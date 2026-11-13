import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { ALL_CARDS, UNIT_INFO } from '../../src/data/units';
import { endlessBudget, endlessLevel, endlessWave } from '../../src/sim/endless';
import { Match, defaultConfig } from '../../src/sim/match';
import { nextRandom, randomInt } from '../../src/sim/rng';
import { LANES, MAX_LEVEL, PLANT_COLS, ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type { CardKey, Command, Faction, MatchConfig, SimEvent, SimState } from '../../src/sim/types';
import { eventsOf } from './helpers';

/**
 * The rules tests pin Task 7a's starting Free Play numbers (garden 1's base at 6000, as a battle's),
 * so the tuning of `BALANCE.endless` (Task 8) does not move their figures; the shipped numbers are
 * pinned on their own below.
 */
const B: Balance = (() => {
  const b = cloneBalance(BALANCE);
  b.endless = { ...b.endless, budgetBase: 100, budgetStep: 60, gardenBaseHp: 6000 };
  return b;
})();
const ZOMBIES: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior'];
const PLANTS: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb'];

/** Free Play as the plants: the zombies come in waves from `ZOMBIES`; the zombie side has no hand. */
function survive(seed: number, patch: Partial<MatchConfig> = {}, balance: Balance = B): MatchConfig {
  const c = defaultConfig(seed, balance);
  return {
    ...c, mode: 'survive', goalTicks: null, invulnerableBase: 'zombies',
    cards: { plants: [...c.cards.plants], zombies: [] },
    heroes: { plants: true, zombies: false }, spells: { plants: 2, zombies: 0 },
    endless: { cards: [...ZOMBIES], firstWaveTicks: 150 },
    ...patch,
  };
}

/** Free Play as the zombies: gardens of `PLANTS` (never a Sunflower), a clock; the plant side has no hand. */
function breakthrough(seed: number, patch: Partial<MatchConfig> = {}, balance: Balance = B): MatchConfig {
  const c = defaultConfig(seed, balance);
  return {
    ...c, mode: 'breakthrough', goalTicks: null,
    cards: { plants: [], zombies: [...c.cards.zombies] },
    heroes: { plants: false, zombies: true }, spells: { plants: 0, zombies: 2 },
    endless: { cards: [...PLANTS], firstWaveTicks: 0 },
    ...patch,
  };
}

function cost(card: CardKey, level: number): number {
  return UNIT_INFO[card].price * level;
}

describe('the numbers of a wave', () => {
  it('has a budget of 100 + 60 per wave', () => {
    expect([1, 5, 10].map((w) => endlessBudget(B, w))).toEqual([160, 400, 700]);
  });

  it('sends units one level higher every five waves, up to 5', () => {
    expect([1, 5, 6, 10, 11, 16, 21, 50].map((w) => endlessLevel(B, w))).toEqual([1, 1, 2, 2, 3, 4, 5, 5]);
  });

  it('keeps every number in Balance.endless (Task 8: measured with the level stand-ins)', () => {
    expect(BALANCE.endless).toEqual({
      budgetBase: 250, budgetStep: 68, gapSeconds: 20, levelEvery: 5, bossEvery: 10,
      clockSeconds: 90, clockBonusSeconds: 30, gardenBaseHp: 1500, gardenHpStep: 0.15,
      spreadSeconds: 6, gardenMinCol: 1, gardenMaxCol: 7,
    });
  });
});

describe('endlessWave', () => {
  const sets: Array<[Faction, CardKey[]]> = [
    ['zombies', ZOMBIES],
    ['zombies', ALL_CARDS.zombies],
    ['zombies', ['veryFastWalker']],
    ['plants', PLANTS],
    ['plants', ALL_CARDS.plants],
    ['plants', ['potatoMine', 'sunflower']],
  ];

  it.each(sets)('%s from %j: 50 waves on 20 seeds keep every rule', (side, cards) => {
    const usable = cards.filter((c) => c !== 'sunflower' || side === 'zombies');
    const priciest = usable.reduce((a, c) => (UNIT_INFO[c].price > UNIT_INFO[a].price ? c : a));
    for (let seed = 1; seed <= 20; seed++) {
      const rng = { rng: seed * 7919 };
      for (let w = 1; w <= 50; w++) {
        const level = endlessLevel(B, w);
        const spawns = endlessWave(B, cards, side, w, rng);
        const regular = spawns.filter((u) => !u.big);
        const bigOnes = spawns.filter((u) => u.big);
        const at = `seed ${seed} wave ${w}`;
        expect(regular.length, at).toBeGreaterThan(0); // never an empty wave
        const spent = regular.reduce((sum, u) => sum + cost(u.unit, level), 0);
        const left = endlessBudget(B, w) - spent;
        expect(left, at).toBeGreaterThanOrEqual(0); // the budget is never exceeded
        expect(left, at).toBeLessThan(Math.min(...usable.map((c) => cost(c, level)))); // nothing affordable is left over
        expect(regular.every((u) => u.level === level && usable.includes(u.unit)), at).toBe(true);
        expect(bigOnes, at).toEqual(w % 10 === 0 ? [{ ...bigOnes[0]!, unit: priciest, level: MAX_LEVEL, big: true }] : []);
        if (side === 'zombies') {
          expect(spawns.every((u) => u.x === ZOMBIE_SPAWN_X && u.lane >= 0 && u.lane < LANES), at).toBe(true);
          const delays = spawns.map((u) => u.delay);
          expect(delays[0], at).toBe(0);
          expect(delays.every((d, i) => d >= 0 && d <= seconds(6) && (i === 0 || d >= delays[i - 1]!)), at).toBe(true);
          if (spawns.length > 1) expect(delays.at(-1), at).toBe(seconds(6));
        } else {
          expect(spawns.some((u) => u.unit === 'sunflower'), at).toBe(false);
          const tiles = spawns.map((u) => u.lane * PLANT_COLS + (u.x - 0.5));
          expect(new Set(tiles).size, at).toBe(tiles.length);
          expect(spawns.every((u) => u.delay === 0 && u.x - 0.5 >= 1 && u.x - 0.5 <= 7 && Number.isInteger(u.x - 0.5)), at).toBe(true);
        }
      }
    }
  });

  it('brings the big one first on waves 10 and 20, and not on 9, 11 or 19', () => {
    const rng = { rng: 5 };
    const bigOn = (w: number) => endlessWave(B, ZOMBIES, 'zombies', w, rng).filter((u) => u.big);
    expect(bigOn(9)).toEqual([]);
    const ten = endlessWave(B, ZOMBIES, 'zombies', 10, rng);
    expect(ten[0]).toMatchObject({ unit: 'skeletonWarrior', level: 5, big: true, delay: 0 });
    expect(ten.filter((u) => u.big)).toHaveLength(1);
    expect(bigOn(11)).toEqual([]);
    expect(bigOn(19)).toEqual([]);
    expect(bigOn(20)).toHaveLength(1);
  });

  it('the most expensive card is the first such in list order', () => {
    const spawns = endlessWave(B, ['cowboyZombie', 'skeletonWarrior', 'brainEater'], 'zombies', 10, { rng: 1 });
    expect(spawns[0]).toMatchObject({ unit: 'cowboyZombie', level: 5, big: true }); // both 125: the first listed
  });

  it('sends one unit of the cheapest card when nothing is affordable', () => {
    expect(endlessWave(B, ['brainRot'], 'zombies', 1, { rng: 9 })).toEqual([
      { unit: 'brainRot', lane: expect.any(Number) as number, x: ZOMBIE_SPAWN_X, level: 1, delay: 0, big: false },
    ]);
  });

  it('is the same for the same rng, and draws from it', () => {
    const a = { rng: 1234 };
    const b = { rng: 1234 };
    expect(endlessWave(B, ZOMBIES, 'zombies', 7, a)).toEqual(endlessWave(B, ZOMBIES, 'zombies', 7, b));
    expect(a.rng).toBe(b.rng);
    expect(a.rng).not.toBe(1234);
  });

  it('refuses a card of the other side', () => {
    expect(() => endlessWave(B, ['peashooter'], 'zombies', 1, { rng: 1 })).toThrow(RangeError);
  });
});

describe('checking an endless setup', () => {
  const cases: Array<[string, MatchConfig, string]> = [
    ['endless in a battle', { ...defaultConfig(1, B), endless: { cards: ZOMBIES, firstWaveTicks: 0 } }, 'endless'],
    ['endless in a conveyor', {
      ...survive(1), mode: 'conveyor', goalTicks: 100, noEnergy: true,
      belt: { side: 'plants', everyTicks: 30, cards: ['peashooter'], slots: 5 },
    }, 'endless'],
    ['no cards', survive(1, { endless: { cards: [], firstWaveTicks: 0 } }), 'cards'],
    ['a card of the player\'s side', survive(1, { endless: { cards: ['peashooter'], firstWaveTicks: 0 } }), 'peashooter'],
    ['no card at all', survive(1, { endless: { cards: ['rock' as CardKey], firstWaveTicks: 0 } }), 'rock'],
    ['a twice-listed card', survive(1, { endless: { cards: ['brainEater', 'brainEater'], firstWaveTicks: 0 } }), 'twice'],
    ['a garden of Sunflowers only', breakthrough(1, { endless: { cards: ['sunflower'], firstWaveTicks: 0 } }), 'Sunflower'],
    ['a negative first wave', survive(1, { endless: { cards: ZOMBIES, firstWaveTicks: -1 } }), 'firstWaveTicks'],
    ['a fractional first wave', survive(1, { endless: { cards: ZOMBIES, firstWaveTicks: 1.5 } }), 'firstWaveTicks'],
    ['a late first garden', breakthrough(1, { endless: { cards: PLANTS, firstWaveTicks: 30 } }), 'firstWaveTicks'],
    ['an endless breakthrough with goalTicks', breakthrough(1, { goalTicks: 2700 }), 'goalTicks'],
    ['a survive whose zombie base can be hurt', survive(1, { invulnerableBase: null }), 'invulnerableBase'],
    ['a hand for the waves\' side', survive(1, { cards: { plants: ['peashooter'], zombies: ['brainEater'] } }), 'hand'],
    ['spells for the waves\' side', breakthrough(1, { spells: { plants: 1, zombies: 2 } }), 'spells'],
    ['a hero for the waves\' side', survive(1, { heroes: { plants: true, zombies: true } }), 'hero'],
    ['a script', survive(1, { script: [{ tick: 5, unit: 'brainEater', faction: 'zombies', lane: 0, level: 1 }] }), 'script'],
    ['a prepared unit', breakthrough(1, { prepared: [{ unit: 'peashooter', faction: 'plants', lane: 0, x: 0.5, level: 1 }] }), 'prepared'],
    ['no energy', survive(1, { noEnergy: true }), 'noEnergy'],
    ['upgrades for the waves\' side (survive)', survive(1, { upgrades: { plants: {}, zombies: { brainEater: 3 } } }), 'upgrades'],
    ['upgrades for the waves\' side (breakthrough)', breakthrough(1, { upgrades: { plants: { peashooter: 2 }, zombies: {} } }), 'upgrades'],
  ];
  it.each(cases)('refuses %s', (_name, config, message) => {
    expect(() => new Match(config, B)).toThrow(message);
  });

  it('refuses a garden 1 with no health (gardenBaseHp 0)', () => {
    const b = cloneBalance(B);
    b.endless.gardenBaseHp = 0;
    expect(() => new Match(breakthrough(1, {}, b), b)).toThrow('Balance.endless');
  });

  it('accepts a survive with no clock and a breakthrough with no goalTicks; the player\'s own upgrades are fine', () => {
    expect(() => new Match(survive(1, { upgrades: { plants: { peashooter: 4 }, zombies: {} } }), B)).not.toThrow();
    expect(() => new Match(survive(1), B)).not.toThrow();
    expect(() => new Match(survive(1, { goalTicks: 9000 }), B)).not.toThrow();
    expect(() => new Match(breakthrough(1), B)).not.toThrow();
  });

  it('still refuses a survive with no clock and no endless', () => {
    expect(() => new Match(survive(1, { endless: null }), B)).toThrow('goalTicks');
  });

  it('does not share the endless cards with the caller', () => {
    const config = survive(1);
    const m = new Match(config, B);
    config.endless!.cards.push('skeletonArcher');
    expect(m.state.config.endless!.cards).toEqual(ZOMBIES);
  });

  it('starts at wave 0, the first wave\'s timer, no clock and nobody incoming; a default battle has the same zeros', () => {
    const m = new Match(survive(1), B);
    expect([m.state.wave, m.state.waveTimer, m.state.clock, m.state.incoming]).toEqual([0, 150, 0, []]);
    const battle = new Match(defaultConfig(1, B), B);
    expect([battle.state.config.endless, battle.state.wave, battle.state.waveTimer, battle.state.clock, battle.state.incoming])
      .toEqual([null, 0, 0, 0, []]);
  });
});

/** Steps `n` times with no commands, collecting the events. */
function run(m: Match, n: number): SimEvent[] {
  const seen: SimEvent[] = [];
  for (let i = 0; i < n && m.state.winner === null; i++) seen.push(...m.step());
  return seen;
}

describe('Free Play as the plants (endless survive)', () => {
  it('starts wave 1 when the first timer runs out, spreads it over 6 s, and wave 2 20 s after wave 1 began', () => {
    const m = new Match(survive(4), B);
    expect(eventsOf(run(m, 150), 'waveStarted')).toEqual([]);
    const start = m.step();
    const [started] = eventsOf(start, 'waveStarted');
    expect(started).toEqual({ type: 'waveStarted', wave: 1, budget: 160, units: started!.units });
    expect(m.state.wave).toBe(1);
    expect(m.state.waveTimer).toBe(seconds(20) - 1);
    const spawned = [...eventsOf(start, 'waveSpawned'), ...eventsOf(run(m, seconds(6)), 'waveSpawned')];
    expect(spawned.map((e) => e.index)).toEqual([...Array(started!.units).keys()]);
    expect(m.state.incoming).toEqual([]);
    expect(m.state.units.filter((u) => u.faction === 'zombies' && u.level === 1).length).toBeGreaterThan(0);
    const until = eventsOf(run(m, seconds(20) - seconds(6) - 1), 'waveStarted');
    expect(until).toEqual([]);
    expect([m.state.tick, m.state.waveTimer]).toEqual([150 + 600, 0]);
    expect(eventsOf(m.step(), 'waveStarted')).toMatchObject([{ wave: 2, budget: 220 }]);
  });

  it('gives the waves\' side no energy at all; the player earns as usual', () => {
    const m = new Match(survive(2, { startEnergy: { plants: 190, zombies: 190 } }), B);
    run(m, 1500);
    expect(m.state.players.zombies.energy).toBe(0);
    expect(m.state.players.plants.energy).toBeGreaterThan(190);
  });

  it('ends only when the plant base falls: the zombies win, the waves started are the score, no sudden death', () => {
    const m = new Match(survive(3), B);
    run(m, 30);
    m.state.baseHp.plants = 0;
    const events = m.step();
    expect(events.at(-1)).toEqual({ type: 'matchEnded', winner: 'zombies' });
    expect(eventsOf(events, 'goalReached')).toEqual([]);
    expect([m.state.winner, m.state.wave]).toEqual(['zombies', 0]);
  });

  it('an idle player\'s base falls within 8 minutes on every seed, never by sudden death', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = new Match(survive(seed), B);
      const seen = run(m, seconds(8 * 60));
      expect(m.state.winner, `seed ${seed}`).toBe('zombies');
      expect(eventsOf(seen, 'suddenDeath'), `seed ${seed}`).toEqual([]);
      expect(m.state.wave, `seed ${seed}`).toBeGreaterThan(0);
      expect(m.state.baseHp.zombies).toBe(m.state.baseMaxHp.zombies);
    }
  });

  it('restored mid-wave (units still to come), it reaches the unbroken checksum 2000 ticks on', () => {
    const config = survive(11);
    const unbroken = new Match(config, B);
    while (!(unbroken.state.incoming.length > 0 && unbroken.state.wave === 2)) unbroken.step(defence(11, unbroken.state));
    const snapshot = unbroken.snapshot();
    const at = unbroken.state.tick;
    while (unbroken.state.tick < at + 2000) unbroken.step(defence(11, unbroken.state));
    const restored = Match.restore(snapshot, B);
    while (restored.state.tick < at + 2000) restored.step(defence(11, restored.state));
    expect(restored.hash()).toBe(unbroken.hash());
    expect(restored.snapshot()).toBe(unbroken.snapshot());
  });

  it('50 waves on 20 seeds: no exception, whole energy, nobody above max health', () => {
    const fast = cloneBalance(B);
    fast.endless.gapSeconds = 7; // fifty waves in a test's time (longer than the 6 s spread, so a wave has fully come before the next); the rules are the shipped ones
    for (let seed = 1; seed <= 20; seed++) {
      const m = new Match(survive(seed, { baseHp: { plants: 1e9, zombies: 6000 }, startEnergy: { plants: 5000, zombies: 0 } }, fast), fast);
      let starts = 0;
      while ((m.state.wave < 50 || m.state.incoming.length > 0) && m.state.winner === null) {
        starts += eventsOf(m.step(defence(seed, m.state)), 'waveStarted').length;
        const s = m.state;
        for (const f of ['plants', 'zombies'] as const) expect(Number.isInteger(s.players[f].energy), `seed ${seed}`).toBe(true);
        for (const u of s.units) expect(u.hp <= u.maxHp, `seed ${seed} ${u.key}`).toBe(true);
      }
      expect([starts, m.state.winner]).toEqual([50, null]);
    }
  }, 120_000); // about 12 s alone; the whole suite on a loaded 8-core machine can take several times that
});

