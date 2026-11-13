import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { getModelDef, modelKeys } from '../../src/render/models/registry';
import { UNITS } from '../../src/render/models/roster';
import { VOXEL, buildParts, modelColors } from '../../src/render/voxel/build';
import { LEVEL_SCALE } from '../../src/render/voxel/palette';
import { ModelInstance } from '../../src/render/voxel/rig';
import type { ModelDef, PartPose, Pose } from '../../src/render/voxel/types';

// The rules every model must keep, checked for every model in the registry. A new unit is
// covered the moment it is registered.

const LEVELS = [1, 2, 3, 4, 5];
/** Every unit plays these; the game asks for them whatever the unit is. */
const REQUIRED_CLIPS = ['idle', 'hit', 'spawn', 'die', 'cheer'] as const;
/** The models in `plants/`: they face +X, towards the zombies. */
const PLANT_KEYS = new Set(
  Object.values(import.meta.glob<Record<string, unknown>>('../../src/render/models/plants/*.ts', { eager: true }))
    .flatMap((module) => Object.values(module))
    .map((value) => (value as Partial<ModelDef>).key)
    .filter((key): key is string => typeof key === 'string'),
);
/** The models in `zombies/`: they face −X, towards the plants. */
const ZOMBIE_KEYS = new Set(
  Object.values(import.meta.glob<Record<string, unknown>>('../../src/render/models/zombies/*.ts', { eager: true }))
    .flatMap((module) => Object.values(module))
    .map((value) => (value as Partial<ModelDef>).key)
    .filter((key): key is string => typeof key === 'string'),
);
/** The ten plants a player can field, in unlock order (spec section 6.6). */
const ALL_PLANTS = [
  'peashooter',
  'sunflower',
  'walnutBomb',
  'potatoMine',
  'kernelPult',
  'mangoPult',
  'avocadoBunker',
  'torchwood',
  'cherryBomber',
  'pumpkinSquash',
];

/**
 * Triangles a unit may cost at any level, counting only what is drawn: a part built hidden
 * (`cracks`, `armed`) is not drawn until the game shows it. 150 units on the lawn at 5,000
 * each is the frame budget the Peashooter's crowd test held at 60 fps.
 */
const TRIANGLE_CEILING = 5000;
/**
 * Models allowed past the ceiling, each with its reason. Empty: every unit fits. Add one only
 * where the look truly needs it, with the level and the count it may reach.
 */
const TRIANGLE_OVERRIDES: Record<string, number> = {
  // The bosses: one on the lawn at a time, two to four times a unit's size (phase 3 Task 3 allows 6,000).
  brainTitan: 6000,
  elderOak: 6000,
};

describe('the registry', () => {
  it('has the three plants of the first level', () => {
    expect(modelKeys()).toEqual(expect.arrayContaining(['peashooter', 'sunflower', 'walnutBomb']));
    expect([...PLANT_KEYS]).toEqual(expect.arrayContaining(['peashooter', 'sunflower', 'walnutBomb']));
  });

  it('has all ten plants, each from plants/', () => {
    expect(modelKeys()).toEqual(expect.arrayContaining(ALL_PLANTS));
    // Every one of them is a plant; more may come.
    expect([...PLANT_KEYS]).toEqual(expect.arrayContaining(ALL_PLANTS));
  });

  it('holds every unit in the roster, in its order, and nothing else', () => {
    expect(modelKeys()).toEqual([...UNITS]);
  });
});

