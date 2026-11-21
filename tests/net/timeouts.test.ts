import { describe, expect, it } from 'vitest';
import {
  HASH_EVERY_TICKS, HASH_RING, MAX_REPAIRS, VS_TIMEOUTS, inputDelay, scaledTimeouts, stallStage,
} from '../../src/net/timeouts';

describe('versus timeouts', () => {
  it('holds the spec table (6.8)', () => {
    expect(VS_TIMEOUTS).toEqual({
      heartbeatMs: 15000, hereMs: 40000, inviteMs: 60000, readyMs: 30000, rematchMs: 60000,
      stall: { hourglassMs: 1000, faceMs: 3000, flagMs: 90000, unfinishedMs: 600000 },
      endWaitMs: 10000, retry: { firstMs: 250, maxMs: 2000 }, stream: { firstMs: 500, maxMs: 8000 },
    });
    expect([HASH_EVERY_TICKS, HASH_RING, MAX_REPAIRS]).toEqual([30, 20, 3]);
  });

  it.each([
    [0, 'none'], [999, 'none'], [1000, 'hourglass'], [2999, 'hourglass'], [3000, 'face'],
    [89999, 'face'], [90000, 'flag'], [599999, 'flag'], [600000, 'unfinished'],
  ] as const)('a silence of %i ms is stage %s', (ms, stage) => {
    expect(stallStage(ms)).toBe(stage);
  });

  it('stages by the timeouts it is given', () => {
    expect(stallStage(3000, scaledTimeouts(30))).toBe('flag');
    expect(stallStage(20000, scaledTimeouts(30))).toBe('unfinished');
  });

  it('picks the input delay from the round trip', () => {
    expect(inputDelay(null)).toBe(12);
    expect(inputDelay(280)).toBe(13);
    expect(inputDelay(0)).toBe(9);
    expect(inputDelay(1000)).toBe(30);
  });

  it('divides every duration for the quick debug mode', () => {
    const q = scaledTimeouts(30);
    expect(q.stall.flagMs).toBe(3000);
    expect(q.heartbeatMs).toBe(500);
    expect(q.retry).toEqual({ firstMs: 250 / 30, maxMs: 2000 / 30 });
    expect(VS_TIMEOUTS.stall.flagMs).toBe(90000); // the table itself is untouched
  });
});
