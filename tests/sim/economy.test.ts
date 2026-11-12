import { describe, expect, it } from 'vitest';
import { seconds } from '../../src/data/balance';
import { payBounty, tickEconomy } from '../../src/sim/economy';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { SimEvent, Unit } from '../../src/sim/types';
import { classicBalance, eventsOf, place } from './helpers';

/** The numbers these rules tests were written for (see `classicBalance`). */
const BALANCE = classicBalance();

function steps(m: Match, n: number): void {
  for (let i = 0; i < n; i++) m.step();
}

describe('income', () => {
  it('pays plants 1.8 and zombies 6 energy over 30 steps, the part of an energy kept as carry', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    steps(m, 30);
    expect(m.state.players.plants.energy).toBe(191);
    expect(m.state.players.plants.carry).toBe(24000); // 0.8 of an energy
    expect(m.state.players.zombies.energy).toBe(196);
    expect(m.state.players.zombies.carry).toBe(0);
  });

  it('scales with the income multiplier: zombies at 1.2 earn 7.2 a second', () => {
    const config = defaultConfig(1, BALANCE);
    config.incomeMultiplier.zombies = 1.2;
    const m = new Match(config, BALANCE);
    steps(m, 30);
    expect(m.state.players.zombies.energy).toBe(197);
    expect(m.state.players.zombies.carry).toBe(6000); // 0.2 of an energy
    expect(m.state.players.plants.energy).toBe(191);
  });

  it('keeps energy a whole number after every step, whatever the multiplier', () => {
    const config = defaultConfig(1, BALANCE);
    config.incomeMultiplier = { plants: 0.37, zombies: 1.7 };
    const m = new Match(config, BALANCE);
    for (let i = 0; i < 400; i++) {
      m.step();
      for (const side of ['plants', 'zombies'] as const) {
        const p = m.state.players[side];
        expect(Number.isInteger(p.energy)).toBe(true);
        expect(Number.isInteger(p.carry)).toBe(true);
        expect(p.carry).toBeGreaterThanOrEqual(0);
        expect(p.carry).toBeLessThan(30000);
      }
    }
  });

  it('adds the whole carry of a tick before paying out whole energy', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    m.step();
    // 1.8 energy per second is 1800 per tick; nothing whole yet.
    expect(m.state.players.plants.carry).toBe(1800);
    expect(m.state.players.plants.energy).toBe(190);
    expect(m.state.players.zombies.carry).toBe(6000);
  });

  it('can pay out several energy in one tick at a high rate', () => {
    const config = defaultConfig(1, BALANCE);
    config.incomeMultiplier.zombies = 11; // 66 energy a second: 66000 carry a tick
    const m = new Match(config, BALANCE);
    m.step();
    expect(m.state.players.zombies.energy).toBe(192);
    expect(m.state.players.zombies.carry).toBe(6000);
  });
});

describe('timers', () => {
  it('counts unit timers and card recharges down by 1, never below 0', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const u = spawnUnit(m.state, BALANCE, 'brainEater', 0, 9.5);
    u.meleeTimer = 1;
    u.shotTimer = 0;
    u.abilityTimer = 5;
    m.state.players.plants.recharge = { peashooter: 2, sunflower: 0 };
    m.state.players.zombies.recharge = { brainEater: 1 };

    tickEconomy(m.state, BALANCE, []);

    expect([u.meleeTimer, u.shotTimer, u.abilityTimer]).toEqual([0, 0, 4]);
    expect(m.state.players.plants.recharge).toEqual({ peashooter: 1, sunflower: 0 });
    expect(m.state.players.zombies.recharge).toEqual({ brainEater: 0 });

    tickEconomy(m.state, BALANCE, []);
    expect(m.state.players.plants.recharge).toEqual({ peashooter: 0, sunflower: 0 });
    expect(u.meleeTimer).toBe(0);
  });

  it.each([
    ['plants', 'peashooter'],
    ['plants', 'sunflower'],
    ['plants', 'walnutBomb'],
    ['zombies', 'brainEater'],
    ['zombies', 'veryFastWalker'],
    ['zombies', 'skeletonWarrior'],
  ] as const)('%s card %s is ready after exactly seconds(recharge) steps, not before', (faction, unit) => {
    const config = defaultConfig(1, BALANCE);
    config.startEnergy = { plants: 999, zombies: 999 };
    const m = new Match(config, BALANCE);
    const total = seconds(BALANCE.units[unit]?.recharge ?? 0);
    expect(total).toBeGreaterThan(0);

    m.step([place(faction, unit, 0, 0)]); // the placing step counts as the first
    expect(m.state.players[faction].recharge[unit]).toBe(total - 1);

    for (let n = 2; n < total; n++) {
      m.step();
      expect(m.state.players[faction].recharge[unit]).toBe(total - n);
      expect(m.check(place(faction, unit, 1, 1))).toBe('recharging');
    }
    m.step(); // step number `total`
    expect(m.state.players[faction].recharge[unit]).toBe(0);
    expect(m.check(place(faction, unit, 1, 1))).toBeNull();
  });
});

