import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { PHASE1_CARDS, PLANT_KEYS, ZOMBIE_KEYS } from '../../src/data/units';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { nextRandom, randomInt } from '../../src/sim/rng';
import { BASE_STOP_X, COLS, LANES, PLANT_COLS, ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type {
  Command, CommandRejection, Faction, MatchConfig, SimEvent, SimState, UnitKey,
} from '../../src/sim/types';
import { eventsOf, merge, remove } from './helpers';

/**
 * Review Focus 5: crowded and simultaneous moments, and determinism.
 *
 * 50 seeds each play 3,000 steps of random commands. After every step the state is checked
 * (`findProblem`); then the same seed is played again from scratch, and once more from a
 * snapshot taken half way, and the checksums must agree.
 */

const SEEDS: readonly number[] = Array.from({ length: 50 }, (_, i) => i + 1);
const STEPS = 3000;
const CHECKPOINTS: readonly number[] = [500, 1000, 2000, 3000];
const SNAPSHOT_AT = 1500;
/** The brief's budget for this whole file; a fuzz test that runs past it fails. */
const BUDGET_MS = 20_000;

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];

// ---------------------------------------------------------------------------------------------
// Random commands

type Rng = { rng: number };

const ALL_KEYS: readonly UnitKey[] = [...PLANT_KEYS, ...ZOMBIE_KEYS];
const BAD_LANES: readonly number[] = [-1, LANES, 2.5, Number.NaN];
const BAD_COLS: readonly number[] = [-1, PLANT_COLS, COLS - 1, 3.5, Number.NaN, Number.POSITIVE_INFINITY];
const IMPOSSIBLE_IDS: readonly number[] = [0, -1, 1.5, Number.NaN];

