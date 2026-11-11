import { Box3, Color, Group, Mesh, MeshStandardMaterial, Object3D, Scene, ShaderLib, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { getModelDef, hasModel, modelKeys, registerModel } from '../../src/render/models/registry';
import { peashooter } from '../../src/render/models/plants/peashooter';
import { VOXEL, buildParts, disposeModels, modelColors, modelStats, prewarmModels } from '../../src/render/voxel/build';
import { cheerJump, hitRecoil, idleBob, shootSnap, spawnRise, wilt } from '../../src/render/voxel/clips';
import { LEVEL_SCALE, PALETTE, levelMaterial } from '../../src/render/voxel/palette';
import { ModelInstance } from '../../src/render/voxel/rig';
import type { Box, Clip, ModelDef, PartPose, Pose } from '../../src/render/voxel/types';
import { BoxBatch } from '../../src/render/world/boxes';

const LEVELS = [1, 2, 3, 4, 5];
const hex = (name: string): number => parseInt((PALETTE[name] as string).slice(1), 16);

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) out.push(object);
  });
  return out;
}

function boxesAt(def: ModelDef, level: number): Box[] {
  return def.parts.flatMap((part) => part.boxes).filter((b) => (b.minLevel ?? 1) <= level && level <= (b.maxLevel ?? 5));
}

function restPose(names: string[]): Pose {
  const pose: Pose = {};
  for (const name of names) pose[name] = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, s: 1, sx: 1, sy: 1, sz: 1 };
  return pose;
}

function sampled(clip: Clip, t: number, names: string[]): Pose {
  const pose = restPose(names);
  clip.sample(t, pose);
  return pose;
}

function expectSamePose(a: Pose, b: Pose, tolerance = 1e-6): void {
  for (const name of Object.keys(a)) {
    const pa = a[name] as PartPose;
    const pb = b[name] as PartPose;
    for (const field of Object.keys(pa) as (keyof PartPose)[]) {
      expect(Math.abs(pa[field] - pb[field]), `${name}.${field}`).toBeLessThanOrEqual(tolerance);
    }
  }
}

/** Runs `seconds` of game time through an instance in 60 fps frames. */
function run(instance: ModelInstance, seconds: number): void {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) instance.update(1 / 60);
}

function part(instance: ModelInstance, name: string): Object3D {
  const found = instance.root.getObjectByName(name);
  if (!found) throw new Error(`no part named ${name}`);
  return found;
}

/** A two-legged test model: hips, a slouched torso and two legs that swing from the hip. */
function biped(clips: ModelDef['clips'] = {}): ModelDef {
  return {
    key: 'test-biped',
    trim: [],
    parts: [
      { name: 'hips', pivot: [0, 6, 0], boxes: [{ at: [-2, 5, -2], size: [4, 2, 4], color: 'clothDark' }] },
      // A little narrower than the hips: flanks in one plane would flicker where the slouch overlaps them.
      { name: 'torso', parent: 'hips', pivot: [0, 7, 0], rot: [0, 0, 10], boxes: [{ at: [-2, 7, -1.75], size: [4, 5, 3.5], color: 'clothPurple' }] },
      { name: 'legL', parent: 'hips', pivot: [0, 5, 1], boxes: [{ at: [-1, 0, 0], size: [2, 5, 2], color: 'skin' }] },
      { name: 'legR', parent: 'hips', pivot: [0, 5, -1], boxes: [{ at: [-1, 0, -2], size: [2, 5, 2], color: 'skin' }] },
    ],
    clips,
  };
}

describe('level tables', () => {
  it('scales levels as the art bible says', () => {
    expect(LEVEL_SCALE).toEqual([0, 1, 1.08, 1.16, 1.24, 1.34]);
  });

  it('names the material each level adds', () => {
    expect(LEVELS.map(levelMaterial)).toEqual(['none', 'none', 'iron', 'crystal', 'gold']);
  });

  it('shares one palette with the rest of the renderer', () => {
    expect(PALETTE.leaf).toBe('#58C13B');
    expect(PALETTE.levelGold).toBe('#FFC83D');
  });
});

