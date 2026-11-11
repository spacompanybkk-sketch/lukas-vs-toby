import { describe, expect, it } from 'vitest';
import { BALANCE, seconds } from '../../src/data/balance';
import { UNIT_INFO } from '../../src/data/units';
import { TICKS_PER_SECOND } from '../../src/sim/types';
import type { UnitKey } from '../../src/sim/types';

describe('seconds', () => {
  it('converts seconds to whole ticks', () => {
    expect(TICKS_PER_SECOND).toBe(30);
    expect(seconds(1)).toBe(30);
    expect(seconds(0.7)).toBe(21);
    expect(seconds(1.2)).toBe(36);
    expect(seconds(1.5)).toBe(45);
    expect(seconds(0)).toBe(0);
  });

  it('rounds to the nearest tick', () => {
    expect(seconds(0.016)).toBe(0);
    expect(seconds(0.017)).toBe(1);
    expect(Number.isInteger(seconds(2.3333))).toBe(true);
  });
});

describe('BALANCE global numbers', () => {
  it('has the starting values', () => {
    expect(BALANCE.trickle).toEqual({ plants: 2, zombies: 5 });
    expect(BALANCE.bountyShare).toEqual({ plants: 0.2, zombies: 0.5 });
    expect(BALANCE.baseShotFactor).toBe(0.5);
    expect(BALANCE.hitRadius).toBe(0.35);
    expect(BALANCE.levelScale).toEqual([0, 1, 2, 3, 4, 5]);
    expect(BALANCE.suddenDeath).toEqual({ startSeconds: 360, baseRate: 0.005, growthPerSecond: 0.0001 });
    expect(BALANCE.startEnergy).toBe(200);
    expect(BALANCE.baseHp).toBe(3000);
  });
});

describe('BALANCE unit table', () => {
  it('has the six Phase 1 units and nothing else', () => {
    expect(Object.keys(BALANCE.units).sort()).toEqual(
      ['brainEater', 'peashooter', 'skeletonWarrior', 'sunflower', 'veryFastWalker', 'walnutBomb'],
    );
  });

  it('matches the table, row by row', () => {
    expect(BALANCE.units.peashooter).toEqual({
      recharge: 5, hp: 300, armor: 0, speed: 0,
      shot: { kind: 'pea', damage: 20, interval: 1.5, range: 10, speed: 6 },
    });
    expect(BALANCE.units.sunflower).toEqual({
      recharge: 5, hp: 200, armor: 0, speed: 0,
      sun: { amount: 25, interval: 10 },
    });
    expect(BALANCE.units.walnutBomb).toEqual({
      recharge: 15, hp: 1200, armor: 0, speed: 0,
      deathBlast: { damage: 150, radius: 1.5 },
    });
    expect(BALANCE.units.brainEater).toEqual({
      recharge: 5, hp: 400, armor: 0, speed: 0.35,
      melee: { damage: 40, interval: 1.0, reach: 0.6 },
      shot: { kind: 'brain', damage: 15, interval: 2.0, range: 3.5, speed: 4 },
    });
    expect(BALANCE.units.veryFastWalker).toEqual({
      recharge: 3, hp: 180, armor: 0, speed: 0.9,
      melee: { damage: 15, interval: 0.7, reach: 0.6 },
    });
    expect(BALANCE.units.skeletonWarrior).toEqual({
      recharge: 10, hp: 700, armor: 0, speed: 0.3,
      melee: { damage: 45, interval: 1.2, reach: 0.6 },
      shield: { interval: 4 },
    });
  });

  it('only plants stand still and only zombies walk', () => {
    for (const key of Object.keys(BALANCE.units) as UnitKey[]) {
      const speed = BALANCE.units[key]?.speed ?? -1;
      if (UNIT_INFO[key].faction === 'plants') expect(speed).toBe(0);
      else expect(speed).toBeGreaterThan(0);
    }
  });
});