describe('Walnut Bomb', () => {
  it('carries its damage in a part named cracks, hidden at rest and shown when the view asks', () => {
    const def = getModelDef('walnutBomb');
    const cracks = def.parts.find((part) => part.name === 'cracks');
    expect(cracks?.boxes.length).toBeGreaterThan(0);
    for (const level of LEVELS) {
      const instance = new ModelInstance(def, level);
      const part = instance.root.getObjectByName('cracks') as Object3D;
      expect(part.children.some((child) => child instanceof Mesh), `level ${level}`).toBe(true);
      expect(part.visible, `level ${level}`).toBe(false);
      instance.showPart('cracks', true);
      expect(part.visible).toBe(true);
      instance.showPart('cracks', false);
      expect(part.visible).toBe(false);
      instance.dispose();
    }
  });
});
/** Builds `key` at every level and checks that its part `name` has boxes, is hidden at rest and shows and hides on request. */
function expectToggledPart(key: string, name: string): void {
  const def = getModelDef(key);
  const part = def.parts.find((p) => p.name === name);
  expect(part?.boxes.length, `${key} has a part ${name}`).toBeGreaterThan(0);
  for (const level of LEVELS) {
    const instance = new ModelInstance(def, level);
    const object = instance.root.getObjectByName(name) as Object3D;
    expect(object.children.some((child) => child instanceof Mesh), `level ${level}`).toBe(true);
    expect(object.visible, `level ${level}`).toBe(false);
    instance.showPart(name, true);
    expect(object.visible).toBe(true);
    instance.showPart(name, false);
    expect(object.visible).toBe(false);
    instance.dispose();
  }
}

describe('Potato Mine', () => {
  it('lights up in a part named armed, hidden until the game shows it', () => {
    expectToggledPart('potatoMine', 'armed');
    // What it shows glows: the bulb, at every level.
    const armed = getModelDef('potatoMine').parts.find((p) => p.name === 'armed');
    for (const level of LEVELS) {
      const lit = armed?.boxes.filter((b) => (b.minLevel ?? 1) <= level && level <= (b.maxLevel ?? 5) && (b.emissive ?? 0) >= 1.5);
      expect(lit?.length, `level ${level}`).toBeGreaterThan(0);
    }
  });

  it('is the smallest plant: about half a tile tall, under a smaller envelope than a unit', () => {
    const def = getModelDef('potatoMine');
    expect(def.envelope?.[1]).toBeLessThanOrEqual(10);
    expect(bounds(def, 1).max.y / VOXEL).toBeLessThan(10);
  });

  it('jumps and swells when it goes off', () => {
    const def = getModelDef('potatoMine');
    expect(def.clips.shoot?.parts).toEqual(['body']);
    const blast = sampled(def, def.clips.shoot as NonNullable<ModelDef['clips']['shoot']>, 0.3).body as PartPose;
    expect(blast.py).toBeGreaterThan(2);
    expect(blast.s).toBeCloseTo(1.3, 6);
  });
});

describe('Avocado Bunker', () => {
  it('carries its damage in a part named cracks, hidden at rest and shown when the view asks', () => {
    expectToggledPart('avocadoBunker', 'cracks');
  });
});

describe('Pumpkin Squash', () => {
  it('leaps a tile and comes down squashed at 0.4 s', () => {
    const def = getModelDef('pumpkinSquash');
    const melee = def.clips.melee as NonNullable<ModelDef['clips']['melee']>;
    expect(melee.duration).toBe(0.6);
    let highest = 0;
    for (let t = 0; t <= 0.6; t += 0.01) highest = Math.max(highest, (sampled(def, melee, t).body as PartPose).py);
    expect(highest).toBeGreaterThan(15);
    const impact = sampled(def, melee, 0.4001).body as PartPose;
    expect(impact.py).toBeLessThan(0.1);
    expect(impact.sy).toBeLessThan(0.7);
  });
});

describe('Torchwood and Cherry Bomber', () => {
  it('burn: the torch flickers its flames on a loop, and the fuse swells both cherries over a second', () => {
    const torch = getModelDef('torchwood');
    expect(torch.clips.idle?.parts).toEqual(expect.arrayContaining(['flame', 'flameTip']));
    const flames = torch.parts.filter((p) => p.name.startsWith('flame')).flatMap((p) => p.boxes);
    for (const level of LEVELS) {
      const lit = flames.filter((b) => (b.minLevel ?? 1) <= level && level <= (b.maxLevel ?? 5));
      expect(lit.length, `level ${level}`).toBeGreaterThan(0);
      for (const box of lit) expect(box.emissive ?? 0, `level ${level}`).toBeGreaterThanOrEqual(1.5);
    }
    const cherry = getModelDef('cherryBomber');
    expect(cherry.clips.shoot?.duration).toBe(1);
    expect(cherry.clips.shoot?.parts).toEqual(['front', 'back']);
  });
});

