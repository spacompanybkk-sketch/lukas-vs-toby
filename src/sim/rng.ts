/**
 * Seeded random numbers (mulberry32). The whole state is one unsigned 32-bit integer
 * kept in `s.rng`, so a match can be snapshotted, replayed and checksummed exactly.
 */

/** Next value in [0, 1). Stores the new 32-bit state in `s.rng`. */
export function nextRandom(s: { rng: number }): number {
  const a = (s.rng + 0x6d2b79f5) | 0;
  s.rng = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A whole number from 0 to n - 1. `n` must be a positive integer. */
export function randomInt(s: { rng: number }, n: number): number {
  if (!(n >= 1) || n !== Math.floor(n)) {
    throw new RangeError(`randomInt needs a positive integer range, got ${n}`);
  }
  return Math.floor(nextRandom(s) * n);
}