describe('sunflower', () => {
  it('pays 25 during the 300th and 600th steps after being placed in the first', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const first = m.step([place('plants', 'sunflower', 2, 4)]);
    const sunflower = m.state.units[0];
    if (!sunflower) throw new Error('no sunflower');
    expect(eventsOf(first, 'energyGained')).toEqual([]);

    const paidOn: number[] = [];
    for (let n = 2; n <= 650; n++) {
      const events = m.step();
      for (const e of eventsOf(events, 'energyGained')) {
        paidOn.push(n);
        expect(e).toEqual({
          type: 'energyGained', faction: 'plants', amount: 25, source: 'sunflower',
          unitId: sunflower.id, lane: 2, x: 4.5,
        });
      }
      if (n === 300) {
        // 190 start - 50 card + 18 trickle (300 ticks at 1800 carry) + 25 sun
        expect(m.state.players.plants.energy).toBe(183);
      }
    }
    expect(paidOn).toEqual([300, 600]);
  });

  it('pays sun.amount x the special level curve and resets its timer to the full interval', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const u = spawnUnit(m.state, BALANCE, 'sunflower', 1, 2.5);
    u.level = 3;
    u.abilityTimer = 1;
    const events: SimEvent[] = [];

    tickEconomy(m.state, BALANCE, events);

    expect(eventsOf(events, 'energyGained')).toEqual([
      { type: 'energyGained', faction: 'plants', amount: 75, source: 'sunflower', unitId: u.id, lane: 1, x: 2.5 },
    ]);
    expect(m.state.players.plants.energy).toBe(265);
    expect(u.abilityTimer).toBe(seconds(10));
  });

  it('does not pay while its timer is above 0, and other units never pay', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const sun = spawnUnit(m.state, BALANCE, 'sunflower', 1, 2.5);
    const pea = spawnUnit(m.state, BALANCE, 'peashooter', 1, 3.5);
    sun.abilityTimer = 2;
    pea.abilityTimer = 0;
    const events: SimEvent[] = [];
    tickEconomy(m.state, BALANCE, events);
    expect(eventsOf(events, 'energyGained')).toEqual([]);
    expect(m.state.players.plants.energy).toBe(190);
  });

  it('pays every ready Sunflower, in ascending id order', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const a = spawnUnit(m.state, BALANCE, 'sunflower', 0, 0.5);
    const b = spawnUnit(m.state, BALANCE, 'sunflower', 3, 1.5);
    a.abilityTimer = 1;
    b.abilityTimer = 1;
    const events: SimEvent[] = [];
    tickEconomy(m.state, BALANCE, events);
    expect(eventsOf(events, 'energyGained').map((e) => e.unitId)).toEqual([a.id, b.id]);
    expect(m.state.players.plants.energy).toBe(240);
  });
});

describe('payBounty', () => {
  function victim(m: Match, key: Parameters<typeof spawnUnit>[2], x: number): Unit {
    return spawnUnit(m.state, BALANCE, key, 3, x);
  }

  it('pays plants 20% of a dead zombie\'s spent energy, at its position', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const zombie = victim(m, 'brainEater', 6.25); // spent 100
    const events: SimEvent[] = [];
    payBounty(m.state, BALANCE, zombie, events);
    expect(m.state.players.plants.energy).toBe(210);
    expect(m.state.players.zombies.energy).toBe(190);
    expect(events).toEqual([
      { type: 'energyGained', faction: 'plants', amount: 20, source: 'bounty', unitId: null, lane: 3, x: 6.25 },
    ]);
  });

  it('pays zombies 50% of a dead plant\'s spent energy', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const plant = victim(m, 'peashooter', 2.5); // spent 100
    const events: SimEvent[] = [];
    payBounty(m.state, BALANCE, plant, events);
    expect(m.state.players.zombies.energy).toBe(240);
    expect(m.state.players.plants.energy).toBe(190);
    expect(eventsOf(events, 'energyGained')).toEqual([
      { type: 'energyGained', faction: 'zombies', amount: 50, source: 'bounty', unitId: null, lane: 3, x: 2.5 },
    ]);
  });

  it('rounds down to a whole number', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const plant = victim(m, 'sunflower', 0.5); // spent 50 -> 25
    plant.spent = 51; // 25.5 -> 25
    const events: SimEvent[] = [];
    payBounty(m.state, BALANCE, plant, events);
    expect(eventsOf(events, 'energyGained')[0]?.amount).toBe(25);
    expect(m.state.players.zombies.energy).toBe(215);
  });

  it('pays nothing and emits nothing when the amount is 0', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const zombie = victim(m, 'veryFastWalker', 5.5);
    zombie.spent = 4; // 0.2 x 4 = 0.8 -> 0
    const events: SimEvent[] = [];
    payBounty(m.state, BALANCE, zombie, events);
    expect(events).toEqual([]);
    expect(m.state.players.plants.energy).toBe(190);
  });

  it('uses the victim\'s own spent, not the card price, so merged units pay more', () => {
    const m = new Match(defaultConfig(1, BALANCE), BALANCE);
    const zombie = victim(m, 'brainEater', 5.5);
    zombie.spent = 300;
    const events: SimEvent[] = [];
    payBounty(m.state, BALANCE, zombie, events);
    expect(m.state.players.plants.energy).toBe(250);
  });
});
