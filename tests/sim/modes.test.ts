import { describe, expect, it } from 'vitest';
import { BALANCE, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { nextRandom, randomInt } from '../../src/sim/rng';
import { LANES, PLANT_COLS, TICKS_PER_SECOND } from '../../src/sim/types';
import type {
  BeltConfig, CardKey, Command, Faction, LevelMode, MatchConfig, PreparedUnit, ScriptEntry, SimEvent, SimState,
} from '../../src/sim/types';
import { classicBalance, classicConfig, eventsOf, place } from './helpers';

/** The numbers these rules tests were written for (see `classicBalance`), with the shipped Bone Minion (Grave Rise raises it). */
function withMinion(b: Balance): Balance {
  b.units.boneMinion = BALANCE.units.boneMinion;
  return b;
}
const B = withMinion(classicBalance());

function withMode(mode: LevelMode, patch: Partial<MatchConfig> = {}, balance: Balance = B): Match {
  const goalTicks = mode === 'battle' || mode === 'boss' ? null : 90;
  const boss: MatchConfig['boss'] = mode === 'boss' ? { key: 'brainTitan', faction: 'zombies', lane: 2 } : null;
  return new Match({ ...classicConfig(3, balance), mode, goalTicks, boss, ...patch }, balance);
}

/** Steps until the match ends or `limit` steps have run; the events of the last step. */
function runOut(m: Match, limit: number): SimEvent[] {
  let last: SimEvent[] = [];
  for (let i = 0; i < limit && m.state.winner === null; i++) last = m.step();
  return last;
}

describe('a default battle', () => {
  it('has every level field at its neutral value', () => {
    const c = defaultConfig(1);
    expect([c.mode, c.script, c.prepared, c.goalTicks, c.belt, c.noEnergy, c.invulnerableBase, c.boss, c.endless]).toEqual([
      'battle', [], [], null, null, false, null, null, null,
    ]);
    const m = new Match(c);
    expect([m.state.scriptIndex, m.state.belt]).toEqual([0, []]);
  });

  /**
   * The same scripted battles as before the level modes, with their checksums. First pinned against
   * the code at commit 28a6d4f (its checksums continued over the neutral level bytes). Re-pinned in
   * Task 3 (bosses), when every unit gained four fields (`pattern` .. `phase`) in the middle of the
   * layout and the setup its `boss`: a scratch replay of these three battles at the commit before
   * (4469587) and with the bosses gave equal events on every step and equal snapshots at tick 1000
   * and at the end once the new fields (all 0, boss null) were taken out, so the battles still play
   * the same; only the bytes hashed changed. Re-pinned again in Task 7a (Free Play), when the setup
   * gained `endless` and the state `wave` .. `incoming`: a scratch replay of these three battles at
   * a92eff8 and with Free Play gave equal events on every step and equal snapshots at tick 1000 and
   * at the end once the new fields (all 0 / null / empty) were taken out. Re-pinned in Task 8
   * (levels), when every unit gained `stunFatigue` (a boss's stun resistance): a scratch replay at
   * 4726149 and with it gave equal events on every step and equal snapshots at tick 1000 and at the
   * end once `stunFatigue` (always 0 outside a boss) was taken out.
   */
  const BEFORE: Array<[number, number, number]> = [ // seed, checksum at tick 1000, checksum at the end (tick 6880)
    [1, 228950009, 4019655029],
    [2, 3745210085, 497565829],
    [3, 3742689830, 3612142098],
  ];
  function commandsAt(tick: number): Command[] {
    const out: Command[] = [];
    if (tick < 5) out.push(place('plants', 'peashooter', tick, 0));
    if (tick >= 5 && tick < 10) out.push(place('plants', 'sunflower', tick - 5, 1));
    if (tick % 240 === 60) out.push(place('zombies', 'brainEater', (tick / 240 | 0) % 5, 0));
    if (tick % 400 === 200) out.push(place('zombies', 'veryFastWalker', (tick / 400 | 0) % 5, 0));
    if (tick % 500 === 250) out.push(place('plants', 'peashooter', (tick / 500 | 0) % 5, 2 + ((tick / 2500) | 0) % 5));
    if (tick % 200 === 100) out.push({ type: 'hero', faction: tick % 400 === 100 ? 'plants' : 'zombies', lane: (tick / 200 | 0) % 5 });
    return out;
  }
  it.each(BEFORE)('plays seed %i exactly as before the level modes', (seed, at1000, atEnd) => {
    const b = classicBalance();
    const c = classicConfig(seed, b);
    c.heroes = { plants: true, zombies: true };
    c.spells = { plants: 2, zombies: 2 };
    const m = new Match(c, b);
    let mid = 0;
    while (m.state.winner === null && m.state.tick < 30000) {
      m.step(commandsAt(m.state.tick));
      if (m.state.tick === 1000) mid = m.hash();
    }
    expect([m.state.tick, m.state.winner]).toEqual([6880, 'zombies']);
    expect(mid).toBe(at1000);
    expect(m.hash()).toBe(atEnd);
  });
});

describe('the clock goal', () => {
  it.each(['survive', 'breakthrough', 'conveyor'] as const)('%s: the plants win when goalTicks ticks have been played', (mode) => {
    const belt: BeltConfig | null = mode === 'conveyor' ? { side: 'plants', everyTicks: 30, cards: ['peashooter'], slots: 5 } : null;
    const m = withMode(mode, { belt });
    for (let i = 0; i < 89; i++) {
      m.step();
      expect(m.state.winner).toBeNull();
    }
    const events = m.step();
    expect(events.slice(-2)).toEqual([
      { type: 'goalReached', winner: 'plants' }, { type: 'matchEnded', winner: 'plants' },
    ]);
    expect([m.state.tick, m.state.winner]).toEqual([90, 'plants']);
    expect(m.step()).toEqual([]);
  });

  it('a base at zero ends the match first, even on the goal step', () => {
    const m = withMode('survive');
    for (let i = 0; i < 89; i++) m.step();
    m.state.baseHp.plants = 0;
    const events = m.step();
    expect(eventsOf(events, 'goalReached')).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'matchEnded', winner: 'zombies' });
  });

  it('a base at zero before the goal ends it then (breakthrough: the zombies broke through)', () => {
    const m = withMode('breakthrough');
    m.step();
    m.state.baseHp.plants = -5;
    m.step();
    expect([m.state.tick, m.state.winner]).toEqual([2, 'zombies']);
  });

});

