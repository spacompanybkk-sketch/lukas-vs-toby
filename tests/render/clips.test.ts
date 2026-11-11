import { describe, expect, it } from 'vitest';
import { flameIdle, fuseSwell, leapSlam, mineTrigger, pairBob, pultFling } from '../../src/render/voxel/clips';
import type { Clip, PartPose, Pose } from '../../src/render/voxel/types';

// The clip builders of the plants with a trick of their own: the mine's trigger, the two
// catapults, the pumpkin's leap, the torch's fire, the cherries' fuse and their idle.

const DEG = Math.PI / 180;
const names = ['body', 'arm', 'a', 'b', 'leaf', 'flame', 'tip'];

function rest(): Pose {
  const pose: Pose = {};
  for (const name of names) pose[name] = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, s: 1, sx: 1, sy: 1, sz: 1 };
  return pose;
}

function at(clip: Clip, t: number): Pose {
  const pose = rest();
  clip.sample(t, pose);
  return pose;
}

const of = (pose: Pose, name: string): PartPose => pose[name] as PartPose;

function expectSame(a: Pose, b: Pose, tolerance = 1e-6): void {
  for (const name of Object.keys(a)) {
    for (const field of Object.keys(of(a, name)) as (keyof PartPose)[]) {
      expect(Math.abs(of(a, name)[field] - of(b, name)[field]), `${name}.${field}`).toBeLessThanOrEqual(tolerance);
    }
  }
}

/** The largest jump in any field between neighbouring samples 1 ms apart, from `from` to `to`. */
function largestStep(clip: Clip, from: number, to: number): number {
  let worst = 0;
  let before = at(clip, from);
  for (let t = from + 0.001; t <= to + 1e-9; t += 0.001) {
    const now = at(clip, t);
    for (const name of names) {
      for (const field of Object.keys(of(now, name)) as (keyof PartPose)[]) {
        worst = Math.max(worst, Math.abs(of(now, name)[field] - of(before, name)[field]));
      }
    }
    before = now;
  }
  return worst;
}

