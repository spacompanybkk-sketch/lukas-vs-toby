import { describe, expect, it } from 'vitest';
import { BALANCE, seconds } from '../../src/data/balance';
import type { BossPattern, BossStats } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { damageUnit } from '../../src/sim/damage';
import { patternsOf } from '../../src/sim/boss';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { BossConfig, Command, MatchConfig, SimEvent, Unit } from '../../src/sim/types';
import { place } from './helpers';

/**
 * The world-2 bosses' numbers (step-2 plan Task 4, content design §2): the Moon Howler (p2-8, the
 * zombies' boss) and the Frost Melon (z2-8, the plants'). These tests read the shipped rows, so the
 * level tasks' hp tuning moves nothing here but the fights' lengths; the scripted fights assert only
 * that they end, pass the mark and stay deterministic through a snapshot.
 *
 * Rhythm (ruling A13 of the phase-3 plan: `everySeconds` is the gap after the previous timed pattern,
 * and the timed patterns take turns): phase 1 is a two-pattern cycle of 10–11 s, so each attack
 * comes back about every 10–11 s (an attack every 5–5.5 s); phase 2 is a three-pattern cycle of
 * 10 s (an attack every 3.3 s), faster as the design asks.
 */

const HOWLER: BossConfig = { key: 'moonHowler', faction: 'zombies', lane: 2 };
const MELON: BossConfig = { key: 'frostMelon', faction: 'plants', lane: 2 };
const howler = BALANCE.bosses.moonHowler;
const melon = BALANCE.bosses.frostMelon;

const cycle = (list: readonly BossPattern[]): number => list.reduce((n, p) => n + p.everySeconds, 0);
const timed = (list: readonly BossPattern[]): number => list.filter((p) => p.everySeconds > 0).length;

