import { describe, expect, it } from 'vitest';
import { seconds } from '../../src/data/balance';
import type { Balance, BossStats } from '../../src/data/balance';
import { isWindingUp, patternsOf } from '../../src/sim/boss';
import { Match, defaultConfig } from '../../src/sim/match';
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
  b.bosses = { brainTitan: structuredClone(SHIPPED_TITAN), elderOak: structuredClone(SHIPPED_OAK) };
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