describe('the catapults', () => {
  it.each([
    ['kernelPult', 0.4, 0.15],
    ['mangoPult', 0.6, 0.25],
  ])('%s throws with a part named arm: %s s, letting go at %s s', (key, duration, release) => {
    const def = getModelDef(key);
    expect(def.parts.some((p) => p.name === 'arm' && p.boxes.length > 0)).toBe(true);
    const shoot = def.clips.shoot as NonNullable<ModelDef['clips']['shoot']>;
    expect(shoot.duration).toBe(duration);
    expect(shoot.parts).toContain('arm');
    // Wound back before the release, thrown well forward of rest by it, at rest at the end.
    expect((sampled(def, shoot, 0.55 * release).arm as PartPose).rz).toBeGreaterThan(0);
    expect((sampled(def, shoot, release).arm as PartPose).rz).toBeLessThan(-0.5);
    expect((sampled(def, shoot, duration).arm as PartPose).rz).toBeCloseTo(0, 6);
  });
});

/** Art bible section 1: what a level-1 unit fits, in voxels, unless the model names its own. */
const UNIT_ENVELOPE: [number, number, number] = [12, 16, 10];

function boxesAt(def: ModelDef, level: number): number {
  return def.parts.flatMap((part) => part.boxes).filter((b) => (b.minLevel ?? 1) <= level && level <= (b.maxLevel ?? 5)).length;
}

function bounds(def: ModelDef, level: number): Box3 {
  const model = buildParts(def, level);
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);
  return new Box3().setFromObject(model, true);
}

/** Triangles drawn for `def` at `level`: every mesh, except those in a part built hidden. */
function drawnTriangles(def: ModelDef, level: number): number {
  let triangles = 0;
  buildParts(def, level).traverseVisible((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
  });
  return triangles;
}

function sampled(def: ModelDef, clip: NonNullable<ModelDef['clips'][keyof ModelDef['clips']]>, t: number): Pose {
  const pose: Pose = {};
  for (const part of def.parts) pose[part.name] = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, s: 1, sx: 1, sy: 1, sz: 1 };
  clip.sample(t, pose);
  return pose;
}

