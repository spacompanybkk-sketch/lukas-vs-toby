import { describe, expect, it } from 'vitest';
import { nextRandom, randomInt } from '../../src/sim/rng';

function draws(seed: number, count: number): number[] {
  const s = { rng: seed };
  return Array.from({ length: count }, () => nextRandom(s));
}

describe('nextRandom (mulberry32)', () => {
  it('gives the same first 1,000 values for the same seed', () => {
    expect(draws(12345, 1000)).toEqual(draws(12345, 1000));
  });

  it('gives different sequences for different seeds', () => {
    expect(draws(1, 1000)).not.toEqual(draws(2, 1000));
  });

  it('matches the reference mulberry32 values (pins the algorithm across browsers)', () => {
    // First draws for seed 1, computed with the canonical mulberry32 reference implementation.
    expect(draws(1, 3)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it('returns only values in [0, 1)', () => {
    for (const v of draws(987654321, 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('keeps the state an unsigned 32-bit integer', () => {
    for (const seed of [0, 1, 0xffffffff, 0x80000000, 0xdeadbeef]) {
      const s = { rng: seed };
      for (let i = 0; i < 1000; i++) {
        nextRandom(s);
        expect(Number.isInteger(s.rng)).toBe(true);
        expect(s.rng).toBeGreaterThanOrEqual(0);
        expect(s.rng).toBeLessThanOrEqual(0xffffffff);
      }
    }
  });

  it('continues the same sequence from a stored state', () => {
    const a = { rng: 777 };
    for (let i = 0; i < 50; i++) nextRandom(a);
    const b = { rng: a.rng };
    expect(draws(777, 100).slice(50)).toEqual(Array.from({ length: 50 }, () => nextRandom(b)));
  });
});

describe('randomInt', () => {
  it('hits each of 0..4 between 1,700 and 2,300 times over 10,000 draws', () => {
    const s = { rng: 2024 };
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 10_000; i++) {
      const v = randomInt(s, 5);
      expect(Number.isInteger(v)).toBe(true);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(1700);
      expect(count).toBeLessThanOrEqual(2300);
    }
  });

  it('returns 0 for n = 1 and rejects a range that is not a positive integer', () => {
    const s = { rng: 5 };
    expect(randomInt(s, 1)).toBe(0);
    expect(() => randomInt(s, 0)).toThrow(RangeError);
    expect(() => randomInt(s, 2.5)).toThrow(RangeError);
    expect(() => randomInt(s, Number.NaN)).toThrow(RangeError);
  });
});
