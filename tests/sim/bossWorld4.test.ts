import { describe, expect, it } from 'vitest';
import { BALANCE, seconds } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { patternsOf } from '../../src/sim/boss';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { PLANT_COLS } from '../../src/sim/types';
import type { BossConfig, Command, MatchConfig, SimEvent, Unit } from '../../src/sim/types';
import { place } from './helpers';

/**
 * The world-4 bosses' numbers (worlds-4 plan Task 4, content design §2, Rulings 8-9): the Yeti (p4-8,
 * the zombies' boss) and the Glowcap (z4-8, the plants'). Like bossWorld3 these read the shipped
 * rows, so the level tasks' hp tuning moves nothing here but the fights' lengths.
 */

const YETI: BossConfig = { key: 'yeti', faction: 'zombies', lane: 2 };
const GLOWCAP: BossConfig = { key: 'glowcap', faction: 'plants', lane: 2 };
const yeti = BALANCE.bosses.yeti;
const glowcap = BALANCE.bosses.glowcap;

const SLAM = (everySeconds: number) => ({ kind: 'slam', everySeconds, windupSeconds: 1.5, damage: 380, sideDamage: 160, reach: 0.6 });

describe('the rows (content design §2, Rulings 8-9)', () => {
  it('the Yeti: two marks, a snow fort (x0.5) that bounces straight shots; avalanche from phase 2, skeletons in phase 3', () => {
    expect([yeti.speed, yeti.col, yeti.guardFactor]).toEqual([0.1, undefined, undefined]);
    expect(yeti.hp).toBeGreaterThanOrEqual(6500);
    expect(yeti.patterns.filter((p) => p.kind === 'shield')).toEqual([
      { kind: 'shield', everySeconds: 0, atHealth: [0.66, 0.33], seconds: 6, damageFactor: 0.5, bouncesStraight: true },
    ]);
    expect(yeti.phases).toHaveLength(3);
    expect(yeti.phases![0]).toEqual([
      { kind: 'summon', everySeconds: 8, unit: 'veryFastWalker', count: 3, level: 1 },
      SLAM(11),
    ]);
    expect(yeti.phases![1]).toEqual([
      { kind: 'strike', everySeconds: 6, windupSeconds: 2, target: 'lanes', count: 1, damage: 80, status: { kind: 'stun', seconds: 2 } },
      { kind: 'summon', everySeconds: 5, unit: 'veryFastWalker', count: 2, level: 2 },
      SLAM(7),
    ]);
    expect(yeti.phases![2]).toEqual([
      { kind: 'strike', everySeconds: 6, windupSeconds: 2, target: 'lanes', count: 2, damage: 80, status: { kind: 'stun', seconds: 2 } },
      { kind: 'summon', everySeconds: 5, unit: 'skeletonWarrior', count: 2, level: 2 },
      SLAM(6),
    ]);
  });

  it('the Glowcap: column 0, guard x0.5, 8 s cap plates at half health; spore cloud in phase 2', () => {
    expect([glowcap.speed, glowcap.col, glowcap.guardFactor]).toEqual([0, 0, 0.5]);
    expect(glowcap.hp).toBeGreaterThanOrEqual(10000);
    expect(glowcap.patterns.filter((p) => p.kind === 'shield')).toEqual([
      { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 8, damageFactor: 0.5, bouncesStraight: false },
    ]);
    expect(glowcap.phases).toHaveLength(2);
    expect(glowcap.phases![0]).toEqual([
      { kind: 'barrage', everySeconds: 9, count: 3, damage: 180, splash: 1.0, speed: 5 },
      { kind: 'summon', everySeconds: 12, unit: 'peashooter', count: 2, level: 1, minCol: 1, maxCol: 4 },
    ]);
    expect(glowcap.phases![1]).toEqual([
      { kind: 'strike', everySeconds: 6, windupSeconds: 2.5, target: 'tiles', count: 4, damage: 40, status: { kind: 'poison', seconds: 4, dps: 20 } },
      { kind: 'barrage', everySeconds: 7, count: 4, damage: 180, splash: 1.0, speed: 5 },
      { kind: 'summon', everySeconds: 14, unit: 'avocadoBunker', count: 1, level: 1, minCol: 2, maxCol: 5 },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------

/** A boss level with every card and plenty of energy; no heroes, spells, income or sudden death. */
function bossConfig(boss: BossConfig, patch: Partial<MatchConfig> = {}, seed = 1): MatchConfig {
  return {
    ...defaultConfig(seed, BALANCE), mode: 'boss', boss,
    heroes: { plants: false, zombies: false }, spells: { plants: 0, zombies: 0 },
    incomeMultiplier: { plants: 0, zombies: 0 }, startEnergy: { plants: 5000, zombies: 5000 },
    cards: { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] },
    suddenDeath: false, ...patch,
  };
}

function level(boss: BossConfig, patch: Partial<MatchConfig> = {}, seed = 1): { m: Match; boss: () => Unit } {
  const m = new Match(bossConfig(boss, patch, seed), BALANCE);
  m.step();
  return { m, boss: () => m.state.units.find((u) => u.key === boss.key)! };
}

type StrikeEvent = Extract<SimEvent, { type: 'bossStrike' }>;

function untilStrike(m: Match, windup: boolean, limit = 30 * 20): SimEvent[] {
  for (let i = 0; i < limit; i++) {
    const events = m.step();
    if (events.some((e) => e.type === 'bossStrike' && e.windup === windup)) return events;
  }
  throw new Error('no strike');
}

const everyLane = (unit: 'walnutBomb' | 'skeletonWarrior', x: number): NonNullable<MatchConfig['prepared']> =>
  [0, 1, 2, 3, 4].map((lane) => ({ unit, faction: unit === 'walnutBomb' ? 'plants' as const : 'zombies' as const, lane, x, level: 1 }));

describe('the Yeti passes two marks', () => {
  it('at 66% the fort goes up and phase 2 opens with the avalanche; at 33% again, phase 3, with two lanes', () => {
    const { m, boss } = level(YETI);
    for (let i = 0; i < 30 * 3; i++) m.step();
    boss().hp = boss().maxHp * 0.66 + 1;
    expect(m.step().some((e) => e.type === 'bossPhase')).toBe(false);
    boss().hp = boss().maxHp * 0.66;
    expect(m.step()).toContainEqual({ type: 'bossPhase', unitId: boss().id, phase: 1 });
    expect(boss().shieldLeft).toBe(seconds(6));
    expect(boss().pattern).toBe(0);
    expect(patternsOf(yeti, 1)[0]!.kind).toBe('strike');
    expect(boss().patternTimer).toBe(seconds(6) - 1);
    boss().hp = boss().maxHp * 0.33;
    expect(m.step()).toContainEqual({ type: 'bossPhase', unitId: boss().id, phase: 2 });
    expect(boss().shieldLeft).toBe(seconds(6));
    expect(boss().pattern).toBe(0);
    expect(patternsOf(yeti, 2)[0]).toMatchObject({ kind: 'strike', count: 2 });
    expect(boss().patternTimer).toBe(seconds(6) - 1);
  });

  it('phase 1 opens with its summon; the fort never goes up again at a mark already passed', () => {
    const { m, boss } = level(YETI);
    expect(patternsOf(yeti, 0)[boss().pattern]!.kind).toBe('summon');
    boss().hp = boss().maxHp * 0.6;
    m.step();
    expect(boss().phase).toBe(1);
    for (let i = 0; i < seconds(7); i++) m.step();
    expect(boss().shieldLeft).toBe(0);
    boss().hp = boss().maxHp * 0.65; // healed back above the first mark
    boss().hp = boss().maxHp * 0.62;
    const events: SimEvent[] = [];
    for (let i = 0; i < 30; i++) events.push(...m.step());
    expect(events.some((e) => e.type === 'bossPhase')).toBe(false);
    expect([boss().phase, boss().shieldLeft]).toEqual([1, 0]);
    // The second mark's fort comes once, and a third dip does not bring a third.
    boss().hp = boss().maxHp * 0.3;
    expect(m.step().filter((e) => e.type === 'bossPhase')).toHaveLength(1);
    for (let i = 0; i < seconds(7); i++) m.step();
    boss().hp = boss().maxHp * 0.1;
    expect(m.step().some((e) => e.type === 'bossPhase')).toBe(false);
    expect(boss().shieldLeft).toBe(0);
  });
});

describe('the Yeti\'s snow fort', () => {
  /** The fort up, the Yeti held still (stunned: no patterns) at x 6, one `plant` in its lane; the shots that hit it over 5 s. */
  function fort(plant: 'peashooter' | 'mangoPult'): { hits: number; blocked: number; damage: number[] } {
    const { m, boss } = level(YETI);
    boss().x = 6;
    boss().hp = boss().maxHp * 0.6;
    m.step();
    expect(boss().shieldLeft).toBeGreaterThan(seconds(5));
    spawnUnit(m.state, m.balance, plant, 2, 1.5);
    const events: SimEvent[] = [];
    for (let i = 0; i < seconds(5); i++) {
      boss().stun = 10;
      events.push(...m.step());
    }
    expect(boss().shieldLeft).toBeGreaterThan(0);
    const hits = events.filter((e): e is Extract<SimEvent, { type: 'projectileHit' }> => e.type === 'projectileHit' && e.targetId === boss().id);
    const damage = events.filter((e): e is Extract<SimEvent, { type: 'unitDamaged' }> => e.type === 'unitDamaged' && e.unitId === boss().id).map((e) => e.amount);
    return { hits: hits.length, blocked: hits.filter((e) => e.blocked).length, damage };
  }

  it('bounces every straight shot (a Peashooter does nothing)', () => {
    const pea = fort('peashooter');
    expect(pea.hits).toBeGreaterThanOrEqual(2);
    expect(pea.blocked).toBe(pea.hits);
    expect(pea.damage).toEqual([]);
  });

  it('lets a lobbed shot through at x0.5 (the Mango-pult)', () => {
    const lob = fort('mangoPult');
    expect(lob.hits).toBeGreaterThan(0);
    expect(lob.blocked).toBe(0);
    expect(lob.damage.length).toBeGreaterThan(0);
    expect(lob.damage.every((d) => d === BALANCE.units.mangoPult!.shot!.damage * 0.5)).toBe(true);
  });
});

describe('the avalanche: announced, then struck', () => {
  it('phase 2 drops it down one whole lane: 80 damage and a 2 s stun to the plants standing in it', () => {
    for (const seed of [1, 2, 3]) {
      const { m, boss } = level(YETI, { prepared: everyLane('walnutBomb', 1.5) }, seed);
      boss().hp = boss().maxHp * 0.6;
      m.step();
      const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
      const announcedAt = m.state.tick;
      const lanes = [...new Set(said.tiles.map((t) => t.lane))];
      expect(lanes).toHaveLength(1);
      expect(said.tiles).toHaveLength(10);
      const hit = untilStrike(m, false);
      expect(m.state.tick - announcedAt).toBe(seconds(2));
      for (const u of m.state.units.filter((x) => x.key === 'walnutBomb')) {
        const struck = lanes.includes(u.lane);
        expect([seed, u.lane, u.maxHp - u.hp]).toEqual([seed, u.lane, struck ? 80 - u.armor : 0]);
        expect(hit.some((e) => e.type === 'statusApplied' && e.unitId === u.id && e.status === 'stun' && e.ticks === seconds(2))).toBe(struck);
      }
    }
  });

  it('phase 3 drops it down two lanes at once', () => {
    const { m, boss } = level(YETI, { prepared: everyLane('walnutBomb', 1.5) }, 1);
    boss().hp = boss().maxHp * 0.3;
    m.step();
    const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
    expect(new Set(said.tiles.map((t) => t.lane)).size).toBe(2);
    expect(said.tiles).toHaveLength(20);
  });

  it('the summons land in random lanes: veryFastWalkers appear in more than one lane over a phase', () => {
    const lanes = new Set<number>();
    for (const seed of [1, 2, 3]) {
      const { m, boss } = level(YETI, {}, seed);
      boss().hp = boss().maxHp * 0.6;
      for (let i = 0; i < seconds(30); i++) for (const e of m.step()) if (e.type === 'unitSpawned' && e.key === 'veryFastWalker') lanes.add(e.lane);
    }
    expect(lanes.size).toBeGreaterThan(1);
  });
});

describe('the Yeti on ice', () => {
  it('walks x1.6 as fast down an iced lane 2', () => {
    const run = (ice: MatchConfig['lawn']['ice']): number => {
      const base = defaultConfig(1, BALANCE).lawn;
      const { m, boss } = level(YETI, { lawn: { ...base, ice } });
      const x0 = boss().x;
      for (let i = 0; i < seconds(10); i++) m.step();
      return x0 - boss().x;
    };
    const plain = run(null);
    const iced = run({ lanes: [2], speed: BALANCE.twists.ice.speed });
    expect(plain).toBeGreaterThan(0);
    expect(iced / plain).toBeCloseTo(1.6, 1);
  });
});

describe('the spore cloud: announced, then struck', () => {
  it('picks only tiles with zombies, says so 2.5 s before, then hits 4 of them: 40 damage and 4 s of poison at 20 dps', () => {
    const zombies = (): NonNullable<MatchConfig['prepared']> =>
      [0, 1, 2, 3, 4].flatMap((lane) => [2.5, 5.5, 8.5].map((x) => ({ unit: 'skeletonWarrior' as const, faction: 'zombies' as const, lane, x, level: 1 })));
    for (const seed of [1, 2, 3]) {
      const { m, boss } = level(GLOWCAP, { prepared: zombies() }, seed);
      boss().hp = boss().maxHp * 0.5;
      m.step();
      const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
      const announcedAt = m.state.tick;
      expect(said.tiles).toHaveLength(4);
      expect(new Set(said.tiles.map((t) => `${t.lane},${t.col}`)).size).toBe(4);
      for (const t of said.tiles) {
        const there = m.state.units.some((u) => u.faction === 'zombies' && u.lane === t.lane && Math.floor(u.x) === t.col);
        expect([seed, t.lane, t.col, there]).toEqual([seed, t.lane, t.col, true]);
      }
      const struck = new Set(said.tiles.map((t) => `${t.lane},${t.col}`));
      let onTiles = new Set<number>();
      let blow: SimEvent[] = [];
      for (let i = 0; i < seconds(2.5) + 5 && blow.length === 0; i++) {
        onTiles = new Set(m.state.units.filter((u) => u.faction === 'zombies' && struck.has(`${u.lane},${Math.floor(u.x)}`)).map((u) => u.id));
        const events = m.step();
        if (events.some((e) => e.type === 'bossStrike' && !e.windup)) blow = events;
      }
      expect(m.state.tick - announcedAt).toBe(seconds(2.5));
      expect(onTiles.size).toBeGreaterThan(0);
      for (const id of onTiles) {
        const u = m.state.units.find((x) => x.id === id)!;
        expect(blow.some((e) => e.type === 'statusApplied' && e.unitId === id && e.status === 'poison' && e.ticks === seconds(4)), `seed ${seed}`).toBe(true);
        expect([seed, u.poisonDps, u.poison >= seconds(4) - 1 && u.poison <= seconds(4)]).toEqual([seed, 20, true]); // one tick has run since
        const dmg = blow.find((e): e is Extract<SimEvent, { type: 'unitDamaged' }> => e.type === 'unitDamaged' && e.unitId === id && e.amount >= 20);
        expect(dmg?.amount).toBe(40 - u.armor);
      }
    }
  });
});

describe('the Glowcap\'s summoned Avocado Bunker', () => {
  it('never lands on an occupied tile (a plant or a rock)', () => {
    const rocks: number[] = [];
    for (const lane of [0, 4]) for (let col = 2; col <= 4; col++) rocks.push(lane * PLANT_COLS + col);
    const prepared: NonNullable<MatchConfig['prepared']> = [1, 2, 3].flatMap((lane) =>
      [2, 3, 4, 5].map((c) => ({ unit: 'walnutBomb' as const, faction: 'plants' as const, lane, x: c + 0.5, level: 1 })));
    for (const seed of [1, 2, 3, 4]) {
      const { m, boss } = level(GLOWCAP, { prepared, lawn: { ...defaultConfig(seed, BALANCE).lawn, rocks } }, seed);
      boss().hp = boss().maxHp * 0.5;
      m.step();
      const occupied = new Set(m.state.units.filter((u) => u.faction === 'plants' && u.key !== 'glowcap').map((u) => `${u.lane},${Math.floor(u.x)}`));
      const landed: { lane: number; col: number }[] = [];
      for (let i = 0; i < seconds(70); i++) {
        for (const e of m.step()) if (e.type === 'unitSpawned' && e.key === 'avocadoBunker') landed.push({ lane: e.lane, col: Math.floor(e.x) });
      }
      expect(landed.length).toBeGreaterThan(0);
      for (const l of landed) {
        expect([seed, l.lane, l.col, occupied.has(`${l.lane},${l.col}`) || rocks.includes(l.lane * PLANT_COLS + l.col)]).toEqual([seed, l.lane, l.col, false]);
        occupied.add(`${l.lane},${l.col}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Scripted fights: a fixed list of commands (no bot, so no AI change can move them).

function commandsFor(boss: BossConfig): (t: number) => Command[] {
  if (boss.faction === 'zombies') {
    return (t) => {
      const out: Command[] = [];
      const k = (t / 100) | 0;
      if (t % 100 === 10) out.push(place('plants', k % 3 === 2 ? 'mangoPult' : k % 3 === 1 ? 'kernelPult' : 'peashooter', (k * 2) % 5, (t / 500 | 0) % 4));
      if (t % 450 === 40) out.push(place('plants', 'sunflower', (t / 450 | 0) % 5, 4));
      if (t % 600 === 300) out.push(place('plants', 'walnutBomb', 2, 6 - ((t / 600) | 0) % 2));
      return out;
    };
  }
  return (t) => {
    const out: Command[] = [];
    if (t % 60 === 20) out.push(place('zombies', (t / 60 | 0) % 3 === 0 ? 'skeletonWarrior' : 'brainEater', (t / 60 | 0) % 5, 0));
    if (t % 200 === 77) out.push(place('zombies', 'veryFastWalker', (t / 200 | 0) % 5, 0));
    return out;
  };
}

function fightConfig(boss: BossConfig, seed: number): MatchConfig {
  const c: MatchConfig = {
    ...defaultConfig(seed, BALANCE), mode: 'boss', boss, spells: { plants: 0, zombies: 0 }, heroes: { plants: false, zombies: false },
    startEnergy: { plants: 600, zombies: 400 },
  };
  // The scripted fight is a fixed list of commands, not a defence: with the Yeti's tuned hp (Task 6) the fight runs long
  // enough that the zombie base (default hp) falls before the second mark, so both bases are large enough for the Yeti's hp to decide it.
  if (boss.faction === 'zombies') c.baseHp = { plants: 40_000, zombies: 40_000 };
  if (boss.faction === 'plants') {
    c.incomeMultiplier = { ...c.incomeMultiplier, zombies: 2 };
    c.baseHp = { ...c.baseHp, zombies: 20_000 };
    c.prepared = [
      { unit: 'peashooter', faction: 'plants', lane: 0, x: 3.5, level: 1 },
      { unit: 'peashooter', faction: 'plants', lane: 4, x: 3.5, level: 1 },
    ];
  }
  return c;
}

interface Fight { m: Match; phases: number; strikes: number; snapAt: number; snapshot: string | null }

/** Plays the scripted fight to its end; snapshots at tick `at`, or at the 10th step of the first strike wind-up (`at` 'windup'), or at the first step the shield is up (`at` 'shield'). */
function fight(boss: BossConfig, seed: number, at: number | 'windup' | 'shield', from?: Match): Fight {
  const m = from ?? new Match(fightConfig(boss, seed), BALANCE);
  const commandsAt = commandsFor(boss);
  let phases = 0;
  let strikes = 0;
  let snapshot: string | null = null;
  let snapAt = -1;
  let windupSeen = -1;
  while (m.state.winner === null && m.state.tick < 14_400) {
    for (const e of m.step(commandsAt(m.state.tick))) {
      if (e.type === 'bossPhase') phases += 1;
      if (e.type === 'bossStrike' && !e.windup) strikes += 1;
      if (e.type === 'bossStrike' && e.windup && windupSeen < 0) windupSeen = m.state.tick;
    }
    const shielded = m.state.units.some((u) => u.key === boss.key && u.shieldLeft > 0);
    const due = at === 'windup' ? windupSeen >= 0 && m.state.tick === windupSeen + 10 : at === 'shield' ? shielded : m.state.tick === at;
    if (snapshot === null && due && from === undefined) {
      snapshot = JSON.stringify(m.snapshot());
      snapAt = m.state.tick;
    }
  }
  return { m, phases, strikes, snapAt, snapshot };
}

describe('scripted fights end, pass the marks, and restore from a snapshot to the same end', () => {
  it.each([
    ['yeti', 1, YETI, 2], ['yeti', 2, YETI, 2], ['glowcap', 1, GLOWCAP, 1], ['glowcap', 2, GLOWCAP, 1],
  ] as const)('%s, seed %i', (key, seed, boss, marks) => {
    for (const at of [1500, 'windup', 'shield'] as const) {
      const a = fight(boss, seed, at);
      expect(a.m.state.winner, `${key} ${seed} ends`).not.toBeNull();
      expect(a.phases).toBe(marks);
      expect(a.strikes).toBeGreaterThan(0);
      expect(a.snapshot, `${key} ${seed} snapshot at ${String(at)}`).not.toBeNull();
      const restored = Match.restore(JSON.parse(a.snapshot!), BALANCE);
      expect(restored.state.tick).toBe(a.snapAt);
      if (at === 'windup') expect(restored.state.units.find((u) => u.key === key)!.strikeTiles.length).toBeGreaterThan(0);
      if (at === 'shield') expect(restored.state.units.find((u) => u.key === key)!.shieldLeft).toBeGreaterThan(0);
      const b = fight(boss, seed, at, restored);
      expect([b.m.state.tick, b.m.state.winner, b.m.hash()]).toEqual([a.m.state.tick, a.m.state.winner, a.m.hash()]);
    }
  });
});
