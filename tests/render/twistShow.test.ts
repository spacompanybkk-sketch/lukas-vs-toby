import { Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GHOST_PUFF, GHOST_SKID, TwistShow } from '../../src/render/world/TwistTiles';
import { allocationsIn } from './allocations';
import { NO_TWIST } from '../../src/sim/lawn';
import type { LawnConfig } from '../../src/sim/types';

// Step 2, Task 3: the twist lesson's ghosts. Visual only: a ghost pea that puffs out at the level's
// fog reach; icy lanes that pulse and a ghost zombie sliding down one.

const fogLawn = (reach: number): LawnConfig => ({ ...NO_TWIST, fog: reach });
const iceLawn = (lanes: number[], speed = 1.6): LawnConfig => ({ ...NO_TWIST, ice: { lanes, speed } });

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
      expect(Math.abs(start - show.startX)).toBeLessThanOrEqual(0.6); // from the shooter's mouth
      expect(start).toBeGreaterThan(show.startX); // in front of it
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
    expect(show.slider.object.name).toBe('ghost-brainEater');
    expect(show.walker?.object.name).toBe('ghost-brainEater');
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

// The Tundra's levels (content design §1): the lanes each of them ices.
const TUNDRA_LANES: Record<string, number[]> = {
  'z2-1': [2], 'z2-2': [1, 3], 'z2-3': [2], 'z2-4': [1, 3], 'z2-5': [0, 2, 4], 'z2-6': [0, 2, 4], 'z2-7': [0, 1, 3, 4], 'z2-8': [0, 1, 3, 4],
};

describe('TwistShow: the ice reads', () => {
  for (const [id, lanes] of Object.entries(TUNDRA_LANES)) {
    it(`${id} (ice in ${lanes.join(', ')}): every icy lane pulses, a ghost slides an icy lane and one walks the plain lane right beside it, both in the camera's box`, () => {
      const show = new TwistShow('ice', iceLawn(lanes), puffs());
      const pulses = named(show, 'ice-pulse');
      expect(pulses.map((p) => p.position.z - 0.5).sort()).toEqual([...lanes].sort());
      expect(lanes).toContain(show.slider.lane);
      expect(show.lane).toBe(show.slider.lane);
      expect(show.walker).not.toBeNull();
      expect(lanes).not.toContain(show.walker!.lane);
      expect(Math.abs(show.walker!.lane - show.slider.lane)).toBe(1); // a race the eye can follow
      // The box holds both lanes, the whole way down the lawn.
      expect(show.box.z[0]).toBeLessThanOrEqual(Math.min(show.slider.lane, show.walker!.lane));
      expect(show.box.z[1]).toBeGreaterThanOrEqual(Math.max(show.slider.lane, show.walker!.lane) + 1);
      expect(show.box.x[0]).toBeLessThanOrEqual(0.3);
      expect(show.box.x[1]).toBeGreaterThanOrEqual(10.2);
      const box = show.box;
      play(show, 2);
      expect(show.box).toBe(box); // worked out once
      show.dispose();
    });
  }

  it('both ghosts are the real Brain Eater, lightly see-through (never a pale blob on the snow), on models of their own', () => {
    const show = new TwistShow('ice', iceLawn([2]), puffs());
    for (const ghost of [show.slider, show.walker!]) {
      expect(ghost.object.name).toBe('ghost-brainEater');
      let meshes = 0;
      ghost.object.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        meshes += 1;
        const m = o.material as { opacity: number; transparent: boolean };
        expect(m.transparent).toBe(true);
        expect(m.opacity).toBeGreaterThanOrEqual(0.6);
      });
      expect(meshes).toBeGreaterThan(0);
    }
    expect(show.slider.object).not.toBe(show.walker!.object);
    show.dispose();
  });

  it('the icy one covers the ground 1.6 times as fast as the walker (the lawn\'s own ice speed), and holds another pose: arms up, sliding', () => {
    for (const speed of [1.6, 2]) {
      const show = new TwistShow('ice', iceLawn([2], speed), puffs());
      const s0 = show.slider.object.position.x;
      const w0 = show.walker!.object.position.x;
      expect(s0).toBe(w0); // they set off together, from the zombies' end
      expect(s0).toBeGreaterThan(9.5);
      play(show, 1.5);
      const slid = s0 - show.slider.object.position.x;
      const walked = w0 - show.walker!.object.position.x;
      expect(walked).toBeGreaterThan(1);
      expect(slid / walked).toBeCloseTo(speed, 3);
      // The slider cheers (arms up), the walker walks: their arms are not in the same place.
      const arm = (ghost: { object: { getObjectByName(n: string): { rotation: { z: number } } | undefined } }): number => ghost.object.getObjectByName('armL')!.rotation.z;
      expect(Math.abs(arm(show.slider as never) - arm(show.walker as never))).toBeGreaterThan(0.3);
      show.dispose();
    }
  });

  it('the slider gets there first and skids to a stop in a puff of snow at the plants\' end, the walker still on its way; then both start again', () => {
    const fx = puffs();
    const show = new TwistShow('ice', iceLawn([1, 3]), fx);
    const skidded = (): boolean => fx.at.length > 0;
    for (let i = 0; i < 60 * 8 && !skidded(); i++) show.update(1 / 60);
    const walkerAtSkid = show.walker!.object.position.x;
    expect(fx.at).toHaveLength(1);
    expect(fx.colors).toEqual([GHOST_SKID]);
    expect(fx.at[0]!.x).toBeLessThan(1); // the plants' end
    expect(fx.at[0]!.z).toBeCloseTo(show.slider.lane + 0.5, 5);
    expect(show.slider.object.position.x).toBeLessThan(1);
    expect(walkerAtSkid).toBeGreaterThan(3); // well short
    // It rests there a moment (no second puff), then the race runs again from the start.
    play(show, 0.5);
    expect(fx.at).toHaveLength(1);
    expect(show.slider.object.position.x).toBeLessThan(1);
    play(show, 0.6);
    expect(show.loops).toBe(1);
    expect(show.slider.object.position.x).toBeGreaterThan(9);
    expect(show.walker!.object.position.x).toBeGreaterThan(9);
    play(show, 6);
    expect(fx.at).toHaveLength(2);
    show.dispose();
  });

  it('the pulse is blocky: a few hard steps of brightness, the same on every icy lane, never a smooth fade', () => {
    const show = new TwistShow('ice', iceLawn([0, 2, 4]), puffs());
    const pulses = named(show, 'ice-pulse').map((p) => p.material as unknown as { opacity: number });
    const seen = new Set<number>();
    for (let i = 0; i < 60 * 3; i++) {
      show.update(1 / 60);
      seen.add(pulses[0]!.opacity);
      for (const p of pulses) expect(p.opacity).toBe(pulses[0]!.opacity);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(seen.size).toBeLessThanOrEqual(4);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(0.4); // bright enough to read on the snow
    show.dispose();
  });

  it('a long frame (the tab was away) moves the race on by a quarter second at most', () => {
    const show = new TwistShow('ice', iceLawn([2]), puffs());
    const x0 = show.slider.object.position.x;
    show.update(30);
    expect(x0 - show.slider.object.position.x).toBeLessThan(1);
    show.dispose();
  });

  it('plays without allocating (ice through a skid and a restart; fog through a puff and a new pea)', () => {
    for (const show of [new TwistShow('ice', iceLawn([0, 1, 3, 4]), { puff() {} }), new TwistShow('fog', fogLawn(5), { puff() {} })]) {
      play(show, 1);
      expect(allocationsIn(() => {
        for (let i = 0; i < 600; i++) show.update(1 / 60);
      }), show.kind).toEqual({});
      expect(show.loops).toBeGreaterThanOrEqual(1);
      show.dispose();
    }
  });
});

