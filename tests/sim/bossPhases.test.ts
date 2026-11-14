import { describe, expect, it } from 'vitest';
import { seconds } from '../../src/data/balance';
import type { Balance, BossStats } from '../../src/data/balance';
import { isWindingUp, patternsOf } from '../../src/sim/boss';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { BossConfig, Command, MatchConfig, SimEvent, Unit } from '../../src/sim/types';
import { classicBalance, place } from './helpers';

/**
 * Boss phases and the `strike` pattern (worlds machinery, Task 3). The Titan and the Oak have no
 * phases and no strike: their fights must play, and hash, exactly as before this task.
 */

/** The Brain Titan and the Elder Oak as shipped when this task began (pinned here, so tuning cannot move these checksums). */
const SHIPPED_TITAN: BossStats = {
  recharge: 0, hp: 3800, armor: 0, speed: 0.1,
  melee: { damage: 40, interval: 1.5, reach: 0.6 },
  maxStunSeconds: 1, stunFalloff: 0.5, stunWindowSeconds: 10, hitCap: 0.1,
  patterns: [
    { kind: 'slam', everySeconds: 12, windupSeconds: 1.5, damage: 400, sideDamage: 200, reach: 0.6 },
    { kind: 'summon', everySeconds: 6, unit: 'veryFastWalker', count: 2, level: 1 },
    { kind: 'shield', everySeconds: 0, atHealth: [0.66, 0.33], seconds: 6, damageFactor: 1, bouncesStraight: true },
  ],
};
const SHIPPED_OAK: BossStats = {
  recharge: 0, hp: 4200, armor: 0, speed: 0,
  maxStunSeconds: 1, stunFalloff: 0.5, stunWindowSeconds: 10, hitCap: 0.1, col: 0, guardFactor: 0.5,
  patterns: [
    { kind: 'barrage', everySeconds: 10, count: 3, damage: 230, splash: 0.75, speed: 5 },
    { kind: 'summon', everySeconds: 10, unit: 'peashooter', count: 2, level: 1, minCol: 1, maxCol: 4 },
    { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 8, damageFactor: 0.5, bouncesStraight: false },
  ],
};

function shippedBosses(): Balance {
  const b = classicBalance();
  b.bosses = { ...b.bosses, brainTitan: structuredClone(SHIPPED_TITAN), elderOak: structuredClone(SHIPPED_OAK) };
  return b;
}

/** A boss fight with a fixed list of commands (no bot, so no later AI change can move it). */
function scriptedFight(boss: BossConfig, seed: number): { m: Match; mid: number; phases: number } {
  const b = shippedBosses();
  const c: MatchConfig = {
    ...defaultConfig(seed, b), mode: 'boss', boss, spells: { plants: 0, zombies: 0 },
    startEnergy: { plants: 400, zombies: 400 },
  };
  if (boss.faction === 'plants') {
    c.prepared = [
      { unit: 'peashooter', faction: 'plants', lane: 0, x: 3.5, level: 1 },
      { unit: 'peashooter', faction: 'plants', lane: 4, x: 3.5, level: 1 },
    ];
  }
  const m = new Match(c, b);
  const commandsAt = (t: number): Command[] => {
    const out: Command[] = [];
    if (boss.faction === 'zombies') {
      if (t % 150 === 10) out.push(place('plants', 'peashooter', (t / 150 | 0) % 5, (t / 750 | 0) % 4));
      if (t % 450 === 40) out.push(place('plants', 'sunflower', (t / 450 | 0) % 5, 4));
      if (t === 300) out.push(place('plants', 'walnutBomb', 2, 6));
      if (t % 600 === 599) out.push({ type: 'hero', faction: 'plants', lane: 2 });
    } else {
      if (t % 120 === 20) out.push(place('zombies', (t / 120 | 0) % 3 === 0 ? 'skeletonWarrior' : 'brainEater', (t / 120 | 0) % 5, 0));
      if (t % 200 === 77) out.push(place('zombies', 'veryFastWalker', (t / 200 | 0) % 5, 0));
      if (t % 600 === 599) out.push({ type: 'hero', faction: 'zombies', lane: (t / 600 | 0) % 5 });
    }
    return out;
  };
  let mid = 0;
  let phases = 0;
  while (m.state.winner === null && m.state.tick < 14_400) {
    for (const e of m.step(commandsAt(m.state.tick))) if (e.type === 'bossPhase') phases += 1;
    if (m.state.tick === 1500) mid = m.hash();
  }
  return { m, mid, phases };
}

