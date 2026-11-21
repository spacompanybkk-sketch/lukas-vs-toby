import { describe, expect, it } from 'vitest';
import { HashRing } from '../../src/net/hashRing';

describe('HashRing', () => {
  it('keeps the newest 20 hashes by tick', () => {
    const ring = new HashRing();
    expect(ring.newest()).toBeNull();
    for (let i = 1; i <= 25; i++) ring.put(30 * i, 1000 + i);
    expect(ring.get(30 * 25)).toBe(1025);
    expect(ring.get(30 * 6)).toBe(1006); // the oldest kept
    expect(ring.get(30 * 5)).toBeUndefined(); // evicted
    expect(ring.get(30 * 1)).toBeUndefined();
    expect(ring.newest()).toEqual([750, 1025]);
  });

  it('takes a size, replaces a tick put twice, and clears', () => {
    const ring = new HashRing(2);
    ring.put(30, 1);
    ring.put(60, 2);
    ring.put(60, 3);
    expect(ring.get(30)).toBe(1);
    expect(ring.get(60)).toBe(3);
    ring.put(90, 4);
    expect(ring.get(30)).toBeUndefined();
    ring.clear();
    expect(ring.get(90)).toBeUndefined();
    expect(ring.newest()).toBeNull();
  });
});
