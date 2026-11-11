import { describe, expect, it } from 'vitest';
import { GameLoop, type LoopHost } from '../../src/game/GameLoop';

/** A host that records what the loop asks of it. */
function recorder() {
  const log = { steps: 0, frames: 0, alphas: [] as number[], dts: [] as number[] };
  const host: LoopHost = {
    step() {
      log.steps++;
    },
    frame(alpha, dtSeconds) {
      log.frames++;
      log.alphas.push(alpha);
      log.dts.push(dtSeconds);
    },
  };
  return { log, loop: new GameLoop(host) };
}

describe('GameLoop', () => {
  it('runs 30 fixed steps per second: 100 ms is exactly 3 steps', () => {
    const { log, loop } = recorder();
    loop.advance(0);
    expect(log.steps).toBe(0);
    loop.advance(100);
    expect(log.steps).toBe(3);
    expect(log.frames).toBe(2);
  });

  it('does not fast-forward after a long gap (tab hidden, laptop asleep)', () => {
    const { log, loop } = recorder();
    loop.advance(0);
    loop.advance(60_000);
    expect(log.steps).toBeGreaterThan(0);
    expect(log.steps).toBeLessThanOrEqual(5);

    // The time left over from the clamped gap is dropped, not carried into the next frame.
    const before = log.steps;
    loop.advance(60_034);
    expect(log.steps - before).toBe(1);
  });

  it('counts a gap over 250 ms as 250 ms', () => {
    const { log, loop } = recorder();
    loop.timeScale = 0.5;
    loop.advance(0);
    // Unclamped this would be 500 ms of game time (15 steps, capped to 5); clamped it is 125 ms.
    loop.advance(1000);
    expect(log.steps).toBe(3);
    expect(log.dts[1]).toBeCloseTo(0.25, 10);
  });

  it('never runs more than 5 steps in one frame', () => {
    const { log, loop } = recorder();
    loop.timeScale = 4;
    loop.advance(0);
    for (let t = 100; t <= 2000; t += 100) {
      const before = log.steps;
      loop.advance(t);
      expect(log.steps - before).toBeLessThanOrEqual(5);
    }
  });

  it('scales game time by timeScale', () => {
    const { log, loop } = recorder();
    loop.timeScale = 0.5;
    for (let t = 0; t <= 1000; t += 16) loop.advance(t);
    expect(log.steps).toBeGreaterThanOrEqual(14);
    expect(log.steps).toBeLessThanOrEqual(16);
  });

  it('holds 30 steps per second over a long run of uneven frames', () => {
    const { log, loop } = recorder();
    let t = 0;
    loop.advance(t);
    for (let i = 0; i < 600; i++) {
      t += i % 3 === 0 ? 21 : 14.5; // 10,000 ms in total
      loop.advance(t);
    }
    expect(t).toBe(10_000);
    expect(log.steps).toBeGreaterThanOrEqual(299);
    expect(log.steps).toBeLessThanOrEqual(300);
  });

  it('runs no steps while paused but still draws, with alpha 0', () => {
    const { log, loop } = recorder();
    loop.advance(0);
    loop.advance(50);
    const stepsBefore = log.steps;
    const framesBefore = log.frames;

    loop.paused = true;
    for (let t = 66; t <= 1000; t += 16) loop.advance(t);
    expect(log.steps).toBe(stepsBefore);
    expect(log.frames).toBeGreaterThan(framesBefore);
    expect(log.alphas.slice(framesBefore).every((a) => a === 0)).toBe(true);

    // Time spent paused is not owed to the simulation afterwards.
    loop.paused = false;
    loop.advance(1016);
    expect(log.steps - stepsBefore).toBeLessThanOrEqual(1);
  });

  it('keeps alpha in [0, 1) on every frame', () => {
    const { log, loop } = recorder();
    const gaps = [0, 16, 17, 33, 34, 5, 100, 250, 251, 60_000, 1, 16.6667, 33.3333, 66.6667, 0, 8];
    let t = 1234.5;
    for (let round = 0; round < 40; round++) {
      for (const gap of gaps) {
        t += gap;
        loop.timeScale = round % 4 === 3 ? 0.25 : 1;
        loop.advance(t);
      }
    }
    expect(log.alphas.length).toBe(40 * gaps.length);
    for (const alpha of log.alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('ignores a clock that runs backwards', () => {
    const { log, loop } = recorder();
    loop.advance(1000);
    loop.advance(900);
    expect(log.steps).toBe(0);
    expect(log.dts.every((dt) => dt >= 0)).toBe(true);
    loop.advance(1000);
    expect(log.steps).toBe(3);
  });
});
