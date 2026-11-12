import { Group, Mesh, Object3D, PerspectiveCamera, Vector3, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_STORM_SECONDS, HeroFx, MOWER_SECONDS } from '../../src/render/battle/HeroFx';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import type { Feel } from '../../src/render/battle/types';
import { seededRandom } from '../../src/render/world/boxes';
import { allocationsIn } from './allocations';

const camera = new PerspectiveCamera();

function setup(feel: Feel[] = []) {
  const particles = new Particles(600);
  const effects = new Effects(particles, seededRandom(3));
  const hero = new HeroFx(effects, { onFeel: (f) => feel.push(f) });
  return { particles, effects, hero };
}

function run(hero: HeroFx, effects: Effects, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    hero.update(1 / 60);
    effects.update(1 / 60, camera);
  }
}

function visible(root: Object3D): Object3D[] {
  return root.children.filter((o) => o.visible);
}

/** A snapshot of what the group holds and shows, to compare before and after a show. */
function state(root: Object3D): string {
  return root.children.map((o) => `${o.name}:${o.visible}`).join(',');
}

describe('HeroFx — Mega Mower', () => {
  it('drives the mower down the lane from left to right and resolves when it is off the lawn', async () => {
    const { hero, effects } = setup();
    const before = state(hero.group);
    let done = false;
    const xs: number[] = [];
    const finished = hero.play('plants', 2).then(() => (done = true));
    for (let i = 0; i < 20; i++) {
      run(hero, effects, MOWER_SECONDS / 20);
      const mower = visible(hero.group).find((o) => o.name === 'mega-mower');
      if (mower) {
        xs.push(mower.position.x);
        expect(mower.position.z).toBeCloseTo(2.5);
      }
    }
    run(hero, effects, 0.2);
    await finished;
    expect(done).toBe(true);
    expect(xs.length).toBeGreaterThan(10);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    expect(xs[0]!).toBeLessThan(0.5);
    expect(xs[xs.length - 1]!).toBeGreaterThan(9);
    // The scene is as it was.
    expect(state(hero.group)).toBe(before);
    expect(hero.playing).toBe(0);
  });

  it('reports each stretch of lane as the mower passes it, left to right, and stops the world at the first hit', async () => {
    const feel: Feel[] = [];
    const { hero, effects } = setup(feel);
    const hits: number[] = [];
    const finished = hero.play('plants', 0, (x) => {
      hits.push(x);
      return x >= 4;
    });
    run(hero, effects, MOWER_SECONDS + 0.2);
    await finished;
    expect(hits.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < hits.length; i++) expect(hits[i]!).toBeGreaterThan(hits[i - 1]!);
    expect(hits[hits.length - 1]!).toBeGreaterThanOrEqual(10);
    // One hit-stop of about 90 ms, at the first stretch that hit something.
    const stops = feel.filter((f) => f.hitStop !== undefined);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.hitStop!).toBeCloseTo(0.09, 2);
  });

  it('throws grass clippings as it goes', () => {
    const { hero, effects, particles } = setup();
    void hero.play('plants', 1);
    run(hero, effects, MOWER_SECONDS / 2);
    expect(particles.alive).toBeGreaterThan(10);
  });
});

describe('HeroFx — Bone Storm', () => {
  it('rains bones and lightning down the lane, every hit reported, then leaves the scene as it was', async () => {
    const { hero, effects } = setup();
    const before = state(hero.group);
    const hits: number[] = [];
    let sawBolt = false;
    let sawBone = false;
    let glow = 0;
    const finished = hero.play('zombies', 3, (x) => (hits.push(x), true));
    for (let t = 0; t < BONE_STORM_SECONDS + 0.3; t += 1 / 60) {
      run(hero, effects, 1 / 60);
      for (const o of visible(hero.group)) {
        if (o.name.startsWith('bolt')) {
          sawBolt = true;
          expect(o.position.z).toBeCloseTo(3.5);
          const m = (o as Mesh).material as Material & { emissiveIntensity: number };
          glow = Math.max(glow, m.emissiveIntensity);
        }
        if (o.name === 'storm-bone') {
          sawBone = true;
          expect(o.position.z).toBeGreaterThan(3);
          expect(o.position.z).toBeLessThan(4);
        }
      }
    }
    await finished;
    expect(sawBone).toBe(true);
    expect(sawBolt).toBe(true);
    expect(glow).toBeGreaterThanOrEqual(1.5);
    // Bones land the length of the lawn.
    expect(Math.min(...hits)).toBeLessThan(1.5);
    expect(Math.max(...hits)).toBeGreaterThan(8.5);
    expect(state(hero.group)).toBe(before);
  });

  it('can run both powers at once and clear them', async () => {
    const { hero, effects } = setup();
    const a = hero.play('plants', 0);
    const b = hero.play('zombies', 4);
    run(hero, effects, 0.3);
    expect(hero.playing).toBe(2);
    hero.clear();
    await Promise.all([a, b]);
    expect(hero.playing).toBe(0);
    expect(visible(hero.group)).toHaveLength(0);
  });

  it('places nothing off its lane', () => {
    const { hero, effects } = setup();
    void hero.play('zombies', 1);
    const p = new Vector3();
    for (let t = 0; t < 1; t += 1 / 30) {
      run(hero, effects, 1 / 30);
      for (const o of visible(hero.group)) {
        o.getWorldPosition(p);
        expect(Math.abs(p.z - 1.5)).toBeLessThan(0.5);
      }
    }
  });

  it('allocates nothing observable in update while both powers run', () => {
    const { hero } = setup();
    void hero.play('plants', 1, () => true);
    void hero.play('zombies', 3, () => true);
    hero.update(1 / 60);
    expect(allocationsIn(() => {
      for (let i = 0; i < 40; i++) hero.update(1 / 60);
    })).toEqual({});
  });

  it('always starts a bolt whole, even if a long frame ended its last strike mid-flicker', () => {
    const { hero } = setup();
    void hero.play('zombies', 2);
    // Step to the middle of the first bolt's flicker, then jump far past the end in one frame.
    for (let t = 0; t < 0.19; t += 1 / 120) hero.update(1 / 120);
    hero.update(5);
    expect(hero.playing).toBe(0);
    void hero.play('zombies', 2);
    for (let t = 0; t < 0.14; t += 1 / 120) hero.update(1 / 120);
    const bolts = hero.group.children.filter((o) => o.visible && o.name.startsWith('bolt'));
    expect(bolts.length).toBeGreaterThan(0);
    for (const b of bolts) expect(b.scale.y).toBe(1);
  });

  it('resolves pending shows and leaves the scene on dispose', async () => {
    const { hero } = setup();
    const scene = new Group();
    scene.add(hero.group);
    const shows = [hero.play('plants', 0), hero.play('zombies', 4)];
    hero.update(0.2);
    hero.dispose();
    await expect(Promise.all(shows)).resolves.toBeDefined();
    expect(hero.playing).toBe(0);
    expect(scene.children).not.toContain(hero.group);
  });
});