describe('TwistShow: the fog reads', () => {
  for (const reach of [7, 5]) {
    it(`reach ${reach}: the real Peashooter model, lightly see-through; a mist bank from the reach on; the lane past it darker; a white pixel puff`, () => {
      const show = new TwistShow('fog', fogLawn(reach), puffs());
      expect(show.shooter?.object.name).toBe('ghost-peashooter');
      let meshes = 0;
      show.shooter!.object.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        meshes += 1;
        const m = o.material as { opacity: number; transparent: boolean };
        expect(m.transparent).toBe(true);
        expect(m.opacity).toBeGreaterThanOrEqual(0.6);
      });
      expect(meshes).toBeGreaterThan(0);
      const [bank] = named(show, 'fog-bank');
      bank!.geometry.computeBoundingBox();
      const bb = bank!.geometry.boundingBox!;
      expect(bb.min.x).toBeGreaterThanOrEqual(show.fadeX - 0.3);
      expect(bb.min.x).toBeLessThanOrEqual(show.fadeX);
      expect(bb.min.z).toBeLessThanOrEqual(0.3);
      expect(bb.max.z).toBeGreaterThanOrEqual(4.7);
      const [past] = named(show, 'fog-past-reach');
      expect(past!.position.x - ((past!.geometry as unknown as { parameters: { width: number } }).parameters.width) / 2).toBeCloseTo(show.fadeX, 5);
      const puff = show.group.getObjectByName('fog-puff')!;
      expect(puff.visible).toBe(false);
      for (let i = 0; i < 600 && !puff.visible; i++) show.update(1 / 60);
      expect(puff.visible).toBe(true);
      expect(puff.position.x).toBeCloseTo(show.fadeX, 5);
      play(show, 0.6);
      expect(puff.visible).toBe(false); // short
      show.dispose();
    });
  }
});

describe('TwistShow: disposal', () => {
  it('frees every geometry and material it made, and leaves the models\' shared geometry alone', () => {
    for (const show of [new TwistShow('fog', fogLawn(6), puffs()), new TwistShow('ice', iceLawn([2]), puffs())]) {
      const own: Mesh[] = [];
      const shared: Mesh[] = [];
      const models = [show.shooter?.object, show.slider.object, show.walker?.object].filter((o) => o !== undefined && o.name.startsWith('ghost-'));
      show.group.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        let p: typeof o.parent = o;
        let inModel = false;
        while (p !== null) { if (models.includes(p)) inModel = true; p = p.parent; }
        (inModel ? shared : own).push(o);
      });
      expect(own.length).toBeGreaterThan(0);
      expect(shared.length).toBeGreaterThan(0);
      const freedGeometry = new Set<unknown>();
      const freedMaterial = new Set<unknown>();
      for (const m of [...own, ...shared]) {
        m.geometry.addEventListener('dispose', () => { freedGeometry.add(m.geometry); });
        (m.material as Mesh['material'] & { addEventListener: Function }).addEventListener('dispose', () => { freedMaterial.add(m.material); });
      }
      show.dispose();
      for (const m of own) expect(freedGeometry.has(m.geometry)).toBe(true);
      for (const m of shared) expect(freedGeometry.has(m.geometry)).toBe(false);
      for (const m of [...own, ...shared]) expect(freedMaterial.has(m.material)).toBe(true);
      expect(show.disposed).toBe(true);
      show.update(1 / 60); // harmless afterwards
      show.dispose();
    }
  });
});