describe('sudden death by mode', () => {
  const early = withMinion(classicBalance());
  early.suddenDeath = { ...early.suddenDeath, startSeconds: 1 };
  it.each([
    ['battle', true], ['boss', true], ['survive', false], ['breakthrough', false], ['conveyor', false],
  ] as const)('%s: sudden death %s', (mode, on) => {
    const belt: BeltConfig | null = mode === 'conveyor' ? { side: 'zombies', everyTicks: 30, cards: ['brainEater'], slots: 5 } : null;
    const m = withMode(mode, { belt, suddenDeath: true, goalTicks: mode === 'battle' || mode === 'boss' ? null : 1000 }, early);
    const seen: SimEvent[] = [];
    for (let i = 0; i < 40; i++) seen.push(...m.step());
    expect(eventsOf(seen, 'suddenDeath')).toHaveLength(on ? 1 : 0);
    expect(m.state.suddenDeath).toBe(on);
    expect(m.state.baseHp.plants < 3000).toBe(on);
  });
});

describe('an invulnerable base', () => {
  it('takes no damage from plant shots, which still fly and vanish', () => {
    const m = withMode('survive', { invulnerableBase: 'zombies' });
    spawnUnit(m.state, B, 'peashooter', 0, 7.5);
    const seen: SimEvent[] = [];
    for (let i = 0; i < 80; i++) seen.push(...m.step());
    const hits = eventsOf(seen, 'projectileHit').filter((e) => e.targetBase === 'zombies');
    expect(hits.length).toBeGreaterThan(0);
    expect(eventsOf(seen, 'baseDamaged')).toEqual([]);
    expect(m.state.baseHp.zombies).toBe(3000);
    expect(m.state.projectiles.every((p) => p.x < 10)).toBe(true); // those that hit are gone
  });

  it('is spared by sudden death too', () => {
    const early = withMinion(classicBalance());
    early.suddenDeath = { ...early.suddenDeath, startSeconds: 1 };
    const m = withMode('boss', { invulnerableBase: 'zombies', suddenDeath: true }, early);
    for (let i = 0; i < 60; i++) m.step();
    expect(m.state.baseHp.zombies).toBe(3000);
    expect(m.state.baseHp.plants).toBeLessThan(3000);
  });
});