function pick<T>(r: Rng, items: readonly T[]): T {
  const item = items[randomInt(r, items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

function otherSide(f: Faction): Faction {
  return f === 'plants' ? 'zombies' : 'plants';
}

/** Mostly the side's own cards; sometimes the other side's, or one that is in no hand. */
function pickUnit(r: Rng, faction: Faction): UnitKey {
  const roll = randomInt(r, 10);
  if (roll < 8) return pick(r, PHASE1_CARDS[faction]);
  if (roll < 9) return pick(r, PHASE1_CARDS[otherSide(faction)]);
  return pick(r, ALL_KEYS);
}

function pickLane(r: Rng): number {
  return randomInt(r, 10) < 9 ? randomInt(r, LANES) : pick(r, BAD_LANES);
}

function pickCol(r: Rng): number {
  return randomInt(r, 10) < 9 ? randomInt(r, PLANT_COLS) : pick(r, BAD_COLS);
}

/**
 * A target id: a living unit (often the wrong side, type or level), any id handed out so far
 * (a living unit, a dead one, or a projectile), an id not handed out yet, or one no unit can have.
 */
function pickTarget(r: Rng, s: Readonly<SimState>): number {
  const roll = randomInt(r, 10);
  if (roll < 6 && s.units.length > 0) return pick(r, s.units).id;
  if (roll < 8) return 1 + randomInt(r, Math.max(1, s.nextId - 1));
  if (roll < 9) return s.nextId + randomInt(r, 100);
  return pick(r, IMPOSSIBLE_IDS);
}

function randomCommand(r: Rng, s: Readonly<SimState>): Command {
  const faction: Faction = randomInt(r, 2) === 0 ? 'plants' : 'zombies';
  const kind = randomInt(r, 40);
  if (kind < 26) return { type: 'place', faction, unit: pickUnit(r, faction), lane: pickLane(r), col: pickCol(r) };
  if (kind < 39) return merge(faction, pickUnit(r, faction), pickTarget(r, s));
  return remove(faction, pickTarget(r, s));
}

/**
 * 0–2 commands for one tick, valid and invalid ones for both sides. Every choice is drawn from
 * `seed` and `tick` with the project's own generator on a private `{ rng }` (never Math.random,
 * never the match's own rng), so a seed always gives the same commands in the same state. The
 * state is only read, to aim merges and removals (see `pickTarget`).
 */
function randomCommands(seed: number, tick: number, s: Readonly<SimState>): Command[] {
  const r: Rng = { rng: (Math.imul(seed, 0x9e3779b1) ^ Math.imul(tick + 0x632be5ab, 0x85ebca6b)) >>> 0 };
  nextRandom(r); // mixes seed and tick before the first real draw
  const count = randomInt(r, 3);
  const commands: Command[] = [];
  for (let i = 0; i < count; i++) commands.push(randomCommand(r, s));
  return commands;
}

// ---------------------------------------------------------------------------------------------
// Invariants

/** True if any number anywhere in `v` is NaN or infinite. Kept lean: it runs after every step. */
function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v !== 'object' || v === null) return false;
  if (Array.isArray(v)) {
    for (const item of v) if (hasNonFinite(item)) return true;
    return false;
  }
  const record = v as Record<string, unknown>;
  for (const key in record) if (hasNonFinite(record[key])) return true;
  return false;
}

/** Where the first non-finite number is, for the failure message. */
function pathOfNonFinite(v: unknown, path: string): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (typeof v !== 'object' || v === null) return null;
  for (const [key, child] of Object.entries(v)) {
    const found = pathOfNonFinite(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function isLane(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < LANES;
}

/**
 * The first broken invariant, or null:
 *  - no NaN or Infinity in any numeric field of the state;
 *  - both energies ≥ 0 (and whole);
 *  - every unit has 0 < hp ≤ maxHp and a lane 0..4, every zombie 0.3 ≤ x ≤ 9.5;
 *  - unit ids are unique;
 *  - every projectile's lane is 0..4, and none is orphaned: it moves, and it has not been in
 *    flight longer than it takes to cross the whole lawn.
 */
function findProblem(s: SimState): string | null {
  if (hasNonFinite(s)) return `${pathOfNonFinite(s, 'state')} is not a finite number`;
  for (const f of FACTIONS) {
    const energy = s.players[f].energy;
    if (!(energy >= 0) || !Number.isInteger(energy)) return `${f} energy is ${energy}`;
  }
  const ids = new Set<number>();
  for (const u of s.units) {
    const name = `unit ${u.id} (${u.key})`;
    if (!(u.hp > 0 && u.hp <= u.maxHp)) return `${name} has ${u.hp}/${u.maxHp} hp`;
    if (!isLane(u.lane)) return `${name} is in lane ${u.lane}`;
    if (u.faction === 'zombies' && !(u.x >= BASE_STOP_X && u.x <= ZOMBIE_SPAWN_X)) return `${name} is at x ${u.x}`;
    if (ids.has(u.id)) return `unit id ${u.id} appears twice`;
    ids.add(u.id);
  }
  for (const p of s.projectiles) {
    if (!isLane(p.lane)) return `projectile ${p.id} is in lane ${p.lane}`;
    if (!(p.speed > 0)) return `projectile ${p.id} has speed ${p.speed}`;
    const age = s.tick - p.spawnTick;
    if (age > Math.ceil((COLS + 1) / p.speed) + 1) return `projectile ${p.id} has been flying for ${age} ticks`;
  }
  return null;
}

/** Steps `m` and checks every invariant straight after. */
function checkedStep(m: Match, commands: readonly Command[] = []): SimEvent[] {
  const events = m.step(commands);
  const problem = findProblem(m.state);
  if (problem !== null) expect.unreachable(`after the step to tick ${m.state.tick}: ${problem}`);
  return events;
}

describe('the invariant check', () => {
  /** A small live scene: plants, zombies on the move, peas and brains in flight. */
  function scene(): Match {
    const m = new Match(defaultConfig(4));
    spawnUnit(m.state, BALANCE, 'peashooter', 1, 0.5);
    spawnUnit(m.state, BALANCE, 'brainEater', 1, 3);
    spawnUnit(m.state, BALANCE, 'skeletonWarrior', 3, 9.5);
    for (let i = 0; i < 60; i++) m.step();
    expect(m.state.projectiles.length).toBeGreaterThan(0);
    return m;
  }

  const breakages: Array<[string, (s: SimState) => void]> = [
    ['a NaN deep in a unit', (s) => { s.units[0]!.shotTimer = Number.NaN; }],
    ['an Infinity in a card recharge', (s) => { s.players.zombies.recharge.brainEater = Number.POSITIVE_INFINITY; }],
    ['a NaN in the config', (s) => { s.config.incomeMultiplier.plants = Number.NaN; }],
    ['negative energy', (s) => { s.players.plants.energy = -1; }],
    ['fractional energy', (s) => { s.players.zombies.energy = 10.5; }],
    ['a unit at 0 hp', (s) => { s.units[0]!.hp = 0; }],
    ['a unit above its max hp', (s) => { s.units[0]!.hp = s.units[0]!.maxHp + 1; }],
    ['a unit in lane 5', (s) => { s.units[0]!.lane = 5; }],
    ['a unit in lane 1.5', (s) => { s.units[0]!.lane = 1.5; }],
    ['a zombie past the base stop', (s) => { s.units.find((u) => u.faction === 'zombies')!.x = 0.29; }],
    ['a zombie beyond the spawn edge', (s) => { s.units.find((u) => u.faction === 'zombies')!.x = 9.51; }],
    ['two units with one id', (s) => { s.units[1]!.id = s.units[0]!.id; }],
    ['a projectile in lane -1', (s) => { s.projectiles[0]!.lane = -1; }],
    ['a projectile that does not move', (s) => { s.projectiles[0]!.speed = 0; }],
    ['a projectile flying for ever', (s) => { s.projectiles[0]!.spawnTick = s.tick - 1000; }],
  ];

  it('passes a healthy state', () => {
    expect(findProblem(scene().state)).toBeNull();
  });

  it.each(breakages)('catches %s', (_name, breakIt) => {
    const m = scene();
    breakIt(m.state);
    expect(findProblem(m.state)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The fuzz runs

/**
 * The match a seed plays. Richer than a real match so the lawn gets crowded: more energy and
 * faster income for both sides. Most seeds get sturdy bases so the fight lasts all 3,000 steps;
 * every 5th seed keeps the shipped base health so plenty of matches also end (and then sit
 * still), and every 10th plays a balance whose sudden death starts after 40 s.
 */
function fuzzSetup(seed: number): { config: MatchConfig; balance: Balance } {
  const balance = seed % 10 === 0
    ? { ...BALANCE, suddenDeath: { ...BALANCE.suddenDeath, startSeconds: 40 } }
    : BALANCE;
  const config = defaultConfig(seed, balance);
  config.startEnergy = { plants: 600, zombies: 600 };
  config.incomeMultiplier = { plants: 6, zombies: 1.5 }; // random plants hold a lane less well than random zombies take one
  if (seed % 5 !== 0) config.baseHp = { plants: 30_000, zombies: 30_000 };
  return { config, balance };
}

interface FuzzRun {
  /** The first broken invariant, with where it happened, or null. */
  problem: string | null;
  /** The checksum after steps 500, 1,000, 2,000 and 3,000. */
  hashes: number[];
  /** The same, for the same seed played again from scratch. */
  replayHashes: number[];
  /** The checksum after a snapshot at step 1,500, `Match.restore` and 1,500 more steps. */
  restoredHash: number;
  /** How often each event type, death cause and rejection reason came up. */
  tally: Map<string, number>;
}

function count(tally: Map<string, number>, key: string): void {
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

function tallyEvents(tally: Map<string, number>, events: readonly SimEvent[]): void {
  for (const e of events) {
    count(tally, e.type);
    if (e.type === 'unitDied') count(tally, `unitDied:${e.cause}`);
    if (e.type === 'commandRejected') count(tally, `rejected:${e.reason}`);
  }
}

/**
 * Plays `steps` steps of the seed's commands from where `m` stands, calling `after` after each.
 * Counts steps, not ticks: once a match has ended its tick stands still.
 */
function play(m: Match, seed: number, steps: number, after?: (step: number, events: SimEvent[]) => void): void {
  for (let step = 1; step <= steps; step++) {
    const events = m.step(randomCommands(seed, m.state.tick, m.state));
    after?.(step, events);
  }
}

const runs = new Map<number, FuzzRun>();

/** Plays one seed (once per file; later calls reuse the result). */
function fuzzRun(seed: number): FuzzRun {
  const known = runs.get(seed);
  if (known) return known;

  const { config, balance } = fuzzSetup(seed);

  // First run: every invariant after every step, checksums at the checkpoints, a snapshot half way.
  const first = new Match(config, balance);
  const hashes: number[] = [];
  const tally = new Map<string, number>();
  let snapshot = '';
  let problem: string | null = null;
  play(first, seed, STEPS, (step, events) => {
    tallyEvents(tally, events);
    if (problem === null) {
      const found = findProblem(first.state);
      if (found !== null) problem = `seed ${seed}, step ${step} (tick ${first.state.tick}): ${found}`;
    }
    if (CHECKPOINTS.includes(step)) hashes.push(first.hash());
    if (step === SNAPSHOT_AT) snapshot = first.snapshot();
  });

  // Second run: the same seed from scratch.
  const replay = new Match(config, balance);
  const replayHashes: number[] = [];
  play(replay, seed, STEPS, (step) => {
    if (CHECKPOINTS.includes(step)) replayHashes.push(replay.hash());
  });

  // Third run: from the snapshot.
  const restored = Match.restore(snapshot, balance);
  play(restored, seed, STEPS - SNAPSHOT_AT);

  const run: FuzzRun = { problem, hashes, replayHashes, restoredHash: restored.hash(), tally };
  runs.set(seed, run);
  return run;
}

describe(`fuzz: ${SEEDS.length} seeds × ${STEPS} steps of random commands`, () => {
  it('keeps every invariant after every step', () => {
    const problems = SEEDS.map((seed) => fuzzRun(seed).problem).filter((p) => p !== null);
    expect(problems).toEqual([]); // a list, so a failure prints each seed's problem in full
  }, BUDGET_MS);

  it('gives the same hash at ticks 500, 1,000, 2,000 and 3,000 when a seed is run twice', () => {
    for (const seed of SEEDS) {
      const run = fuzzRun(seed);
      expect(run.hashes, `seed ${seed}`).toHaveLength(CHECKPOINTS.length);
      expect(run.replayHashes, `seed ${seed}`).toEqual(run.hashes);
    }
  }, BUDGET_MS);

  it('gives the same hash at tick 3,000 after a snapshot at tick 1,500 and Match.restore', () => {
    for (const seed of SEEDS) {
      const run = fuzzRun(seed);
      expect(run.restoredHash, `seed ${seed}`).toBe(run.hashes[run.hashes.length - 1]);
    }
  }, BUDGET_MS);

  it('plays a different match for every seed, and exercises merges, the shovel, deaths, blasts, endings and the rejections', () => {
    // Guards against a fuzz that quietly stops testing anything (say, every command rejected).
    // `max-level` is left out: four random merges on one unit are too rare to count on.
    const finals = new Set(SEEDS.map((seed) => fuzzRun(seed).hashes.at(-1)));
    expect(finals.size).toBe(SEEDS.length);

    const total = new Map<string, number>();
    for (const seed of SEEDS) {
      for (const [key, n] of fuzzRun(seed).tally) total.set(key, (total.get(key) ?? 0) + n);
    }
    const expected = [
      'unitSpawned', 'unitMerged', 'unitAttacked', 'projectileSpawned', 'projectileHit', 'unitDamaged',
      'unitDied:damage', 'unitDied:blast', 'unitDied:shovel', 'explosion', 'baseDamaged', 'energyGained',
      'suddenDeath', 'matchEnded',
    ];
    const reasons: readonly CommandRejection[] = [
      'wrong-side', 'not-in-hand', 'no-energy', 'recharging', 'bad-lane', 'bad-column', 'occupied',
      'no-target', 'wrong-type', 'not-yours', 'plants-only',
    ];
    for (const key of [...expected, ...reasons.map((r) => `rejected:${r}`)]) {
      expect(total.get(key) ?? 0, key).toBeGreaterThan(0);
    }
  }, BUDGET_MS);
});

// ---------------------------------------------------------------------------------------------
// Crafted crowded moments

describe('crowded moments', () => {
  it('30 Very Fast Walkers in one lane against one Walnut Bomb, then a merge aimed at it the step after it died', () => {
    const m = new Match(defaultConfig(9));
    const nut = spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 3.5);
    spawnUnit(m.state, BALANCE, 'peashooter', 2, 0.5); // peas in flight through the crowd
    const walkers = Array.from({ length: 30 }, (_, i) =>
      spawnUnit(m.state, BALANCE, 'veryFastWalker', 2, ZOMBIE_SPAWN_X - (i % 5) * 0.1));

    let fall: SimEvent[] = [];
    for (let i = 0; i < 2000; i++) {
      fall = checkedStep(m);
      if (eventsOf(fall, 'unitDied').some((e) => e.unitId === nut.id)) break;
    }
    expect(eventsOf(fall, 'unitDied').find((e) => e.unitId === nut.id)?.cause).toBe('damage');
    expect(eventsOf(fall, 'explosion')).toEqual([
      { type: 'explosion', lane: 2, x: 3.5, radius: 1.5, sourceKey: 'walnutBomb' },
    ]);
    // The blast reached the whole crowd: no walker left standing has more than 180 - 150.
    const standing = walkers.filter((w) => m.state.units.includes(w));
    expect(standing.length).toBeGreaterThan(0);
    for (const w of standing) expect(w.hp).toBeLessThanOrEqual(30);

    // The step after: a merge and a removal aimed at the fallen Walnut Bomb find nothing.
    const aimed = [merge('plants', 'walnutBomb', nut.id), remove('plants', nut.id)];
    for (const cmd of aimed) expect(m.check(cmd)).toBe('no-target');
    const after = checkedStep(m, aimed);
    expect(eventsOf(after, 'commandRejected').map((e) => e.reason)).toEqual(['no-target', 'no-target']);
    expect(eventsOf(after, 'unitMerged')).toEqual([]);

    // The crowd goes on to the plant base; the invariants hold all the way to the end.
    for (let i = 0; i < 3000 && m.state.winner === null; i++) checkedStep(m);
    expect(m.state.winner).toBe('zombies');
  });

  it("a level-2 Walnut Bomb's blast fells all 30 walkers in one step, and a merge aimed at one of them next step finds nothing", () => {
    const m = new Match(defaultConfig(9));
    const nut = spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 3.5);
    checkedStep(m, [merge('plants', 'walnutBomb', nut.id)]);
    expect(nut).toMatchObject({ level: 2, hp: 2400, maxHp: 2400, spent: 150 });
    const walkers = Array.from({ length: 30 }, () => spawnUnit(m.state, BALANCE, 'veryFastWalker', 2, ZOMBIE_SPAWN_X));

    let fall: SimEvent[] = [];
    for (let i = 0; i < 2000; i++) {
      fall = checkedStep(m);
      if (eventsOf(fall, 'unitDied').some((e) => e.unitId === nut.id)) break;
    }
    const deaths = eventsOf(fall, 'unitDied');
    expect(deaths).toHaveLength(31);
    expect(deaths[0]).toMatchObject({ unitId: nut.id, cause: 'damage', level: 2 });
    expect(deaths.slice(1).map((e) => [e.unitId, e.cause])).toEqual(walkers.map((w) => [w.id, 'blast']));
    const bounties = eventsOf(fall, 'energyGained').filter((e) => e.source === 'bounty');
    expect(bounties.filter((e) => e.faction === 'zombies').map((e) => e.amount)).toEqual([75]); // 50% of 150
    expect(bounties.filter((e) => e.faction === 'plants').map((e) => e.amount)).toEqual(Array(30).fill(10)); // 20% of 50
    expect(m.state.units).toEqual([]);

    const energy = { plants: m.state.players.plants.energy, zombies: m.state.players.zombies.energy };
    const aimed = [merge('zombies', 'veryFastWalker', walkers[0]!.id), merge('plants', 'walnutBomb', nut.id)];
    const after = checkedStep(m, aimed);
    expect(eventsOf(after, 'commandRejected').map((e) => e.reason)).toEqual(['no-target', 'no-target']);
    expect(m.state.units).toEqual([]);
    // Nothing was spent: energy only grew by the trickle.
    expect(m.state.players.plants.energy).toBeGreaterThanOrEqual(energy.plants);
    expect(m.state.players.zombies.energy).toBeGreaterThanOrEqual(energy.zombies);
  });
});
