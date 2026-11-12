import { describe, expect, it } from 'vitest';
import { MERGE_PAIRS, breakEven, laneDuel, mergeValue } from '../../src/ai/duels';
import { BALANCE, cloneBalance } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';

// Spec 6.3 and 10: a level-N unit is worth 1.00-1.15 times N separate level-1 units. Measured with
// equal-budget lane duels (src/ai/duels.ts): how many level-1 enemies one level-N unit holds off,
// against how many N level-1 units do, for every fighting unit of phase 1 against every enemy it
// meets, both orders, N = 2..5. Each duel is a few thousand ticks, so the measure is exact for the
// numbers but coarse (a kill more or less moves a value by up to 0.1): each pair and level must
// fall within 0.8-1.3, and the average over all of them within the spec's 1.00-1.15.

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
  it('a level-N unit is worth about N separate ones: each pair 0.8-1.3, the average 1.00-1.15', () => {
    const all: string[] = [];
    for (const [unit, enemy] of MERGE_PAIRS) {
      for (let level = 2; level <= 5; level++) {
        const v = mergeValue(unit, enemy, level);
        all.push(`${unit} vs ${enemy} N=${level}: ${v.value.toFixed(2)}`);
        expect(v.value, `${unit} vs ${enemy}, level ${level}`).toBeGreaterThanOrEqual(0.8);
        expect(v.value, `${unit} vs ${enemy}, level ${level}`).toBeLessThanOrEqual(1.3);
      }
    }
    const avg = mean(values(cloneBalance(BALANCE)));
    expect(avg, all.join('\n')).toBeGreaterThanOrEqual(1);
    expect(avg, all.join('\n')).toBeLessThanOrEqual(1.15);
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