describe('heroes and spells in every mode', () => {
  it.each(['battle', 'survive', 'breakthrough', 'conveyor', 'boss'] as const)('%s: a ready hero and spell are cast', (mode) => {
    const belt: BeltConfig | null = mode === 'conveyor' ? { side: 'plants', everyTicks: 30, cards: ['peashooter'], slots: 5 } : null;
    const m = withMode(mode, { belt, noEnergy: mode === 'conveyor', heroes: { plants: true, zombies: true }, spells: { plants: 1, zombies: 1 } });
    m.state.players.zombies.heroTimer = 0;
    m.state.players.plants.spells = [{ key: 'thunderbolt', timer: 0 }];
    const events = m.step([
      { type: 'hero', faction: 'zombies', lane: 1 },
      { type: 'spell', faction: 'plants', spell: 'thunderbolt', lane: 2, col: 5 },
    ]);
    expect(eventsOf(events, 'commandRejected')).toEqual([]);
    expect(eventsOf(events, 'heroUsed')).toHaveLength(1);
    expect(eventsOf(events, 'spellCast')).toHaveLength(1);
  });
});

describe('checking the mode', () => {
  const cases: Array<[string, Partial<MatchConfig>, string]> = [
    ['an unknown mode', { mode: 'siege' as LevelMode }, 'mode'],
    ['a breakthrough with no clock', { mode: 'breakthrough', goalTicks: null }, 'goalTicks'],
    ['a conveyor with no clock', { mode: 'conveyor', goalTicks: null, belt: { side: 'plants', everyTicks: 30, cards: ['peashooter'], slots: 5 } }, 'goalTicks'],
    ['a clock in a battle', { mode: 'battle', goalTicks: 100 }, 'goalTicks'],
    ['a clock in a boss level', { mode: 'boss', goalTicks: 100 }, 'goalTicks'],
    ['goalTicks 0', { mode: 'survive', goalTicks: 0 }, 'goalTicks'],
    ['goalTicks -30', { mode: 'survive', goalTicks: -30 }, 'goalTicks'],
    ['goalTicks 1.5', { mode: 'survive', goalTicks: 1.5 }, 'goalTicks'],
    ['an invulnerable base of no side', { invulnerableBase: 'robots' as Faction }, 'invulnerableBase'],
    // The clock's winner is always the plants: a safe plant base would leave a zombie player no way to win.
    ['an invulnerable plant base', { invulnerableBase: 'plants' }, 'invulnerableBase'],
    ['an invulnerable plant base in a zombie conveyor', {
      mode: 'conveyor', goalTicks: 100, noEnergy: true, invulnerableBase: 'plants',
      belt: { side: 'zombies', everyTicks: 30, cards: ['brainEater'], slots: 5 },
    }, 'invulnerableBase'],
    ['a survive with no clock', { mode: 'survive', goalTicks: null }, 'goalTicks'],
    ['a script entry at goalTicks', {
      mode: 'survive', goalTicks: 100, script: [{ tick: 100, unit: 'brainEater', faction: 'zombies', lane: 0, level: 1 }],
    }, 'never comes'],
    ['a script entry after goalTicks', {
      mode: 'survive', goalTicks: 100, script: [{ tick: 250, unit: 'brainEater', faction: 'zombies', lane: 0, level: 1 }],
    }, 'never comes'],
    ['a noEnergy that is no boolean', { noEnergy: 1 as unknown as boolean }, 'noEnergy'],
  ];
  it.each(cases)('refuses %s', (_name, patch, message) => {
    expect(() => new Match({ ...classicConfig(1, B), ...patch }, B)).toThrow(message);
  });

  it('does not share the level lists with the caller', () => {
    const config: MatchConfig = {
      ...classicConfig(1, B), mode: 'survive', goalTicks: 100,
      script: [{ tick: 5, unit: 'brainEater', faction: 'zombies', lane: 0, level: 1 }],
      prepared: [{ unit: 'peashooter', faction: 'plants', lane: 0, x: 0.5, level: 1 }],
    };
    const m = new Match(config, B);
    config.script[0]!.lane = 3;
    config.prepared.push({ unit: 'peashooter', faction: 'plants', lane: 1, x: 0.5, level: 1 });
    expect(m.state.config.script[0]!.lane).toBe(0);
    expect(m.state.config.prepared).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Snapshots mid-level (review focus 2) and the fuzz (review focus 1)

type Rng = { rng: number };

function pick<T>(r: Rng, items: readonly T[]): T {
  return items[randomInt(r, items.length)]!;
}

/**
 * The strong scripted attack a fuzz run may add for the zombies (the side that loses at the clock):
 * a level-5 Skeleton Warrior or Brain Eater every 1.5 s from 1 s in, lane after lane, so the plant
 * base falls before the clock unless the random play happens to hold it.
 */
function strongAttack(goalTicks: number): ScriptEntry[] {
  const out: ScriptEntry[] = [];
  for (let tick = 30, i = 0; tick < goalTicks; tick += 45, i++) {
    out.push({ tick, unit: i % 2 === 0 ? 'skeletonWarrior' : 'brainEater', faction: 'zombies', lane: i % LANES, level: 5 });
  }
  return out;
}

/** Joins two scripts, keeping them sorted by tick (ties: `a` first). */
function joinScripts(a: ScriptEntry[], b: ScriptEntry[]): ScriptEntry[] {
  return [...a, ...b].map((e, i) => ({ e, i })).sort((x, y) => x.e.tick - y.e.tick || x.i - y.i).map(({ e }) => e);
}

/**
 * A level of `mode` for `seed`: waves, a prepared garden, a belt, as the mode would have them; with
 * `attack`, the zombies also get `strongAttack` (clocked modes), so the level can end by a base falling.
 */
function levelConfig(mode: LevelMode, seed: number, balance: Balance, attack = false): MatchConfig {
  const r: Rng = { rng: (seed * 2654435761) >>> 0 };
  nextRandom(r);
  const zombies: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior'];
  const script: ScriptEntry[] = [];
  for (let tick = 60; tick < 1800; tick += 60 + randomInt(r, 120)) {
    script.push({ tick, unit: pick(r, zombies), faction: 'zombies', lane: randomInt(r, LANES), level: 1 + randomInt(r, 2) });
    if (randomInt(r, 4) === 0) {
      script.push({ tick, unit: 'peashooter', faction: 'plants', lane: randomInt(r, LANES), x: randomInt(r, PLANT_COLS) + 0.5, level: 1 });
    }
  }
  const prepared: PreparedUnit[] = [];
  for (let lane = 0; lane < LANES; lane++) {
    prepared.push({ unit: pick(r, ['peashooter', 'walnutBomb'] as const), faction: 'plants', lane, x: 3.5 + randomInt(r, 3), level: 1 + randomInt(r, 3) });
  }
  const config: MatchConfig = { ...classicConfig(seed, balance), heroes: { plants: true, zombies: true }, spells: { plants: 2, zombies: 2 }, mode };
  const level = levelOf(mode, seed, config, script, prepared);
  if (attack && level.goalTicks !== null) level.script = joinScripts(level.script, strongAttack(level.goalTicks));
  return level;
}

function levelOf(mode: LevelMode, seed: number, config: MatchConfig, script: ScriptEntry[], prepared: PreparedUnit[]): MatchConfig {
  const zombies: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior'];
  const plants: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb'];
  switch (mode) {
    case 'battle':
      return config;
    case 'boss': // the plants' boss (the Brain Titan) on odd seeds, the zombies' (the Elder Oak) on even ones
      return {
        ...config, script: seed % 2 === 1 ? script.filter((e) => e.faction === 'zombies') : [],
        boss: seed % 2 === 1 ? { key: 'brainTitan', faction: 'zombies', lane: seed % LANES } : { key: 'elderOak', faction: 'plants', lane: 2 },
      };
    case 'survive':
      return { ...config, goalTicks: 1800, script, invulnerableBase: 'zombies' };
    case 'breakthrough':
      return { ...config, goalTicks: 1800, prepared };
    case 'conveyor': {
      const side: Faction = seed % 2 === 0 ? 'zombies' : 'plants';
      const belt: BeltConfig = { side, everyTicks: 45, cards: side === 'plants' ? plants : zombies, slots: 5 };
      return {
        ...config, goalTicks: 1800, belt, noEnergy: true,
        invulnerableBase: side === 'plants' ? 'zombies' : null,
        script: side === 'plants' ? script : [], prepared: side === 'zombies' ? prepared : [],
      };
    }
    default: {
      const unhandled: never = mode;
      throw new Error(String(unhandled));
    }
  }
}

/** 0–2 well-formed commands for this tick, either side, drawn from seed and tick (never the match's rng). */
function randomCommands(seed: number, s: Readonly<SimState>): Command[] {
  const r: Rng = { rng: (Math.imul(seed, 0x9e3779b1) ^ Math.imul(s.tick + 0x632be5ab, 0x85ebca6b)) >>> 0 };
  nextRandom(r);
  const out: Command[] = [];
  const count = randomInt(r, 3);
  for (let i = 0; i < count; i++) {
    const faction: Faction = randomInt(r, 2) === 0 ? 'plants' : 'zombies';
    const lane = randomInt(r, LANES);
    const col = randomInt(r, PLANT_COLS);
    const kind = randomInt(r, 20);
    if (kind < 8 && s.belt.length > 0) {
      out.push({ type: 'belt', faction, slot: randomInt(r, s.belt.length), lane, col });
    } else if (kind < 15) {
      out.push({ type: 'place', faction, unit: pick(r, s.config.cards[faction]), lane, col });
    } else if (kind < 17) {
      const own = s.units.filter((u) => u.faction === faction && s.config.cards[faction].includes(u.key as CardKey));
      if (own.length > 0) {
        const target = pick(r, own);
        out.push({ type: 'merge', faction, unit: target.key as CardKey, targetId: target.id });
      }
    } else if (kind < 18) {
      out.push({ type: 'hero', faction, lane });
    } else {
      const dealt = s.players[faction].spells;
      if (dealt.length > 0) out.push({ type: 'spell', faction, spell: pick(r, dealt).key, lane, col });
    }
  }
  return out;
}

describe('a snapshot mid-level', () => {
  it.each(['survive', 'conveyor', 'breakthrough'] as const)('%s: restored mid-wave with cards on the belt, it reaches the unbroken checksum', (mode) => {
    const seed = 7;
    const config = levelConfig(mode, seed, B);
    const unbroken = new Match(config, B);
    let snapshot = '';
    for (let step = 1; step <= 1200; step++) {
      unbroken.step(randomCommands(seed, unbroken.state));
      if (step === 500) snapshot = unbroken.snapshot();
    }
    const at = JSON.parse(snapshot) as SimState;
    if (mode !== 'breakthrough') {
      expect(at.scriptIndex).toBeGreaterThan(0);
      expect(at.scriptIndex).toBeLessThan(at.config.script.length);
    }
    if (mode === 'conveyor') expect(at.belt.length).toBeGreaterThan(0);
    const restored = Match.restore(snapshot, B);
    for (let step = 501; step <= 1200; step++) restored.step(randomCommands(seed, restored.state));
    expect(restored.hash()).toBe(unbroken.hash());
    expect(restored.snapshot()).toBe(unbroken.snapshot());
  });
});

describe('every level ends (100 seeds per mode, random commands)', () => {
  // Sudden death from 30 s, so the battles end in a test's time; the rule is the shipped one.
  const fast = withMinion(classicBalance());
  fast.suddenDeath = { ...fast.suddenDeath, startSeconds: 30 };
  /**
   * The last tick a battle can still be running: when sudden death alone has drained a full base
   * (each base loses the same share of its own maximum, so any full base falls on the same tick).
   */
  function suddenDeathBound(baseHp: number): number {
    const start = seconds(fast.suddenDeath.startSeconds);
    let drained = 0;
    let tick = start;
    while (drained < baseHp) {
      drained += baseHp * (fast.suddenDeath.baseRate + fast.suddenDeath.growthPerSecond * (tick - start) / TICKS_PER_SECOND) / TICKS_PER_SECOND;
      tick += 1;
    }
    return tick;
  }

  // Every third seed the zombies also get a strong scripted attack, so a clocked level can end by
  // the plant base falling as well as at the clock; both endings must occur across the seeds.
  it.each(['battle', 'boss', 'survive', 'breakthrough', 'conveyor'] as const)('%s', (mode) => {
    const winners = new Map<string, number>();
    let atClock = 0;
    let baseFell = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const config = levelConfig(mode, seed, fast, seed % 3 === 0);
      const m = new Match(config, fast);
      const bound = config.goalTicks ?? suddenDeathBound(Math.max(config.baseHp.plants, config.baseHp.zombies));
      let reached = false;
      while (m.state.winner === null && m.state.tick < bound + 1) {
        if (eventsOf(m.step(randomCommands(seed, m.state)), 'goalReached').length > 0) reached = true;
      }
      expect(m.state.winner, `${mode} seed ${seed}`).not.toBeNull();
      expect(m.state.tick, `${mode} seed ${seed}`).toBeLessThanOrEqual(bound);
      if (reached) atClock += 1;
      else baseFell += 1;
      winners.set(String(m.state.winner), (winners.get(String(m.state.winner)) ?? 0) + 1);
    }
    expect([...winners.values()].reduce((a, b) => a + b, 0)).toBe(100);
    if (config0(mode).goalTicks !== null) {
      expect(atClock, `${mode}: ended at the clock`).toBeGreaterThan(0);
      expect(baseFell, `${mode}: ended by a base falling`).toBeGreaterThan(0);
    }
  });
  function config0(mode: LevelMode): MatchConfig {
    return levelConfig(mode, 1, fast);
  }
});
