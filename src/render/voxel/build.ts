import { Euler, Group, MathUtils, Matrix4, Mesh, type BufferGeometry } from 'three';
import { disposeMaterials, glowKey, sharedMaterial, type MaterialKey } from './materials';
import { findSharedSurface, meshPart, type Shape, type Solid } from './mesh';
import { LEVEL_MATERIALS, LEVEL_SCALE, MAX_LEVEL, PALETTE, levelMaterial, type LevelMaterial } from './palette';
import type { Box, ColorRef, ModelDef, PartDef } from './types';

// Turns a model definition into objects to draw. Each part becomes a group that turns about
// its pivot; inside it, the part's boxes are merged into one mesh per material (see
// mesh.ts). What is built is kept, so every instance of a model at a level shares the same
// geometry.

/** Edge of one character voxel, in tiles. */
export const VOXEL = 1 / 16;

type Vec3 = [number, number, number];

interface BuiltPart {
  name: string;
  hidden: boolean;
  /** Index of the parent in the built list, or −1 for a part that hangs from the model itself. */
  parent: number;
  /** Rest position (tiles, in the parent's space) and rest turn (radians). */
  position: Vec3;
  rotation: Vec3;
  meshes: { material: MaterialKey; geometry: BufferGeometry }[];
}

interface Built {
  parts: BuiltPart[];
  colors: number[];
  meshes: number;
  triangles: number;
}

/** Built models by definition, then by level. Geometry in here is shared by every instance. */
const cache = new Map<ModelDef, (Built | undefined)[]>();

// ---- Reading the definition ---------------------------------------------------------------

/** Which level material a palette name belongs to, if any. */
const TONE_OWNER = new Map<string, Exclude<LevelMaterial, 'none'>>();
for (const [name, def] of Object.entries(LEVEL_MATERIALS)) {
  for (const tone of def.tones) TONE_OWNER.set(tone, name as Exclude<LevelMaterial, 'none'>);
}

function toHex(def: ModelDef, ref: ColorRef, where: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(ref)) return ref.toUpperCase();
  const hex = ref.startsWith('#') ? undefined : PALETTE[ref];
  if (!hex) throw new Error(`Model "${def.key}", ${where}: unknown colour "${ref}" (use a palette name or #RRGGBB)`);
  return hex;
}

function activeAt(box: Box, level: number): boolean {
  return (box.minLevel ?? 1) <= level && level <= (box.maxLevel ?? MAX_LEVEL);
}

/** The colour and material of a box at a level: trim becomes the level material from level 3. */
function paintOf(def: ModelDef, box: Box, level: number, where: string): { hex: string; material: MaterialKey } {
  let ref = box.color;
  const trim = def.trim.indexOf(ref);
  const upgrade = levelMaterial(level);
  if (trim >= 0 && upgrade !== 'none') ref = LEVEL_MATERIALS[upgrade].tones[Math.min(trim, 1)] as string;
  const hex = toHex(def, ref, where);
  if (box.emissive && box.emissive > 0) return { hex, material: glowKey(box.emissive) };
  return { hex, material: TONE_OWNER.get(ref) ?? 'plain' };
}

