import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { PHASE1_CARDS, PLANT_KEYS, ZOMBIE_KEYS, isCard } from '../../src/data/units';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { nextRandom, randomInt } from '../../src/sim/rng';
import { BASE_STOP_X, COLS, LANES, PLANT_COLS, ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type {
  CardKey, Command, CommandRejection, Faction, MatchConfig, SimEvent, SimState,
} from '../../src/sim/types';
import { classicBalance, classicConfig, eventsOf, merge, remove, withBaseDefense } from './helpers';

/**
 * Review Focus 5: crowded and simultaneous moments, and determinism.
 *
 * Two sweeps of seeds play random commands: 50 seeds on a rich setup that keeps the lawn crowded,
 * for 3,000 steps each, and 20 on the plain default configuration, until the latest tick any such
 * match can still be running (see `LAST_POSSIBLE_TICK`). After every step the state is checked
 * (`findProblem`); then each seed is played again from scratch, and once more from a snapshot,
 * and the checksums must agree.
 */

/** The brief's budget for this whole file; a fuzz test that runs past it fails. */
const BUDGET_MS = 20_000;

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];

// ---------------------------------------------------------------------------------------------
// Random commands

type Rng = { rng: number };

const ALL_KEYS: readonly CardKey[] = [...PLANT_KEYS, ...ZOMBIE_KEYS];
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
function pickUnit(r: Rng, faction: Faction): CardKey {
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

/**
 * A merge a player would really try: one of the side's own units, with that unit's own card.
 * Half the time it is the side's highest-level unit (lowest id on a tie), so levels 4 and 5, and
 * then `max-level`, come up in random play. Null when the side has no unit.
 */
function ownMerge(r: Rng, s: Readonly<SimState>, faction: Faction): Command | null {
  const own = s.units.filter((u) => u.faction === faction && isCard(u.key)); // never a Bone Minion
  if (own.length === 0) return null;
  let target = pick(r, own);
  if (randomInt(r, 2) === 0) {
    for (const u of own) if (u.level > target.level || (u.level === target.level && u.id < target.id)) target = u;
  }
  const key = target.key;
  if (!isCard(key)) throw new Error(`${key} is no card`);
  return merge(faction, key, target.id);
}

function randomCommand(r: Rng, s: Readonly<SimState>): Command {
  const faction: Faction = randomInt(r, 2) === 0 ? 'plants' : 'zombies';
  const kind = randomInt(r, 40);
  if (kind < 26) return { type: 'place', faction, unit: pickUnit(r, faction), lane: pickLane(r), col: pickCol(r) };
  if (kind < 33) return ownMerge(r, s, faction) ?? merge(faction, pickUnit(r, faction), pickTarget(r, s));
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
 *    flight longer than it takes to cross the whole lawn;
 *  - there is one base defence timer per lane, each a whole number from 0 to the balance's
 *    `seconds(baseDefense.interval)`.
 */
function findProblem(s: SimState, b: Balance = BALANCE): string | null {
  if (hasNonFinite(s)) return `${pathOfNonFinite(s, 'state')} is not a finite number`;
  for (const f of FACTIONS) {
    const energy = s.players[f].energy;
    if (!(energy >= 0) || !Number.isInteger(energy)) return `${f} energy is ${energy}`;
  }
  const timers = s.baseDefenseTimers;
  if (timers.length !== LANES) return `there are ${timers.length} base defence timers`;
  const longest = seconds(b.baseDefense.interval);
  for (const [lane, left] of timers.entries()) {
    if (!(Number.isInteger(left) && left >= 0 && left <= longest)) return `the base defence timer in lane ${lane} is ${left}`;
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
  const problem = findProblem(m.state, m.balance);
  if (problem !== null) expect.unreachable(`after the step to tick ${m.state.tick}: ${problem}`);
  return events;
}

/**
 * `defaultConfig` turns both heroes on and deals two spells a side; these scenes and the default
 * sweep were written before either existed and never use them, so they say so (and the deal no
 * longer draws on the state rng at creation).
 */
function withoutPowers(config: MatchConfig): MatchConfig {
  config.heroes = { plants: false, zombies: false };
  config.spells = { plants: 0, zombies: 0 };
  return config;
}

describe('the invariant check', () => {
  /** A small live scene: plants, zombies on the move, peas and brains in flight. */
  function scene(): Match {
    const m = new Match(withoutPowers(defaultConfig(4)));
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
    ['a base defence timer below 0', (s) => { s.baseDefenseTimers[1] = -1; }],
    ['a fractional base defence timer', (s) => { s.baseDefenseTimers[2] = 0.5; }],
    ['a base defence timer longer than its interval', (s) => { s.baseDefenseTimers[4] = seconds(BALANCE.baseDefense.interval) + 1; }],
    ['a missing base defence timer', (s) => { s.baseDefenseTimers.pop(); }],
    ['one base defence timer too many', (s) => { s.baseDefenseTimers.push(0); }],
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
 * The match a seed of the rich sweep plays. Richer than a real match so the lawn gets crowded:
 * more energy and faster income for both sides. The plant base's defence is switched on (60 per
 * strike, once a second per lane) so the fuzz exercises it. Most seeds get sturdy bases so the
 * fight lasts all 3,000 steps; every 5th seed gets weak ones, 2,000 a side, so plenty of matches
 * also end (and then sit still): with the base striking back a leak no longer settles a match
 * quickly, and on the shipped 6,000 none of them ended within 3,000 steps. Seeds 3, 13, 23, …
 * (sturdy ones) play a balance whose sudden death starts after 40 s, so the drain runs for a
 * minute alongside a full lawn.
 */
function richSetup(seed: number): { config: MatchConfig; balance: Balance } {
  const balance = withBaseDefense(60, 1);
  if (seed % 10 === 3) balance.suddenDeath.startSeconds = 40;
  const config = defaultConfig(seed, balance);
  config.startEnergy = { plants: 600, zombies: 600 };
  config.incomeMultiplier = { plants: 6, zombies: 1.5 }; // random plants hold a lane less well than random zombies take one
  const baseHp = seed % 5 === 0 ? 2000 : 30_000;
  config.baseHp = { plants: baseHp, zombies: baseHp };
  return { config, balance };
}

interface Sweep {
  name: string;
  seeds: readonly number[];
  /** Steps each seed plays. */
  steps: number;
  /** Steps after which the checksum is taken and compared with the replay. Ascending, ending at `steps`. */
  checkpoints: readonly number[];
  /** The step after which the snapshot is taken that the restored run continues from. */
  snapshotAt: number;
  /** Seeds whose match must still be playing at the snapshot, so the restore covers live play. */
  liveAtSnapshot: (seed: number) => boolean;
  setup: (seed: number) => { config: MatchConfig; balance: Balance };
}

const RICH: Sweep = {
  name: 'rich setup',
  seeds: Array.from({ length: 50 }, (_, i) => i + 1),
  steps: 3000,
  checkpoints: [500, 1000, 2000, 3000],
  snapshotAt: 1500,
  liveAtSnapshot: (seed) => seed % 5 !== 0, // the sturdy-base seeds; the others may end sooner
  setup: richSetup,
};

/**
 * The latest tick a match on the shipped balance can still be running, whatever the tuned values.
 * Once sudden death starts both bases lose the same share of `BALANCE.baseHp` every tick, growing
 * with time, and neither can heal: a base at its full health is empty `t` seconds later, where
 * `rate × t + growth × t² / 2 = 1`. A few seconds are added for the drain being paid per tick.
 */
const LAST_POSSIBLE_TICK = ((): number => {
  const { startSeconds, baseRate: r, growthPerSecond: g } = BALANCE.suddenDeath;
  const drainSeconds = g > 0 ? (-r + Math.sqrt(r * r + 2 * g)) / g : 1 / r;
  return seconds(startSeconds + drainSeconds + 5);
})();

/**
 * The plain default configuration, played until `LAST_POSSIBLE_TICK`, so every seed's match ends
 * however the balance is tuned. The snapshot and the extra checkpoints (300, 600, 900) fall where
 * every seed is still playing.
 */
const PLAIN: Sweep = {
  name: 'default config',
  seeds: Array.from({ length: 20 }, (_, i) => i + 1),
  steps: LAST_POSSIBLE_TICK,
  checkpoints: [300, 500, 600, 900, 1000, 2000, 3000, LAST_POSSIBLE_TICK],
  snapshotAt: 600,
  liveAtSnapshot: () => true,
  setup: (seed) => ({ config: withoutPowers(defaultConfig(seed)), balance: BALANCE }),
};

interface FuzzRun {
  /** The first broken invariant, with where it happened, or null. */
  problem: string | null;
  /** The checksum after each of the sweep's checkpoints. */
  hashes: number[];
  /** The same, for the same seed played again from scratch. */
  replayHashes: number[];
  /** The checksum after the last step of a run continued from `Match.restore(snapshot)`. */
  restoredHash: number;
  /** Whether the match was still being played when the snapshot was taken. */
  liveAtSnapshot: boolean;
  /** The step on which the match ended, or null if it was still playing after the last step. */
  endedAtStep: number | null;
  /** How often each event type, death cause, merge level and rejection reason came up. */
  tally: Map<string, number>;
}

function count(tally: Map<string, number>, key: string): void {
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

function tallyEvents(tally: Map<string, number>, events: readonly SimEvent[]): void {
  for (const e of events) {
    count(tally, e.type);
    if (e.type === 'unitDied') count(tally, `unitDied:${e.cause}`);
    if (e.type === 'unitMerged') count(tally, `unitMerged:level${e.level}`);
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

const runs = new Map<string, FuzzRun>();

/** Plays one seed of a sweep (once per file; later calls reuse the result). */
function fuzzRun(sweep: Sweep, seed: number): FuzzRun {
  const key = `${sweep.name}:${seed}`;
  const known = runs.get(key);
  if (known) return known;

  const { config, balance } = sweep.setup(seed);

  // First run: every invariant after every step, checksums at the checkpoints, the snapshot.
  const first = new Match(config, balance);
  const hashes: number[] = [];
  const tally = new Map<string, number>();
  let snapshot = '';
  let liveAtSnapshot = false;
  let endedAtStep: number | null = null;
  let problem: string | null = null;
  play(first, seed, sweep.steps, (step, events) => {
    tallyEvents(tally, events);
    if (endedAtStep === null && first.state.winner !== null) endedAtStep = step;
    if (problem === null) {
      const found = findProblem(first.state, balance);
      if (found !== null) problem = `${sweep.name}, seed ${seed}, step ${step} (tick ${first.state.tick}): ${found}`;
    }
    if (sweep.checkpoints.includes(step)) hashes.push(first.hash());
    if (step === sweep.snapshotAt) {
      snapshot = first.snapshot();
      liveAtSnapshot = first.state.winner === null;
    }
  });

  // Second run: the same seed from scratch.
  const replay = new Match(config, balance);
  const replayHashes: number[] = [];
  play(replay, seed, sweep.steps, (step) => {
    if (sweep.checkpoints.includes(step)) replayHashes.push(replay.hash());
  });

  // Third run: from the snapshot to the last step.
  const restored = Match.restore(snapshot, balance);
  play(restored, seed, sweep.steps - sweep.snapshotAt);

  const run: FuzzRun = {
    problem, hashes, replayHashes, restoredHash: restored.hash(), liveAtSnapshot, endedAtStep, tally,
  };
  runs.set(key, run);
  return run;
}

/** A step number the way the test names write it: 3000 → "3,000". */
function num(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ',');
}

/** Step numbers as a list in words: "500, 1,000 and 3,000". */
function list(steps: readonly number[]): string {
  const words = steps.map(num);
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** The brief's three determinism checks, for one sweep. */
function describeSweep(sweep: Sweep): void {
  describe(`fuzz, ${sweep.name}: ${sweep.seeds.length} seeds × ${num(sweep.steps)} steps of random commands`, () => {
    it('keeps every invariant after every step', () => {
      const problems = sweep.seeds.map((seed) => fuzzRun(sweep, seed).problem).filter((p) => p !== null);
      expect(problems).toEqual([]); // a list, so a failure prints each seed's problem in full
    }, BUDGET_MS);

    it(`gives the same hash at ticks ${list(sweep.checkpoints)} when a seed is run twice`, () => {
      for (const seed of sweep.seeds) {
        const run = fuzzRun(sweep, seed);
        expect(run.hashes, `seed ${seed}`).toHaveLength(sweep.checkpoints.length);
        expect(run.replayHashes, `seed ${seed}`).toEqual(run.hashes);
      }
    }, BUDGET_MS);

    it(`gives the same hash at tick ${num(sweep.steps)} after a snapshot at tick ${num(sweep.snapshotAt)} and Match.restore`, () => {
      for (const seed of sweep.seeds) {
        const run = fuzzRun(sweep, seed);
        if (sweep.liveAtSnapshot(seed)) {
          expect(run.liveAtSnapshot, `seed ${seed} had already ended at the snapshot`).toBe(true);
        }
        expect(run.restoredHash, `seed ${seed}`).toBe(run.hashes.at(-1));
      }
    }, BUDGET_MS);
  });
}

describeSweep(RICH);
describeSweep(PLAIN);

describe('fuzz coverage', () => {
  /** Event counts over every seed of a sweep. */
  function totals(sweep: Sweep): Map<string, number> {
    const total = new Map<string, number>();
    for (const seed of sweep.seeds) {
      for (const [key, n] of fuzzRun(sweep, seed).tally) total.set(key, (total.get(key) ?? 0) + n);
    }
    return total;
  }

  it('plays a different match for every seed, and exercises merges to level 5, the shovel, deaths, blasts, base strikes, endings and every rejection', () => {
    // Guards against a fuzz that quietly stops testing anything (say, every command rejected).
    for (const sweep of [RICH, PLAIN]) {
      const finals = new Set(sweep.seeds.map((seed) => fuzzRun(sweep, seed).hashes.at(-1)));
      expect(finals.size, sweep.name).toBe(sweep.seeds.length);
    }

    const total = totals(RICH);
    const expected = [
      'unitSpawned', 'unitMerged', 'unitMerged:level4', 'unitMerged:level5', 'unitAttacked',
      'projectileSpawned', 'projectileHit', 'unitDamaged', 'unitDied:damage', 'unitDied:blast',
      'unitDied:shovel', 'explosion', 'baseDamaged', 'baseStruck', 'energyGained', 'suddenDeath', 'matchEnded',
    ];
    // Every reason a step can give; `match-over` never shows as an event, as a finished match's
    // step returns nothing.
    const reasons: readonly CommandRejection[] = [
      'wrong-side', 'not-in-hand', 'no-energy', 'recharging', 'bad-lane', 'bad-column', 'occupied',
      'no-target', 'wrong-type', 'max-level', 'not-yours', 'plants-only',
    ];
    for (const key of [...expected, ...reasons.map((r) => `rejected:${r}`)]) {
      expect(total.get(key) ?? 0, key).toBeGreaterThan(0);
    }
    // The plain sweep plays real matches to their end, merges included.
    const plain = totals(PLAIN);
    for (const key of ['unitMerged', 'unitDied:damage', 'unitDied:shovel', 'matchEnded']) {
      expect(plain.get(key) ?? 0, `default config: ${key}`).toBeGreaterThan(0);
    }
  }, BUDGET_MS);
});

// ---------------------------------------------------------------------------------------------
// Crafted crowded moments

describe('crowded moments', () => {
  it('30 Very Fast Walkers in one lane against one Walnut Bomb, then a merge aimed at it the step after it died', () => {
    const m = new Match(withoutPowers(defaultConfig(9)));
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
    const m = new Match(classicConfig(9), classicBalance()); // enough energy for the merge; phase-1 bounty share
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

// ---------------------------------------------------------------------------------------------
// Phase 2: statuses and flights survive a snapshot

describe('snapshot and restore mid-flight and mid-poison (review focus 2)', () => {
  it('a 3-unit match with a lobbed shot in flight and a poisoned unit, restored at tick 40, reaches the unbroken hash at tick 400', () => {
    const balance = cloneBalance(classicBalance());
    balance.units.kernelPult = { // synthetic until Task 2: a poisoning lob
      recharge: 5, hp: 300, armor: 0, speed: 0,
      shot: {
        kind: 'kernel', damage: 12, interval: 1, range: 10, speed: 6, flight: 'lobbed', splash: 0.5,
        status: { kind: 'poison', seconds: 20, dps: 3 },
      },
    };
    const unbroken = new Match(classicConfig(5, balance), balance);
    const pult = spawnUnit(unbroken.state, balance, 'kernelPult', 2, 0.5);
    const eater = spawnUnit(unbroken.state, balance, 'brainEater', 2, 5);
    spawnUnit(unbroken.state, balance, 'skeletonWarrior', 2, 9.5);
    pult.shotTimer = 0;

    for (let i = 0; i < 40; i++) checkedStep(unbroken);
    expect(unbroken.state.tick).toBe(40);
    const inFlight = unbroken.state.projectiles.filter((p) => p.flight === 'lobbed' && p.targetId !== null);
    expect(inFlight).toHaveLength(1);
    expect(eater.poison).toBeGreaterThan(0);
    expect(eater.poisonDps).toBe(3);
    const snapshot = unbroken.snapshot();

    const restored = Match.restore(snapshot, balance);
    expect(restored.hash()).toBe(unbroken.hash());
    for (let i = 0; i < 360; i++) {
      checkedStep(unbroken);
      restored.step();
    }

    expect(unbroken.state.tick).toBe(400);
    expect(restored.hash()).toBe(unbroken.hash());
    expect(restored.state).toEqual(unbroken.state);
    // The poison really ran across the snapshot: the Brain Eater lost health to it after tick 40.
    expect(eater.hp).toBeLessThan(400);
  });
});