describe('the Titan and the Oak play and hash exactly as before boss phases', () => {
  // Pinned at 5f17dd0 (Task 2 done), before this task touched the boss engine.
  const BEFORE: Array<[string, BossConfig, number, number, number, number, string]> = [
    ['titan', { key: 'brainTitan', faction: 'zombies', lane: 2 }, 1, 5268, 2077792557, 3794934943, 'plants'],
    ['titan', { key: 'brainTitan', faction: 'zombies', lane: 2 }, 2, 5268, 1567914996, 982358164, 'plants'],
    ['oak', { key: 'elderOak', faction: 'plants', lane: 2 }, 1, 4723, 1267053511, 933527899, 'plants'],
    ['oak', { key: 'elderOak', faction: 'plants', lane: 2 }, 2, 5293, 202434642, 4215772169, 'plants'],
  ];
  it.each(BEFORE)('%s fight %#', (_name, boss, seed, tick, mid, end, winner) => {
    const { m, mid: midHash, phases } = scriptedFight(boss, seed);
    expect([seed, m.state.tick, midHash, m.hash(), m.state.winner]).toEqual([seed, tick, mid, end, winner]);
    expect(phases).toBe(boss.key === 'brainTitan' ? 2 : 1); // every shield mark passed, so every pattern of the table played
  });
});

// ---------------------------------------------------------------------------------------------
// A test-only boss: the Titan's body with phases and a strike.

type Pattern = BossStats['patterns'][number];
const SUMMON_WALKER: Pattern = { kind: 'summon', everySeconds: 5, unit: 'veryFastWalker', count: 1, level: 1 };
const SUMMON_WARRIOR: Pattern = { kind: 'summon', everySeconds: 3, unit: 'skeletonWarrior', count: 1, level: 1 };
const SLAM: Pattern = { kind: 'slam', everySeconds: 4, windupSeconds: 1, damage: 50, sideDamage: 10, reach: 0.6 };
const SHIELD: Pattern = { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 2, damageFactor: 1, bouncesStraight: false };

function phasedBalance(stats: Partial<BossStats>): Balance {
  const b = shippedBosses();
  b.bosses.brainTitan = { ...b.bosses.brainTitan, speed: 0, ...stats };
  return b;
}

/** A Titan fight with nobody playing; `prepared` plants on the lawn from the start. */
function phasedFight(b: Balance, prepared: MatchConfig['prepared'] = [], seed = 1): { m: Match; boss: () => Unit } {
  const c: MatchConfig = {
    ...defaultConfig(seed, b), mode: 'boss', boss: { key: 'brainTitan', faction: 'zombies', lane: 2 },
    cards: { plants: [], zombies: [] }, heroes: { plants: false, zombies: false }, spells: { plants: 0, zombies: 0 },
    suddenDeath: false, prepared,
  };
  const m = new Match(c, b);
  m.step();
  return { m, boss: () => m.state.units.find((u) => u.key === 'brainTitan')! };
}

function summonedKeys(events: SimEvent[]): string[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'unitSpawned' }> => e.type === 'unitSpawned').map((e) => e.key);
}

describe('patternsOf', () => {
  it('phase i uses phases[i], or the table patterns when there is none', () => {
    const stats = { ...SHIPPED_TITAN, phases: [[SUMMON_WALKER], [SUMMON_WARRIOR]] };
    expect(patternsOf(stats, 0)).toEqual([SUMMON_WALKER]);
    expect(patternsOf(stats, 1)).toEqual([SUMMON_WARRIOR]);
    expect(patternsOf(stats, 2)).toBe(stats.patterns);
    expect(patternsOf(SHIPPED_TITAN, 0)).toBe(SHIPPED_TITAN.patterns);
  });
});