describe('buildParts', () => {
  it('makes a named object for every part, nested under its parent', () => {
    const model = buildParts(peashooter, 1);
    for (const def of peashooter.parts) {
      const object = model.getObjectByName(def.name);
      expect(object, def.name).toBeDefined();
      const parent = def.parent ? model.getObjectByName(def.parent) : model;
      expect(object?.parent, def.name).toBe(parent);
    }
  });

  it('keeps a level-1 Peashooter inside the 12 × 16 × 10 voxel envelope, standing on the ground', () => {
    const box = new Box3().setFromObject(buildParts(peashooter, 1), true);
    const slack = 1e-6;
    expect(box.min.x).toBeGreaterThanOrEqual(-6 * VOXEL - slack);
    expect(box.max.x).toBeLessThanOrEqual(6 * VOXEL + slack);
    expect(box.min.y).toBeGreaterThanOrEqual(-slack);
    expect(box.min.y).toBeLessThan(0.5 * VOXEL);
    expect(box.max.y).toBeLessThanOrEqual(16 * VOXEL + slack);
    expect(box.min.z).toBeGreaterThanOrEqual(-5 * VOXEL - slack);
    expect(box.max.z).toBeLessThanOrEqual(5 * VOXEL + slack);
    // It fills most of that envelope rather than hiding in a corner of it.
    expect(box.max.y - box.min.y).toBeGreaterThan(13 * VOXEL);
    expect(box.max.x - box.min.x).toBeGreaterThan(9 * VOXEL);
  });

  it('scales the model root by the level', () => {
    expect(VOXEL).toBe(1 / 16);
    for (const level of LEVELS) {
      const model = buildParts(peashooter, level);
      expect(model.scale.toArray()).toEqual([LEVEL_SCALE[level], LEVEL_SCALE[level], LEVEL_SCALE[level]]);
    }
    expect(buildParts(peashooter, 5).scale.x).toBe(1.34);
  });

  it('adds boxes with every level and so draws more at level 5 than at level 1', () => {
    const counts = LEVELS.map((level) => boxesAt(peashooter, level).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i], `level ${i + 1}`).toBeGreaterThan(counts[i - 1] as number);
    expect(modelStats(peashooter, 5).triangles).toBeGreaterThan(modelStats(peashooter, 1).triangles);
    const built = meshes(buildParts(peashooter, 5)).reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? 0) / 3, 0);
    expect(modelStats(peashooter, 5).triangles).toBe(built);
    expect(modelStats(peashooter, 5).meshes).toBe(meshes(buildParts(peashooter, 5)).length);
  });

  it('makes every mesh cast and receive shadows', () => {
    for (const level of LEVELS) {
      for (const mesh of meshes(buildParts(peashooter, level))) {
        expect(mesh.castShadow, mesh.name).toBe(true);
        expect(mesh.receiveShadow, mesh.name).toBe(true);
      }
    }
  });

  it('shares geometry and materials between builds of the same model and level', () => {
    const a = meshes(buildParts(peashooter, 3));
    const b = meshes(buildParts(peashooter, 3));
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).not.toBe(b[i]);
      expect(a[i]?.geometry).toBe(b[i]?.geometry);
      expect(a[i]?.material).toBe(b[i]?.material);
    }
  });

  it('uses matte plastic at level 1 and the level material from level 3 up', () => {
    const materialsAt = (level: number): MeshStandardMaterial[] => [
      ...new Set(meshes(buildParts(peashooter, level)).map((mesh) => mesh.material as MeshStandardMaterial)),
    ];
    for (const material of materialsAt(1)) {
      expect(material.vertexColors).toBe(true);
      expect(material.metalness).toBe(0);
    }
    expect(materialsAt(1).some((m) => m.roughness === 0.85)).toBe(true);
    const iron = materialsAt(3).find((m) => m.metalness === 0.6);
    expect(iron?.roughness).toBe(0.4);
    // Crystal glows hard enough to bloom; gold only has a sheen.
    const crystal = materialsAt(4).find((m) => m.name === 'crystal');
    expect(crystal?.emissiveIntensity).toBeGreaterThanOrEqual(1.5);
    expect(crystal?.emissive.getHex()).toBe(hex('levelCrystal'));
    const gold = materialsAt(5).find((m) => m.metalness === 0.8);
    expect(gold?.emissiveIntensity).toBe(0.15);
    // Level-5 eyes glow.
    const eyes = buildParts(peashooter, 5).getObjectByName((peashooter.eyes as string[])[0] as string) as Object3D;
    expect(meshes(eyes).some((mesh) => (mesh.material as MeshStandardMaterial).emissiveIntensity >= 1.5)).toBe(true);
  });

  it('makes crystal and glowing boxes glow in their own baked colours, so shading survives the glow', () => {
    const crystal = meshes(buildParts(peashooter, 4))
      .map((mesh) => mesh.material as MeshStandardMaterial)
      .find((material) => material.name === 'crystal') as MeshStandardMaterial;
    const patch = (material: MeshStandardMaterial): string => {
      const shader = { fragmentShader: ShaderLib.physical.fragmentShader };
      (material.onBeforeCompile as unknown as (shader: { fragmentShader: string }) => void)(shader);
      return shader.fragmentShader;
    };
    // The emission is multiplied by the vertex colour, right where three.js adds it up.
    expect(patch(crystal)).toMatch(/#include <emissivemap_fragment>\s+totalEmissiveRadiance \*= vColor\.rgb;/);
    expect(patch(crystal)).not.toBe(ShaderLib.physical.fragmentShader);
    // Such a material must not share a compiled program with one that does not do this.
    const plain = meshes(buildParts(peashooter, 1)).map((mesh) => mesh.material as MeshStandardMaterial).find((m) => m.name === 'plain');
    expect(crystal.customProgramCacheKey()).not.toBe(plain?.customProgramCacheKey());
    expect(patch(plain as MeshStandardMaterial)).toBe(ShaderLib.physical.fragmentShader);
    // The glowing eyes of level 5 do the same; gold's sheen is left even.
    const eyes = buildParts(peashooter, 5).getObjectByName('eyes') as Object3D;
    const glow = meshes(eyes).map((mesh) => mesh.material as MeshStandardMaterial).find((m) => m.emissiveIntensity >= 1.5);
    expect(patch(glow as MeshStandardMaterial)).toContain('totalEmissiveRadiance *= vColor.rgb;');
    const gold = meshes(buildParts(peashooter, 5)).map((mesh) => mesh.material as MeshStandardMaterial).find((m) => m.name === 'gold');
    expect(patch(gold as MeshStandardMaterial)).toBe(ShaderLib.physical.fragmentShader);

    // And the shading is there to survive: a crystal box is lighter on top than on its sides.
    const def: ModelDef = {
      key: 'test-crystal-tones',
      trim: [],
      parts: [{ name: 'gem', pivot: [0, 0, 0], boxes: [{ at: [-1, 0, -1], size: [2, 2, 2], color: 'levelCrystal' }] }],
      clips: {},
    };
    const geometry = (meshes(buildParts(def, 1))[0] as Mesh).geometry;
    const normal = geometry.getAttribute('normal');
    const color = geometry.getAttribute('color');
    const tone = (nx: number, ny: number): number => {
      for (let i = 0; i < normal.count; i++) if (normal.getX(i) === nx && normal.getY(i) === ny) return color.getY(i);
      throw new Error('no such face');
    };
    expect(tone(1, 0)).toBeLessThan(tone(0, 1) * 0.85);
    expect(tone(0, -1)).toBeLessThan(tone(1, 0) * 0.85);
  });

  it('builds ahead of time when asked, so a merge in mid-match does not stop to build', () => {
    disposeModels();
    const built = vi.spyOn(BoxBatch.prototype, 'build');
    prewarmModels(['peashooter'], [2, 3]);
    const afterPrewarm = built.mock.calls.length;
    expect(afterPrewarm).toBeGreaterThan(0);
    buildParts(peashooter, 2);
    buildParts(peashooter, 3);
    expect(built.mock.calls.length).toBe(afterPrewarm);
    // A level that was not asked for is still built on first use.
    buildParts(peashooter, 4);
    expect(built.mock.calls.length).toBeGreaterThan(afterPrewarm);
    // Without levels it does all five.
    const before = built.mock.calls.length;
    prewarmModels(['peashooter']);
    expect(built.mock.calls.length).toBeGreaterThan(before);
    const all = built.mock.calls.length;
    for (const level of LEVELS) buildParts(peashooter, level);
    expect(built.mock.calls.length).toBe(all);
    expect(() => prewarmModels(['nope'])).toThrow(/nope/);
    built.mockRestore();
  });

  it('gives level 5, and only level 5, an empty aura group for effects to fill', () => {
    for (const level of [1, 2, 3, 4]) expect(buildParts(peashooter, level).getObjectByName('aura')).toBeUndefined();
    const aura = buildParts(peashooter, 5).getObjectByName('aura');
    expect(aura).toBeInstanceOf(Group);
    expect(aura?.children).toHaveLength(0);
  });

  it('turns a part about its pivot, carrying its children with it', () => {
    const model = buildParts(biped(), 1);
    model.updateMatrixWorld(true);
    const torso = model.getObjectByName('torso') as Object3D;
    // Authored upright, the torso slouches 10 degrees about the pivot at its base.
    expect(torso.rotation.z).toBeCloseTo((10 * Math.PI) / 180, 12);
    expect(torso.position.toArray()).toEqual([0, VOXEL, 0]);
    const leg = model.getObjectByName('legL') as Object3D;
    expect(leg.position.toArray()).toEqual([0, -VOXEL, VOXEL]);
    // The leg hangs from its pivot: its geometry reaches from the hip down to the ground.
    const box = new Box3().setFromObject(leg, true);
    expect(box.min.y).toBeCloseTo(0, 9);
    expect(box.max.y).toBeCloseTo(5 * VOXEL, 9);
  });

  it('rejects a model that cannot be built, naming what is wrong', () => {
    const broken = (change: (def: ModelDef) => void): ModelDef => {
      const def = biped();
      def.key = `broken-${Math.random()}`;
      change(def);
      return def;
    };
    expect(() => buildParts(broken((d) => ((d.parts[1] as { parent?: string }).parent = 'nobody')), 1)).toThrow(/nobody/);
    expect(() => buildParts(broken((d) => ((d.parts[0]?.boxes[0] as Box).color = 'leef')), 1)).toThrow(/leef/);
    expect(() => buildParts(broken((d) => d.parts.push({ name: 'hips', pivot: [0, 0, 0], boxes: [] })), 1)).toThrow(/hips/);
    expect(() => buildParts(broken((d) => (d.eyes = ['nose'])), 1)).toThrow(/nose/);
    expect(() => buildParts(biped(), 0)).toThrow(/level/);
    expect(() => buildParts(biped(), 6)).toThrow(/level/);
    // A clip that names a part the model does not have: a typo must not pass as a model that stands still.
    expect(() => buildParts(broken((d) => (d.clips = { idle: idleBob({ body: 'stm' }) })), 1)).toThrow(/idle.*"stm"/);
    expect(() => buildParts(broken((d) => (d.clips = { idle: idleBob({ body: 'hips', sway: ['legL', 'tail'] }) })), 1)).toThrow(/"tail"/);
    expect(() => buildParts(broken((d) => (d.clips = { idle: idleBob({ body: 'hips', sway: ['legL'] }) })), 1)).not.toThrow();
    // Level gates must be whole levels, the right way round.
    const gate = (levels: Partial<Box>) => broken((d) => Object.assign(d.parts[0]?.boxes[0] as Box, levels));
    expect(() => buildParts(gate({ minLevel: 0 }), 1)).toThrow(/"hips" box 0.*minLevel/);
    expect(() => buildParts(gate({ maxLevel: 6 }), 1)).toThrow(/maxLevel/);
    expect(() => buildParts(gate({ minLevel: 2.5 }), 1)).toThrow(/minLevel/);
    expect(() => buildParts(gate({ minLevel: 4, maxLevel: 3 }), 1)).toThrow(/minLevel.*maxLevel/);
    expect(() => buildParts(gate({ minLevel: 3, maxLevel: 3 }), 1)).not.toThrow();
    // Trim has a main tone and a shadow tone; a third has no material to turn into.
    expect(() => buildParts(broken((d) => (d.trim = ['skin', 'clothDark', 'clothPurple'])), 1)).toThrow(/trim.*two/);
    expect(() => buildParts(broken((d) => (d.trim = ['skin', 'clothDark'])), 1)).not.toThrow();
    // Names that point nowhere.
    expect(() => buildParts(broken((d) => (d.muzzle = { part: 'gun', at: [0, 0, 0] })), 1)).toThrow(/muzzle.*"gun"/);
    expect(() => buildParts(broken((d) => ((d.parts[0] as { shadedBy?: string[] }).shadedBy = ['cape'])), 1)).toThrow(/"cape"/);
  });

  /** The colours of the quads on the plane `axis` = `at` (voxels) that cover the point (`u`, `v`). */
  function quadsAt(geometry: BufferGeometry, axis: number, at: number, u: number, v: number): number[] {
    const position = geometry.getAttribute('position');
    const color = geometry.getAttribute('color');
    const ua = (axis + 1) % 3;
    const va = (axis + 2) % 3;
    const found: number[] = [];
    for (let quad = 0; quad < position.count; quad += 4) {
      const corners = [0, 1, 2, 3].map((k) => new Vector3().fromBufferAttribute(position, quad + k).divideScalar(VOXEL));
      if (!corners.every((c) => Math.abs(c.getComponent(axis) - at) < 1e-6)) continue;
      const us = corners.map((c) => c.getComponent(ua));
      const vs = corners.map((c) => c.getComponent(va));
      if (u > Math.min(...us) && u < Math.max(...us) && v > Math.min(...vs) && v < Math.max(...vs)) {
        found.push(new Color().fromBufferAttribute(color, quad).getHex());
      }
    }
    return found;
  }

  it('leaves out faces hidden inside a part, and lets a later box paint over an earlier one', () => {
    const def: ModelDef = {
      key: 'test-paint',
      trim: [],
      parts: [
        {
          name: 'body',
          pivot: [0, 0, 0],
          boxes: [
            { at: [-3, 0, -3], size: [6, 2, 6], color: 'leaf' },
            // Standing on it: the faces between the two are never seen.
            { at: [-1, 2, -1], size: [2, 2, 2], color: 'leaf' },
            // Set flush into the big box's +Z face, at half-voxel positions.
            { at: [0.5, 0.5, 2.5], size: [1, 1, 0.5], color: 'eye' },
          ],
        },
      ],
      clips: {},
    };
    const geometry = (meshes(buildParts(def, 1))[0] as Mesh).geometry as BufferGeometry;
    // Under the small box the big one has no top, and the small one has no underside.
    expect(quadsAt(geometry, 1, 2, 0.25, 0.25)).toEqual([]);
    expect(quadsAt(geometry, 1, 2, 2.25, 0.25)).toHaveLength(1);
    expect(quadsAt(geometry, 1, 4, 0.25, 0.25)).toHaveLength(1);
    // Where the flush box lies, the face is drawn once, in its colour …
    const eye = new Color(PALETTE.eye as string).getHex();
    expect(quadsAt(geometry, 2, 3, 0.75, 0.75)).toEqual([eye]);
    expect(quadsAt(geometry, 2, 3, 1.25, 1.25)).toEqual([eye]);
    // … and beside it once, in the big box's.
    const beside = quadsAt(geometry, 2, 3, 0.25, 0.75);
    expect(beside).toHaveLength(1);
    expect(beside[0]).not.toBe(eye);
    expect(quadsAt(geometry, 2, 3, 1.75, 1.25)).toHaveLength(1);
  });

  it('refuses boxes of two parts that share a surface, which would flicker', () => {
    const def = (eyeZ: number): ModelDef => ({
      key: `test-flicker-${eyeZ}`,
      trim: [],
      eyes: ['eye'],
      parts: [
        { name: 'head', pivot: [0, 0, 0], boxes: [{ at: [-2, 0, -2], size: [4, 4, 4], color: 'leaf' }] },
        { name: 'eye', parent: 'head', pivot: [0, 2, 2], boxes: [{ at: [0, 1, eyeZ], size: [2, 2, 1], color: 'eye' }] },
      ],
      clips: {},
    });
    // Sunk half into the head with its side flush with the head's side: two meshes, one surface.
    expect(() => buildParts(def(1.5), 1)).toThrow(/"head".*"eye".*share a surface/);
    // Standing on the head's face instead is fine.
    expect(() => buildParts(def(2), 1)).not.toThrow();
  });

  it('shades a part against another part only where the model asks for it', () => {
    // An arm resting against a body. The body's flank is shaded where the arm lies only if
    // the body says the arm never leaves it; an arm that swings would leave the patch behind.
    const def = (shadedBy?: string[]): ModelDef => ({
      key: `test-shaded-${shadedBy?.join('') ?? 'alone'}`,
      trim: [],
      parts: [
        { name: 'body', pivot: [0, 0, 0], shadedBy, boxes: [{ at: [-2, 0, -2], size: [4, 6, 4], color: 'skin' }] },
        { name: 'arm', parent: 'body', pivot: [0, 5, 2.5], boxes: [{ at: [-1, 1, 2], size: [2, 4, 1], color: 'skin' }] },
      ],
      clips: {},
    });
    /** The darkest and lightest green on the body's +Z face. */
    const flank = (model: ModelDef): { darkest: number; lightest: number } => {
      const body = buildParts(model, 1).getObjectByName('body') as Object3D;
      const geometry = (body.children.find((child) => child instanceof Mesh) as Mesh).geometry;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const color = geometry.getAttribute('color');
      let darkest = Infinity;
      let lightest = 0;
      for (let i = 0; i < position.count; i++) {
        if (normal.getZ(i) < 0.5) continue;
        darkest = Math.min(darkest, color.getY(i));
        lightest = Math.max(lightest, color.getY(i));
      }
      return { darkest, lightest };
    };
    const alone = flank(def());
    expect(alone.darkest).toBeCloseTo(alone.lightest, 9);
    const against = flank(def(['arm']));
    expect(against.lightest).toBeCloseTo(alone.lightest, 9);
    expect(against.darkest).toBeLessThan(against.lightest * 0.9);
  });

  it('shades the creases where boxes meet darker than open faces', () => {
    // A small block standing on a big one: the big block's top is darker beside the small one.
    const def: ModelDef = {
      key: 'test-crease',
      trim: [],
      parts: [
        {
          name: 'body',
          pivot: [0, 0, 0],
          boxes: [
            { at: [-3, 0, -3], size: [6, 2, 6], color: 'leaf' },
            { at: [-1, 2, -1], size: [2, 2, 2], color: 'leaf' },
          ],
        },
      ],
      clips: {},
    };
    const geometry = (meshes(buildParts(def, 1))[0] as Mesh).geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const color = geometry.getAttribute('color');
    let beside = Infinity;
    let open = 0;
    for (let i = 0; i < position.count; i++) {
      if (normal.getY(i) < 0.5 || Math.abs(position.getY(i) - 2 * VOXEL) > 1e-9) continue;
      const x = position.getX(i) / VOXEL;
      const z = position.getZ(i) / VOXEL;
      const green = color.getY(i);
      if (Math.abs(x) === 3 && Math.abs(z) === 3) open = Math.max(open, green);
      if (Math.abs(x) === 1 && Math.abs(z) <= 1) beside = Math.min(beside, green);
    }
    expect(open).toBeGreaterThan(0);
    expect(beside).toBeLessThan(open * 0.95);
  });
});

