import { describe, expect, it } from 'vitest';
import { FIGHTERS, MERGE_PAIRS, breakEven, laneDuel, mergeValue, unitMergeValue } from '../../src/ai/duels';
import { BALANCE, cloneBalance } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';

// Spec 6.3 and 10: a level-N unit is worth about N separate level-1 units. Measured with
// equal-budget lane duels (src/ai/duels.ts): how many level-1 enemies one level-N unit holds off,
// against how many N level-1 units do, N = 2..5. Each duel is exact for the numbers but coarse (a
// kill more or less moves a value by up to 0.1), so the band is on each fighter's mean over N:
// 0.95-1.25 (plan Task 8), every plant that fights against Brain Eaters and every zombie but the
// Necromancer against Peashooters; and phase 1's pairs average 1.00-1.15.

const BULK_MS = 60_000;

function values(b: Balance): number[] {
  const out: number[] = [];
  for (const [unit, enemy] of MERGE_PAIRS) {
    for (let level = 2; level <= 5; level++) out.push(mergeValue(unit, enemy, level, b).value);
  }
  return out;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('merge value', () => {
  it('every unit that fights is worth 0.95-1.25 times N separate ones (its mean over N = 2..5)', () => {
    for (const unit of FIGHTERS) {
      const v = unitMergeValue(unit);
      const shown = `${unit} v ${v.enemy}: ${v.values.map((x) => x.toFixed(2)).join(' ')}`;
      expect(v.mean, shown).toBeGreaterThanOrEqual(0.95);
      expect(v.mean, shown).toBeLessThanOrEqual(1.25);
    }
  }, BULK_MS);

  it("phase 1's pairs, both orders, average 1.00-1.15", () => {
    // Phase 1 also held each pair and level within 0.8-1.3. Phase 2 measures plants against
    // zombies that arrive one behind the other (ENEMY_SPACING) and has an 800-health Skeleton
    // Warrior; two cells fall just outside (Peashooter v Very Fast Walker N=2 1.34, v Skeleton
    // Warrior N=3 0.79). The brief's per-unit band above replaces that per-cell check.
    const avg = mean(values(cloneBalance(BALANCE)));
    expect(avg).toBeGreaterThanOrEqual(1);
    expect(avg).toBeLessThanOrEqual(1.15);
  }, BULK_MS);

  it('tells a curve that makes merging too strong: health and damage both ×N² would fail', () => {
    const b = cloneBalance(BALANCE);
    const square = [0, 1, 4, 9, 16, 25];
    b.levelCurves.hp = { plants: square, zombies: square };
    b.levelCurves.damage = { plants: square, zombies: square };
    expect(mean(values(b))).toBeGreaterThan(1.3);
  }, BULK_MS);

  it('measures a duel the same way every time, and a bigger enemy group never does worse', () => {
    const peas = { key: 'peashooter', level: 1, count: 3 } as const;
    const a = laneDuel(peas, { key: 'brainEater', level: 1, count: 2 });
    expect(laneDuel(peas, { key: 'brainEater', level: 1, count: 2 })).toEqual(a);
    const more = laneDuel(peas, { key: 'brainEater', level: 1, count: 4 });
    expect(more.left.plants).toBeLessThanOrEqual(a.left.plants);
    // Three Peashooters hold off some Brain Eaters, and not dozens.
    const n = breakEven(peas, 'brainEater');
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(10);
  });
});