describe('the rows (content design §2)', () => {
  it('the Moon Howler: two phases, a 7 s straight-bouncing dome at half health', () => {
    expect([howler.hp, howler.speed, howler.col, howler.guardFactor]).toEqual([5500, 0.1, undefined, undefined]);
    expect(howler.phases).toHaveLength(2);
    expect(howler.patterns.filter((p) => p.kind === 'shield')).toEqual([
      { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 7, damageFactor: 1, bouncesStraight: true },
    ]);
    expect(howler.phases![0]).toEqual([
      { kind: 'summon', everySeconds: 5, unit: 'veryFastWalker', count: 2, level: 1 },
      { kind: 'slam', everySeconds: 6, windupSeconds: 1.5, damage: 350, sideDamage: 150, reach: 0.6 },
    ]);
    expect(howler.phases![1]).toEqual([
      { kind: 'strike', everySeconds: 4, windupSeconds: 2, target: 'lanes', count: 1, damage: 60, status: { kind: 'blind', seconds: 4 } },
      { kind: 'summon', everySeconds: 3, unit: 'brainEater', count: 2, level: 2 },
      { kind: 'slam', everySeconds: 3, windupSeconds: 1.5, damage: 350, sideDamage: 150, reach: 0.6 },
    ]);
  });

  it('the Frost Melon: two phases, 8 s ice plates (×0.5) at half health, on column 0 guarding the base', () => {
    expect([melon.hp, melon.speed, melon.col, melon.guardFactor]).toEqual([6000, 0, 0, 0.5]);
    expect(melon.phases).toHaveLength(2);
    expect(melon.patterns.filter((p) => p.kind === 'shield')).toEqual([
      { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 8, damageFactor: 0.5, bouncesStraight: false },
    ]);
    expect(melon.phases![0]).toEqual([
      { kind: 'barrage', everySeconds: 4, count: 3, damage: 200, splash: 0.75, speed: 5 },
      { kind: 'summon', everySeconds: 6, unit: 'peashooter', count: 2, level: 1, minCol: 1, maxCol: 4 },
    ]);
    expect(melon.phases![1]).toEqual([
      { kind: 'strike', everySeconds: 4, windupSeconds: 2.5, target: 'lanes', count: 2, damage: 80, status: { kind: 'stun', seconds: 2 } },
      { kind: 'barrage', everySeconds: 3, count: 4, damage: 200, splash: 0.75, speed: 5 },
      { kind: 'summon', everySeconds: 3, unit: 'walnutBomb', count: 2, level: 1, minCol: 2, maxCol: 5 },
    ]);
  });

  it.each([['moonHowler', howler], ['frostMelon', melon]] as const)('%s: phase 2 attacks more often than phase 1, each attack back within 11 s', (_key, stats: BossStats) => {
    const [p1, p2] = [patternsOf(stats, 0), patternsOf(stats, 1)];
    expect(cycle(p1)).toBeLessThanOrEqual(11);
    expect(cycle(p2)).toBeLessThanOrEqual(11);
    expect(cycle(p2) / timed(p2)).toBeLessThan(cycle(p1) / timed(p1));
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

const everyLane = (unit: 'walnutBomb' | 'skeletonWarrior', x: number): MatchConfig['prepared'] =>
  [0, 1, 2, 3, 4].map((lane) => ({ unit, faction: unit === 'walnutBomb' ? 'plants' : 'zombies', lane, x, level: 1 }));

describe('the phases switch at the mark', () => {
  it.each([['moonHowler', HOWLER], ['frostMelon', MELON]] as const)('%s: at half health the shield goes up and phase 2 starts with its strike', (_key, cfg) => {
    const { m, boss } = level(cfg);
    for (let i = 0; i < 30 * 3; i++) m.step();
    boss().hp = boss().maxHp * 0.5 + 1;
    expect(m.step().some((e) => e.type === 'bossPhase')).toBe(false);
    boss().hp = boss().maxHp * 0.5;
    const events = m.step();
    expect(events).toContainEqual({ type: 'bossPhase', unitId: boss().id, phase: 1 });
    const stats = BALANCE.bosses[cfg.key];
    expect(boss().shieldLeft).toBe(seconds(stats.patterns.find((p) => p.kind === 'shield')!.seconds));
    expect(boss().pattern).toBe(0);
    expect(patternsOf(stats, 1)[0]!.kind).toBe('strike');
    expect(boss().patternTimer).toBe(seconds(4) - 1);
  });
});

describe('the strikes: announced, then struck', () => {
  it('the Moon Howler howls down one whole lane: 60 damage and 4 s of blindness to the plants standing in it', () => {
    for (const seed of [1, 2, 3]) {
      const { m, boss } = level(HOWLER, { prepared: everyLane('walnutBomb', 1.5) }, seed);
      boss().hp = boss().maxHp * 0.5;
      m.step();
      const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
      const lanes = [...new Set(said.tiles.map((t) => t.lane))];
      expect(lanes).toHaveLength(1);
      expect(said.tiles).toHaveLength(10);
      const hit = untilStrike(m, false);
      for (const u of m.state.units.filter((x) => x.key === 'walnutBomb')) {
        const struck = lanes.includes(u.lane);
        expect([seed, u.lane, u.maxHp - u.hp]).toEqual([seed, u.lane, struck ? 60 : 0]);
        expect(hit.some((e) => e.type === 'statusApplied' && e.unitId === u.id && e.status === 'blind' && e.ticks === seconds(4))).toBe(struck);
      }
    }
  });

  it('the Frost Melon freezes two whole lanes: 80 damage (less armor) and a 2 s stun to the zombies standing in them', () => {
    for (const seed of [1, 2, 3]) {
      const { m, boss } = level(MELON, { prepared: everyLane('skeletonWarrior', 8.5) }, seed);
      boss().hp = boss().maxHp * 0.5;
      m.step();
      const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
      expect(boss().strikeTiles).toHaveLength(20);
      const lanes = [...new Set(said.tiles.map((t) => t.lane))];
      expect(lanes).toHaveLength(2);
      const hit = untilStrike(m, false);
      for (const u of m.state.units.filter((x) => x.key === 'skeletonWarrior')) {
        const struck = lanes.includes(u.lane);
        expect([seed, u.lane, u.maxHp - u.hp]).toEqual([seed, u.lane, struck ? 80 - u.armor : 0]);
        expect(hit.some((e) => e.type === 'statusApplied' && e.unitId === u.id && e.status === 'stun' && e.ticks === seconds(2))).toBe(struck);
      }
    }
  });
});

describe('the shields', () => {
  /** The Howler with its dome up, held still (stunned: no patterns) at x 6; one `plant` in its lane; the damage it took over 5 s. */
  function dome(plant: 'peashooter' | 'kernelPult' | 'mangoPult'): { hits: number; blocked: number; damage: number[] } {
    const { m, boss } = level(HOWLER);
    boss().x = 6;
    boss().hp = boss().maxHp * 0.5;
    m.step();
    expect(boss().shieldLeft).toBeGreaterThan(seconds(6));
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

  it('the Howler\'s dome bounces every straight shot (a Peashooter does nothing)', () => {
    const pea = dome('peashooter');
    expect(pea.hits).toBeGreaterThanOrEqual(2);
    expect(pea.blocked).toBe(pea.hits);
    expect(pea.damage).toEqual([]);
  });

  it.each([['kernelPult'], ['mangoPult']] as const)('lobbed shots go through the dome (%s), at the shield\'s damage factor', (plant) => {
    const factor = howler.patterns.find((p) => p.kind === 'shield')!.damageFactor;
    const lob = dome(plant);
    expect(lob.hits).toBeGreaterThan(0);
    expect(lob.blocked).toBe(0);
    expect(lob.damage.length).toBeGreaterThan(0);
    expect(lob.damage.every((d) => d === BALANCE.units[plant]!.shot!.damage * factor)).toBe(true);
  });

  it('the Melon\'s ice plates halve all damage for 8 s, then it takes full damage again', () => {
    const { m, boss } = level(MELON);
    boss().hp = boss().maxHp * 0.5;
    m.step();
    const hurt = (): number => {
      const events: SimEvent[] = [];
      damageUnit(m.state, m.balance, boss(), 100, events);
      return events.filter((e): e is Extract<SimEvent, { type: 'unitDamaged' }> => e.type === 'unitDamaged').reduce((n, e) => n + e.amount, 0);
    };
    expect(hurt()).toBe(50);
    for (let i = 0; i < seconds(8) - 2; i++) m.step();
    expect(boss().shieldLeft).toBeGreaterThan(0);
    expect(hurt()).toBe(50);
    m.step();
    m.step();
    expect(boss().shieldLeft).toBe(0);
    expect(hurt()).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------
// Scripted fights: a fixed list of commands (no bot, so no AI change can move them).

function commandsFor(boss: BossConfig): (t: number) => Command[] {
  if (boss.faction === 'zombies') {
    return (t) => {
      const out: Command[] = [];
      const k = (t / 150) | 0;
      if (t % 150 === 10) out.push(place('plants', k % 3 === 2 ? 'mangoPult' : k % 3 === 1 ? 'kernelPult' : 'peashooter', k % 5, (t / 750 | 0) % 4));
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
    startEnergy: { plants: 400, zombies: 400 },
  };
  if (boss.faction === 'plants') {
    // The Melon guards the plant base: the zombies get double income and a big base, so the fight is
    // decided at the boss (it passes the mark and freezes lanes) and not by the Peashooters' shots.
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

/** Plays the scripted fight to its end; snapshots at tick `at`, or at the 10th step of the first strike wind-up (`at` 'windup'). */
function fight(boss: BossConfig, seed: number, at: number | 'windup', from?: Match): Fight {
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
    const due = at === 'windup' ? windupSeen >= 0 && m.state.tick === windupSeen + 10 : m.state.tick === at;
    if (snapshot === null && due && from === undefined) {
      snapshot = JSON.stringify(m.snapshot());
      snapAt = m.state.tick;
    }
  }
  return { m, phases, strikes, snapAt, snapshot };
}

describe('scripted fights end, pass the mark, and restore from a snapshot to the same end', () => {
  it.each([
    ['moonHowler', 1, HOWLER], ['moonHowler', 2, HOWLER], ['frostMelon', 1, MELON], ['frostMelon', 2, MELON],
  ] as const)('%s, seed %i', (key, seed, boss) => {
    for (const at of [1500, 'windup'] as const) {
      const a = fight(boss, seed, at);
      expect(a.m.state.winner, `${key} ${seed} ends`).not.toBeNull();
      expect(a.phases).toBe(1);
      expect(a.strikes).toBeGreaterThan(0);
      expect(a.snapshot, `${key} ${seed} snapshot at ${String(at)}`).not.toBeNull();
      const restored = Match.restore(JSON.parse(a.snapshot!), BALANCE);
      expect(restored.state.tick).toBe(a.snapAt);
      if (at === 'windup') expect(restored.state.units.find((u) => u.key === key)!.strikeTiles.length).toBeGreaterThan(0);
      const b = fight(boss, seed, at, restored);
      expect([b.m.state.tick, b.m.state.winner, b.m.hash()]).toEqual([a.m.state.tick, a.m.state.winner, a.m.hash()]);
    }
  });
});