describe('modelColors', () => {
  it('swaps the trim colours for the level material', () => {
    const trim = peashooter.trim.map(hex);
    // Trim shows at levels 1 and 2 in its own colours …
    expect(trim.some((color) => modelColors(peashooter, 1).includes(color))).toBe(true);
    expect(trim.some((color) => modelColors(peashooter, 2).includes(color))).toBe(true);
    // … and from level 3 none of it is left: it is iron, then crystal, then gold.
    for (const level of [3, 4, 5]) {
      for (const color of trim) expect(modelColors(peashooter, level), `level ${level}`).not.toContain(color);
    }
    expect(modelColors(peashooter, 3)).toContain(hex('levelIron'));
    expect(modelColors(peashooter, 4)).toContain(hex('levelCrystal'));
    expect(modelColors(peashooter, 5)).toContain(0xffc83d);
    expect(modelColors(peashooter, 1)).not.toContain(0xffc83d);
    expect(modelColors(peashooter, 2)).not.toContain(hex('levelIron'));
  });

  it('gives the second trim colour the level material\'s shadow tone', () => {
    const def: ModelDef = {
      key: 'test-two-trims',
      trim: ['pea', 'stem'],
      parts: [
        {
          name: 'body',
          pivot: [0, 0, 0],
          boxes: [
            { at: [0, 0, 0], size: [2, 2, 2], color: 'pea' },
            { at: [2, 0, 0], size: [2, 2, 2], color: 'stem' },
          ],
        },
      ],
      clips: {},
    };
    expect(modelColors(def, 2).sort()).toEqual([hex('pea'), hex('stem')].sort());
    expect(modelColors(def, 3).sort()).toEqual([hex('levelIron'), hex('levelIronDark')].sort());
    expect(modelColors(def, 4).sort()).toEqual([hex('levelCrystal'), hex('levelCrystalDeep')].sort());
    expect(modelColors(def, 5).sort()).toEqual([hex('levelGold'), hex('levelGoldDark')].sort());
  });

  it('lists each colour once, the commonest first', () => {
    const colors = modelColors(peashooter, 1);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.length).toBeGreaterThanOrEqual(4);
    // A Peashooter is mostly leaf green.
    expect([hex('leaf'), hex('leafDark'), hex('leafLight')]).toContain(colors[0]);
  });
});