describe.each(modelKeys())('model %s', (key) => {
  const def = getModelDef(key);

  it('builds at all five levels, with something to draw in every one', () => {
    for (const level of LEVELS) {
      let meshes = 0;
      buildParts(def, level).traverse((object) => {
        if (object instanceof Mesh) meshes++;
      });
      expect(meshes, `level ${level}`).toBeGreaterThan(0);
    }
  });

  it(`costs at most ${TRIANGLE_CEILING} triangles at every level, counting what is drawn`, () => {
    const ceiling = TRIANGLE_OVERRIDES[key] ?? TRIANGLE_CEILING;
    for (const level of LEVELS) expect(drawnTriangles(def, level), `level ${level}`).toBeLessThanOrEqual(ceiling);
  });

  it('has one look at every level if it says so, and then gates nothing by level and has no trim', () => {
    if (!def.singleLevel) return;
    expect(def.parts.flatMap((part) => part.boxes).every((box) => box.minLevel === undefined && box.maxLevel === undefined)).toBe(true);
    expect(def.trim).toEqual([]);
  });

  it('fits its level-1 envelope, standing on the ground, centred on its tile', () => {
    const [wide, tall, deep] = def.envelope ?? UNIT_ENVELOPE;
    const box = bounds(def, 1);
    const slack = 1e-6;
    expect(box.min.x / VOXEL).toBeGreaterThanOrEqual(-wide / 2 - slack);
    expect(box.max.x / VOXEL).toBeLessThanOrEqual(wide / 2 + slack);
    expect(box.min.z / VOXEL).toBeGreaterThanOrEqual(-deep / 2 - slack);
    expect(box.max.z / VOXEL).toBeLessThanOrEqual(deep / 2 + slack);
    expect(box.max.y / VOXEL).toBeLessThanOrEqual(tall + slack);
    expect(box.min.y / VOXEL).toBeGreaterThanOrEqual(-slack);
    expect(box.min.y / VOXEL).toBeLessThan(0.5);
    // And it uses the room it has.
    expect(box.max.y / VOXEL).toBeGreaterThan(tall * 0.75);
  });

  it('has a head that is 40 to 50 percent of its height, if it has a part called head', () => {
    const model = buildParts(def, 1);
    const head = model.getObjectByName('head');
    if (!head) return;
    // The head as it was modelled, before any tilt: its own boxes, without the parts that sit on it.
    const box = new Box3();
    for (const child of head.children) if (child instanceof Mesh) box.union(child.geometry.boundingBox as Box3);
    const whole = bounds(def, 1);
    const share = (box.max.y - box.min.y) / (whole.max.y - whole.min.y);
    expect(share).toBeGreaterThanOrEqual(0.4);
    expect(share).toBeLessThanOrEqual(0.5);
  });

  it('changes at every level: more or different boxes, or different colours, than the level below', () => {
    if (def.singleLevel) {
      for (const level of [2, 3, 4, 5]) expect(modelColors(def, level), `level ${level}`).toEqual(modelColors(def, 1));
      for (const level of [2, 3, 4, 5]) expect(boxesAt(def, level), `level ${level}`).toBe(boxesAt(def, 1));
      return;
    }
    for (const level of [2, 3, 4, 5]) {
      const moreBoxes = boxesAt(def, level) !== boxesAt(def, level - 1);
      const otherColours = modelColors(def, level).join() !== modelColors(def, level - 1).join();
      expect(moreBoxes || otherColours, `level ${level}`).toBe(true);
    }
  });

  it('grows at every level where the lawn camera can see it: taller, longer in front, or wider', () => {
    // Art bible section 3: a level's additions go on top of the head, in front of the face
    // or outside the footprint. Measured before the level's scale is applied.
    /**
     * How much further `now` reaches along the lane than `before`. A plant's additions count
     * in front (+X), as its back is hidden behind its head. The camera sees a zombie from
     * the side, so its outline counts at either end: in front (−X) or streaming out behind.
     */
    const forward = (now: Box3, before: Box3): number =>
      ZOMBIE_KEYS.has(key) ? Math.max(before.min.x - now.min.x, now.max.x - before.max.x) : now.max.x - before.max.x;
    if (def.singleLevel) return;
    for (const level of [2, 3, 4, 5]) {
      const now = bounds(def, level);
      const before = bounds(def, level - 1);
      const grew = now.max.y > before.max.y + 0.5 * VOXEL || forward(now, before) > 0.5 * VOXEL || now.max.z > before.max.z + 0.5 * VOXEL;
      const recoloured = modelColors(def, level).filter((color) => !modelColors(def, level - 1).includes(color)).length > 0;
      expect(grew || recoloured, `level ${level}`).toBe(true);
    }
    // Level 2 has no new material to show for itself, so it must change the outline.
    const two = bounds(def, 2);
    const one = bounds(def, 1);
    expect(two.max.y > one.max.y + 0.5 * VOXEL || forward(two, one) > 0.5 * VOXEL || two.max.z > one.max.z + 0.5 * VOXEL).toBe(true);
  });

  it('loops every looping clip without a seam and plays every clip for some time', () => {
    for (const [name, clip] of Object.entries(def.clips)) {
      expect(clip.duration, name).toBeGreaterThan(0);
      // Every builder says which parts it moves; that is what lets a typo be caught.
      expect(clip.parts?.length, name).toBeGreaterThan(0);
      if (!clip.loop) continue;
      const start = sampled(def, clip, 0);
      const end = sampled(def, clip, clip.duration);
      for (const part of def.parts) {
        const a = start[part.name] as PartPose;
        const b = end[part.name] as PartPose;
        for (const field of Object.keys(a) as (keyof PartPose)[]) {
          expect(Math.abs(a[field] - b[field]), `${name} ${part.name}.${field}`).toBeLessThanOrEqual(1e-6);
        }
      }
    }
    expect(def.clips.idle?.loop).toBe(true);
  });

  it('has the clips every unit needs', () => {
    for (const name of REQUIRED_CLIPS) expect(def.clips[name], name).toBeDefined();
  });

  it('keeps its business end forward, if it is a plant: the muzzle, or else the head, at x >= 0', () => {
    if (!PLANT_KEYS.has(key)) return;
    const still = new ModelInstance({ ...def, key: `${def.key}-forward`, clips: {} }, 1);
    still.root.updateMatrixWorld(true);
    let x: number;
    if (def.muzzle) {
      x = still.muzzleWorld(new Vector3()).x;
    } else {
      const head = still.root.getObjectByName('head');
      expect(head, 'a plant without a muzzle names its head part "head"').toBeDefined();
      // The head's own boxes, where they stand at rest.
      const box = new Box3();
      for (const child of (head as Object3D).children) if (child instanceof Mesh) box.expandByObject(child, true);
      x = box.getCenter(new Vector3()).x;
    }
    expect(x / VOXEL).toBeGreaterThanOrEqual(-1e-6);
    still.dispose();
  });

  it('walks and attacks, if it is a zombie: a looping walk, and a melee or a shot', () => {
    if (!ZOMBIE_KEYS.has(key)) return;
    expect(def.clips.walk?.loop).toBe(true);
    expect(def.clips.melee ?? def.clips.shoot).toBeDefined();
  });

  it('faces −X, if it is a zombie: its head, and its muzzle if it has one, at x <= 0', () => {
    if (!ZOMBIE_KEYS.has(key)) return;
    const still = new ModelInstance({ ...def, key: `${def.key}-facing`, clips: {} }, 1);
    still.root.updateMatrixWorld(true);
    const head = still.root.getObjectByName('head');
    expect(head, 'a zombie names its head part "head"').toBeDefined();
    const box = new Box3();
    for (const child of (head as Object3D).children) if (child instanceof Mesh) box.expandByObject(child, true);
    expect(box.getCenter(new Vector3()).x / VOXEL).toBeLessThanOrEqual(1e-6);
    if (def.muzzle) expect(still.muzzleWorld(new Vector3()).x / VOXEL).toBeLessThanOrEqual(1e-6);
    still.dispose();
  });

  it('has eyes, with something to blink at every level', () => {
    expect(def.eyes?.length).toBeGreaterThan(0);
    for (const level of LEVELS) {
      const model = buildParts(def, level);
      for (const name of def.eyes ?? []) {
        const eye = model.getObjectByName(name) as Object3D;
        expect(eye.children.some((child) => child instanceof Mesh), `${name} at level ${level}`).toBe(true);
      }
    }
  });

  it('keeps its muzzle inside its own bounds at every level, if it has one', () => {
    if (!def.muzzle) return;
    // The rest pose, whatever clip the model idles on.
    const resting: ModelDef = { ...def, key: `${def.key}-at-rest`, clips: {} };
    for (const level of LEVELS) {
      const still = new ModelInstance(resting, level);
      still.root.scale.setScalar(1 / (LEVEL_SCALE[level] as number));
      const muzzle = still.muzzleWorld(new Vector3());
      const box = bounds(def, level).expandByScalar(VOXEL);
      expect(box.containsPoint(muzzle), `level ${level}: ${muzzle.toArray().map((v) => (v / VOXEL).toFixed(2))} voxels`).toBe(true);
      still.dispose();
    }
  });
});
