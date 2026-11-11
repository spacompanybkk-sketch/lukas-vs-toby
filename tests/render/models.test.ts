import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { getModelDef, modelKeys } from '../../src/render/models/registry';
import { VOXEL, buildParts, modelColors } from '../../src/render/voxel/build';
import { ModelInstance } from '../../src/render/voxel/rig';
import type { ModelDef, PartPose, Pose } from '../../src/render/voxel/types';

// The rules every model must keep, checked for every model in the registry. A new unit is
// covered the moment it is registered.

const LEVELS = [1, 2, 3, 4, 5];
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
    for (const level of [2, 3, 4, 5]) {
      const moreBoxes = boxesAt(def, level) !== boxesAt(def, level - 1);
      const otherColours = modelColors(def, level).join() !== modelColors(def, level - 1).join();
      expect(moreBoxes || otherColours, `level ${level}`).toBe(true);
    }
  });

  it('grows at every level where the lawn camera can see it: taller, longer in front, or wider', () => {
    // Art bible section 3: a level's additions go on top of the head, in front of the face
    // or outside the footprint. Measured before the level's scale is applied.
    for (const level of [2, 3, 4, 5]) {
      const now = bounds(def, level);
      const before = bounds(def, level - 1);
      const grew = now.max.y > before.max.y + 0.5 * VOXEL || now.max.x > before.max.x + 0.5 * VOXEL || now.max.z > before.max.z + 0.5 * VOXEL;
      const recoloured = modelColors(def, level).filter((color) => !modelColors(def, level - 1).includes(color)).length > 0;
      expect(grew || recoloured, `level ${level}`).toBe(true);
    }
    // Level 2 has no new material to show for itself, so it must change the outline.
    const two = bounds(def, 2);
    const one = bounds(def, 1);
    expect(two.max.y > one.max.y + 0.5 * VOXEL || two.max.x > one.max.x + 0.5 * VOXEL || two.max.z > one.max.z + 0.5 * VOXEL).toBe(true);
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

  it('keeps its muzzle inside its own bounds, if it has one', () => {
    if (!def.muzzle) return;
    const instance = new ModelInstance(def, 1);
    // The rest pose, whatever clip the model idles on.
    const still = new ModelInstance({ ...def, key: `${def.key}-at-rest`, clips: {} }, 1);
    const muzzle = still.muzzleWorld(new Vector3());
    const box = bounds(def, 1).expandByScalar(VOXEL);
    expect(box.containsPoint(muzzle), `${muzzle.toArray().map((v) => (v / VOXEL).toFixed(2))} voxels`).toBe(true);
    instance.dispose();
    still.dispose();
  });
});
