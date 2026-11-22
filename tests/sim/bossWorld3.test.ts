import { describe, expect, it } from 'vitest';
import { BALANCE, seconds } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { patternsOf } from '../../src/sim/boss';
import { Match, defaultConfig } from '../../src/sim/match';
import { PLANT_COLS } from '../../src/sim/types';
import type { BossConfig, Command, MatchConfig, SimEvent, Unit } from '../../src/sim/types';
import { place } from './helpers';

/**
 * The world-3 bosses' numbers (step-3 plan Task 4, content design §2): the Sand Pharaoh (p3-8, the
 * zombies' boss) and the Cactus King (z3-8, the plants'). Like bossWorld2 these read the shipped
 * rows, so the level tasks' hp tuning moves nothing here but the fights' lengths.
 */

const PHARAOH: BossConfig = { key: 'sandPharaoh', faction: 'zombies', lane: 2 };
const CACTUS: BossConfig = { key: 'cactusKing', faction: 'plants', lane: 2 };
const pharaoh = BALANCE.bosses.sandPharaoh;
const cactus = BALANCE.bosses.cactusKing;

describe('the rows (content design §2)', () => {
  it('the Sand Pharaoh: a 7 s sand swirl (×0.5) at half health; mummy-wrapped sandstorm in phase 2', () => {
    expect([pharaoh.hp, pharaoh.speed, pharaoh.col, pharaoh.guardFactor]).toEqual([7000, 0.1, undefined, undefined]);
    expect(pharaoh.patterns.filter((p) => p.kind === 'shield')).toEqual([
      { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 7, damageFactor: 0.5, bouncesStraight: false },
    ]);
    expect(pharaoh.phases).toHaveLength(2);
    expect(pharaoh.phases![0]).toEqual([
      { kind: 'summon', everySeconds: 9, unit: 'desertZombie', count: 2, level: 1 },
      { kind: 'slam', everySeconds: 11, windupSeconds: 1.5, damage: 380, sideDamage: 160, reach: 0.6 },
    ]);
    expect(pharaoh.phases![1]).toEqual([
      { kind: 'strike', everySeconds: 6, windupSeconds: 2, target: 'tiles', count: 3, damage: 50, status: { kind: 'blind', seconds: 3 } },
      { kind: 'summon', everySeconds: 5, unit: 'skeletonWarrior', count: 2, level: 2 },
      { kind: 'slam', everySeconds: 7, windupSeconds: 1.5, damage: 380, sideDamage: 160, reach: 0.6 },
    ]);
  });

  it('the Cactus King: column 0, guard ×0.5, 8 s spine armour at half health; rockfall in phase 2', () => {
    expect([cactus.hp, cactus.speed, cactus.col, cactus.guardFactor]).toEqual([6200, 0, 0, 0.5]);
    expect(cactus.patterns.filter((p) => p.kind === 'shield')).toEqual([
      { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 8, damageFactor: 0.5, bouncesStraight: false },
    ]);
    expect(cactus.phases).toHaveLength(2);
    expect(cactus.phases![0]).toEqual([
      { kind: 'barrage', everySeconds: 9, count: 3, damage: 200, splash: 0.75, speed: 5 },
      { kind: 'summon', everySeconds: 12, unit: 'kernelPult', count: 2, level: 1, minCol: 1, maxCol: 4 },
    ]);
    expect(cactus.phases![1]).toEqual([
      { kind: 'strike', everySeconds: 6, windupSeconds: 2.5, target: 'tiles', count: 3, damage: 220 },
      { kind: 'barrage', everySeconds: 7, count: 4, damage: 200, splash: 0.75, speed: 5 },
      { kind: 'summon', everySeconds: 12, unit: 'walnutBomb', count: 2, level: 1, minCol: 2, maxCol: 5 },
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

describe('the phases switch at the mark', () => {
  it.each([['sandPharaoh', PHARAOH], ['cactusKing', CACTUS]] as const)('%s: at half health the shield goes up and phase 2 starts with its strike', (_key, cfg) => {
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
    expect(boss().patternTimer).toBe(seconds(6) - 1);
  });
});

describe('the strikes: announced, then struck', () => {
  /** Plants on some tiles of every lane (columns 1, 3, 5 of lanes 0-4 hold a Walnut Bomb; the rest are empty). */
  const plantsOn = (cols: number[]): NonNullable<MatchConfig['prepared']> =>
    [0, 1, 2, 3, 4].flatMap((lane) => cols.map((c) => ({ unit: 'walnutBomb' as const, faction: 'plants' as const, lane, x: c + 0.5, level: 1 })));

  it('the sandstorm picks only tiles with plants, says so 2 s before, then hits 3 of them: 50 damage and 3 s of blindness', () => {
    for (const seed of [1, 2, 3]) {
      const { m, boss } = level(PHARAOH, { prepared: plantsOn([1, 3, 5]) }, seed);
      boss().hp = boss().maxHp * 0.5;
      m.step();
      const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
      const announcedAt = m.state.tick;
      expect(said.tiles).toHaveLength(3);
      for (const t of said.tiles) expect([seed, [1, 3, 5].includes(t.col)]).toEqual([seed, true]);
      expect(new Set(said.tiles.map((t) => `${t.lane},${t.col}`)).size).toBe(3);
      const hit = untilStrike(m, false);
      expect(m.state.tick - announcedAt).toBe(seconds(2));
      const struck = new Set(said.tiles.map((t) => `${t.lane},${t.col}`));
      for (const u of m.state.units.filter((x) => x.key === 'walnutBomb')) {
        const on = struck.has(`${u.lane},${Math.floor(u.x)}`);
        expect([seed, u.lane, u.x, u.maxHp - u.hp]).toEqual([seed, u.lane, u.x, on ? 50 - u.armor : 0]);
        expect(hit.some((e) => e.type === 'statusApplied' && e.unitId === u.id && e.status === 'blind' && e.ticks === seconds(3))).toBe(on);
      }
    }
  });

  it('the rockfall picks only tiles with zombies, says so 2.5 s before, then hits 3 of them: 220 damage, no status', () => {
    const zombies = (): NonNullable<MatchConfig['prepared']> =>
      [0, 1, 2, 3, 4].flatMap((lane) => [2.5, 5.5, 8.5].map((x) => ({ unit: 'skeletonWarrior' as const, faction: 'zombies' as const, lane, x, level: 1 })));
    for (const seed of [1, 2, 3]) {
      const { m, boss } = level(CACTUS, { prepared: zombies() }, seed);
      boss().hp = boss().maxHp * 0.5;
      m.step();
      const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
      const announcedAt = m.state.tick;
      expect(said.tiles).toHaveLength(3);
      for (const t of said.tiles) {
        const there = m.state.units.some((u) => u.faction === 'zombies' && u.lane === t.lane && Math.floor(u.x) === t.col);
        expect([seed, t.lane, t.col, there]).toEqual([seed, t.lane, t.col, true]);
      }
      // The blow lands on whoever stands on the announced tiles in the step it falls.
      const struck = new Set(said.tiles.map((t) => `${t.lane},${t.col}`));
      let onTiles = new Set<number>();
      let blow: SimEvent[] = [];
      for (let i = 0; i < seconds(2.5) + 5 && blow.length === 0; i++) {
        onTiles = new Set(m.state.units.filter((u) => u.faction === 'zombies' && struck.has(`${u.lane},${Math.floor(u.x)}`)).map((u) => u.id));
        const events = m.step();
        if (events.some((e) => e.type === 'bossStrike' && !e.windup)) blow = events;
      }
      expect(m.state.tick - announcedAt).toBe(seconds(2.5));
      expect(blow.some((e) => e.type === 'statusApplied')).toBe(false);
      const hurt = blow.filter((e): e is Extract<SimEvent, { type: 'unitDamaged' }> => e.type === 'unitDamaged' && e.amount >= 100);
      expect(hurt.length).toBeGreaterThan(0);
      for (const e of hurt) expect([seed, onTiles.has(e.unitId), e.amount]).toEqual([seed, true, 220 - m.state.units.find((u) => u.id === e.unitId)!.armor]);
    }
  });

  it('with no plant (no zombie) on the lawn the strike announces nothing', () => {
    const { m, boss } = level(PHARAOH, {}, 1);
    boss().hp = boss().maxHp * 0.5;
    m.step();
    for (let i = 0; i < 30 * 3; i++) {
      for (const e of m.step()) if (e.type === 'bossStrike') expect(e.tiles).toEqual([]);
    }
  });
});

describe('the Cactus King\'s summons skip rocks', () => {
  it('Kernel-pults and Walnut Bombs land only on free tiles: no rock, no plant', () => {
    // Rocks on every tile of columns 1-4 of the flanks (lanes 0 and 4), as the z3-8 design has them.
    const rocks: number[] = [];
    for (const lane of [0, 4]) for (let col = 1; col <= 5; col++) rocks.push(lane * PLANT_COLS + col);
    for (const seed of [1, 2, 3, 4]) {
      const { m, boss } = level(CACTUS, { lawn: { ...defaultConfig(seed, BALANCE).lawn, rocks } }, seed);
      const landed: { lane: number; col: number; key: string }[] = [];
      for (let i = 0; i < seconds(70); i++) {
        if (boss().phase === 0 && boss().hp > boss().maxHp * 0.5 && i === seconds(30)) boss().hp = boss().maxHp * 0.5;
        for (const e of m.step()) if (e.type === 'unitSpawned' && (e.key === 'kernelPult' || e.key === 'walnutBomb')) landed.push({ lane: e.lane, col: Math.floor(e.x), key: e.key });
      }
      expect(landed.some((l) => l.key === 'kernelPult')).toBe(true);
      expect(landed.some((l) => l.key === 'walnutBomb')).toBe(true);
      for (const l of landed) expect([seed, l.key, rocks.includes(l.lane * PLANT_COLS + l.col)]).toEqual([seed, l.key, false]);
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
      if (t % 100 === 10) out.push(place('plants', k % 3 === 2 ? 'torchwood' : k % 3 === 1 ? 'kernelPult' : 'peashooter', (k * 2) % 5, (t / 500 | 0) % 4));
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
    ['sandPharaoh', 1, PHARAOH], ['sandPharaoh', 2, PHARAOH], ['cactusKing', 1, CACTUS], ['cactusKing', 2, CACTUS],
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