describe('plant clip builders', () => {
  it('say which parts they move and leave every other part at rest', () => {
    const clips: [Clip, string[]][] = [
      [mineTrigger('body'), ['body']],
      [pultFling({ arm: 'arm', body: 'body', duration: 0.4, release: 0.15, rest: 10 }), ['arm', 'body']],
      [pultFling({ arm: 'arm', duration: 0.4, release: 0.15, rest: 10 }), ['arm']],
      [leapSlam({ body: 'body' }), ['body']],
      [flameIdle({ flames: ['flame', 'tip'], body: 'body' }), ['body', 'flame', 'tip']],
      [fuseSwell(['a', 'b']), ['a', 'b']],
      [pairBob({ body: 'body', a: 'a', b: 'b', sway: ['leaf'] }), ['body', 'a', 'b', 'leaf']],
    ];
    for (const [clip, moved] of clips) {
      expect(clip.parts).toEqual(moved);
      const pose = at(clip, clip.duration * 0.37);
      const still = rest();
      for (const name of names) if (!moved.includes(name)) expectSame({ [name]: of(pose, name) }, { [name]: of(still, name) });
      expect(() => clip.sample(0.05, {})).not.toThrow();
    }
  });

  it('mineTrigger: 0.3 s, a crouch, a jump four voxels up, then a swell to 1.3 that holds for the blast', () => {
    const clip = mineTrigger('body');
    expect(clip.duration).toBe(0.3);
    expect(clip.loop).toBe(false);
    expectSame(at(clip, 0), rest());
    expect(of(at(clip, 0.06), 'body').sy).toBeCloseTo(0.8, 6);
    // At the top of the jump, stretched thin.
    expect(of(at(clip, 0.18), 'body').py).toBeCloseTo(4, 6);
    expect(of(at(clip, 0.18), 'body').sy).toBeGreaterThan(1.1);
    const end = of(at(clip, 0.3), 'body');
    expect(end.s).toBeCloseTo(1.3, 6);
    expect(end.py).toBeGreaterThan(2);
    // Held there.
    expectSame(at(clip, 5), at(clip, 0.3));
    // No jumps between frames.
    expect(largestStep(clip, 0, 0.3)).toBeLessThan(0.15);
  });

  it('pultFling: winds back, whips over to let go leaning forward, carries on and comes back to rest', () => {
    // The Kernel-pult's: 0.4 s, released at 0.15 s; the arm leans back 10 degrees at rest.
    const kernel = pultFling({ arm: 'arm', body: 'body', duration: 0.4, release: 0.15, rest: 10 });
    expect(kernel.duration).toBe(0.4);
    expect(kernel.loop).toBe(false);
    expectSame(at(kernel, 0), rest());
    expectSame(at(kernel, 0.4), rest());
    // Wound back further than rest, with the body leaning back.
    const windUp = at(kernel, 0.55 * 0.15);
    expect(of(windUp, 'arm').rz).toBeCloseTo(25 * DEG, 6);
    expect(of(windUp, 'body').rz).toBeGreaterThan(0);
    // At the release the arm has come up past upright and leans 30 degrees forward.
    expect(of(at(kernel, 0.15), 'arm').rz).toBeCloseTo(-40 * DEG, 6);
    // Still going after the release, all the way over, and the body thrown forward.
    const over = at(kernel, 0.15 + 0.6 * 0.45 * 0.15);
    expect(of(over, 'arm').rz).toBeCloseTo(-75 * DEG, 6);
    expect(of(over, 'body').rz).toBeLessThan(0);
    // The arm moves fastest through the release.
    const speed = (t: number): number => Math.abs(of(at(kernel, t + 0.005), 'arm').rz - of(at(kernel, t - 0.005), 'arm').rz);
    expect(speed(0.145)).toBeGreaterThan(speed(0.06));
    expect(speed(0.145)).toBeGreaterThan(speed(0.3));

    // The Mango-pult's is slower and heavier: 0.6 s, released at 0.25 s.
    const mango = pultFling({ arm: 'arm', duration: 0.6, release: 0.25, rest: 70, windUp: 15, lead: 20, forward: 30 });
    expect(of(at(mango, 0.55 * 0.25), 'arm').rz).toBeCloseTo(15 * DEG, 6);
    expect(of(at(mango, 0.25), 'arm').rz).toBeCloseTo(-90 * DEG, 6);
    expectSame(at(mango, 0.6), rest());
    expectSame(at(mango, 3), rest());
    expect(largestStep(mango, 0, 0.6)).toBeLessThan(0.06);
  });

  it('leapSlam: 0.6 s, crouches, leaps a tile, lands squashed flat at 0.4 s, then springs back', () => {
    const clip = leapSlam({ body: 'body' });
    expect(clip.duration).toBe(0.6);
    expect(clip.loop).toBe(false);
    expectSame(at(clip, 0), rest());
    expect(of(at(clip, 0.1), 'body').sy).toBeCloseTo(0.8, 6);
    // The apex: sixteen voxels up.
    const apex = 0.1 + 0.6 * 0.3;
    let highest = 0;
    let highestAt = 0;
    for (let t = 0; t <= 0.6; t += 0.001) {
      const py = of(at(clip, t), 'body').py;
      if (py > highest) [highest, highestAt] = [py, t];
    }
    expect(highest).toBeCloseTo(16, 3);
    expect(highestAt).toBeCloseTo(apex, 2);
    // The impact: on the ground, squashed flat and wide.
    const impact = of(at(clip, 0.4), 'body');
    expect(impact.py).toBeCloseTo(0, 6);
    const squash = of(at(clip, 0.4001), 'body');
    expect(squash.sy).toBeLessThan(0.65);
    expect(squash.sx).toBeGreaterThan(1.25);
    expectSame(at(clip, 0.6), rest());
    expectSame(at(clip, 2), rest());
    // Other lengths and heights keep the shape.
    const small = leapSlam({ body: 'body', duration: 1.2, impact: 0.8, height: 8 });
    expect(of(at(small, 0.2 + 0.6 * 0.6), 'body').py).toBeCloseTo(8, 6);
    expect(of(at(small, 0.8), 'body').py).toBeCloseTo(0, 6);
  });

  it('flameIdle: loops without a seam, the flames growing taller and thinner and back, each on its own beat', () => {
    const clip = flameIdle({ flames: ['flame', 'tip'], body: 'body' });
    expect(clip.loop).toBe(true);
    expect(clip.duration).toBe(1.6);
    expectSame(at(clip, 0), at(clip, 1.6));
    let tallest = 1;
    let shortest = 1;
    let apart = 0;
    for (let t = 0; t < 1.6; t += 0.01) {
      const pose = at(clip, t);
      const flame = of(pose, 'flame');
      tallest = Math.max(tallest, flame.sy);
      shortest = Math.min(shortest, flame.sy);
      // Thinner when taller.
      if (flame.sy > 1.01) expect(flame.sx).toBeLessThan(1);
      apart = Math.max(apart, Math.abs(flame.sy - of(pose, 'tip').sy));
      expect(Math.abs(of(pose, 'body').py)).toBeLessThanOrEqual(0.25 + 1e-9);
    }
    expect(tallest).toBeGreaterThan(1.12);
    expect(shortest).toBeLessThan(0.88);
    expect(apart).toBeGreaterThan(0.1);
  });

  it('fuseSwell: a second of throbbing, out of step, ending swollen to 1.35 and held', () => {
    const clip = fuseSwell(['a', 'b']);
    expect(clip.duration).toBe(1);
    expect(clip.loop).toBe(false);
    expectSame(at(clip, 0), rest());
    expect(of(at(clip, 1), 'a').s).toBeCloseTo(1.35, 6);
    expect(of(at(clip, 1), 'b').s).toBeCloseTo(1.35, 6);
    expectSame(at(clip, 4), at(clip, 1));
    // It throbs: the size goes down as well as up on the way, and the two are out of step.
    let shrinks = 0;
    let apart = 0;
    for (let t = 0.01; t <= 1; t += 0.01) {
      if (of(at(clip, t), 'a').s < of(at(clip, t - 0.01), 'a').s) shrinks++;
      apart = Math.max(apart, Math.abs(of(at(clip, t), 'a').s - of(at(clip, t), 'b').s));
    }
    expect(shrinks).toBeGreaterThan(3);
    expect(apart).toBeGreaterThan(0.05);
    expect(fuseSwell(['a'], 0.5).duration).toBe(0.5);
  });

  it('pairBob: loops without a seam, the two heads breathing on alternate beats', () => {
    const clip = pairBob({ body: 'body', a: 'a', b: 'b', sway: ['leaf'] });
    expect(clip.loop).toBe(true);
    expect(clip.duration).toBe(1.6);
    expectSame(at(clip, 0), at(clip, 1.6));
    const quarter = at(clip, 0.2);
    expect(of(quarter, 'a').s).toBeGreaterThan(1.03);
    expect(of(quarter, 'b').s).toBeLessThan(0.97);
    let bob = 0;
    let flutter = 0;
    for (let t = 0; t < 1.6; t += 0.01) {
      bob = Math.max(bob, Math.abs(of(at(clip, t), 'body').py));
      flutter = Math.max(flutter, Math.abs(of(at(clip, t), 'leaf').rz));
    }
    expect(bob).toBeCloseTo(0.5, 2);
    expect(flutter).toBeGreaterThan(4 * DEG);
  });
});
