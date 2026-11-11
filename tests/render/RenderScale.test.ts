import { describe, expect, it } from 'vitest';
import { RenderScale } from '../../src/render/Renderer';

/** Feeds `count` frames of `ms` each and returns how many times the scale changed. */
function feed(scale: RenderScale, ms: number, count: number): number {
  let changes = 0;
  for (let i = 0; i < count; i++) if (scale.sample(ms)) changes++;
  return changes;
}

/** A scale that has already been driven down to its floor. */
function atFloor(): RenderScale {
  const scale = new RenderScale();
  feed(scale, 40, 400);
  expect(scale.value).toBe(0.6);
  return scale;
}

describe('RenderScale', () => {
  it('starts at full resolution', () => {
    expect(new RenderScale().value).toBe(1);
  });

  it('lowers by 0.1 after 30 consecutive frames over 18 ms, and not before', () => {
    const scale = new RenderScale();
    expect(feed(scale, 20, 29)).toBe(0);
    expect(scale.value).toBe(1);
    expect(scale.sample(20)).toBe(true);
    expect(scale.value).toBe(0.9);
  });

  it('does not lower when the slow frames are not consecutive', () => {
    const scale = new RenderScale();
    for (let i = 0; i < 20; i++) {
      feed(scale, 20, 25);
      feed(scale, 16.7, 3);
    }
    expect(scale.value).toBe(1);
  });

  it('sees through frames that alternate between one and two display refreshes', () => {
    const scale = new RenderScale();
    // 45 fps on a 60 Hz display: no two frames in a row are both over 18 ms.
    for (let i = 0; i < 32; i++) scale.sample(i % 2 === 0 ? 16.7 : 33.3);
    expect(scale.value).toBe(0.9);
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

  it('raises by 0.1 after 300 consecutive frames under 14 ms, and not before', () => {
    const scale = atFloor();
    expect(feed(scale, 8.3, 299)).toBe(0);
    expect(feed(scale, 8.3, 15)).toBe(1);
    expect(scale.value).toBe(0.7);
  });

  it('never goes above 1', () => {
    const scale = atFloor();
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      scale.sample(8.3);
      seen.add(scale.value);
    }
    expect([...seen]).toEqual([0.6, 0.7, 0.8, 0.9, 1]);
  });

  it('comes back up on a 60 Hz display, where no frame is ever under 14 ms', () => {
    const scale = atFloor();
    expect(feed(scale, 16.7, 299)).toBe(0);
    expect(feed(scale, 16.7, 15)).toBe(1);
    expect(scale.value).toBe(0.7);
  });

  /** A machine that holds 60 fps below full resolution but not at it, on a 60 Hz display. */
  function struggleAtFull(scale: RenderScale, frames: number): number[] {
    const raisedAt: number[] = [];
    for (let i = 0; i < frames; i++) {
      const before = scale.value;
      scale.sample(before >= 1 ? 25 : 16.7);
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
    const scale = new RenderScale();
    struggleAtFull(scale, 6000);
    feed(scale, 25, 60); // make sure it is below full resolution now
    expect(scale.value).toBeLessThan(1);
    const before = scale.value;

    // On-time frames alone would now have to wait for well over 300 frames …
    const patient = new RenderScale();
    struggleAtFull(patient, 6000);
    feed(patient, 25, 60);
    expect(feed(patient, 16.7, 320)).toBe(0);

    // … frames with real headroom do not.
    expect(feed(scale, 8.3, 320)).toBe(1);
    expect(scale.value).toBeCloseTo(before + 0.1, 10);
  });

  it('ignores a single long stall such as a hidden tab', () => {
    const scale = new RenderScale();
    feed(scale, 16.7, 100);
    scale.sample(5000);
    feed(scale, 16.7, 100);
    expect(scale.value).toBe(1);
    // A stall in the middle of a slow run does not count towards it either.
    feed(scale, 20, 20);
    scale.sample(900);
    feed(scale, 20, 20);
    expect(scale.value).toBe(1);
  });

  it('can be told to look away while buffers are rebuilt', () => {
    const scale = new RenderScale();
    scale.settle(50);
    expect(feed(scale, 60, 50)).toBe(0);
    expect(feed(scale, 60, 29)).toBe(0);
    expect(scale.sample(60)).toBe(true);
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
