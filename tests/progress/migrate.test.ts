import { describe, expect, it } from 'vitest';
import { OLD_SAVE_KEYS, importOldSave, refund } from '../../src/progress/migrate';
import { newSave, parseSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';

const T0 = 1_762_900_000_000;
const fresh = (): Save => ({ ...newSave('p01', 'Lukas', 'peashooter', T0), coins: 25 });

/**
 * What the old game (tag `old-game-final`, src/game/SaveManager.ts) wrote to
 * `localStorage['lpvtz_save_lukas']`: `JSON.stringify({ tobyDollars, currentLevel, upgrades })`,
 * with `upgrades` keyed by the same unit keys the new game uses.
 */
const OLD_LUKAS = JSON.stringify({ tobyDollars: 300, currentLevel: 4, upgrades: { peashooter: 3 } });
const OLD_TOBY = JSON.stringify({
  tobyDollars: 1240, currentLevel: 9,
  upgrades: { brainEater: 10, veryFastWalker: 1, skeletonWarrior: 0, necromancer: 2 },
});

describe('the old save keys', () => {
  it('are the old game\'s', () => {
    expect(OLD_SAVE_KEYS).toEqual({ lukas: 'lpvtz_save_lukas', toby: 'lpvtz_save_toby' });
  });
});

describe('refund', () => {
  it('returns what the levels cost: 100 × n(n+1)/2', () => {
    expect([0, 1, 2, 3, 10].map(refund)).toEqual([0, 100, 300, 600, 5500]);
  });
});

describe('importOldSave', () => {
  it('carries 300 coins and refunds one unit at level 3 with 600', () => {
    const s = importOldSave(fresh(), OLD_LUKAS, T0 + 10);
    expect(s.coins).toBe(25 + 300 + 600);
    expect(s.importedOld).toBe(true);
    expect(s.upgrades).toEqual({});
    expect(s.updatedAt).toBe(T0 + 10);
    expect(parseSave(s)).toEqual(s);
  });

  it('refunds every upgraded unit', () => {
    const s = importOldSave(fresh(), OLD_TOBY, T0 + 10);
    expect(s.coins).toBe(25 + 1240 + 5500 + 100 + 0 + 300);
  });

  it('runs once: a second import adds nothing', () => {
    const once = importOldSave(fresh(), OLD_LUKAS, T0 + 10);
    const twice = importOldSave(once, OLD_LUKAS, T0 + 20);
    expect(twice).toBe(once);
  });

  it('marks corrupt JSON as imported and adds nothing', () => {
    const s = importOldSave(fresh(), '{"tobyDollars": 30', T0 + 10);
    expect(s.coins).toBe(25);
    expect(s.importedOld).toBe(true);
  });

  it.each(['42', 'null', '"text"', '[]', '{}', '{"tobyDollars":"lots"}'])('treats %s as nothing to carry', (raw) => {
    const s = importOldSave(fresh(), raw, T0 + 10);
    expect(s.coins).toBe(25);
    expect(s.importedOld).toBe(true);
  });

  it('leaves the save alone when this device has no old save, so another device can still import', () => {
    const s = fresh();
    expect(importOldSave(s, null, T0 + 10)).toBe(s);
  });

  it('takes only the sound parts of a damaged old save', () => {
    const raw = JSON.stringify({
      tobyDollars: 50.7, upgrades: { peashooter: 2, notAUnit: 5, brainEater: 'x', sunflower: 14, torchwood: -3 },
    });
    // 50 coins (whole), peashooter 2 → 300, sunflower capped at 10 → 5500; the rest ignored.
    expect(importOldSave(fresh(), raw, T0 + 10).coins).toBe(25 + 50 + 300 + 5500);
    expect(importOldSave(fresh(), JSON.stringify({ tobyDollars: -100, upgrades: null }), T0).coins).toBe(25);
  });
});