/** Checks a definition once and returns its parts with parents before children. */
function ordered(def: ModelDef): PartDef[] {
  const byName = new Map<string, PartDef>();
  for (const part of def.parts) {
    if (byName.has(part.name)) throw new Error(`Model "${def.key}": two parts are named "${part.name}"`);
    byName.set(part.name, part);
  }
  for (const reserved of [def.key, 'aura']) {
    if (byName.has(reserved)) throw new Error(`Model "${def.key}": a part cannot be named "${reserved}"`);
  }
  for (const eye of def.eyes ?? []) {
    if (!byName.has(eye)) throw new Error(`Model "${def.key}": eyes names "${eye}", which is not a part`);
  }
  if (def.muzzle && !Array.isArray(def.muzzle)) {
    if (!byName.has(def.muzzle.part)) {
      throw new Error(`Model "${def.key}": the muzzle is on "${def.muzzle.part}", which is not a part`);
    }
    for (const level of Object.keys(def.muzzle.atLevel ?? {})) {
      const n = Number(level);
      if (!Number.isInteger(n) || n < 2 || n > MAX_LEVEL) {
        throw new Error(`Model "${def.key}": the muzzle's atLevel lists level ${level}; use whole levels from 2 to ${MAX_LEVEL}`);
      }
    }
  }
  for (const [name, clip] of Object.entries(def.clips)) {
    for (const moved of clip.parts ?? []) {
      if (!byName.has(moved)) {
        throw new Error(`Model "${def.key}": clip "${name}" moves "${moved}", which is not a part (a misspelt name?)`);
      }
    }
  }
  if (def.trim.length > 2) {
    throw new Error(
      `Model "${def.key}": trim lists ${def.trim.length} colours, but takes at most two (a main tone and a shadow tone)`,
    );
  }
  def.trim.forEach((ref) => toHex(def, ref, 'trim'));
  const wholeLevel = (value: number | undefined): boolean =>
    value === undefined || (Number.isInteger(value) && value >= 1 && value <= MAX_LEVEL);
  for (const part of def.parts) {
    for (const other of part.shadedBy ?? []) {
      if (!byName.has(other) || other === part.name) {
        throw new Error(`Model "${def.key}": part "${part.name}" is shaded by "${other}", which is not another part`);
      }
    }
    part.boxes.forEach((box, i) => {
      const where = `part "${part.name}" box ${i}`;
      toHex(def, box.color, where);
      if (!(box.size[0] > 0 && box.size[1] > 0 && box.size[2] > 0)) {
        throw new Error(`Model "${def.key}", ${where}: size must be positive on every axis`);
      }
      if (!wholeLevel(box.minLevel)) {
        throw new Error(`Model "${def.key}", ${where}: minLevel must be a whole level from 1 to ${MAX_LEVEL}, not ${box.minLevel}`);
      }
      if (!wholeLevel(box.maxLevel)) {
        throw new Error(`Model "${def.key}", ${where}: maxLevel must be a whole level from 1 to ${MAX_LEVEL}, not ${box.maxLevel}`);
      }
      if ((box.minLevel ?? 1) > (box.maxLevel ?? MAX_LEVEL)) {
        throw new Error(`Model "${def.key}", ${where}: minLevel ${box.minLevel} is above maxLevel ${box.maxLevel}, so the box never shows`);
      }
    });
  }

  const out: PartDef[] = [];
  const state = new Map<PartDef, 'visiting' | 'done'>();
  const visit = (part: PartDef): void => {
    const seen = state.get(part);
    if (seen === 'done') return;
    if (seen === 'visiting') throw new Error(`Model "${def.key}": part "${part.name}" is its own ancestor`);
    state.set(part, 'visiting');
    if (part.parent !== undefined) {
      const parent = byName.get(part.parent);
      if (!parent) throw new Error(`Model "${def.key}": part "${part.name}" has unknown parent "${part.parent}"`);
      visit(parent);
    }
    state.set(part, 'done');
    out.push(part);
  };
  def.parts.forEach(visit);
  return out;
}

const euler = new Euler();
const turnMatrix = new Matrix4();

function build(def: ModelDef, level: number): Built {
  const parts = ordered(def);
  const shapes: Shape[] = [];
  const builtParts: BuiltPart[] = [];
  const volume = new Map<number, number>();

  for (const part of parts) {
    const parent = part.parent === undefined ? -1 : parts.findIndex((p) => p.name === part.parent);
    const parentPivot: Vec3 = parent < 0 ? [0, 0, 0] : (parts[parent] as PartDef).pivot;
    const position: Vec3 = [
      (part.pivot[0] - parentPivot[0]) * VOXEL,
      (part.pivot[1] - parentPivot[1]) * VOXEL,
      (part.pivot[2] - parentPivot[2]) * VOXEL,
    ];
    const rot = part.rot ?? [0, 0, 0];
    const rotation: Vec3 = [MathUtils.degToRad(rot[0]), MathUtils.degToRad(rot[1]), MathUtils.degToRad(rot[2])];

    // The same transform in voxels, for probing other parts at rest.
    const toModel = new Matrix4()
      .makeTranslation(part.pivot[0] - parentPivot[0], part.pivot[1] - parentPivot[1], part.pivot[2] - parentPivot[2])
      .multiply(turnMatrix.makeRotationFromEuler(euler.set(rotation[0], rotation[1], rotation[2])));
    if (parent >= 0) toModel.premultiply((shapes[parent] as Shape).toModel);

    const solids: Solid[] = [];
    part.boxes.forEach((box, i) => {
      if (!activeAt(box, level)) return;
      const { hex, material } = paintOf(def, box, level, `part "${part.name}" box ${i}`);
      solids.push({
        box: i,
        min: [box.at[0], box.at[1], box.at[2]],
        max: [box.at[0] + box.size[0], box.at[1] + box.size[1], box.at[2] + box.size[2]],
        hex,
        material,
      });
      const number = parseInt(hex.slice(1), 16);
      volume.set(number, (volume.get(number) ?? 0) + box.size[0] * box.size[1] * box.size[2]);
    });

    shapes.push({ def: part, solids, shadedBy: [], toModel, fromModel: toModel.clone().invert() });
    builtParts.push({ name: part.name, hidden: part.hidden === true, parent, position, rotation, meshes: [] });
  }
  for (const shape of shapes) {
    shape.shadedBy = (shape.def.shadedBy ?? []).map((name) => shapes.find((other) => other.def.name === name) as Shape);
  }

  const clash = findSharedSurface(shapes);
  if (clash) {
    throw new Error(
      `Model "${def.key}": box ${clash.one.box} of part "${clash.a.def.name}" (${clash.one.hex}) and box ${clash.other.box} ` +
        `of part "${clash.b.def.name}" (${clash.other.hex}) share a surface at level ${level} and would flicker. Move one ` +
        `of them a fraction of a voxel, make them touch face to face instead of overlapping, or make one of ` +
        `the two boxes a fraction narrower (the usual fix where one part is turned).`,
    );
  }

  let meshes = 0;
  let triangles = 0;
  shapes.forEach((shape, i) => {
    for (const [material, batch] of meshPart(shape, VOXEL)) {
      if (batch.quadCount === 0) continue;
      (builtParts[i] as BuiltPart).meshes.push({ material, geometry: batch.build() });
      meshes++;
      triangles += batch.quadCount * 2;
    }
  });

  const colors = [...volume.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  return { parts: builtParts, colors, meshes, triangles };
}

function builtFor(def: ModelDef, level: number): Built {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new RangeError(`Model "${def.key}": level must be a whole number from 1 to ${MAX_LEVEL}, not ${level}`);
  }
  let levels = cache.get(def);
  if (!levels) cache.set(def, (levels = []));
  return (levels[level] ??= build(def, level));
}

