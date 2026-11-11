import { describe, expect, it } from 'vitest';
import { seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { BASE_STOP_X, LANES } from '../../src/sim/types';
import type { SimEvent, Unit } from '../../src/sim/types';
import { eventsOf, withBaseDefense } from './helpers';

/**
 * The plant base strikes a zombie that is biting it. Unless a test says otherwise the defence is
 * on at 60 damage, one strike per lane per second. Income is off so energy only moves through
 * bounties, and each base has 3000 health.
 */
function fresh(balance: Balance = withBaseDefense(60, 1)): Match {
  const config = defaultConfig(1, balance);
  config.startEnergy = { plants: 1000, zombies: 1000 };
  config.baseHp = { plants: 3000, zombies: 3000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  return new Match(config, balance);
}

/** Plays `steps` steps and returns each step's events, numbered from 1. */
function play(m: Match, steps: number): Array<[number, SimEvent[]]> {
  const log: Array<[number, SimEvent[]]> = [];
  for (let n = 1; n <= steps; n++) log.push([n, m.step()]);
  return log;
}

/** The steps on which the base struck, with the lane and the zombie it struck. */
function strikes(log: Array<[number, SimEvent[]]>): Array<[number, number, number]> {
  return log.flatMap(([n, events]) => eventsOf(events, 'baseStruck').map((e) => [n, e.lane, e.targetId] as [number, number, number]));
}

/** The step on which `u` died, or null. */
function deathStep(log: Array<[number, SimEvent[]]>, u: Unit): number | null {
  const found = log.find(([, events]) => eventsOf(events, 'unitDied').some((e) => e.unitId === u.id));
  return found ? found[0] : null;
}

describe('the plant base strikes back', () => {
  it('starts every match with one timer per lane, all at 0', () => {
    const m = fresh();
    expect(m.state.baseDefenseTimers).toEqual(Array(LANES).fill(0));
  });

  it('strikes a Very Fast Walker at the base for 60 on its first blocked step, then every 30 ticks, and kills it on the third strike', () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'veryFastWalker', 2, BASE_STOP_X);
    expect(z.hp).toBe(180);
    const energy = m.state.players.plants.energy;

    const log = play(m, 200);

    expect(strikes(log)).toEqual([[1, 2, z.id], [31, 2, z.id], [61, 2, z.id]]);
    const damage = log.flatMap(([n, events]) =>
      eventsOf(events, 'unitDamaged').filter((e) => e.unitId === z.id).map((e) => [n, e.amount, e.hp]));
    expect(damage).toEqual([[1, 60, 120], [31, 60, 60], [61, 60, 0]]);

    const deaths = log.flatMap(([, events]) => eventsOf(events, 'unitDied'));
    expect(deaths).toEqual([
      { type: 'unitDied', unitId: z.id, key: 'veryFastWalker', faction: 'zombies', lane: 2, x: BASE_STOP_X, level: 1, cause: 'damage' },
    ]);
    expect(deathStep(log, z)).toBe(61);
    expect(m.state.units).toEqual([]);

    const bounties = log.flatMap(([, events]) => eventsOf(events, 'energyGained').filter((e) => e.source === 'bounty'));
    const bounty = Math.floor(m.balance.bountyShare.plants * z.spent);
    expect(bounty).toBeGreaterThan(0);
    expect(bounties).toEqual([
      { type: 'energyGained', faction: 'plants', amount: bounty, source: 'bounty', unitId: null, lane: 2, x: BASE_STOP_X },
    ]);
    expect(m.state.players.plants.energy).toBe(energy + bounty);
  });

  it('the plant base only loses what the walker bit before it died', () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'veryFastWalker', 2, BASE_STOP_X);

    const log = play(m, 300);

    const died = deathStep(log, z);
    expect(died).toBe(61);
    const hits = log.flatMap(([n, events]) => eventsOf(events, 'baseDamaged').map((e) => [n, e] as const));
    expect(hits.length).toBeGreaterThan(0); // it did bite before it fell
    for (const [n, hit] of hits) {
      expect(n).toBeLessThanOrEqual(died ?? 0);
      expect(hit).toMatchObject({ faction: 'plants', lane: 2 });
    }
    const lost = 3000 - m.state.baseHp.plants;
    expect(hits.reduce((sum, [, hit]) => sum + hit.amount, 0)).toBe(lost);
    expect(m.state.baseHp.zombies).toBe(3000);
  });

  it('two zombies at the base in one lane: the lower id is struck until it dies, then the other, one interval later', () => {
    const m = fresh();
    const first = spawnUnit(m.state, m.balance, 'veryFastWalker', 0, BASE_STOP_X);
    const second = spawnUnit(m.state, m.balance, 'veryFastWalker', 0, BASE_STOP_X);
    second.hp = 60; // the weaker one: still not struck before the lower id falls

    const log = play(m, 200);

    expect(strikes(log)).toEqual([
      [1, 0, first.id], [31, 0, first.id], [61, 0, first.id],
      [91, 0, second.id],
    ]);
    expect(deathStep(log, first)).toBe(61);
    expect(deathStep(log, second)).toBe(91);
  });

  it('zombies at the base in lanes 1 and 3 are both struck on the same step, lane 1 first', () => {
    const m = fresh();
    const lane3 = spawnUnit(m.state, m.balance, 'brainEater', 3, BASE_STOP_X); // the lower id
    const lane1 = spawnUnit(m.state, m.balance, 'brainEater', 1, BASE_STOP_X);

    const events = m.step();

    expect(eventsOf(events, 'baseStruck')).toEqual([
      { type: 'baseStruck', lane: 1, targetId: lane1.id },
      { type: 'baseStruck', lane: 3, targetId: lane3.id },
    ]);
    expect([lane1.hp, lane3.hp]).toEqual([340, 340]);
    expect(m.state.baseDefenseTimers).toEqual([0, seconds(1), 0, seconds(1), 0]);
  });

  it('a zombie blocked by a plant is never struck; once it has eaten through and reached the base, it is', () => {
    const m = fresh();
    const plant = spawnUnit(m.state, m.balance, 'sunflower', 2, 1.5);
    const z = spawnUnit(m.state, m.balance, 'veryFastWalker', 2, 2.0); // within reach of the Sunflower

    let blockedByPlant = 0;
    let firstStrike: number | null = null;
    let plantFell: number | null = null;
    for (let n = 1; n <= 2000 && firstStrike === null; n++) {
      const events = m.step();
      if (eventsOf(events, 'unitDied').some((e) => e.unitId === plant.id)) plantFell = n;
      const struck = eventsOf(events, 'baseStruck');
      if (struck.length > 0) {
        firstStrike = n;
        expect(struck).toEqual([{ type: 'baseStruck', lane: 2, targetId: z.id }]);
        expect(z.x).toBe(BASE_STOP_X);
        expect(z.blocked).toBe(true);
      } else if (z.blocked && z.x > BASE_STOP_X) {
        blockedByPlant += 1;
      }
    }

    expect(blockedByPlant).toBeGreaterThan(100); // it stood at the Sunflower a good while, never struck
    expect(plantFell).not.toBeNull();
    expect(firstStrike).not.toBeNull();
    expect(firstStrike ?? 0).toBeGreaterThan(plantFell ?? Infinity);
  });

  it('a zombie still walking is never struck, not even on the step it arrives at BASE_STOP_X', () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'veryFastWalker', 4, 2.0);

    let arrived: number | null = null;
    let firstStrike: number | null = null;
    for (let n = 1; n <= 400 && firstStrike === null; n++) {
      const events = m.step();
      const struck = eventsOf(events, 'baseStruck');
      if (struck.length > 0) firstStrike = n;
      if (!z.blocked) {
        // It walked this step (blocked is set before it moves), so the base did not strike it.
        expect(struck, `step ${n}, x ${z.x}`).toEqual([]);
        if (arrived === null && z.x === BASE_STOP_X) arrived = n;
      }
    }

    expect(arrived).not.toBeNull();
    expect(firstStrike).toBe((arrived ?? 0) + 1);
  });

  it('with damage 0 (the shipped value) a zombie at the base for 600 steps is never struck and the timers stay 0', () => {
    const m = fresh(withBaseDefense(0, 1));
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, BASE_STOP_X);

    for (let n = 1; n <= 600; n++) {
      const events = m.step();
      expect(eventsOf(events, 'baseStruck')).toEqual([]);
      expect(m.state.baseDefenseTimers).toEqual([0, 0, 0, 0, 0]);
    }
    expect(z.hp).toBe(z.maxHp);
    expect(m.state.baseHp.plants).toBeLessThan(3000); // it was biting all along
  });

  it('a zombie with armor 10 loses 50 per strike', () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'brainEater', 1, BASE_STOP_X);
    z.armor = 10;

    const log = play(m, 31);

    expect(strikes(log)).toEqual([[1, 1, z.id], [31, 1, z.id]]);
    const damage = log.flatMap(([, events]) => eventsOf(events, 'unitDamaged').filter((e) => e.unitId === z.id));
    expect(damage).toEqual([
      { type: 'unitDamaged', unitId: z.id, amount: 50, hp: 350 },
      { type: 'unitDamaged', unitId: z.id, amount: 50, hp: 300 },
    ]);
  });

  it("a lane's timer reads seconds(1) right after a strike and counts down by 1 per step to 0", () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'veryFastWalker', 3, BASE_STOP_X);
    z.hp = 60; // the first strike kills it, so nothing re-arms the timer

    m.step();
    expect(m.state.baseDefenseTimers).toEqual([0, 0, 0, seconds(1), 0]);
    expect(m.state.units).toEqual([]);

    for (let left = seconds(1) - 1; left >= 0; left--) {
      m.step();
      expect(m.state.baseDefenseTimers).toEqual([0, 0, 0, left, 0]);
    }
    for (let n = 0; n < 10; n++) {
      m.step();
      expect(m.state.baseDefenseTimers).toEqual([0, 0, 0, 0, 0]); // never below 0
    }
  });

  it("strikes after units attack: on a shared step the base's strike follows the zombie's own bite", () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, BASE_STOP_X);
    z.meleeTimer = 1; // its bite is ready on the first step too

    const events = m.step();

    expect(events).toEqual([
      { type: 'unitAttacked', unitId: z.id, attack: 'melee', targetId: null, targetBase: 'plants' },
      { type: 'baseDamaged', faction: 'plants', amount: 40, hp: 2960, lane: 2 },
      { type: 'baseStruck', lane: 2, targetId: z.id },
      { type: 'unitDamaged', unitId: z.id, amount: 60, hp: 340 },
    ]);
  });

  it('a match restored from a snapshot keeps its timers and strikes on the same step as the original', () => {
    const original = fresh();
    spawnUnit(original.state, original.balance, 'brainEater', 2, BASE_STOP_X);
    play(original, 10);
    expect(original.state.baseDefenseTimers[2]).toBe(seconds(1) - 9);

    const copy = Match.restore(original.snapshot(), original.balance);
    expect(copy.state.baseDefenseTimers).toEqual(original.state.baseDefenseTimers);
    expect(strikes(play(copy, 30))).toEqual(strikes(play(original, 30)));
    expect(copy.hash()).toBe(original.hash());
  });
});