describe('a boss with two phases', () => {
  const b = phasedBalance({ patterns: [SLAM, SHIELD], phases: [[SUMMON_WALKER], [SUMMON_WARRIOR]] });

  it('plays phase 0\'s list from the start, never the table\'s', () => {
    const { m } = phasedFight(b);
    const events: SimEvent[] = [];
    for (let i = 0; i < 30 * 16; i++) events.push(...m.step());
    expect(summonedKeys(events)).toEqual(['veryFastWalker', 'veryFastWalker', 'veryFastWalker']); // at 5, 10 and 15 s
    expect(events.some((e) => e.type === 'bossPattern' && e.kind === 'slam')).toBe(false);
  });

  it('at its shield mark it switches lists and starts the new one from its first timed pattern', () => {
    const { m, boss } = phasedFight(b);
    for (let i = 0; i < 30 * 4; i++) m.step(); // phase 0's summon is due in 1 s
    boss().hp = boss().maxHp * 0.5;
    const events = m.step();
    expect(events).toContainEqual({ type: 'bossPhase', unitId: boss().id, phase: 1 });
    expect(boss().pattern).toBe(0);
    expect(boss().patternTimer).toBe(seconds(3) - 1); // counted down once on the step of the mark
    const after: SimEvent[] = [];
    for (let i = 0; i < 30 * 7; i++) after.push(...m.step());
    expect(summonedKeys(after)).toEqual(['skeletonWarrior', 'skeletonWarrior']); // at 3 and 6 s after the mark
  });

  it('winding up reads the current phase\'s list: a slam in phase 1 holds the boss, the table\'s slam does not count in phase 0', () => {
    const slamLater = phasedBalance({ speed: 0.3, patterns: [SLAM, SHIELD], phases: [[SUMMON_WALKER], [SLAM]] });
    const { m, boss } = phasedFight(slamLater);
    for (let i = 0; i < 30 * 4; i++) {
      m.step();
      expect(isWindingUp(slamLater, boss())).toBe(false);
    }
    boss().hp = boss().maxHp * 0.4;
    let wound = 0;
    let slams = 0;
    for (let i = 0; i < 30 * 5; i++) {
      const x = boss().x;
      const winding = isWindingUp(slamLater, boss()); // decided by the step before: it holds this whole step
      for (const e of m.step()) if (e.type === 'bossPattern' && e.kind === 'slam' && !e.windup) slams += 1;
      if (winding) {
        wound += 1;
        expect(boss().x).toBe(x);
      }
    }
    expect(slams).toBe(1);
    expect(wound).toBeGreaterThan(20);
  });

  it('an acorn splashes as the barrage of the thrower\'s current phase', () => {
    const barrage = (splash: number): Pattern => ({ kind: 'barrage', everySeconds: 2, count: 1, damage: 30, splash, speed: 10 });
    const twoBarrages = phasedBalance({ patterns: [SUMMON_WALKER, SHIELD], phases: [[barrage(0)], [barrage(2)]] });
    const garden: MatchConfig['prepared'] = [
      { unit: 'walnutBomb', faction: 'plants', lane: 0, x: 5.5, level: 1 },
      { unit: 'walnutBomb', faction: 'plants', lane: 0, x: 4.5, level: 1 },
    ];
    const splashed = (phase1: boolean): boolean => {
      const { m, boss } = phasedFight(twoBarrages, garden);
      if (phase1) {
        boss().hp = boss().maxHp * 0.5;
        m.step();
      }
      for (let i = 0; i < 30 * 3; i++) m.step();
      const behind = m.state.units.find((u) => u.key === 'walnutBomb' && u.x === 4.5)!;
      return behind.hp < behind.maxHp;
    };
    expect([splashed(false), splashed(true)]).toEqual([false, true]);
  });

  it('a shield in a phase list is refused: the marks come from the table', () => {
    expect(() => phasedFight(phasedBalance({ patterns: [SLAM, SHIELD], phases: [[SUMMON_WALKER], [SHIELD]] })))
      .toThrow(/boss brainTitan: phase 1 lists a shield; its marks come from its patterns/);
  });

  it('a boss without phases does not reset its patterns at a mark (the Titan and the Oak)', () => {
    const plain = phasedBalance({ patterns: [SUMMON_WALKER, SUMMON_WARRIOR, SHIELD] });
    const { m, boss } = phasedFight(plain);
    for (let i = 0; i < 30 * 4; i++) m.step();
    const [pattern, timer] = [boss().pattern, boss().patternTimer];
    boss().hp = boss().maxHp * 0.5;
    m.step();
    expect([boss().pattern, boss().patternTimer]).toEqual([pattern, timer - 1]);
  });
});

// ---------------------------------------------------------------------------------------------
// The strike.

type StrikeEvent = Extract<SimEvent, { type: 'bossStrike' }>;
const strikeOf = (more: Partial<Extract<Pattern, { kind: 'strike' }>> = {}): Pattern => ({
  kind: 'strike', everySeconds: 4, windupSeconds: 2, target: 'tiles', count: 2, damage: 100, status: { kind: 'stun', seconds: 1 }, ...more,
});
const WALNUTS: MatchConfig['prepared'] = [
  { unit: 'walnutBomb', faction: 'plants', lane: 0, x: 1.5, level: 1 },
  { unit: 'walnutBomb', faction: 'plants', lane: 1, x: 2.5, level: 1 },
  { unit: 'walnutBomb', faction: 'plants', lane: 3, x: 4.5, level: 1 },
  { unit: 'walnutBomb', faction: 'plants', lane: 4, x: 6.5, level: 1 },
];
const tileOf = (u: Unit) => ({ lane: u.lane, col: Math.floor(u.x) });
const same = (a: { lane: number; col: number }, b: { lane: number; col: number }) => a.lane === b.lane && a.col === b.col;

