import { Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GHOST_PUFF, TwistShow } from '../../src/render/world/TwistTiles';
import { NO_TWIST } from '../../src/sim/lawn';
import type { LawnConfig } from '../../src/sim/types';

// Step 2, Task 3: the twist lesson's ghosts. Visual only: a ghost pea that puffs out at the level's
// fog reach; icy lanes that pulse and a ghost zombie sliding down one.

const fogLawn = (reach: number): LawnConfig => ({ ...NO_TWIST, fog: reach });
const iceLawn = (lanes: number[]): LawnConfig => ({ ...NO_TWIST, ice: { lanes, speed: 1.6 } });

function puffs(): { at: Vector3[]; colors: number[]; puff(at: Vector3, color: number): void } {
  const rec = { at: [] as Vector3[], colors: [] as number[], puff(at: Vector3, color: number) { rec.at.push(at.clone()); rec.colors.push(color); } };
  return rec;
}

const named = (show: TwistShow, name: string): Mesh[] => {
  const found: Mesh[] = [];
  show.group.traverse((o) => { if (o instanceof Mesh && o.name === name) found.push(o); });
  return found;
};

const play = (show: TwistShow, seconds: number): void => { for (let t = 0; t < seconds; t += 1 / 60) show.update(1 / 60); };

describe('TwistShow: fog', () => {
  for (const reach of [7, 6, 5]) {
    it(`reach ${reach}: the ghost pea flies from a front plant tile and puffs out ${reach} tiles on, again and again`, () => {
      const fx = puffs();
      const show = new TwistShow('fog', fogLawn(reach), fx);
      const [pea] = named(show, 'ghost-pea');
      expect(pea).toBeDefined();
      expect(show.fadeX - show.startX).toBe(reach);
      const start = pea!.position.x;
      expect(Math.abs(start - show.startX)).toBeLessThanOrEqual(0.3); // from the shooter's mouth
      // Mid-flight the pea is between the tile and the puff.
      play(show, 0.6);
      expect(pea!.position.x).toBeGreaterThan(start);
      expect(pea!.position.x).toBeLessThan(show.fadeX);
      play(show, 6);
      expect(fx.at.length).toBeGreaterThanOrEqual(2);
      for (const at of fx.at) expect(at.x).toBeCloseTo(show.fadeX, 1);
      expect(fx.colors.every((c) => c === GHOST_PUFF)).toBe(true);
      expect(show.loops).toBeGreaterThanOrEqual(2);
      show.dispose();
    });
  }

  it('the camera box is worked out once: the shooter to past the puff, over the lawn, the same object every frame', () => {
    for (const reach of [7, 5]) {
      const show = new TwistShow('fog', fogLawn(reach), puffs());
      const box = show.box;
      play(show, 1.2);
      expect(show.box).toBe(box);
      expect(box.x[0]).toBeLessThanOrEqual(show.startX - 0.5);
      expect(box.x[1]).toBeGreaterThanOrEqual(Math.min(10.5, show.fadeX + 1));
      expect(box.x[0]).toBeGreaterThanOrEqual(-1);
      expect(box.x[1]).toBeLessThanOrEqual(11);
      expect(box.z[0]).toBeLessThanOrEqual(show.lane);
      expect(box.z[1]).toBeGreaterThanOrEqual(show.lane + 1);
      show.dispose();
    }
  });
});

describe('TwistShow: ice', () => {
  it('pulses every icy lane and slides a ghost zombie down one, faster than one walking a plain lane beside it', () => {
    const show = new TwistShow('ice', iceLawn([1, 3]), puffs());
    expect(named(show, 'ice-pulse')).toHaveLength(2);
    const ghosts = named(show, 'ghost-zombie');
    expect(ghosts.length).toBeGreaterThan(0);
    const icy = show.slider;
    const plain = show.walker;
    expect([1, 3]).toContain(icy.lane);
    expect(plain).not.toBeNull();
    expect([1, 3]).not.toContain(plain!.lane);
    const pulse = named(show, 'ice-pulse')[0]!.material as { opacity: number };
    const seen = new Set<number>();
    const x0 = icy.object.position.x;
    for (let i = 0; i < 60; i++) { show.update(1 / 60); seen.add(pulse.opacity); }
    expect(seen.size).toBeGreaterThan(1); // it pulses
    expect(icy.object.position.x).toBeLessThan(x0);
    expect(icy.object.position.x).toBeLessThan(plain!.object.position.x); // the icy one is ahead
    const loops = show.loops;
    play(show, 12);
    expect(show.loops).toBeGreaterThan(loops);
    show.dispose();
  });

  it('every lane icy but one: the walker takes the plain one; all icy: no walker', () => {
    const one = new TwistShow('ice', iceLawn([0, 1, 3, 4]), puffs());
    expect(one.walker?.lane).toBe(2);
    one.dispose();
    const all = new TwistShow('ice', iceLawn([0, 1, 2, 3, 4]), puffs());
    expect(all.walker).toBeNull();
    all.dispose();
  });
});

describe('TwistShow: disposal', () => {
  it('frees every geometry and material it made', () => {
    for (const show of [new TwistShow('fog', fogLawn(6), puffs()), new TwistShow('ice', iceLawn([2]), puffs())]) {
      const meshes: Mesh[] = [];
      show.group.traverse((o) => { if (o instanceof Mesh) meshes.push(o); });
      expect(meshes.length).toBeGreaterThan(0);
      let freed = 0;
      for (const m of meshes) {
        m.geometry.addEventListener('dispose', () => { freed += 1; });
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat.addEventListener('dispose', () => { freed += 1; });
      }
      show.dispose();
      expect(freed).toBeGreaterThanOrEqual(meshes.length);
      expect(show.disposed).toBe(true);
      show.update(1 / 60); // harmless afterwards
      show.dispose();
    }
  });
});
