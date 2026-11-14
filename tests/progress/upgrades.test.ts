import { describe, expect, it } from 'vitest';
import { MAX_UPGRADE, buyUpgrade, upgradeCost } from '../../src/progress/upgrades';
import { newSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';

const T0 = 1_762_900_000_000;

describe('upgradeCost', () => {
  it('is 100 × the next level', () => {
    expect(MAX_UPGRADE).toBe(10);
    expect([1, 2, 3, 9, 10].map(upgradeCost)).toEqual([100, 200, 300, 900, 1000]);
  });

  it('refuses a level outside 1..10', () => {
    for (const n of [0, 11, -1, 1.5]) expect(() => upgradeCost(n)).toThrow();
  });
});

describe('buyUpgrade', () => {
  it('takes a unit from 0 to 10 for 5,500 coins in total, then says max', () => {
    let s: Save = { ...newSave('p01', 'Lukas', 'peashooter', T0), coins: 6000 };
    for (let i = 1; i <= 10; i++) {
      const next = buyUpgrade(s, 'peashooter', T0 + i);
      if (typeof next === 'string') throw new Error(`level ${i}: ${next}`);
      expect(next.upgrades.peashooter).toBe(i);
      expect(next.updatedAt).toBe(T0 + i);
      s = next;
    }
    expect(s.coins).toBe(500);
    expect(buyUpgrade(s, 'peashooter', T0 + 11)).toBe('max');
  });

  it('says no-coins when one coin short, and changes nothing', () => {
    const s: Save = { ...newSave('p01', 'Lukas', 'peashooter', T0), coins: 99 };
    expect(buyUpgrade(s, 'brainEater', T0 + 1)).toBe('no-coins');
    const t = buyUpgrade({ ...s, coins: 100 }, 'brainEater', T0 + 1);
    expect(t).toMatchObject({ coins: 0, upgrades: { brainEater: 1 } });
    expect(s.upgrades).toEqual({});
  });

  it('prices each unit by its own level', () => {
    const s: Save = { ...newSave('p01', 'Lukas', 'peashooter', T0), coins: 1000, upgrades: { torchwood: 4 } };
    expect(buyUpgrade(s, 'torchwood', T0 + 1)).toMatchObject({ coins: 500, upgrades: { torchwood: 5 } });
    expect(buyUpgrade(s, 'sunflower', T0 + 1)).toMatchObject({ coins: 900, upgrades: { torchwood: 4, sunflower: 1 } });
  });
});
