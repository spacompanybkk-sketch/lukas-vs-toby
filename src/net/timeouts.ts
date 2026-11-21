/**
 * The timeouts of two-device Versus as one table (spec 6.8), so every wait is driven by an injected
 * clock and the debug `vsquick` mode can shrink them all at once.
 */
export interface VersusTimeouts {
  heartbeatMs: number; hereMs: number; inviteMs: number; readyMs: number; rematchMs: number;
  stall: { hourglassMs: number; faceMs: number; flagMs: number; unfinishedMs: number };
  endWaitMs: number; retry: { firstMs: number; maxMs: number }; stream: { firstMs: number; maxMs: number };
}

export const VS_TIMEOUTS: VersusTimeouts = Object.freeze({
  heartbeatMs: 15000, // "here" heartbeat
  hereMs: 40000, // a heartbeat younger than this counts as here
  inviteMs: 60000,
  readyMs: 30000,
  rematchMs: 60000,
  stall: Object.freeze({ hourglassMs: 1000, faceMs: 3000, flagMs: 90000, unfinishedMs: 600000 }),
  endWaitMs: 10000, // how long to wait for the other seat's end record
  retry: Object.freeze({ firstMs: 250, maxMs: 2000 }), // a write answered offline: 250 ms doubling to 2 s
  stream: Object.freeze({ firstMs: 500, maxMs: 8000 }), // reopening a stream: 0.5 s doubling to 8 s
});

/** Hash check every 30 ticks (1 s), a ring of the last 20, three repairs before giving up (spec 6.5, 6.6). */
export const HASH_EVERY_TICKS = 30;
export const HASH_RING = 20;
export const MAX_REPAIRS = 3;

/** Every duration of the table divided by `divisor` (debug `vsquick`). */
export function scaledTimeouts(divisor: number): VersusTimeouts {
  const t = VS_TIMEOUTS;
  const d = (ms: number) => ms / divisor;
  return {
    heartbeatMs: d(t.heartbeatMs), hereMs: d(t.hereMs), inviteMs: d(t.inviteMs), readyMs: d(t.readyMs),
    rematchMs: d(t.rematchMs),
    stall: {
      hourglassMs: d(t.stall.hourglassMs), faceMs: d(t.stall.faceMs),
      flagMs: d(t.stall.flagMs), unfinishedMs: d(t.stall.unfinishedMs),
    },
    endWaitMs: d(t.endWaitMs),
    retry: { firstMs: d(t.retry.firstMs), maxMs: d(t.retry.maxMs) },
    stream: { firstMs: d(t.stream.firstMs), maxMs: d(t.stream.maxMs) },
  };
}

/** What the waiting screen shows after the other seat has been silent this long (spec 6.7). */
export type StallStage = 'none' | 'hourglass' | 'face' | 'flag' | 'unfinished';

export function stallStage(silentMs: number, t: VersusTimeouts = VS_TIMEOUTS): StallStage {
  const s = t.stall;
  if (silentMs >= s.unfinishedMs) return 'unfinished';
  if (silentMs >= s.flagMs) return 'flag';
  if (silentMs >= s.faceMs) return 'face';
  if (silentMs >= s.hourglassMs) return 'hourglass';
  return 'none';
}

/** The input delay in ticks from the measured p90 round trip: clamp(ceil((rtt + 120) / 33.3), 9, 30); none measured → 12. */
export function inputDelay(p90RoundTripMs: number | null): number {
  if (p90RoundTripMs === null) return 12;
  return Math.min(30, Math.max(9, Math.ceil((p90RoundTripMs + 120) / 33.3)));
}
