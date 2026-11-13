import { Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { getModelDef } from '../../src/render/models/registry';
import { buildParts, modelColors, modelStats, muzzleOf } from '../../src/render/voxel/build';
import { LEVEL_SCALE } from '../../src/render/voxel/palette';
import { ModelInstance } from '../../src/render/voxel/rig';
import type { ModelDef } from '../../src/render/voxel/types';

// A model flagged `singleLevel` (the Bone Minion) has one look: whatever level it is asked for,
// it is built as level 1 (same boxes, same geometry, level-1 size, no level-5 aura group), and a
// definition that would make its look depend on the level is refused.

function minion(extra: Partial<ModelDef> = {}): ModelDef {
  return {
    key: `single-${Math.random().toString(36).slice(2)}`,
    singleLevel: true,
    trim: [],
    muzzle: { part: 'body', at: [2, 6, 0] },
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [{ at: [-2, 0, -2], size: [4, 8, 4], color: '#808080' }] },
      { name: 'head', parent: 'body', pivot: [0, 8, 0], boxes: [{ at: [-2, 8, -2], size: [4, 4, 4], color: '#C0C0C0' }] },
    ],
    clips: {},
    ...extra,
  };
}

function geometries(root: Object3D): unknown[] {
  const out: unknown[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o.geometry);
  });
  return out;
}

describe('singleLevel: one look at every level', () => {
  it('builds the level-1 model whatever level is asked for: same geometry, level-1 size, no aura', () => {
    const def = minion();
    const one = buildParts(def, 1);
    for (const level of [2, 3, 4, 5]) {
      const built = buildParts(def, level);
      expect(built.scale.x, `level ${level}`).toBe(LEVEL_SCALE[1]);
      expect(geometries(built), `level ${level}`).toEqual(geometries(one));
      expect(built.getObjectByName('aura'), `level ${level}`).toBeUndefined();
      expect(modelStats(def, level)).toEqual(modelStats(def, 1));
      expect(modelColors(def, level)).toEqual(modelColors(def, 1));
      expect(muzzleOf(def, level)).toEqual(muzzleOf(def, 1));
    }
  });

  it('still refuses a level that is not one', () => {
    const def = minion();
    for (const level of [0, 6, 2.5, Number.NaN]) expect(() => buildParts(def, level), String(level)).toThrow(RangeError);
  });

  it('refuses a definition whose look would depend on the level: a box gated by level, or trim', () => {
    const gated = minion();
    (gated.parts[1] as ModelDef['parts'][number]).boxes.push({ at: [-1, 12, -1], size: [2, 2, 2], color: '#FFFFFF', minLevel: 3 });
    expect(() => buildParts(gated, 1)).toThrow(/singleLevel.*minLevel|one look/i);
    const capped = minion();
    (capped.parts[0] as ModelDef['parts'][number]).boxes[0] = { at: [-2, 0, -2], size: [4, 8, 4], color: '#808080', maxLevel: 4 };
    expect(() => buildParts(capped, 1)).toThrow(/one look/i);
    expect(() => buildParts(minion({ trim: ['#808080'] }), 1)).toThrow(/one look/i);
  });

  it('a ModelInstance of it is level 1 at any level, and setLevel keeps the same instance', () => {
    const def = minion();
    const unit = new ModelInstance(def, 4);
    expect(unit.level).toBe(1);
    expect(unit.root.name).toBe(`${def.key}@1`);
    expect(unit.setLevel(5)).toBe(unit);
    expect(unit.setLevel(1)).toBe(unit);
    expect(() => unit.setLevel(9)).toThrow(RangeError);
    unit.dispose();
  });

  it('the Bone Minion is built so: a level-5 minion is the level-1 minion', () => {
    const def = getModelDef('boneMinion');
    expect(def.singleLevel).toBe(true);
    const five = new ModelInstance(def, 5);
    const one = new ModelInstance(def, 1);
    expect(five.level).toBe(1);
    expect(geometries(five.root)).toEqual(geometries(one.root));
    five.dispose();
    one.dispose();
  });

  it('leaves every other model growing with its level', () => {
    const def = getModelDef('boneMinion');
    const other: ModelDef = { ...minion(), singleLevel: undefined };
    expect(buildParts(other, 5).scale.x).toBe(LEVEL_SCALE[5]);
    expect(new ModelInstance(other, 3).level).toBe(3);
    expect(def.key).toBe('boneMinion');
  });
});
