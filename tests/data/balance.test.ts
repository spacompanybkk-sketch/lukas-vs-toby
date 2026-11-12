import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance, UnitStats } from '../../src/data/balance';
import { PHASE1_CARDS, UNIT_INFO } from '../../src/data/units';
import { MAX_LEVEL, TICKS_PER_SECOND } from '../../src/sim/types';
import type { Faction, UnitKey } from '../../src/sim/types';

// These tests check the shape and sanity of the table, never the tuned values themselves,
// so retuning BALANCE does not mean editing this file.

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];

function entries(): Array<[UnitKey, UnitStats]> {
  return (Object.keys(BALANCE.units) as UnitKey[]).map((key) => {
    const stats = BALANCE.units[key];
    if (!stats) throw new Error(`no stats for ${key}`);
    return [key, stats];
  });
}

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

describe('BALANCE units', () => {
  it('has numbers for every Phase 1 card of both sides', () => {
    for (const faction of FACTIONS) {
      for (const key of PHASE1_CARDS[faction]) {
        expect(BALANCE.units[key], `${key} has no stats`).toBeDefined();
      }
    }
  });

  it('only describes units that exist in the roster', () => {
    for (const [key] of entries()) expect(UNIT_INFO[key], key).toBeDefined();
  });

  it('gives every unit positive health and recharge, and non-negative speed and armor', () => {
    for (const [key, stats] of entries()) {
      expect(stats.hp, `${key} hp`).toBeGreaterThan(0);
      expect(stats.recharge, `${key} recharge`).toBeGreaterThan(0);
      expect(stats.speed, `${key} speed`).toBeGreaterThanOrEqual(0);
      expect(stats.armor, `${key} armor`).toBeGreaterThanOrEqual(0);
      expect(seconds(stats.recharge), `${key} recharge ticks`).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps plants still and sets zombies walking', () => {
    for (const [key, stats] of entries()) {
      if (UNIT_INFO[key].faction === 'plants') expect(stats.speed, key).toBe(0);
      else expect(stats.speed, key).toBeGreaterThan(0);
    }
  });

  it('has sensible attacks: positive damage, reach or range, speed, and an interval of at least one tick', () => {
    for (const [key, stats] of entries()) {
      if (stats.melee) {
        expect(stats.melee.damage, `${key} melee damage`).toBeGreaterThan(0);
        expect(stats.melee.reach, `${key} melee reach`).toBeGreaterThan(0);
        expect(seconds(stats.melee.interval), `${key} melee interval`).toBeGreaterThanOrEqual(1);
      }
      if (stats.shot) {
        expect(['pea', 'brain'], `${key} shot kind`).toContain(stats.shot.kind);
        expect(stats.shot.damage, `${key} shot damage`).toBeGreaterThan(0);
        expect(stats.shot.range, `${key} shot range`).toBeGreaterThan(0);
        expect(stats.shot.speed, `${key} shot speed`).toBeGreaterThan(0);
        expect(seconds(stats.shot.interval), `${key} shot interval`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('has sensible abilities: sun, shield and death blast', () => {
    for (const [key, stats] of entries()) {
      if (stats.sun) {
        expect(stats.sun.amount, `${key} sun amount`).toBeGreaterThan(0);
        expect(Number.isInteger(stats.sun.amount), `${key} sun amount whole`).toBe(true);
        expect(seconds(stats.sun.interval), `${key} sun interval`).toBeGreaterThanOrEqual(1);
      }
      if (stats.shield) expect(seconds(stats.shield.interval), `${key} shield interval`).toBeGreaterThanOrEqual(1);
      if (stats.deathBlast) {
        expect(stats.deathBlast.damage, `${key} blast damage`).toBeGreaterThan(0);
        expect(stats.deathBlast.radius, `${key} blast radius`).toBeGreaterThan(0);
      }
    }
  });
});

describe('BALANCE globals', () => {
  const curves = [
    ['hp, plants', BALANCE.levelCurves.hp.plants], ['hp, zombies', BALANCE.levelCurves.hp.zombies],
    ['damage, plants', BALANCE.levelCurves.damage.plants], ['damage, zombies', BALANCE.levelCurves.damage.zombies],
    ['special', BALANCE.levelCurves.special],
  ] as const;
  it.each(curves)('has one %s level curve entry per level, starting with 1 at level 1 and rising', (_name, scale) => {
    expect(scale).toHaveLength(MAX_LEVEL + 1);
    expect(scale[1]).toBe(1);
    for (let level = 2; level <= MAX_LEVEL; level++) {
      expect(scale[level], `level ${level}`).toBeGreaterThan(scale[level - 1] ?? Infinity);
    }
  });

  it('has income and bounty for both sides, bounty shares being fractions', () => {
    for (const faction of FACTIONS) {
      expect(BALANCE.trickle[faction], `${faction} trickle`).toBeGreaterThan(0);
      expect(BALANCE.bountyShare[faction], `${faction} bounty`).toBeGreaterThanOrEqual(0);
      expect(BALANCE.bountyShare[faction], `${faction} bounty`).toBeLessThanOrEqual(1);
    }
  });

  it('has positive, sensible base, shot and hit numbers', () => {
    expect(BALANCE.baseShotFactor).toBeGreaterThan(0);
    expect(BALANCE.baseShotFactor).toBeLessThanOrEqual(1);
    expect(BALANCE.hitRadius).toBeGreaterThan(0);
    expect(Number.isInteger(BALANCE.startEnergy)).toBe(true);
    expect(BALANCE.startEnergy).toBeGreaterThan(0);
    expect(Number.isInteger(BALANCE.baseHp)).toBe(true);
    expect(BALANCE.baseHp).toBeGreaterThan(0);
  });

  it('has a sudden death that starts after the start and grows', () => {
    expect(BALANCE.suddenDeath.startSeconds).toBeGreaterThan(0);
    expect(BALANCE.suddenDeath.baseRate).toBeGreaterThan(0);
    expect(BALANCE.suddenDeath.growthPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('has a plant base defence with damage of 0 or more (0 switches it off) and an interval of at least one tick', () => {
    expect(BALANCE.baseDefense.damage).toBeGreaterThanOrEqual(0);
    expect(seconds(BALANCE.baseDefense.interval)).toBeGreaterThanOrEqual(1);
  });
});

/** Every object and array reachable from `value`, `value` included. */
function walk(value: unknown, found: object[] = []): object[] {
  if (typeof value === 'object' && value !== null) {
    found.push(value);
    for (const child of Object.values(value)) walk(child, found);
  }
  return found;
}

describe('BALANCE is frozen', () => {
  it('is deeply frozen: every nested object and array', () => {
    const all = walk(BALANCE);
    // The walk really reaches the nested parts.
    expect(all).toContain(BALANCE.units);
    expect(all).toContain(BALANCE.levelCurves);
    expect(all).toContain(BALANCE.levelCurves.hp.plants);
    expect(all).toContain(BALANCE.suddenDeath);
    expect(all).toContain(BALANCE.baseDefense);
    for (const [, stats] of entries()) expect(all).toContain(stats);
    for (const node of all) expect(Object.isFrozen(node)).toBe(true);
  });

  it('refuses a write, so no code can retune the shared table by accident', () => {
    const table = BALANCE as unknown as { startEnergy: number; units: { peashooter: { hp: number } }; levelCurves: { hp: { plants: number[] } } };
    expect(() => { table.startEnergy = 1; }).toThrow(TypeError);
    expect(() => { table.units.peashooter.hp = 1; }).toThrow(TypeError);
    expect(() => { table.levelCurves.hp.plants[1] = 9; }).toThrow(TypeError);
    expect(() => { table.levelCurves.hp.plants.push(6); }).toThrow(TypeError);
    expect(BALANCE.startEnergy).not.toBe(1);
  });
});

describe('cloneBalance', () => {
  it('copies every number', () => {
    expect(cloneBalance(BALANCE)).toEqual(BALANCE);
  });

  it('shares no object or array with the original', () => {
    const copy = cloneBalance(BALANCE);
    const originals = new Set(walk(BALANCE));
    for (const node of walk(copy)) expect(originals.has(node)).toBe(false);
  });

  it('is not frozen, so a test can tune it', () => {
    const copy: Balance = cloneBalance(BALANCE);
    for (const node of walk(copy)) expect(Object.isFrozen(node)).toBe(false);
    const hp = BALANCE.units.peashooter?.hp;
    const stats = copy.units.peashooter;
    if (!stats) throw new Error('no peashooter');
    stats.hp = 1;
    copy.startEnergy = 1;
    expect(copy.units.peashooter?.hp).toBe(1);
    expect(BALANCE.units.peashooter?.hp).toBe(hp);
    expect(BALANCE.startEnergy).not.toBe(1);
  });

  it('copies a copy', () => {
    const copy = cloneBalance(cloneBalance(BALANCE));
    expect(copy).toEqual(BALANCE);
  });
});