/** Steps until (and including) the step with a bossStrike event of this `windup`; returns its events. */
function untilStrike(m: Match, windup: boolean, limit = 30 * 10): SimEvent[] {
  for (let i = 0; i < limit; i++) {
    const events = m.step();
    if (events.some((e) => e.type === 'bossStrike' && e.windup === windup)) return events;
  }
  throw new Error('no strike');
}

describe('the strike', () => {
  it('tiles: announces `count` tiles with a standing enemy at the start of the wind-up, then hits exactly those, with its status', () => {
    const b = phasedBalance({ patterns: [strikeOf()] });
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { m, boss } = phasedFight(b, WALNUTS, seed);
      const announce = untilStrike(m, true);
      expect(m.state.tick).toBe(seconds(4) - seconds(2)); // the boss came on at tick 0; its timer reached the wind-up 2 s before the strike
      const said = announce.find((e): e is StrikeEvent => e.type === 'bossStrike')!;
      expect(said.unitId).toBe(boss().id);
      expect(said.tiles).toHaveLength(2);
      const walnuts = m.state.units.filter((u) => u.key === 'walnutBomb');
      for (const t of said.tiles) expect(walnuts.some((u) => same(tileOf(u), t))).toBe(true);
      expect(boss().strikeTiles).toEqual(said.tiles.map((t) => t.lane * 10 + t.col));

      const hit = untilStrike(m, false);
      expect(m.state.tick).toBe(seconds(4));
      expect(hit.find((e): e is StrikeEvent => e.type === 'bossStrike')).toEqual({ ...said, windup: false });
      expect(boss().strikeTiles).toEqual([]);
      for (const u of walnuts) {
        const struck = said.tiles.some((t) => same(tileOf(u), t));
        expect([seed, u.lane, u.maxHp - u.hp]).toEqual([seed, u.lane, struck ? 100 : 0]);
        expect(hit.some((e) => e.type === 'statusApplied' && e.unitId === u.id && e.status === 'stun')).toBe(struck);
      }
    }
  });

  it('tiles: an enemy that leaves an announced tile during the wind-up is not hit; one that steps onto it is', () => {
    const b = phasedBalance({ patterns: [strikeOf({ count: 1, status: undefined })] });
    const { m } = phasedFight(b, [{ unit: 'walnutBomb', faction: 'plants', lane: 2, x: 3.5, level: 1 }]);
    const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
    expect(said.tiles).toEqual([{ lane: 2, col: 3 }]);
    const walnut = m.state.units.find((u) => u.key === 'walnutBomb')!;
    walnut.x = 4.5; // (the test moves it: plants never walk)
    const other = spawnUnit(m.state, m.balance, 'sunflower', 2, 3.5);
    untilStrike(m, false);
    expect([walnut.hp === walnut.maxHp, other.hp === other.maxHp]).toEqual([true, false]);
  });

  it('lanes: `count` whole lanes, every tile of them, with a burn of its dps', () => {
    const b = phasedBalance({ patterns: [strikeOf({ target: 'lanes', count: 2, damage: 40, status: { kind: 'burn', seconds: 2, dps: 20 } })] });
    const { m } = phasedFight(b, WALNUTS, 3);
    const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
    const lanes = [...new Set(said.tiles.map((t) => t.lane))];
    expect(lanes).toHaveLength(2);
    expect(said.tiles).toEqual(lanes.flatMap((lane) => Array.from({ length: 10 }, (_, col) => ({ lane, col }))));
    untilStrike(m, false);
    for (const u of m.state.units.filter((x) => x.key === 'walnutBomb')) {
      const struck = lanes.includes(u.lane);
      expect([u.lane, u.maxHp - u.hp > 0, u.burnDps]).toEqual([u.lane, struck, struck ? 20 : 0]);
    }
  });

  it('a plant boss strikes zombies (the Elder Oak with a strike, the zombies wherever they stand)', () => {
    const b = shippedBosses();
    b.bosses.elderOak = { ...b.bosses.elderOak, patterns: [strikeOf({ count: 5, target: 'tiles', status: undefined }), SHIPPED_OAK.patterns[2]!] };
    const c: MatchConfig = {
      ...defaultConfig(1, b), mode: 'boss', boss: { key: 'elderOak', faction: 'plants', lane: 2 },
      cards: { plants: [], zombies: [] }, heroes: { plants: false, zombies: false }, spells: { plants: 0, zombies: 0 }, suddenDeath: false,
      prepared: [{ unit: 'skeletonWarrior', faction: 'zombies', lane: 4, x: 9.5, level: 1 }],
    };
    const m = new Match(c, b);
    m.step();
    const z = m.state.units.find((u) => u.key === 'skeletonWarrior')!;
    z.stun = 10_000; // it stays on its tile
    const said = untilStrike(m, true).find((e): e is StrikeEvent => e.type === 'bossStrike')!;
    expect(said.tiles).toEqual([{ lane: 4, col: 9 }]); // the only tile with a zombie on it (count 5: all there are)
    untilStrike(m, false);
    expect(z.maxHp - z.hp).toBe(100 - z.armor);
  });

  it('a snapshot taken mid-wind-up restores the announced tiles and finishes the same', () => {
    const b = phasedBalance({ patterns: [strikeOf(), SUMMON_WALKER] });
    for (const seed of [1, 2, 3]) {
      const { m } = phasedFight(b, WALNUTS, seed);
      untilStrike(m, true);
      for (let i = 0; i < 20; i++) m.step();
      const restored = Match.restore(m.snapshot(), b);
      expect(restored.hash()).toBe(m.hash());
      expect(restored.state.units.find((u) => u.key === 'brainTitan')!.strikeTiles).toHaveLength(2);
      const a = untilStrike(m, false);
      const r = untilStrike(restored, false);
      expect(r).toEqual(a);
      for (let i = 0; i < 30 * 20; i++) {
        m.step();
        restored.step();
      }
      expect(restored.hash()).toBe(m.hash());
    }
  });

  it('a phase change during the wind-up drops the announced tiles (the new phase starts afresh)', () => {
    const b = phasedBalance({ patterns: [SLAM, SHIELD], phases: [[strikeOf()], [SUMMON_WARRIOR]] });
    const { m, boss } = phasedFight(b, WALNUTS);
    untilStrike(m, true);
    expect(boss().strikeTiles).toHaveLength(2);
    boss().hp = boss().maxHp * 0.5;
    m.step();
    expect(boss().strikeTiles).toEqual([]);
    const later: SimEvent[] = [];
    for (let i = 0; i < 30 * 5; i++) later.push(...m.step());
    expect(later.some((e) => e.type === 'bossStrike')).toBe(false);
    expect(m.state.units.filter((u) => u.key === 'walnutBomb').every((u) => u.hp === u.maxHp)).toBe(true);
  });

  it('no enemy on the lawn: no tiles, nothing announced, nothing struck; the next pattern still comes', () => {
    const b = phasedBalance({ patterns: [strikeOf(), SUMMON_WALKER] });
    const { m } = phasedFight(b);
    const events: SimEvent[] = [];
    for (let i = 0; i < 30 * 10; i++) events.push(...m.step());
    expect(events.some((e) => e.type === 'bossStrike')).toBe(false);
    expect(summonedKeys(events)).toEqual(['veryFastWalker']);
  });

  it.each([
    ['a wind-up as long as its gap', { windupSeconds: 4 }, /strike: windupSeconds 4 must be above 0 and shorter than everySeconds 4/],
    ['no wind-up', { windupSeconds: 0 }, /strike: windupSeconds 0 must be above 0/],
    ['a count of 0', { count: 0 }, /strike: count 0 is not a whole number from 1/],
    ['a negative damage', { damage: -1 }, /strike: damage -1 must be a number from 0/],
    ['an unknown target', { target: 'rows' as never }, /strike: target "rows" is not lanes or tiles/],
    ['an unknown status', { status: { kind: 'sleep' as never, seconds: 1 } }, /strike: status "sleep" is no status/],
    ['a status lasting 0 s', { status: { kind: 'stun', seconds: 0 } }, /strike: status seconds 0 must last at least a tick/],
    ['a status lasting less than 0 s', { status: { kind: 'blind', seconds: -1 } }, /strike: status seconds -1 must last at least a tick/],
    ['a status lasting NaN s', { status: { kind: 'blind', seconds: Number.NaN } }, /strike: status seconds NaN must last at least a tick/],
    ['a negative status dps', { status: { kind: 'burn', seconds: 2, dps: -5 } }, /strike: status dps -5 must be a number from 0/],
  ] as const)('refuses %s', (_name, more, message) => {
    expect(() => phasedFight(phasedBalance({ patterns: [strikeOf(more)] }))).toThrow(message);
    expect(() => phasedFight(phasedBalance({ patterns: [SLAM, SHIELD], phases: [[SUMMON_WALKER], [strikeOf(more)]] }))).toThrow(message);
  });
});