describe('clip builders', () => {
  const names = ['body', 'head', 'leafA', 'leafB'];
  const clips: Record<string, Clip> = {
    idle: idleBob({ body: 'body', head: 'head', sway: ['leafA', 'leafB'] }),
    shoot: shootSnap({ body: 'body', head: 'head' }),
    hit: hitRecoil('body', -1),
    spawn: spawnRise('body'),
    die: wilt({ body: 'body', head: 'head' }),
    cheer: cheerJump('body'),
  };

  it('have the durations the art bible gives', () => {
    expect(clips.idle?.duration).toBe(1.6);
    expect(clips.shoot?.duration).toBe(0.4);
    expect(clips.hit?.duration).toBe(0.2);
    expect(clips.spawn?.duration).toBe(0.35);
    expect(clips.die?.duration).toBe(0.2);
    expect(clips.cheer?.duration).toBe(0.6);
    expect(Object.entries(clips).filter(([, clip]) => clip.loop).map(([name]) => name)).toEqual(['idle', 'cheer']);
  });

  it('say which parts they move, so a model can be checked against them', () => {
    expect(clips.idle?.parts).toEqual(['body', 'head', 'leafA', 'leafB']);
    expect(idleBob({ body: 'trunk' }).parts).toEqual(['trunk']);
    expect(clips.shoot?.parts).toEqual(['body', 'head']);
    expect(clips.hit?.parts).toEqual(['body']);
    expect(clips.spawn?.parts).toEqual(['body']);
    expect(clips.die?.parts).toEqual(['body', 'head']);
    expect(wilt({ body: 'trunk' }).parts).toEqual(['trunk']);
    expect(clips.cheer?.parts).toEqual(['body']);
  });

  it('loop without a seam', () => {
    for (const clip of [clips.idle, clips.cheer] as Clip[]) {
      expectSamePose(sampled(clip, 0, names), sampled(clip, clip.duration, names));
    }
  });

  it('write only offsets: a part they do not name stays at rest, and a missing part is no error', () => {
    for (const clip of Object.values(clips)) {
      const pose = sampled(clip, clip.duration * 0.4, [...names, 'bystander']);
      expectSamePose({ bystander: pose.bystander as PartPose }, restPose(['bystander']));
      expect(() => clip.sample(0.05, {})).not.toThrow();
    }
  });

  it('idle bobs the body half a voxel, sways the head 3 degrees and flutters the leaves', () => {
    const idle = clips.idle as Clip;
    let bob = 0;
    let sway = 0;
    let flutter = 0;
    for (let t = 0; t < 1.6; t += 0.01) {
      const pose = sampled(idle, t, names);
      bob = Math.max(bob, Math.abs((pose.body as PartPose).py));
      sway = Math.max(sway, Math.abs((pose.head as PartPose).rz));
      flutter = Math.max(flutter, Math.abs((pose.leafA as PartPose).rz) + Math.abs((pose.leafA as PartPose).rx));
    }
    expect(bob).toBeCloseTo(0.5, 2);
    expect((sway * 180) / Math.PI).toBeCloseTo(3, 1);
    expect(flutter).toBeGreaterThan(0.03);
    // The two leaves do not move as one.
    const mid = sampled(idle, 0.3, names);
    expect((mid.leafA as PartPose).rz).not.toBeCloseTo((mid.leafB as PartPose).rz, 3);
  });

  it('shoot leans back and squashes, snaps forward and stretches, then settles to rest', () => {
    const shoot = clips.shoot as Clip;
    const windUp = sampled(shoot, 0.12, names);
    // Facing +X, leaning back turns the top towards −X: a positive turn about Z.
    expect((windUp.body as PartPose).rz).toBeGreaterThan(0.1);
    expect((windUp.body as PartPose).sy).toBeCloseTo(0.9, 6);
    expect((windUp.head as PartPose).px).toBeLessThan(0);
    const snap = sampled(shoot, 0.2, names);
    expect((snap.body as PartPose).rz).toBeLessThan(-0.08);
    expect((snap.body as PartPose).sy).toBeCloseTo(1.1, 6);
    expect((snap.head as PartPose).px).toBeGreaterThan(0.5);
    // Half way through the wind-up it is already most of the way back (it eases out).
    expect((sampled(shoot, 0.06, names).body as PartPose).rz).toBeGreaterThan((windUp.body as PartPose).rz * 0.6);
    expectSamePose(sampled(shoot, 0, names), restPose(names));
    expectSamePose(sampled(shoot, 0.4, names), restPose(names));
  });

  it('shoot mirrors for a model that faces −X', () => {
    const mirrored = shootSnap({ body: 'body', head: 'head' }, -1);
    const a = sampled(clips.shoot as Clip, 0.12, names);
    const b = sampled(mirrored, 0.12, names);
    expect((b.body as PartPose).rz).toBeCloseTo(-(a.body as PartPose).rz, 9);
    expect((b.head as PartPose).px).toBeCloseTo(-(a.head as PartPose).px, 9);
    expect((b.body as PartPose).sy).toBeCloseTo((a.body as PartPose).sy, 9);
  });

  it('hit knocks the body two voxels the way it was pushed within 80 ms and brings it back', () => {
    const peak = sampled(clips.hit as Clip, 0.08, names);
    expect((peak.body as PartPose).px).toBeCloseTo(-2, 6);
    expect((sampled(hitRecoil('body', 1), 0.08, names).body as PartPose).px).toBeCloseTo(2, 6);
    expectSamePose(sampled(clips.hit as Clip, 0, names), restPose(names));
    expectSamePose(sampled(clips.hit as Clip, 0.2, names), restPose(names));
  });

  it('spawn rises from nothing, overshoots to 1.15 and lands on 1', () => {
    const spawn = clips.spawn as Clip;
    const start = sampled(spawn, 0, names).body as PartPose;
    expect(start.s).toBeLessThan(0.02);
    expect(start.s).toBeGreaterThan(0);
    expect(start.py).toBeLessThan(0);
    let peak = 0;
    for (let t = 0; t <= 0.35; t += 0.005) peak = Math.max(peak, (sampled(spawn, t, names).body as PartPose).s);
    expect(peak).toBeCloseTo(1.15, 2);
    expectSamePose(sampled(spawn, 0.35, names), restPose(names));
  });

  it('die droops and shrinks; cheer leaves the ground and squashes on landing', () => {
    const dead = sampled(clips.die as Clip, 0.2, names);
    expect((dead.body as PartPose).sy).toBeLessThan(0.8);
    expect((dead.head as PartPose).py).toBeLessThan(0);
    expectSamePose(sampled(clips.die as Clip, 0, names), restPose(names));
    const cheer = clips.cheer as Clip;
    let height = 0;
    let squash = 1;
    for (let t = 0; t <= 0.6; t += 0.005) {
      const body = sampled(cheer, t, names).body as PartPose;
      height = Math.max(height, body.py);
      squash = Math.min(squash, body.sy);
      expect(body.py).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(height).toBeGreaterThan(2);
    expect(squash).toBeLessThan(0.95);
  });

  it('clamp time outside a one-shot clip instead of extrapolating', () => {
    expectSamePose(sampled(clips.shoot as Clip, 9, names), restPose(names));
    expectSamePose(sampled(clips.shoot as Clip, -1, names), restPose(names));
    expectSamePose(sampled(clips.die as Clip, 9, names), sampled(clips.die as Clip, 0.2, names));
  });
});

describe('Peashooter', () => {
  it('has the clips, eyes, trim and muzzle the game needs', () => {
    expect(peashooter.key).toBe('peashooter');
    expect(Object.keys(peashooter.clips).sort()).toEqual(['cheer', 'die', 'hit', 'idle', 'shoot', 'spawn']);
    expect(peashooter.clips.shoot?.duration).toBe(0.4);
    expect(peashooter.clips.shoot?.loop).toBe(false);
    expect(peashooter.clips.idle?.loop).toBe(true);
    expect(peashooter.trim.length).toBeGreaterThan(0);
    expect(peashooter.eyes?.length).toBeGreaterThan(0);
    // The muzzle rides on the head, at the front (+X) of it.
    expect(peashooter.muzzle).toMatchObject({ part: 'head' });
    const at = (peashooter.muzzle as { at: [number, number, number] }).at;
    expect(at[0]).toBeGreaterThan(4);
    expect(at[1]).toBeGreaterThan(8);
  });

  it('loops every looping clip without a seam, on its real parts', () => {
    const names = peashooter.parts.map((p) => p.name);
    const looping = Object.values(peashooter.clips).filter((clip) => clip.loop);
    expect(looping.length).toBe(2);
    for (const clip of looping) expectSamePose(sampled(clip, 0, names), sampled(clip, clip.duration, names));
  });

  it('animates only parts it has', () => {
    const names = new Set(peashooter.parts.map((p) => p.name));
    const seen = new Proxy({} as Pose, {
      get(_target, name) {
        if (typeof name === 'string' && !names.has(name)) throw new Error(`clip asks for unknown part ${name}`);
        return { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, s: 1, sx: 1, sy: 1, sz: 1 };
      },
    });
    for (const clip of Object.values(peashooter.clips)) expect(() => clip.sample(clip.duration / 3, seen)).not.toThrow();
  });

  it('has a head that is 40 to 50 percent of its height', () => {
    const model = buildParts(peashooter, 1);
    model.updateMatrixWorld(true);
    const whole = new Box3().setFromObject(model, true);
    // The head as it was modelled, before it is tipped back and turned: its own boxes,
    // without the eyes that sit on it and the sprout that rises behind.
    const head = model.getObjectByName('head') as Object3D;
    const box = new Box3();
    for (const child of head.children) if (child instanceof Mesh) box.union(child.geometry.boundingBox as Box3);
    const share = (box.max.y - box.min.y) / (whole.max.y - whole.min.y);
    expect(share).toBeGreaterThanOrEqual(0.4);
    expect(share).toBeLessThanOrEqual(0.5);
  });

  it('has black eyes with a white glint, on both sides of the head', () => {
    const colors = modelColors(peashooter, 1);
    expect(colors).toContain(hex('eye'));
    expect(colors).toContain(hex('eyeGlint'));
    const model = buildParts(peashooter, 1);
    model.updateMatrixWorld(true);
    const eyes = new Box3();
    for (const name of peashooter.eyes as string[]) eyes.expandByObject(model.getObjectByName(name) as Object3D, true);
    // One on each flank, so the camera in front of the lawn always sees an eye.
    expect(eyes.max.z).toBeGreaterThan(3 * VOXEL);
    expect(eyes.min.z).toBeLessThan(-3 * VOXEL);
    // In the upper half of the head, towards the front.
    const head = new Box3();
    for (const child of (model.getObjectByName('head') as Object3D).children) if (child instanceof Mesh) head.expandByObject(child, true);
    expect((eyes.min.y + eyes.max.y) / 2).toBeGreaterThanOrEqual((head.min.y + head.max.y) / 2);
    expect(eyes.max.y).toBeLessThan(head.max.y);
  });
});

describe('ModelInstance', () => {
  it('starts on idle, and returns to it after a one-shot, calling onDone once', () => {
    const instance = new ModelInstance(peashooter, 1);
    expect(instance.clip).toBe('idle');
    const onDone = vi.fn();
    instance.play('shoot', { onDone });
    expect(instance.clip).toBe('shoot');
    run(instance, 0.3);
    expect(instance.clip).toBe('shoot');
    expect(onDone).not.toHaveBeenCalled();
    run(instance, 0.2);
    expect(instance.clip).toBe('idle');
    expect(onDone).toHaveBeenCalledTimes(1);
    run(instance, 2);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(instance.clip).toBe('idle');
  });

  it('finishes a one-shot in a single long update too', () => {
    const instance = new ModelInstance(peashooter, 2);
    const onDone = vi.fn();
    instance.play('shoot', { onDone });
    instance.update(0.5);
    expect(instance.clip).toBe('idle');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('plays faster with a speed, and returns to the last looping clip, not always idle', () => {
    const instance = new ModelInstance(peashooter, 1);
    instance.play('cheer');
    expect(instance.clip).toBe('cheer');
    const onDone = vi.fn();
    instance.play('shoot', { speed: 2, onDone });
    run(instance, 0.25);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(instance.clip).toBe('cheer');
  });

  it('calls onDone once when another one-shot cuts a one-shot short, and once more for the second', () => {
    const instance = new ModelInstance(peashooter, 1);
    const shot = vi.fn();
    const hit = vi.fn();
    instance.play('shoot', { onDone: shot });
    run(instance, 0.1);
    expect(shot).not.toHaveBeenCalled();
    instance.play('hit', { onDone: hit });
    // The shot is over: told so at once, and never again.
    expect(shot).toHaveBeenCalledTimes(1);
    expect(hit).not.toHaveBeenCalled();
    expect(instance.clip).toBe('hit');
    run(instance, 0.3);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(instance.clip).toBe('idle');
    run(instance, 1);
    expect(shot).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledTimes(1);

    // The same clip again counts as another one-shot.
    const first = vi.fn();
    const second = vi.fn();
    instance.play('shoot', { onDone: first });
    run(instance, 0.1);
    instance.play('shoot', { onDone: second });
    expect(first).toHaveBeenCalledTimes(1);
    run(instance, 0.2);
    expect(second).not.toHaveBeenCalled();
    run(instance, 0.3);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('lets a one-shot play out when a looping clip is asked for, and returns to that clip', () => {
    const instance = new ModelInstance(peashooter, 1);
    const onDone = vi.fn();
    instance.play('shoot', { onDone });
    run(instance, 0.1);
    instance.play('cheer');
    // Still shooting; nothing was cut short.
    expect(instance.clip).toBe('shoot');
    expect(onDone).not.toHaveBeenCalled();
    run(instance, 0.2);
    expect(instance.clip).toBe('shoot');
    run(instance, 0.2);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(instance.clip).toBe('cheer');
    // Asked back to idle between one-shots, it goes at once.
    instance.play('idle');
    expect(instance.clip).toBe('idle');
  });

  it('ignores every clip once die has started', () => {
    const instance = new ModelInstance(peashooter, 1);
    const died = vi.fn();
    const later = vi.fn();
    instance.play('die', { onDone: died });
    run(instance, 0.1);
    instance.play('shoot', { onDone: later });
    instance.play('idle');
    instance.play('walk', { onDone: later });
    instance.play('die', { onDone: later });
    expect(instance.clip).toBe('die');
    expect(died).not.toHaveBeenCalled();
    run(instance, 0.2);
    // It died once, on time, and stays down.
    expect(died).toHaveBeenCalledTimes(1);
    const drooped = part(instance, 'stem').scale.y;
    expect(drooped).toBeLessThan(0.8);
    instance.play('cheer');
    instance.play('spawn', { onDone: later });
    run(instance, 1);
    expect(instance.clip).toBe('die');
    expect(part(instance, 'stem').scale.y).toBeCloseTo(drooped, 9);
    expect(later).not.toHaveBeenCalled();
    expect(died).toHaveBeenCalledTimes(1);
  });

  it('dies in the middle of another one-shot, ending that one', () => {
    const instance = new ModelInstance(peashooter, 1);
    const shot = vi.fn();
    const died = vi.fn();
    instance.play('shoot', { onDone: shot });
    run(instance, 0.1);
    instance.play('die', { onDone: died });
    expect(shot).toHaveBeenCalledTimes(1);
    run(instance, 0.5);
    expect(died).toHaveBeenCalledTimes(1);
    expect(shot).toHaveBeenCalledTimes(1);
    expect(instance.clip).toBe('die');
  });

  it('holds the last pose of a one-shot it was sought to the end of, until time moves again', () => {
    const instance = new ModelInstance(peashooter, 1);
    const onDone = vi.fn();
    instance.play('hit', { onDone });
    instance.seek(0.2);
    for (let i = 0; i < 5; i++) instance.update(0);
    expect(instance.clip).toBe('hit');
    expect(onDone).not.toHaveBeenCalled();
    instance.update(1 / 60);
    expect(instance.clip).toBe('idle');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does not restart a looping clip that is already playing', () => {
    const instance = new ModelInstance(peashooter, 1);
    instance.play('cheer');
    run(instance, 0.3); // the top of the jump
    const height = part(instance, 'root').position.y;
    expect(height).toBeGreaterThan(VOXEL);
    instance.play('cheer');
    instance.update(0);
    expect(part(instance, 'root').position.y).toBeCloseTo(height, 9);
  });

  it('holds the last frame of die instead of standing up again', () => {
    const instance = new ModelInstance(peashooter, 1);
    const onDone = vi.fn();
    instance.play('die', { onDone });
    run(instance, 0.5);
    expect(instance.clip).toBe('die');
    expect(onDone).toHaveBeenCalledTimes(1);
    const drooped = part(instance, 'stem').scale.y;
    expect(drooped).toBeLessThan(0.8);
    run(instance, 1);
    expect(part(instance, 'stem').scale.y).toBeCloseTo(drooped, 9);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('tells a caller at once when the model has no such clip, and carries on', () => {
    const instance = new ModelInstance(peashooter, 1);
    const onDone = vi.fn();
    instance.play('walk', { onDone });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(instance.clip).toBe('idle');
    const still = new ModelInstance(biped(), 1);
    expect(still.clip).toBeNull();
    expect(() => run(still, 0.2)).not.toThrow();
  });

  it('cross-fades over 100 ms instead of jumping to the new clip', () => {
    const instance = new ModelInstance(peashooter, 1);
    instance.seek(0);
    const stem = part(instance, 'stem');
    const before = stem.position.y;
    instance.play('cheer');
    instance.seek(0.3);
    const jumping = part(instance, 'root').position.y;
    expect(jumping).toBeGreaterThan(2 * VOXEL);

    const fading = new ModelInstance(peashooter, 1);
    fading.seek(0);
    fading.play('die');
    fading.update(0);
    // Nothing has moved yet on the frame the clip changes.
    expect(part(fading, 'stem').position.y).toBeCloseTo(before, 9);
    expect(part(fading, 'stem').scale.y).toBeCloseTo(1, 9);
    fading.update(0.05);
    const half = part(fading, 'stem').scale.y;
    fading.update(0.05);
    fading.update(0.1);
    const full = part(fading, 'stem').scale.y;
    expect(full).toBeLessThan(0.8);
    // Half way through the fade the pose lies between where it was and where the clip is.
    const unfaded = new ModelInstance(peashooter, 1);
    unfaded.play('die');
    unfaded.seek(0.05);
    expect(half).toBeGreaterThan(part(unfaded, 'stem').scale.y);
    expect(half).toBeLessThan(1);
  });

  it('applies a pose about each part pivot, in voxels and radians', () => {
    const swing: Clip = {
      duration: 1,
      loop: true,
      sample(_t, pose) {
        const leg = pose.legL;
        if (leg) leg.rz = Math.PI / 2;
        const hips = pose.hips;
        if (hips) hips.py = 2;
        const torso = pose.torso;
        if (torso) {
          torso.rz = 0.1;
          torso.s = 2;
          torso.sy = 0.5;
        }
      },
    };
    const instance = new ModelInstance(biped({ idle: swing }), 1);
    instance.seek(0);
    instance.root.updateMatrixWorld(true);
    // The hips rose two voxels and took the legs with them.
    expect(part(instance, 'hips').position.y).toBeCloseTo((6 + 2) * VOXEL, 9);
    // The left leg swung a quarter turn about its hip: it now points along +X at hip height.
    const box = new Box3().setFromObject(part(instance, 'legL'), true);
    expect(box.max.y).toBeCloseTo((5 + 2 + 1) * VOXEL, 6);
    expect(box.min.y).toBeCloseTo((5 + 2 - 1) * VOXEL, 6);
    expect(box.max.x).toBeCloseTo(5 * VOXEL, 6);
    // The right leg did not move.
    expect(new Box3().setFromObject(part(instance, 'legR'), true).min.y).toBeCloseTo(2 * VOXEL, 6);
    // Offsets add to the rest pose.
    const torso = part(instance, 'torso');
    expect(torso.rotation.z).toBeCloseTo((10 * Math.PI) / 180 + 0.1, 9);
    expect(torso.scale.toArray()).toEqual([2, 1, 2]);
  });

  it('turns a part about its own axes, so a slouched torso rolls about its own spine line', () => {
    // The torso rests pitched 10 degrees. A clip then rolls it a quarter turn about its own
    // X axis, which the pitch has tilted: its up axis must end exactly on world Z, and its X
    // axis must stay where the pitch left it. Adding the angles up instead would roll it
    // about the hips' X axis and leave it leaning.
    const roll: Clip = {
      duration: 1,
      loop: true,
      parts: ['torso'],
      sample(_t, pose) {
        const torso = pose.torso;
        if (torso) torso.rx = Math.PI / 2;
      },
    };
    const instance = new ModelInstance(biped({ idle: roll }), 1);
    instance.seek(0);
    const torso = part(instance, 'torso');
    const lean = (10 * Math.PI) / 180;
    const up = new Vector3(0, 1, 0).applyQuaternion(torso.quaternion);
    const forward = new Vector3(1, 0, 0).applyQuaternion(torso.quaternion);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(0, 9);
    expect(up.z).toBeCloseTo(1, 9);
    expect(forward.x).toBeCloseTo(Math.cos(lean), 9);
    expect(forward.y).toBeCloseTo(Math.sin(lean), 9);
    expect(forward.z).toBeCloseTo(0, 9);
    // With no offset from the clip it rests exactly as built.
    const still = new ModelInstance(biped(), 1);
    expect(part(still, 'torso').rotation.z).toBeCloseTo(lean, 12);
    expect(part(still, 'torso').rotation.x).toBeCloseTo(0, 12);
  });

  it('blinks: the eyes close to a tenth of their height for 100 ms every 2 to 5 s', () => {
    const instance = new ModelInstance(peashooter, 1);
    const eye = part(instance, (peashooter.eyes as string[])[0] as string);
    const closedAt: number[] = [];
    let closedFrames = 0;
    let wasClosed = false;
    const dt = 1 / 120;
    for (let frame = 0; frame < 120 * 30; frame++) {
      instance.update(dt);
      const closed = eye.scale.y < 0.5;
      if (closed) {
        expect(eye.scale.y).toBeCloseTo(0.1, 6);
        closedFrames++;
        if (!wasClosed) closedAt.push(frame * dt);
      } else {
        expect(eye.scale.y).toBeCloseTo(1, 6);
      }
      wasClosed = closed;
    }
    expect(closedAt.length).toBeGreaterThanOrEqual(6);
    expect(closedAt.length).toBeLessThanOrEqual(15);
    expect(closedAt[0]).toBeGreaterThanOrEqual(1.9);
    for (let i = 1; i < closedAt.length; i++) {
      const gap = (closedAt[i] as number) - (closedAt[i - 1] as number);
      expect(gap).toBeGreaterThanOrEqual(2);
      expect(gap).toBeLessThanOrEqual(5.2);
    }
    // 100 ms each.
    expect(closedFrames / closedAt.length / 120).toBeCloseTo(0.1, 1);
  });

  it('gives each unit its own blink and idle timing', () => {
    const firstBlink = (instance: ModelInstance): number => {
      const eye = part(instance, (peashooter.eyes as string[])[0] as string);
      for (let frame = 0; frame < 60 * 6; frame++) {
        instance.update(1 / 60);
        if (eye.scale.y < 0.5) return frame;
      }
      return -1;
    };
    const a = new ModelInstance(peashooter, 1);
    const b = new ModelInstance(peashooter, 1);
    expect(part(a, 'stem').position.y).not.toBeCloseTo(part(b, 'stem').position.y, 6);
    expect(firstBlink(a)).not.toBe(firstBlink(b));
  });

  it('seeks to an exact clip time with the eyes open, for stills', () => {
    const a = new ModelInstance(peashooter, 1);
    const b = new ModelInstance(peashooter, 1);
    run(b, 3.3);
    for (const instance of [a, b]) {
      instance.play('shoot');
      instance.seek(0.12);
    }
    for (const name of peashooter.parts.map((p) => p.name)) {
      expect(part(a, name).position.toArray(), name).toEqual(part(b, name).position.toArray());
      expect(part(a, name).rotation.toArray(), name).toEqual(part(b, name).rotation.toArray());
      expect(part(a, name).scale.toArray(), name).toEqual(part(b, name).scale.toArray());
    }
    expect(part(a, 'stem').rotation.z).toBeGreaterThan(0.1);
    // Seeking stays put while no time passes.
    const leaning = part(a, 'stem').rotation.z;
    a.update(0);
    expect(part(a, 'stem').rotation.z).toBe(leaning);
  });

  it('flashes white on its own materials and goes back to the shared ones', () => {
    const a = new ModelInstance(peashooter, 3);
    const b = new ModelInstance(peashooter, 3);
    const shared = meshes(a.root).map((mesh) => mesh.material);
    expect(meshes(b.root).map((mesh) => mesh.material)).toEqual(shared);

    a.setFlash(1);
    for (const [i, mesh] of meshes(a.root).entries()) {
      const material = mesh.material as MeshStandardMaterial;
      expect(material).not.toBe(shared[i]);
      expect(material.emissive.r * material.emissiveIntensity).toBeGreaterThanOrEqual(0.8);
      expect(material.emissive.g * material.emissiveIntensity).toBeGreaterThanOrEqual(0.8);
      expect(material.emissive.b * material.emissiveIntensity).toBeGreaterThanOrEqual(0.8);
      expect(material.metalness).toBe((shared[i] as MeshStandardMaterial).metalness);
    }
    // The neighbour is untouched.
    expect(meshes(b.root).map((mesh) => mesh.material)).toEqual(shared);

    a.setFlash(0.5);
    const half = meshes(a.root)[0]?.material as MeshStandardMaterial;
    expect(half.emissive.r * half.emissiveIntensity).toBeGreaterThan(0.2);
    expect(half.emissive.r * half.emissiveIntensity).toBeLessThan(0.8);

    a.setFlash(0);
    expect(meshes(a.root).map((mesh) => mesh.material)).toEqual(shared);

    // A flashing crystal still glows in its baked colours: its copy keeps the shader change.
    const crystal = new ModelInstance(peashooter, 4);
    const before = meshes(crystal.root).map((mesh) => mesh.material as MeshStandardMaterial);
    crystal.setFlash(0.5);
    meshes(crystal.root).forEach((mesh, i) => {
      const own = mesh.material as MeshStandardMaterial;
      expect(own.onBeforeCompile, own.name).toBe(before[i]?.onBeforeCompile);
      expect(own.customProgramCacheKey(), own.name).toBe(before[i]?.customProgramCacheKey());
    });
  });

  it('frees only what it owns on dispose', () => {
    const a = new ModelInstance(peashooter, 4);
    const b = new ModelInstance(peashooter, 4);
    const scene = new Scene();
    scene.add(a.root, b.root);
    const geometries = meshes(a.root).map((mesh) => mesh.geometry);
    const shared = meshes(a.root).map((mesh) => mesh.material as MeshStandardMaterial);
    const geometrySpies = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'));
    const sharedSpies = shared.map((material) => vi.spyOn(material, 'dispose'));

    a.setFlash(1);
    const own = [...new Set(meshes(a.root).map((mesh) => mesh.material as MeshStandardMaterial))];
    const ownSpies = own.map((material) => vi.spyOn(material, 'dispose'));
    a.dispose();

    for (const spy of ownSpies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of geometrySpies) expect(spy).not.toHaveBeenCalled();
    for (const spy of sharedSpies) expect(spy).not.toHaveBeenCalled();
    expect(a.root.parent).toBeNull();
    expect(b.root.parent).toBe(scene);
    // Disposing twice is harmless, and a new instance still draws with the shared geometry.
    expect(() => a.dispose()).not.toThrow();
    expect(meshes(new ModelInstance(peashooter, 4).root).map((mesh) => mesh.geometry)).toEqual(geometries);
    for (const spy of [...geometrySpies, ...sharedSpies]) spy.mockRestore();
  });

  it('changes level in place: same transform, same parent, same clip and time', () => {
    const scene = new Scene();
    const old = new ModelInstance(peashooter, 2);
    scene.add(old.root);
    old.root.position.set(3.5, 0, 2.5);
    old.root.rotation.y = 0.4;
    old.root.scale.setScalar(1.2);
    old.play('cheer');
    run(old, 0.2);
    const onDone = vi.fn();
    old.play('shoot', { onDone });
    run(old, 0.2);

    const next = old.setLevel(3);
    expect(next).not.toBe(old);
    expect(next.level).toBe(3);
    expect(next.def).toBe(old.def);
    expect(next.root.position.toArray()).toEqual([3.5, 0, 2.5]);
    expect(next.root.rotation.y).toBeCloseTo(0.4, 12);
    expect(next.root.scale.x).toBe(1.2);
    expect(next.root.parent).toBe(scene);
    expect(old.root.parent).toBeNull();
    expect(next.clip).toBe('shoot');
    // The pose carries over exactly: only the level changed.
    for (const name of peashooter.parts.map((p) => p.name)) {
      expect(part(next, name).rotation.z, name).toBeCloseTo(part(old, name).rotation.z, 9);
      expect(part(next, name).position.x, name).toBeCloseTo(part(old, name).position.x, 9);
    }
    run(next, 0.25);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(next.clip).toBe('cheer');
    expect(old.setLevel(2)).toBe(old);
  });

  it('reports where shots leave: on the head, following its turn, the shot and the level', () => {
    const scene = new Scene();
    const instance = new ModelInstance(peashooter, 1);
    scene.add(instance.root);
    instance.root.position.set(2.5, 0, 1.5);
    instance.play('shoot');
    instance.seek(0); // the first frame of the shot is the rest pose
    const out = new Vector3();
    expect(instance.muzzleWorld(out)).toBe(out);
    const rest = out.clone();
    // In front of the plant and up at its mouth; the head is turned to the player, so a little towards +Z.
    expect(rest.x).toBeGreaterThan(2.5 + 4 * VOXEL);
    expect(rest.x).toBeLessThan(2.5 + 6.5 * VOXEL);
    expect(rest.y).toBeGreaterThan(10 * VOXEL);
    expect(rest.y).toBeLessThan(14 * VOXEL);
    expect(rest.z).toBeGreaterThan(1.5 + 0.5 * VOXEL);
    expect(rest.z).toBeLessThan(1.5 + 3 * VOXEL);

    // It moves with the head: back as the plant winds up, forward as it snaps.
    instance.seek(0.12);
    expect(instance.muzzleWorld(new Vector3()).x).toBeLessThan(rest.x - VOXEL);
    instance.seek(0.2);
    expect(instance.muzzleWorld(new Vector3()).x).toBeGreaterThan(rest.x + VOXEL);

    // It follows the root, and the level's size.
    instance.seek(0);
    instance.root.position.x += 1;
    expect(instance.muzzleWorld(new Vector3()).x).toBeCloseTo(rest.x + 1, 9);
    const big = new ModelInstance(peashooter, 5);
    big.play('shoot');
    big.seek(0);
    const offset = big.muzzleWorld(new Vector3());
    expect(offset.x).toBeCloseTo((rest.x - 2.5) * 1.34, 6);
    expect(offset.y).toBeCloseTo(rest.y * 1.34, 6);
    expect(offset.z).toBeCloseTo((rest.z - 1.5) * 1.34, 6);
  });

  it('also takes a muzzle as a plain point on the model, and answers with its feet if it has none', () => {
    const def = biped();
    def.key = 'test-muzzle-point';
    def.muzzle = [3, 5, -1];
    const gun = new ModelInstance(def, 1);
    gun.root.position.set(1, 0, 2);
    const out = gun.muzzleWorld(new Vector3());
    expect(out.x).toBeCloseTo(1 + 3 * VOXEL, 9);
    expect(out.y).toBeCloseTo(5 * VOXEL, 9);
    expect(out.z).toBeCloseTo(2 - VOXEL, 9);
    const plain = new ModelInstance(biped(), 1);
    plain.root.position.set(1, 0, 2);
    expect(plain.muzzleWorld(new Vector3()).toArray()).toEqual([1, 0, 2]);
  });

  it('keeps its root free for the game: the level scale lives one step inside', () => {
    const instance = new ModelInstance(peashooter, 5);
    expect(instance.root.scale.toArray()).toEqual([1, 1, 1]);
    expect(instance.root.children[0]?.scale.x).toBe(LEVEL_SCALE[5]);
    expect(instance.root.getObjectByName('aura')).toBeInstanceOf(Group);
  });
});

describe('registry', () => {
  it('knows the Peashooter', () => {
    expect(hasModel('peashooter')).toBe(true);
    expect(getModelDef('peashooter')).toBe(peashooter);
    expect(modelKeys()).toContain('peashooter');
  });

  it('throws on an unknown key', () => {
    expect(hasModel('nope')).toBe(false);
    expect(() => getModelDef('nope')).toThrow(/nope/);
  });

  it('registers a new model by its key', () => {
    const def = biped();
    def.key = 'test-registered';
    registerModel(def);
    expect(hasModel('test-registered')).toBe(true);
    expect(getModelDef('test-registered')).toBe(def);
    expect(modelKeys().indexOf('peashooter')).toBeLessThan(modelKeys().indexOf('test-registered'));
  });
});
