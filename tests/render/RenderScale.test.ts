import { describe, expect, it } from 'vitest';
import { RenderScale } from '../../src/render/RenderScale';

/** Feeds `count` frames of `ms` each and returns how many times the scale changed. */
function feed(scale: RenderScale, ms: number, count: number): number {
  let changes = 0;
  for (let i = 0; i < count; i++) if (scale.sample(ms)) changes++;
  return changes;
}

/** Feeds `count` frames, repeating `pattern`. Returns how many times the scale changed. */
function feedPattern(scale: RenderScale, pattern: readonly number[], count: number): number {
  let changes = 0;
  for (let i = 0; i < count; i++) if (scale.sample(pattern[i % pattern.length] as number)) changes++;
  return changes;
}

/** One 60 Hz refresh and two of them, in milliseconds. */
const ONE = 1000 / 60;
const TWO = 2000 / 60;

/** Frames ignored after every change of scale. */
const SETTLE = 10;

/** A scale that has just been lowered once, with fresh windows and its settling time over. */
function loweredOnce(): RenderScale {
  const scale = new RenderScale();
  expect(feed(scale, 25, 30)).toBe(1);
  expect(scale.value).toBe(0.9);
  feed(scale, ONE, SETTLE);
  return scale;
}

describe('RenderScale', () => {
  it('starts at full resolution', () => {
    expect(new RenderScale().value).toBe(1);
  });

  it('lowers by 0.1 once the last 30 frames average over 18 ms, and not before it has 30', () => {
    const scale = new RenderScale();
    expect(feed(scale, 20, 29)).toBe(0);
    expect(scale.value).toBe(1);
    expect(scale.sample(20)).toBe(true);
    expect(scale.value).toBe(0.9);
  });

  it('lowers at 45 fps on a 60 Hz display: three frames in every four refreshes', () => {
    const scale = new RenderScale();
    // 16.7, 16.7, 33.3, repeating: never more than one slow frame in a row.
    feedPattern(scale, [ONE, ONE, TWO], 33);
    expect(scale.value).toBe(0.9);
  });

  it('lowers at 50 fps on a 60 Hz display: one late frame in every five', () => {
    const scale = new RenderScale();
    feedPattern(scale, [ONE, ONE, ONE, ONE, TWO], 35);
    expect(scale.value).toBe(0.9);
  });

  it('lowers at 40 fps on a 60 Hz display: frames alternating one and two refreshes', () => {
    const scale = new RenderScale();
    feedPattern(scale, [ONE, TWO], 32);
    expect(scale.value).toBe(0.9);
  });

  it('holds at a steady 60 fps with the odd late frame', () => {
    const scale = new RenderScale();
    // One late frame in every 30 is 59 fps.
    const pattern = [...new Array<number>(29).fill(ONE), TWO];
    expect(feedPattern(scale, pattern, 3000)).toBe(0);
    expect(scale.value).toBe(1);
  });

  it('does not lower for one hitch, however long', () => {
    for (const hitch of [60, 120, 240]) {
      const scale = new RenderScale();
      feed(scale, ONE, 100);
      scale.sample(hitch);
      expect(feed(scale, ONE, 100)).toBe(0);
      expect(scale.value).toBe(1);
    }
  });

  it('never goes below 0.6 and moves in exact tenths', () => {
    const scale = new RenderScale();
    const seen = new Set<number>([scale.value]);
    for (let i = 0; i < 2000; i++) {
      scale.sample(40);
      seen.add(scale.value);
    }
    expect([...seen]).toEqual([1, 0.9, 0.8, 0.7, 0.6]);
  });

  it('raises by 0.1 once the last 300 frames average under 14 ms, and not before it has 300', () => {
    const scale = loweredOnce();
    expect(feed(scale, 8.3, 299)).toBe(0);
    expect(scale.sample(8.3)).toBe(true);
    expect(scale.value).toBe(1);
  });

  it('never goes above 1', () => {
    const scale = new RenderScale();
    feed(scale, 40, 400);
    expect(scale.value).toBe(0.6);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      scale.sample(8.3);
      seen.add(scale.value);
    }
    expect([...seen]).toEqual([0.6, 0.7, 0.8, 0.9, 1]);
  });

  it('comes back up on a 60 Hz display, where no frame is ever under 14 ms', () => {
    const scale = loweredOnce();
    expect(feed(scale, ONE, 299)).toBe(0);
    expect(scale.sample(ONE)).toBe(true);
    expect(scale.value).toBe(1);
  });

  it('does not come back up while frames are only nearly on time', () => {
    const scale = loweredOnce();
    // 56 fps: neither slow enough to lower nor clean enough to raise.
    const pattern = [...new Array<number>(14).fill(ONE), TWO];
    expect(feedPattern(scale, pattern, 3000)).toBe(0);
    expect(scale.value).toBe(0.9);
  });

  /** A machine that holds 60 fps below full resolution but not at it, on a 60 Hz display. */
  function struggleAtFull(scale: RenderScale, frames: number): number[] {
    const raisedAt: number[] = [];
    for (let i = 0; i < frames; i++) {
      const before = scale.value;
      scale.sample(before >= 1 ? 25 : ONE);
      if (scale.value > before) raisedAt.push(i);
    }
    return raisedAt;
  }

  it('waits longer before each retry when going back up keeps failing', () => {
    const scale = new RenderScale();
    const raisedAt = struggleAtFull(scale, 20_000);
    const waits = raisedAt.slice(1).map((at, i) => at - (raisedAt[i] as number));
    expect(waits.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1] as number);
    expect(waits[waits.length - 1]).toBeGreaterThan((waits[0] as number) * 3);
    // Retries are capped, so it never gives up for good.
    expect(Math.max(...waits)).toBeLessThan(6000);
  });

  it('takes frames under 14 ms as proof of headroom, however often a retry has failed', () => {
    const patient = new RenderScale();
    struggleAtFull(patient, 6000);
    // On-time frames alone now have to wait for well over 300 frames …
    const before = patient.value;
    expect(before).toBeLessThan(1);
    expect(feed(patient, ONE, 400)).toBe(0);

    // … frames with real headroom do not.
    expect(feed(patient, 8.3, 300)).toBe(1);
    expect(patient.value).toBeCloseTo(before + 0.1, 10);
  });

  it('ignores a single long stall such as a hidden tab', () => {
    const scale = new RenderScale();
    feed(scale, ONE, 100);
    scale.sample(5000);
    feed(scale, ONE, 100);
    expect(scale.value).toBe(1);
  });

  it('starts counting again after a stall in the middle of a slow run', () => {
    const scale = new RenderScale();
    feed(scale, 20, 20);
    scale.sample(900);
    expect(feed(scale, 20, 29)).toBe(0);
    expect(scale.sample(20)).toBe(true);
  });

  it('can be told to look away while buffers are rebuilt', () => {
    const scale = new RenderScale();
    scale.settle(50);
    expect(feed(scale, 60, 50)).toBe(0);
    expect(feed(scale, 60, 29)).toBe(0);
    expect(scale.sample(60)).toBe(true);
  });

  it('starts its windows afresh after every change of scale', () => {
    const scale = new RenderScale();
    feed(scale, 25, 30);
    expect(scale.value).toBe(0.9);
    // The 30 slow frames that caused the change must not cause a second one.
    feed(scale, ONE, SETTLE);
    expect(feed(scale, ONE, 29)).toBe(0);
    expect(scale.value).toBe(0.9);
  });

  it('reports a smoothed frame rate', () => {
    const scale = new RenderScale();
    feed(scale, 16.667, 200);
    expect(scale.fps).toBeGreaterThan(59);
    expect(scale.fps).toBeLessThan(61);
    feed(scale, 33.333, 200);
    expect(scale.fps).toBeGreaterThan(29);
    expect(scale.fps).toBeLessThan(31);
  });
});