/** The player's plants: now and then a Peashooter or Walnut on a random tile (drawn from seed and tick, never the match's rng). */
function defence(seed: number, s: Readonly<SimState>): Command[] {
  const r = { rng: (Math.imul(seed, 0x9e3779b1) ^ Math.imul(s.tick + 0x632be5ab, 0x85ebca6b)) >>> 0 };
  nextRandom(r);
  if (randomInt(r, 10) !== 0) return [];
  const unit: CardKey = randomInt(r, 2) === 0 ? 'peashooter' : 'walnutBomb';
  return [{ type: 'place', faction: 'plants', unit, lane: randomInt(r, LANES), col: randomInt(r, PLANT_COLS) }];
}

describe('Free Play as the zombies (endless breakthrough)', () => {
  it('lays garden 1 on the first step: plants of its budget at level 1, no Sunflower, the clock at 90 s', () => {
    const m = new Match(breakthrough(1), B);
    expect(m.state.clock).toBe(seconds(90));
    const events = m.step();
    const [started] = eventsOf(events, 'waveStarted');
    expect(started).toMatchObject({ wave: 1, budget: 160 });
    const plants = m.state.units.filter((u) => u.faction === 'plants');
    expect(plants).toHaveLength(started!.units);
    expect(plants.every((u) => u.level === 1 && u.key !== 'sunflower' && u.x >= 1.5 && u.x <= 7.5)).toBe(true);
    expect(eventsOf(events, 'waveSpawned')).toHaveLength(started!.units);
    expect([m.state.wave, m.state.clock, m.state.baseHp.plants]).toEqual([0, seconds(90) - 1, 6000]);
  });

  it('a fallen base breaks the garden: the score goes up, the old plants leave, the clock gains 30 s, the next garden is stronger', () => {
    const m = new Match(breakthrough(2), B);
    run(m, 10);
    const old = m.state.units.filter((u) => u.faction === 'plants').map((u) => u.id);
    const clock = m.state.clock;
    m.state.baseHp.plants = 0;
    const events = m.step();
    expect(eventsOf(events, 'gardenBroken')).toEqual([{ type: 'gardenBroken', wave: 1 }]);
    expect(eventsOf(events, 'matchEnded')).toEqual([]);
    const gone = eventsOf(events, 'unitDied');
    expect(gone.map((e) => e.unitId)).toEqual(old);
    expect(gone.every((e) => e.cause === 'spent')).toBe(true);
    expect(eventsOf(events, 'energyGained').filter((e) => e.source === 'bounty')).toEqual([]);
    expect(m.state.units.some((u) => old.includes(u.id))).toBe(false);
    expect([m.state.wave, m.state.winner, m.state.clock]).toEqual([1, null, clock + seconds(30) - 1]);
    expect([m.state.baseHp.plants, m.state.baseMaxHp.plants]).toEqual([6900, 6900]);
    expect(eventsOf(events, 'waveStarted')).toMatchObject([{ wave: 2, budget: 220 }]);
    const order = events.map((e) => e.type).filter((t) => t === 'gardenBroken' || t === 'unitDied' || t === 'waveStarted');
    expect(order[0]).toBe('gardenBroken');
    expect(order.at(-1)).toBe('waveStarted');
  });

  it('garden 3\'s base has 1.3 times the health of garden 1 (gardenBaseHp, whatever the setup\'s base)', () => {
    const b3 = cloneBalance(B);
    b3.endless.gardenBaseHp = 3000;
    const m = new Match(breakthrough(3, { baseHp: { plants: 5000, zombies: 3000 } }, b3), b3);
    expect([m.state.baseHp.plants, m.state.baseMaxHp.plants]).toEqual([3000, 3000]);
    for (let g = 0; g < 2; g++) {
      run(m, 5);
      m.state.baseHp.plants = -40;
      m.step();
    }
    expect([m.state.wave, m.state.baseHp.plants, m.state.baseMaxHp.plants]).toEqual([2, 3900, 3900]);
  });

  it('garden 1 starts at the shipped gardenBaseHp (1500), below a battle\'s base; a survive keeps the setup\'s', () => {
    const m = new Match(breakthrough(5, {}, BALANCE as Balance), BALANCE as Balance);
    expect([m.state.baseHp.plants, m.state.baseMaxHp.plants]).toEqual([1500, 1500]);
    const s = new Match(survive(5, {}, BALANCE as Balance), BALANCE as Balance);
    expect(s.state.baseHp.plants).toBe(BALANCE.baseHp);
  });

  it('the clock at zero ends the match: the plants win and the gardens broken are the score', () => {
    const idle = new Match(breakthrough(4), B);
    const seen = run(idle, seconds(90) + 10);
    expect(seen.slice(-2)).toEqual([{ type: 'goalReached', winner: 'plants' }, { type: 'matchEnded', winner: 'plants' }]);
    expect([idle.state.tick, idle.state.winner, idle.state.wave, idle.state.clock]).toEqual([seconds(90), 'plants', 0, 0]);

    const once = new Match(breakthrough(4), B);
    run(once, 100);
    once.state.baseHp.plants = 0;
    run(once, seconds(200));
    expect([once.state.tick, once.state.winner, once.state.wave]).toEqual([seconds(120), 'plants', 1]);
  });

  it('the defender has no energy; the zombie player earns as usual', () => {
    const m = new Match(breakthrough(5), B);
    run(m, 900);
    expect(m.state.players.plants.energy).toBe(0);
    expect(m.state.players.zombies.energy).toBeGreaterThan(B.startEnergy);
  });

  it('a fallen zombie base still ends it, the plants winning', () => {
    const m = new Match(breakthrough(6), B);
    run(m, 5);
    m.state.baseHp.zombies = 0;
    expect(m.step().at(-1)).toEqual({ type: 'matchEnded', winner: 'plants' });
  });

  it('restored mid-run, after a garden fell, it reaches the unbroken checksum 2000 ticks on', () => {
    const attack = (s: Readonly<SimState>): Command[] => (s.tick % 40 === 0
      ? [{ type: 'place', faction: 'zombies', unit: s.tick % 80 === 0 ? 'brainEater' : 'skeletonWarrior', lane: (s.tick / 40) % LANES, col: 0 }]
      : []);
    const unbroken = new Match(breakthrough(8, { startEnergy: { plants: 0, zombies: 5000 } }), B);
    run(unbroken, 200);
    unbroken.state.baseHp.plants = 0;
    unbroken.step();
    for (let i = 0; i < 100; i++) unbroken.step(attack(unbroken.state));
    const snapshot = unbroken.snapshot();
    const at = unbroken.state.tick;
    while (unbroken.state.tick < at + 2000 && unbroken.state.winner === null) unbroken.step(attack(unbroken.state));
    const restored = Match.restore(snapshot, B);
    while (restored.state.tick < unbroken.state.tick) restored.step(attack(restored.state));
    expect(restored.hash()).toBe(unbroken.hash());
    expect(restored.snapshot()).toBe(unbroken.snapshot());
  });
});