/**
 * A new model at `level`: a group named after the model's key and scaled by the level,
 * holding one group per part (named after the part, nested under its parent, turning about
 * its pivot) with one mesh per material inside. Geometry and materials are shared between
 * all models built from the same definition and level; the groups are the caller's own.
 * Level 5 also carries an empty group named `aura` for effects to fill.
 */
export function buildParts(def: ModelDef, level: number): Group {
  const built = builtFor(def, level);
  const root = new Group();
  root.name = def.key;
  root.scale.setScalar(LEVEL_SCALE[level] as number);

  const groups: Group[] = [];
  for (const part of built.parts) {
    const group = new Group();
    group.name = part.name;
    group.position.set(part.position[0], part.position[1], part.position[2]);
    group.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
    group.visible = !part.hidden;
    for (const piece of part.meshes) {
      const mesh = new Mesh(piece.geometry, sharedMaterial(piece.material));
      mesh.name = `${part.name}:${piece.material}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    (part.parent < 0 ? root : (groups[part.parent] as Group)).add(group);
    groups.push(group);
  }

  if (level === MAX_LEVEL) {
    const aura = new Group();
    aura.name = 'aura';
    root.add(aura);
  }
  return root;
}

/** The model's distinct colours at `level` as 0xRRGGBB, the most plentiful first. For debris. */
export function modelColors(def: ModelDef, level: number): number[] {
  return [...builtFor(def, level).colors];
}

/** What one model at `level` costs to draw: a draw call per mesh (and one more each for its shadow). */
export function modelStats(def: ModelDef, level: number): { meshes: number; triangles: number } {
  const { meshes, triangles } = builtFor(def, level);
  return { meshes, triangles };
}

/**
 * Builds `def` at `level` and makes its materials, so that nothing is left to build when
 * the first one appears. `prewarmModels` in the registry does this for a list of keys.
 */
export function prewarmModel(def: ModelDef, level: number): void {
  for (const part of builtFor(def, level).parts) for (const piece of part.meshes) sharedMaterial(piece.material);
}

/**
 * Where a model's projectiles leave at `level`: the part the point rides on (none for a
 * bare point) and the point, in authored voxels. A model with no muzzle answers with its feet.
 */
export function muzzleOf(def: ModelDef, level: number): { part?: string; at: [number, number, number] } {
  const muzzle = def.muzzle;
  if (!muzzle) return { at: [0, 0, 0] };
  if (Array.isArray(muzzle)) return { at: muzzle };
  let at = muzzle.at;
  const table = muzzle.atLevel as Partial<Record<number, [number, number, number]>> | undefined;
  for (let from = 2; from <= level; from++) at = table?.[from] ?? at;
  return { part: muzzle.part, at };
}

/**
 * Frees every cached geometry and shared material, for a scene that is being torn down.
 * Models built before this must not be drawn again; the next build starts afresh.
 */
export function disposeModels(): void {
  for (const levels of cache.values()) {
    for (const built of levels) {
      if (!built) continue;
      for (const part of built.parts) for (const piece of part.meshes) piece.geometry.dispose();
    }
  }
  cache.clear();
  disposeMaterials();
}
