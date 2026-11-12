import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type ColorRepresentation,
} from 'three';
import { PLANT_BASE_X, ZOMBIE_BASE_X } from '../coords';
import { FX } from '../fx/fxPalette';
import { glowMaterial } from '../fx/glow';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import type { Faction } from '../types';
import { BoxBatch, hash2, paint } from '../world/boxes';
import { gravestone } from '../world/props';

// The two bases. Lukas's is a tree fortress: a broad tree whose trunk is a house, with a
// wooden door towards the lawn, a round lit window towards the camera, a lookout with a flag
// on top of the leaves, leafy towers at both ends and a log palisade between. Toby's is a
// crypt: a dark stone mausoleum with a glowing doorway, purple crystal spires on its roof
// and sides, and a crooked iron fence with gravestones in it along the lawn.
//
// Both are built in their own frame: x across the base's strip (towards the lawn is +x for
// the plants, −x for the zombies), z along the lanes, the origin in the middle of the strip.
// Most of each is made of 1/8-tile voxels, so that damage can bite chunks out of the leaves,
// the trunk, the walls and the roof; small parts are loose boxes. Each damage state is its
// own pair of merged meshes (plain and glowing), built once and switched.

/** The four damage states: health at or above 0.75, 0.5, 0.25, and below. */
export type DamageState = 0 | 1 | 2 | 3;
/** A fifth, built for the end: what is left standing after the collapse. */
const RUINS = 4;
type BuildState = DamageState | typeof RUINS;

/** Seconds of a hit's shudder, a strike's swat and the collapse. */
const SHUDDER_SECONDS = 0.3;
const FLASH_SECONDS = 0.08;
const STRIKE_SECONDS = 0.25;
const COLLAPSE_SECONDS = 1.6;
/** How long past the fall's own length the clock waits before ending it without `update`. */
const COLLAPSE_GRACE = 0.75;
/** Voxel edge for the bulk of each base. */
const V = 0.125;
/** Where the base's own frame begins: the strip's back-left corner. */
const OX = -0.8;
const OZ = -2.5;
/** Emissive intensities: the tree's lamp and the crypt's crystals and doorway. */
const LAMP_GLOW = 1.8;
const CRYPT_GLOW = 2.4;

const hex = (c: string): number => parseInt(c.slice(1), 16);

// ---- Building blocks ---------------------------------------------------------------------

function hash3(i: number, j: number, k: number, seed: number): number {
  return hash2(Math.imul(i, 7919) + Math.imul(k, 104729), j * 31 + k, seed);
}

/** Smooth 0..1 noise over a grid of cells, for damage that comes away in chunks. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const s = (t: number): number => t * t * (3 - 2 * t);
  const fx = s(x - x0);
  const fy = s(y - y0);
  const fz = s(z - z0);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const plane = (zz: number): number =>
    lerp(
      lerp(hash3(x0, y0, zz, seed), hash3(x0 + 1, y0, zz, seed), fx),
      lerp(hash3(x0, y0 + 1, zz, seed), hash3(x0 + 1, y0 + 1, zz, seed), fx),
      fy,
    );
  return lerp(plane(z0), plane(z0 + 1), fz);
}

/** One voxel: its colour, the colour of its top face, and whether it glows. */
interface Cell {
  color: number;
  top: number;
  glow: boolean;
}

const key = (i: number, j: number, k: number): number => ((i + 128) * 256 + (j + 128)) * 256 + (k + 128);

/**
 * A block of voxels, meshed greedily: neighbouring faces of the same colour that look the
 * same way merge into one quad, and faces between two voxels are never drawn.
 */
class Volume {
  private readonly cells = new Map<number, Cell>();
  private min = [Infinity, Infinity, Infinity];
  private max = [-Infinity, -Infinity, -Infinity];

  constructor(
    readonly size: number,
    readonly origin: readonly [number, number, number],
  ) {}

  get count(): number {
    return this.cells.size;
  }

  set(i: number, j: number, k: number, color: number, top = color, glow = false): void {
    this.cells.set(key(i, j, k), { color, top, glow });
    const at = [i, j, k];
    for (let a = 0; a < 3; a++) {
      this.min[a] = Math.min(this.min[a] as number, at[a] as number);
      this.max[a] = Math.max(this.max[a] as number, at[a] as number);
    }
  }

  has(i: number, j: number, k: number): boolean {
    return this.cells.has(key(i, j, k));
  }

  delete(i: number, j: number, k: number): void {
    this.cells.delete(key(i, j, k));
  }

  /** Adds every visible face to `b`, merged, and counts the voxels as boxes. */
  mesh(b: Builder): void {
    b.boxes += this.cells.size;
    if (this.cells.size === 0) return;
    const { size, origin, min, max } = this;
    const lo = min as [number, number, number];
    const hi = max as [number, number, number];
    const get = (c: [number, number, number]): Cell | undefined => this.cells.get(key(c[0], c[1], c[2]));
    // For a face along axis a, the face plane is spanned by axes u and v with u × v = +a.
    const axes: [number, number, number][] = [
      [0, 1, 2],
      [1, 2, 0],
      [2, 0, 1],
    ];
    const cell: [number, number, number] = [0, 0, 0];
    const next: [number, number, number] = [0, 0, 0];
    for (const [a, u, v] of axes) {
      const nu = (hi[u] as number) - (lo[u] as number) + 1;
      const nv = (hi[v] as number) - (lo[v] as number) + 1;
      const mask = new Float64Array(nu * nv);
      for (const sign of [1, -1]) {
        for (let s = lo[a] as number; s <= (hi[a] as number); s++) {
          mask.fill(-1);
          for (let iu = 0; iu < nu; iu++) {
            for (let iv = 0; iv < nv; iv++) {
              cell[a] = s;
              cell[u] = (lo[u] as number) + iu;
              cell[v] = (lo[v] as number) + iv;
              const here = get(cell);
              if (!here) continue;
              next[0] = cell[0];
              next[1] = cell[1];
              next[2] = cell[2];
              next[a] = s + sign;
              if (get(next)) continue;
              const color = a === 1 && sign > 0 ? here.top : here.color;
              mask[iu + iv * nu] = color * 2 + (here.glow ? 1 : 0);
            }
          }
          // Greedy rectangles of one colour.
          for (let iv = 0; iv < nv; iv++) {
            for (let iu = 0; iu < nu; ) {
              const m = mask[iu + iv * nu] as number;
              if (m < 0) {
                iu++;
                continue;
              }
              let w = 1;
              while (iu + w < nu && mask[iu + w + iv * nu] === m) w++;
              let h = 1;
              grow: while (iv + h < nv) {
                for (let x = 0; x < w; x++) if (mask[iu + x + (iv + h) * nu] !== m) break grow;
                h++;
              }
              for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[iu + x + (iv + y) * nu] = -1;
              const plane = (origin[a] as number) + (sign > 0 ? s + 1 : s) * size;
              const u0 = (origin[u] as number) + ((lo[u] as number) + iu) * size;
              const u1 = u0 + w * size;
              const v0 = (origin[v] as number) + ((lo[v] as number) + iv) * size;
              const v1 = v0 + h * size;
              const corner = (pu: number, pv: number): [number, number, number] => {
                const p: [number, number, number] = [0, 0, 0];
                p[a] = plane;
                p[u] = pu;
                p[v] = pv;
                return p;
              };
              const normal: [number, number, number] = [0, 0, 0];
              normal[a] = sign;
              const glow = m % 2 === 1;
              const tint = paint(Math.floor(m / 2));
              const batch = glow ? b.glow : b.solid;
              if (sign > 0) batch.quad(corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1), normal, tint);
              else batch.quad(corner(u0, v0), corner(u0, v1), corner(u1, v1), corner(u1, v0), normal, tint);
              iu += w;
            }
          }
        }
      }
    }
  }
}

const turn = new Matrix4();

/** Collects one damage state: plain boxes, glowing boxes, and how many boxes in all. */
class Builder {
  readonly solid = new BoxBatch();
  readonly glow = new BoxBatch();
  boxes = 0;

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: ColorRepresentation, top?: ColorRepresentation): void {
    this.solid.box(x, y, z, sx, sy, sz, color, top);
    this.boxes++;
  }

  boxOn(cx: number, y: number, cz: number, sx: number, sy: number, sz: number, color: ColorRepresentation, top?: ColorRepresentation): void {
    this.box(cx - sx / 2, y, cz - sz / 2, sx, sy, sz, color, top);
  }

  glowOn(cx: number, y: number, cz: number, sx: number, sy: number, sz: number, color: ColorRepresentation, top?: ColorRepresentation): void {
    this.glow.box(cx - sx / 2, y, cz - sz / 2, sx, sy, sz, color, top);
    this.boxes++;
  }

  /** Runs `build` moved to (x, y, z) and turned by `yaw` (about Y), then `roll` (Z), then `pitch` (X). */
  at(x: number, y: number, z: number, yaw: number, roll: number, pitch: number, build: () => void): void {
    const m = new Matrix4()
      .makeTranslation(x, y, z)
      .multiply(turn.makeRotationY(yaw))
      .multiply(turn.makeRotationZ(roll))
      .multiply(turn.makeRotationX(pitch));
    this.solid.transformed(m, () => this.glow.transformed(m, build));
  }
}

type Ijk = [number, number, number];

/**
 * The cells of `cells` that survive damage: each cell gets a score, chunky noise plus a
 * little grain plus `bias`, and the lowest `fraction` of scores go. Cells in `keep` never go.
 */
function survivors(cells: Ijk[], fraction: number, seed: number, bias: (c: Ijk) => number, keep?: (c: Ijk) => boolean): Ijk[] {
  if (fraction <= 0) return cells;
  if (fraction >= 1) return keep ? cells.filter(keep) : [];
  const scored = cells.map((c) => ({
    c,
    score: keep?.(c)
      ? Infinity
      : 0.72 * noise3(c[0] / 2.6, c[1] / 2.6, c[2] / 2.6, seed) + 0.28 * hash3(c[0], c[1], c[2], seed + 1) - bias(c),
  }));
  const losable = scored.filter((s) => s.score !== Infinity).sort((p, q) => p.score - q.score);
  const lose = new Set(losable.slice(0, Math.round(losable.length * fraction)).map((s) => s.c));
  return cells.filter((c) => !lose.has(c));
}

/** A stepped crack across a face: short dark slabs zig-zagging from (x, y). */
function crack(
  b: Builder,
  face: 'x' | 'z',
  plane: number,
  along: number,
  y: number,
  steps: number,
  seed: number,
  color: string,
  out = 1,
): void {
  let a = along;
  let h = y;
  for (let n = 0; n < steps; n++) {
    const step = 0.05 + hash2(n, seed, 61) * 0.05;
    const dir = hash2(n, seed, 62) < 0.5 ? -1 : 1;
    const proud = out * 0.006;
    if (face === 'x') b.box(plane + (out > 0 ? 0 : -0.012), h - step, a - 0.018, 0.012 + proud, step, 0.036, color);
    else b.box(a - 0.018, h - step, plane + (out > 0 ? 0 : -0.012), 0.036, step, 0.012 + proud, color);
    h -= step;
    a += dir * 0.03;
  }
}

// ---- Lukas's tree fortress -----------------------------------------------------------------
//
// Seen from the lawn camera a base shows its top and the side that faces the camera (+Z)
// far more than the side that faces the lawn, so the tree's face (door, round window) looks
// at the camera, and its tall parts stand towards the back of the strip, where their shadow
// falls short of the first column.

const X = (i: number): number => OX + i * V;
const Z = (k: number): number => OZ + k * V;

interface Built {
  builder: Builder;
  /** Parts that cast no shadow (the tree's leaves and lookout), if any. */
  high?: Builder;
  /** Where smoke rises at this state, in the base's own frame. */
  smoke: Vector3[];
}

function leafTone(i: number, j: number, k: number, state: BuildState): [number, number] {
  const patch = hash3(Math.floor(i / 2), Math.floor(j / 2), Math.floor(k / 2), 5);
  const grain = hash3(i, j, k, 9);
  // A hurt tree's leaves tire, then dry and brown.
  if (state === 3 && grain < 0.78) {
    const dry = grain < 0.3 ? FX.leafDead : grain < 0.56 ? FX.leafDry : FX.leafTired;
    return [hex(dry), hex(dry === FX.leafDead ? FX.leafDry : dry)];
  }
  if (state === 2 && grain < 0.34) return [hex(FX.leafTired), hex(FX.leafTired)];
  if (patch < 0.26) return [hex(PALETTE.leafDark), hex(PALETTE.leaf)];
  if (patch < 0.9) return [hex(PALETTE.leaf), hex(grain < 0.12 ? PALETTE.leafLight : PALETTE.leaf)];
  return [hex(PALETTE.leafLight), hex(PALETTE.leafLight)];
}

function barkTone(i: number, k: number): number {
  const n = hash2(i * 3 + k * 7, 0, 11);
  return hex(n < 0.3 ? PALETTE.walnutDark : n < 0.86 ? PALETTE.walnut : PALETTE.walnutLight);
}

/** The trunk's front, where the door and the round window are. */
const TREE_FACE_Z = Z(28);
const TREE_FACE_X = -0.24;

/** The round window over the door: a stepped ring of frame round a lit pane, with a cross. */
function treeWindow(b: Builder, state: BuildState): void {
  const cell = 0.055;
  const cy = 0.92;
  const pane = new Volume(cell, [TREE_FACE_X - 3.5 * cell, cy - 3.5 * cell, TREE_FACE_Z]);
  const frame = hex(PALETTE.walnutDark);
  for (let a = 0; a < 7; a++) {
    for (let c = 0; c < 7; c++) {
      const d = Math.hypot(a - 3, c - 3);
      if (d > 3.6) continue;
      const rim = d > 2.5;
      const cross = a === 3 || c === 3;
      if (rim || cross) pane.set(a, c, 0, frame, hex(PALETTE.walnut));
      else if (state <= 1) pane.set(a, c, 0, hex(FX.lamp), undefined, true);
      // Hurt: one pane goes dark; then the lamp is out.
      else if (state === 2) pane.set(a, c, 0, a < 3 && c > 3 ? hex(FX.crackWood) : hex(FX.lampDeep), undefined, !(a < 3 && c > 3));
      else pane.set(a, c, 0, hex(FX.crackWood));
    }
  }
  pane.mesh(b);
  // A sill under it.
  b.box(TREE_FACE_X - 0.18, cy - 0.235, TREE_FACE_Z, 0.36, 0.04, 0.06, PALETTE.walnutDark, PALETTE.walnutLight);
}

/** The front door: an arched frame, planks, iron bands and a yellow knob, and a step. */
function treeDoor(b: Builder, state: BuildState): void {
  const face = TREE_FACE_Z;
  const x0 = TREE_FACE_X - 0.19;
  const x1 = TREE_FACE_X + 0.19;
  const top = 0.5;
  const { walnutDark, petal } = PALETTE;
  // Frame: two posts and a stepped arch.
  b.box(x0 - 0.05, 0, face, 0.05, top, 0.045, walnutDark, PALETTE.walnut);
  b.box(x1, 0, face, 0.05, top, 0.045, walnutDark, PALETTE.walnut);
  b.box(x0 - 0.05, top, face, x1 - x0 + 0.1, 0.05, 0.045, walnutDark, PALETTE.walnut);
  b.box(x0 + 0.04, top + 0.05, face, x1 - x0 - 0.08, 0.045, 0.045, walnutDark, PALETTE.walnut);
  // A flat stone step in front.
  b.box(x0 - 0.02, 0, face + 0.045, x1 - x0 + 0.04, 0.035, 0.1, PALETTE.stoneDark, PALETTE.stone);
  if (state >= 3) {
    // Broken in: a dark doorway, and the door lying in front of it.
    b.box(x0, 0, face, x1 - x0, top + 0.05, 0.012, FX.crackWood);
    b.at(TREE_FACE_X + 0.05, 0.012, face + 0.3, 0.3, 0, 0, () => b.boxOn(0, 0, 0, 0.34, 0.035, 0.26, FX.plankDark, FX.plank));
    return;
  }
  const skew = state === 2 ? 0.16 : 0;
  b.at(x0, 0, face, skew, 0, 0, () => {
    const w = (x1 - x0) / 4;
    const planks = state === 2 ? [0, 1, 3] : [0, 1, 2, 3];
    for (const p of planks) {
      const h = top + (p === 1 || p === 2 ? 0.045 : 0);
      b.box(p * w + 0.003, 0, 0, w - 0.006, h, 0.03, p % 2 ? FX.plank : FX.plankDark, FX.plank);
    }
    if (state === 2) b.box(2 * w, 0, -0.004, w, top, 0.01, FX.crackWood);
    b.box(0, 0.1, 0.03, x1 - x0, 0.04, 0.012, walnutDark);
    b.box(0, 0.36, 0.03, x1 - x0, 0.04, 0.012, walnutDark);
    b.box(x1 - x0 - 0.1, 0.22, 0.03, 0.045, 0.05, 0.03, petal, PALETTE.petalLight);
  });
}

/** The cells in a box of cells (bounds inclusive) that pass `inside`. */
function cellsIn(i0: number, i1: number, j0: number, j1: number, k0: number, k1: number, inside: (i: number, j: number, k: number) => boolean): Ijk[] {
  const out: Ijk[] = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) if (inside(i, j, k)) out.push([i, j, k]);
  return out;
}

/** True inside a rounded block: a superellipse across, an ellipse up and down. */
function clump(i: number, j: number, k: number, c: Ijk, r: Ijk, seed: number): boolean {
  const dx = (i + 0.5 - c[0]) / r[0];
  const dy = (j + 0.5 - c[1]) / r[1];
  const dz = (k + 0.5 - c[2]) / r[2];
  return dx ** 4 + dz ** 4 + dy * dy + (hash3(i, j, k, seed) - 0.5) * 0.3 <= 1;
}

function plantBase(state: BuildState): Built {
  const b = new Builder();
  const vol = new Volume(V, [OX, 0, OZ]);
  // The leaves, the lookout and the flowers on them stand high and lean towards the lawn, so
  // their shadow would fall across the first column: they are built apart and cast none.
  const high = new Builder();
  const crown = new Volume(V, [OX, 0, OZ]);
  const smoke: Vector3[] = [];
  const ruins = state === RUINS;

  // Trunk: a broad, rounded block of bark from the ground into the leaves, with roots.
  const top = ruins ? 2 : 9;
  const trunk = cellsIn(1, 7, 0, top, 12, 27, (i, j, k) => !((i === 1 || i === 7) && (k === 12 || k === 27) && j > 0));
  const roots: Ijk[] = [
    [8, 0, 14], [8, 0, 15], [8, 1, 15], [9, 0, 15], [8, 0, 22], [8, 0, 23], [8, 1, 22],
    [1, 0, 28], [2, 0, 28], [2, 1, 28], [7, 0, 28], [7, 1, 28], [7, 0, 29],
    [3, 0, 11], [4, 0, 11], [4, 1, 11], [0, 0, 18], [0, 0, 19], [0, 1, 19],
  ];
  const door = (c: Ijk): boolean => c[2] >= 25 && c[0] >= 2 && c[0] <= 6 && c[1] <= 9;
  const lamp = (c: Ijk): boolean => c[0] >= 6 && c[2] >= 15 && c[2] <= 19 && c[1] >= 5 && c[1] <= 8;
  const column = (c: Ijk): boolean => c[0] >= 3 && c[0] <= 4 && c[2] >= 15 && c[2] <= 17;
  const trunkLoss = [0, 0.05, 0.12, 0.22, 0.3][state] as number;
  const keepTrunk = (c: Ijk): boolean => !ruins && (door(c) || lamp(c) || column(c));
  for (const [i, j, k] of survivors(trunk, trunkLoss, 21, (c) => c[1] * 0.012, keepTrunk)) vol.set(i, j, k, barkTone(i, k));
  for (const [i, j, k] of roots) vol.set(i, j, k, barkTone(i, k), hex(PALETTE.walnutLight));

  const flowerSpots: Ijk[] = [];
  if (!ruins) {
    // The canopy: four rounded clumps of leaves, the highest at the back. Its front stays
    // behind the trunk's face, so the window under it is never hidden.
    const clumps: [Ijk, Ijk][] = [
      [[4.5, 13.1, 17], [4.9, 2.9, 7.2]],
      [[4, 13.9, 8.5], [4.3, 2.9, 4.4]],
      [[5, 12.3, 24.5], [4.1, 2.2, 3.4]],
      [[8.4, 11.9, 14.5], [2.3, 1.8, 3.6]],
    ];
    const canopy = cellsIn(0, 10, 10, 17, 3, 27, (i, j, k) => clumps.some(([c, r], n) => clump(i, j, k, c, r, 3 + n)));
    const canopyLoss = [0, 0.17, 0.4, 0.7][state] as number;
    // The lawn side and the top go first.
    for (const [i, j, k] of survivors(canopy, canopyLoss, 31, (c) => c[0] * 0.012 + (c[1] - 10) * 0.02)) {
      const [side, up] = leafTone(i, j, k, state);
      crown.set(i, j, k, j === 10 ? hex(PALETTE.leafDark) : side, up);
      if (state <= 1 && hash3(i, j, k, 13) < 0.07) flowerSpots.push([i, j, k]);
    }
    // Branches inside the leaves, which show as the leaves go; and the post the lookout stands on.
    const branch = (cells: Ijk[]): void => {
      for (const [i, j, k] of cells) crown.set(i, j, k, hex(PALETTE.walnut), hex(PALETTE.walnutLight));
    };
    for (let j = 10; j <= 15; j++) for (let i = 3; i <= 4; i++) for (let k = 15; k <= 17; k++) crown.set(i, j, k, hex(PALETTE.walnutDark));
    branch([[5, 11, 20], [6, 11, 21], [7, 12, 21], [8, 12, 22]]);
    branch([[3, 11, 14], [3, 12, 12], [3, 12, 11], [2, 12, 9], [2, 13, 8]]);
    branch([[5, 11, 15], [6, 11, 14], [7, 12, 14], [8, 12, 13]]);
    branch([[2, 11, 17], [1, 11, 17], [1, 12, 18]]);
    if (state >= 1) smoke.push(new Vector3(0.25, 1.8, 0.45));
    if (state >= 3) smoke.push(new Vector3(-0.3, 1.85, -1.3));
  }

  // Two leafy towers at the ends: a post with a crown of leaves.
  const towers: [number, number, number, number][] = [
    // centre i, centre k, post height (cells), crown bottom
    [4, 36, 4, 5],
    [4, 3, 5, 6],
  ];
  towers.forEach(([ci, ck, postTop, crownBottom], t) => {
    const postHeight = ruins ? 1 : state === 3 && t === 0 ? 2 : postTop;
    for (let j = 0; j <= postHeight; j++) {
      for (const [di, dk] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) vol.set(ci - 1 + di, j, ck - 1 + dk, barkTone(ci + di, ck + dk));
    }
    if (ruins) return;
    const crown = cellsIn(ci - 4, ci + 3, crownBottom, crownBottom + 3, ck - 3, ck + 2, (i, j, k) => {
      if (k < 0 || k > 39 || i < 0 || i > 10) return false;
      const dx = (i + 0.5 - ci) / 3.9;
      const dz = (k + 0.5 - ck) / 3.2;
      const dy = (j + 0.5 - (crownBottom + 1.9)) / 2.3;
      return dx * dx + dz * dz + dy * dy + (hash3(i, j, k, 17 + t) - 0.5) * 0.25 <= 1.05;
    });
    const loss = [0, 0.2, 0.5, 0.9][state] as number;
    for (const [i, j, k] of survivors(crown, loss, 41 + t, (c) => (c[1] - crownBottom) * 0.03)) {
      const [side, up] = leafTone(i, j, k, state);
      vol.set(i, j, k, j === crownBottom ? hex(PALETTE.leafDark) : side, up);
      if (state <= 1 && hash3(i, j, k, 19) < 0.08) flowerSpots.push([i, j, k]);
    }
  });
  if (state >= 2 && !ruins) smoke.push(new Vector3(-0.05, 1.05, 2.05));

  vol.mesh(b);
  crown.mesh(high);

  // Little yellow and white flowers dotted over the leaves while the tree is well.
  for (const [i, j, k] of flowerSpots) {
    if (vol.has(i, j + 1, k) || crown.has(i, j + 1, k)) continue;
    const white = hash3(i, j, k, 23) < 0.35;
    high.box(X(i) + 0.035, (j + 1) * V, Z(k) + 0.035, 0.055, 0.025, 0.055, white ? PALETTE.bone : PALETTE.petal);
    high.box(X(i) + 0.05, (j + 1) * V + 0.025, Z(k) + 0.05, 0.025, 0.012, 0.025, PALETTE.petalDark);
  }

  if (!ruins) {
    treeDoor(b, state);
    treeWindow(b, state);
    // A small lit window on the lawn side, higher up.
    const face = X(8);
    const wz = -0.4;
    const wy = 0.78;
    b.box(face, wy - 0.03, wz - 0.13, 0.035, 0.03, 0.26, PALETTE.walnutDark, PALETTE.walnutLight);
    b.box(face, wy + 0.2, wz - 0.13, 0.035, 0.03, 0.26, PALETTE.walnutDark);
    b.box(face, wy, wz - 0.13, 0.035, 0.2, 0.035, PALETTE.walnutDark);
    b.box(face, wy, wz + 0.095, 0.035, 0.2, 0.035, PALETTE.walnutDark);
    if (state <= 2) {
      b.glow.box(face, wy, wz - 0.095, 0.012, 0.2, 0.19, state === 2 ? FX.lampDeep : FX.lamp);
      b.boxes++;
    } else {
      b.box(face, wy, wz - 0.095, 0.012, 0.2, 0.19, FX.crackWood);
    }
    // Cracks in the bark.
    const cracks = [0, 1, 3, 5][Math.min(state, 3)] as number;
    for (let n = 0; n < cracks; n++) {
      if (n % 2 === 0) crack(b, 'z', TREE_FACE_Z, [0.08, -0.55, 0.1][n / 2] as number, 1.3 - n * 0.05, 6, n + 3, FX.crackWood);
      else crack(b, 'x', face, -0.85 + n * 0.25, 1.2, 5, n + 7, FX.crackWood);
    }
    if (state >= 2) smoke.push(new Vector3(-0.25, 0.8, 1.1));
    lookout(high, state);
  }

  palisade(b, state);
  // Stepping stones from the door out to the lawn.
  for (const [x, z] of [[-0.2, 1.3], [0.05, 1.38], [0.3, 1.36], [0.55, 1.32]] as const) {
    b.boxOn(x, 0, z, 0.16, 0.025, 0.13, PALETTE.stoneDark, PALETTE.stone);
  }
  peaPile(b, state);
  rubble(b, state, [FX.plankDark, PALETTE.walnut, PALETTE.leafDark, PALETTE.leaf], 0.5, 51);
  return { builder: b, high, smoke };
}

/** The lookout on the leaves: a plank deck on a beam, posts and rails. */
const DECK = { x0: -0.48, x1: 0.12, z0: -0.32, z1: 0.3, y: 16 * V } as const;

function lookout(b: Builder, state: BuildState): void {
  const { x0, x1, z0, z1, y } = DECK;
  const deck = (): void => {
    const n = 3;
    const w = (x1 - x0) / n;
    for (let p = 0; p < n; p++) {
      if (state >= 3 && p === 1) continue;
      b.box(x0 + p * w + 0.005, 0, z0, w - 0.01, 0.04, z1 - z0, p % 2 ? FX.plankDark : FX.plank, FX.plank);
    }
    b.box(x0 + 0.02, -0.04, -0.05, x1 - x0 - 0.04, 0.04, 0.1, PALETTE.walnutDark);
  };
  if (state >= 3) {
    // Half fallen in: tipped towards the lawn, its rails gone.
    b.at(0, y - 0.05, 0, 0, -0.28, 0.12, deck);
    return;
  }
  b.at(0, y, 0, 0, 0, 0, deck);
  const posts: [number, number][] = [
    [x1 - 0.025, z0 + 0.025],
    [x0 + 0.025, z1 - 0.025],
    [x1 - 0.025, z1 - 0.025],
  ];
  posts.forEach(([px, pz], n) => {
    if (state === 2 && n === 2) return;
    b.boxOn(px, y + 0.04, pz, 0.045, 0.16, 0.045, PALETTE.walnutDark, PALETTE.walnut);
  });
  const railY = y + 0.16;
  b.box(x1 - 0.035, railY, z0, 0.035, 0.035, z1 - z0, PALETTE.walnut, PALETTE.walnutLight);
  if (state < 2) b.box(x0, railY, z1 - 0.035, x1 - x0, 0.035, 0.035, PALETTE.walnut, PALETTE.walnutLight);
  if (state < 2) b.box(x1 - 0.03, y + 0.09, z0, 0.025, 0.025, z1 - z0, PALETTE.walnutDark);
}

/** The log wall along the lawn side, either side of the way out. */
function palisade(b: Builder, state: BuildState): void {
  const runs: [number, number][] = [
    [1.6, 2.46],
    [-2.46, -0.9],
  ];
  const x = 0.5;
  const depth = 0.18;
  let n = 0;
  for (const [z0, z1] of runs) {
    const logs = Math.round((z1 - z0) / 0.16);
    const w = (z1 - z0) / logs;
    let standing = 0;
    for (let l = 0; l < logs; l++, n++) {
      const h = hash2(n, 3, 71);
      // Each log breaks at some state and is gone at the next.
      const breaksAt = state === RUINS ? 0 : 1 + Math.floor(hash2(n, 5, 73) * 3.4);
      const z = z0 + l * w;
      const wood = h < 0.5 ? PALETTE.walnut : PALETTE.walnutLight;
      if (state > breaksAt) continue;
      if (state === breaksAt) {
        const stump = 0.12 + hash2(n, 7, 75) * 0.14;
        b.box(x, 0, z + 0.005, depth, stump, w - 0.01, wood, FX.plank);
        b.box(x + 0.04, stump, z + 0.03, depth * 0.5, 0.04, w * 0.4, wood, FX.plank);
        continue;
      }
      standing++;
      const height = 0.46 + h * 0.14;
      b.box(x, 0, z + 0.005, depth, height, w - 0.01, wood, FX.plank);
      b.box(x + 0.035, height, z + 0.03, depth - 0.07, 0.06, w - 0.06, wood, FX.plank);
      b.box(x + 0.065, height + 0.06, z + 0.055, depth - 0.13, 0.04, w - 0.11, wood, FX.plank);
    }
    // The vine that binds them, while there is something to bind.
    if (standing > logs / 2) b.box(x - 0.008, 0.28, z0, depth + 0.016, 0.04, z1 - z0, PALETTE.stem, PALETTE.leaf);
  }
}

/** A heap of peas by the door: the garden's ammunition. */
function peaPile(b: Builder, state: BuildState): void {
  const s = 0.085;
  const spots: [number, number, number][] = [
    [-0.62, 0, 1.12], [-0.53, 0, 1.12], [-0.62, 0, 1.21], [-0.53, 0, 1.21], [-0.575, s, 1.165],
  ];
  const kept = state >= 3 ? spots.slice(0, 2) : spots;
  for (const [x, y, z] of kept) b.boxOn(x, y, z, s, s, s, PALETTE.pea, PALETTE.peaLight);
}

/** Bits of the base lying about in front of it, more of them the worse it gets. */
function rubble(b: Builder, state: BuildState, colors: string[], front: number, seed: number): void {
  const count = state === RUINS ? 16 : ([0, 0, 5, 9] as const)[state];
  for (let n = 0; n < count; n++) {
    const z = -2.3 + hash2(n, seed, 1) * 4.6;
    const x = front * (0.25 + hash2(n, seed, 2) * 0.5) - (state === RUINS ? hash2(n, seed, 5) * 0.8 * Math.sign(front) : 0);
    const size = 0.07 + hash2(n, seed, 3) * 0.08;
    const color = colors[Math.floor(hash2(n, seed, 4) * colors.length)] as string;
    b.at(x, 0, z, hash2(n, seed, 6) * 3, 0, 0, () => b.boxOn(0, 0, 0, size * 1.6, size * 0.8, size, color));
  }
}

// ---- Toby's crypt ------------------------------------------------------------------------
//
// A mausoleum whose door looks at the camera, lit purple from inside, under a stepped roof
// with crystals on its ridge; a broken wing at the back that the tallest spires grow
// through; a cluster of crystals in front; and a crooked iron fence with gravestones in it
// along the lawn, with a gate where the zombies come out.

function brickTone(i: number, j: number, k: number, seed: number): number {
  const brick = Math.floor((i + k + (j % 2)) / 2);
  const n = hash2(brick * 13 + i, j * 7 + k * 3, seed);
  return hex(n < 0.22 ? FX.cryptStoneDark : n < 0.86 ? FX.cryptStone : FX.cryptStoneLight);
}

/** A crystal: a tall shard stepping in to a point, glowing. `height` in tiles. */
function shard(b: Builder, x: number, z: number, y: number, width: number, height: number, yaw: number, lean: number, dim: boolean): void {
  const side = dim ? FX.spireDim : FX.spireDeep;
  const top = dim ? FX.spireDim : FX.spire;
  b.at(x, y, z, yaw, lean, lean * 0.4, () => {
    const body = height * 0.68;
    b.glowOn(0, 0, 0, width, body, width, side, top);
    b.glowOn(0, body, 0, width * 0.68, height * 0.2, width * 0.68, side, top);
    b.glowOn(0, body + height * 0.2, 0, width * 0.36, height * 0.12, width * 0.36, top, top);
  });
}

/** The crypt's front: the door's face. */
const CRYPT_FACE_Z = Z(26);

function cryptBase(state: BuildState): Built {
  const b = new Builder();
  const vol = new Volume(V, [OX, 0, OZ]);
  const smoke: Vector3[] = [];
  const ruins = state === RUINS;

  // A raised platform of flagstones under the mausoleum, its wing and its yard.
  for (let i = 1; i <= 11; i++) {
    for (let k = 0; k <= 30; k++) {
      const edge = i === 1 || k === 0 || k === 30 || i === 11;
      if (edge && hash2(i, k, 81) < 0.45) continue;
      const slab = hash2(Math.floor(i / 2), Math.floor(k / 2), 83);
      const tone = hex(slab < 0.3 ? FX.cryptStoneDark : FX.cryptStone);
      vol.set(i, 0, k, hex(FX.cryptStoneDark), slab < 0.75 ? tone : hex(FX.cryptStoneLight));
    }
  }

  // The mausoleum: brick walls, a doorway lit from inside, pillars either side.
  const doorway = (i: number, j: number, k: number): boolean =>
    k >= 25 && ((i >= 4 && i <= 8 && j <= 5) || (i >= 5 && i <= 7 && j === 6) || (i === 6 && j === 7));
  const glowBack = (i: number, j: number): boolean => (i >= 4 && i <= 8 && j <= 5) || (i >= 5 && i <= 7 && j === 6) || (i === 6 && j === 7);
  const slit = (i: number, j: number, k: number): boolean => i === 2 && j >= 4 && j <= 6 && (k === 13 || k === 19);
  const wallTop = ruins ? 2 : 8;
  const walls = cellsIn(2, 10, 1, wallTop, 9, 25, (i, j, k) => !doorway(i, j, k) && !slit(i, j, k));
  const pillars = cellsIn(2, 10, 1, ruins ? 2 : 9, 26, 26, (i) => i <= 3 || i >= 9);
  const frame = (c: Ijk): boolean => c[2] >= 25 && c[0] >= 3 && c[0] <= 9;
  const wallLoss = [0, 0.07, 0.17, 0.32, 0.4][state] as number;
  const keepFrame = (c: Ijk): boolean => !ruins && state < 3 && frame(c);
  for (const [i, j, k] of survivors(walls, wallLoss, 91, (c) => c[1] * 0.015, keepFrame)) vol.set(i, j, k, brickTone(i, j, k, 93));
  for (const [i, j, k] of survivors(pillars, wallLoss * 0.6, 95, () => 0, keepFrame)) vol.set(i, j, k, hex(FX.cryptStoneLight));
  if (!ruins) {
    // The lintel over the door, and the light inside it.
    for (let i = 4; i <= 8; i++) if (state < 3 || hash2(i, 0, 97) < 0.5) vol.set(i, 8, 26, hex(FX.cryptStoneLight));
    const light = state <= 1 ? FX.doorway : state === 2 ? FX.doorwayMid : FX.doorwayDeep;
    for (let j = 1; j <= 7; j++) for (let i = 4; i <= 8; i++) if (glowBack(i, j)) vol.set(i, j, 24, hex(light), undefined, true);
    // Purple slits on the lawn side.
    for (let j = 4; j <= 6; j++) for (const k of [13, 19]) vol.set(2, j, k, hex(light), undefined, true);
    // Two steps up to the door, lit purple by it.
    for (let i = 4; i <= 8; i++) {
      vol.set(i, 1, 25, hex(FX.cryptStoneLight), hex(light), true);
      vol.set(i, 1, 26, hex(FX.cryptStoneLight), hex(FX.cryptStoneLight));
    }

    // The roof: five steps up to a ridge, darker than the walls.
    const roof: Ijk[] = [];
    const layer = (j: number, i0: number, i1: number, k0: number, k1: number): void => {
      for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) roof.push([i, j, k]);
    };
    layer(9, 1, 11, 8, 26);
    layer(10, 2, 10, 9, 25);
    layer(11, 3, 9, 11, 23);
    layer(12, 4, 8, 13, 21);
    layer(13, 5, 7, 15, 19);
    const roofLoss = [0, 0.12, 0.38, 0.72][state] as number;
    for (const [i, j, k] of survivors(roof, roofLoss, 99, (c) => (c[1] - 9) * 0.05)) {
      const edge = j === 9;
      const tile = (i + k + j) % 3 === 0 ? FX.cryptRoof : FX.cryptRoofLight;
      vol.set(i, j, k, hex(edge ? FX.cryptStoneDark : FX.cryptRoof), hex(edge ? FX.cryptStone : tile));
    }
    if (state >= 1) smoke.push(new Vector3(0.15, 1.6, -0.6));
    if (state >= 2) smoke.push(new Vector3(-0.45, 1.0, -0.2));
    if (state >= 3) smoke.push(new Vector3(0.3, 1.2, 0.5));
  }

  // The back wing: a broken wall the big crystals grow through.
  const wing = cellsIn(3, 10, 1, ruins ? 1 : 4, 1, 7, (i, j, k) => j <= (ruins ? 1 : 2 + Math.floor(hash2(i, k, 101) * 3)));
  const wingLoss = [0, 0.15, 0.35, 0.6, 0.5][state] as number;
  for (const [i, j, k] of survivors(wing, wingLoss, 103, () => 0)) vol.set(i, j, k, brickTone(i, j, k, 105));
  vol.mesh(b);

  if (!ruins) {
    // A bone-white skull over the door.
    if (state < 3) {
      const sz = Z(27);
      const sx = X(6) + V / 2;
      b.box(sx - 0.09, 1.14, sz, 0.18, 0.15, 0.03, PALETTE.bone, PALETTE.bone);
      b.box(sx - 0.06, 1.19, sz + 0.002, 0.045, 0.05, 0.03, PALETTE.eye);
      b.box(sx + 0.015, 1.19, sz + 0.002, 0.045, 0.05, 0.03, PALETTE.eye);
      b.box(sx - 0.06, 1.09, sz, 0.12, 0.05, 0.03, PALETTE.boneShadow);
    }
    // Cracks in the walls.
    const cracks = [0, 1, 3, 5][Math.min(state, 3)] as number;
    for (let n = 0; n < cracks; n++) {
      if (n % 2 === 0) crack(b, 'z', CRYPT_FACE_Z, [-0.45, 0.45, -0.38][n / 2] as number, 1.05, 6, n + 11, FX.crackStone);
      else crack(b, 'x', X(2), -1.1 + n * 0.3, 1.0, 6, n + 13, FX.crackStone, -1);
    }
    crystals(b, state);
  }
  fence(b, state);
  rubble(b, state, [FX.cryptStone, FX.cryptStoneDark, FX.cryptRoof, PALETTE.stone], -0.55, 111);
  if (state >= 2 && !ruins) smoke.push(new Vector3(0.3, 0.7, -1.7));
  if (state >= 3 && !ruins) smoke.push(new Vector3(0.3, 0.5, 1.9));
  return { builder: b, smoke };
}

/** The crystal spires: on the roof's ridge, through the back wing, and in the yard in front. */
function crystals(b: Builder, state: BuildState): void {
  const dim = state >= 3;
  // How much of each spire is left: whole, tip off, snapped, stump.
  const left = [1, 0.85, 0.6, 0.35][Math.min(state, 3)] as number;
  const ridge = 14 * V;
  const cx = X(6) + V / 2;
  // On the ridge.
  shard(b, cx, Z(17) + V / 2, ridge, 0.2, 0.62 * (state === 0 ? 1 : left), 0.3, 0.06, dim);
  shard(b, cx + 0.1, Z(15), ridge - V, 0.12, 0.38 * left, 1.1, -0.3, dim);
  shard(b, cx - 0.1, Z(20), ridge - V, 0.12, 0.34 * left, 0.6, 0.32, dim);
  // Through the back wing: the tallest.
  shard(b, 0.15, -1.95, V, 0.3, 2.05 * left, 0.2, 0.08, dim);
  shard(b, -0.2, -1.7, V, 0.2, 1.3 * left, 0.9, 0.3, dim);
  shard(b, 0.42, -2.1, V, 0.17, 0.95 * left, 1.7, -0.28, dim);
  shard(b, -0.32, -2.1, V, 0.12, 0.6 * left, 2.4, 0.3, dim);
  // In the yard in front, lower, so they never hide the lane in front.
  shard(b, 0.4, 1.95, V, 0.24, 1.0 * left, 0.5, -0.12, dim);
  shard(b, 0.22, 2.2, V, 0.14, 0.6 * left, 1.3, 0.22, dim);
  shard(b, 0.56, 1.6, V, 0.12, 0.5 * left, 2.0, -0.3, dim);
  shard(b, 0.05, 1.7, V, 0.1, 0.36 * left, 2.6, 0.35, dim);
  if (state >= 2) {
    // The snapped tops lie on the ground.
    b.at(-0.12, 0.06 + V, -1.3, 0.5, -(Math.PI / 2 - 0.15), 0, () => b.glowOn(0, 0, 0, 0.22, 0.55, 0.22, FX.spireDim, FX.spireDeep));
  }
  if (state >= 3) {
    b.at(-0.1, 0.05 + V, 1.55, -0.5, -(Math.PI / 2 - 0.2), 0, () => b.glowOn(0, 0, 0, 0.16, 0.35, 0.16, FX.spireDim, FX.spireDeep));
  }
  // Rocks at the feet of the big clusters.
  b.boxOn(0.1, V, -1.9, 0.42, 0.1, 0.36, PALETTE.graveRock, PALETTE.stoneDark);
  b.boxOn(0.38, V, 1.9, 0.34, 0.08, 0.34, PALETTE.graveRock, PALETTE.stoneDark);
}

/** The crooked fence along the lawn side: iron posts and rails, gravestones in the run, a gate with lamps. */
function fence(b: Builder, state: BuildState): void {
  const x = -0.55;
  const runs: [number, number][] = [
    [-2.28, 0.85],
    [1.7, 2.28],
  ];
  // The gate: two stone posts, each with a purple lamp.
  [0.95, 1.6].forEach((z, n) => {
    if (state >= 3 || (state === 2 && n === 1)) {
      if (state < RUINS) b.at(-0.45, 0.02, z, 0.4, -(Math.PI / 2 - 0.1), 0, () => b.boxOn(0, 0, 0, 0.1, 0.42, 0.1, FX.cryptStone, FX.cryptStoneLight));
      return;
    }
    b.boxOn(x, 0, z, 0.12, 0.46, 0.12, FX.cryptStoneDark, FX.cryptStoneLight);
    b.boxOn(x, 0.46, z, 0.15, 0.04, 0.15, FX.cryptStone, FX.cryptStoneLight);
    b.glowOn(x, 0.5, z, 0.085, 0.09, 0.085, FX.doorway, FX.spire);
    b.boxOn(x, 0.59, z, 0.11, 0.03, 0.11, FX.cryptIron);
  });
  let n = 0;
  for (const [z0, z1] of runs) {
    const count = Math.round((z1 - z0) / 0.27);
    const step = (z1 - z0) / count;
    let last: number | null = null;
    for (let p = 0; p <= count; p++, n++) {
      const z = z0 + p * step;
      const goneAt = state === RUINS ? 0 : 1 + Math.floor(hash2(n, 9, 121) * 3.6);
      if (state >= goneAt) {
        last = null;
        continue;
      }
      // Every other post is a gravestone, each at its own crooked angle.
      if (n % 2 === 0) {
        const yaw = -0.45 + (hash2(n, 1, 123) - 0.5) * 0.6;
        const lean = (hash2(n, 2, 125) - 0.5) * 0.36 + state * 0.05;
        const cross = n % 6 === 4;
        gravestone(b.solid, x + 0.04, z, 0.36 + hash2(n, 3, 127) * 0.14, yaw, lean, cross);
        b.boxes += cross ? 3 : 6;
        last = null;
        continue;
      }
      const h = 0.36 + hash2(n, 4, 129) * 0.1;
      const roll = (hash2(n, 5, 131) - 0.5) * 0.3 * (1 + state * 0.4);
      const pitch = (hash2(n, 6, 133) - 0.5) * 0.3 * (1 + state * 0.4);
      b.at(x, 0, z, 0, roll, pitch, () => {
        b.boxOn(0, 0, 0, 0.045, h, 0.045, FX.cryptIron, PALETTE.stoneDark);
        b.boxOn(0, h, 0, 0.03, 0.05, 0.03, FX.cryptIron);
        b.boxOn(0, h + 0.05, 0, 0.014, 0.035, 0.014, PALETTE.stoneDark);
      });
      if (last !== null) {
        const span = z - last;
        const tilt = (hash2(n, 7, 135) - 0.5) * 0.2;
        for (const ry of [0.14, 0.3]) {
          b.at(x, ry, last + span / 2, 0, 0, tilt, () => b.boxOn(0, 0, 0, 0.025, 0.028, span, FX.cryptIron, PALETTE.stoneDark));
        }
      }
      last = z;
    }
  }
}

// ---- The view ----------------------------------------------------------------------------

/** Cubes the base breaks into when it falls, and the arrays that throw them. */
class Debris {
  readonly mesh: InstancedMesh;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly s: Float32Array;
  private readonly spin: Float32Array;
  private readonly delay: Float32Array;
  private readonly m = new Matrix4();
  private readonly q = new Vector3();
  private readonly size = new Vector3();
  private live = false;
  private shrink = 1;

  constructor(
    readonly count: number,
    colors: string[],
    private readonly front: number,
    private readonly seed: number,
  ) {
    const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, count);
    mesh.name = 'base-debris';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const color = new Color();
    for (let n = 0; n < count; n++) {
      color.set(colors[Math.floor(hash2(n, seed, 1) * colors.length)] as string);
      mesh.setColorAt(n, color);
    }
    this.mesh = mesh;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 3);
    this.s = new Float32Array(count);
    this.spin = new Float32Array(count);
    this.delay = new Float32Array(count);
    for (let n = 0; n < count; n++) {
      this.s[n] = 0.07 + hash2(n, seed, 2) * 0.1;
      this.delay[n] = 0.2 + hash2(n, seed, 3) * 0.6;
    }
  }

  /** Puts every cube back inside the base, ready to fly. */
  start(): void {
    const { p, v, seed } = this;
    for (let n = 0; n < this.count; n++) {
      p[n * 3] = (hash2(n, seed, 4) - 0.5) * 1.3;
      p[n * 3 + 1] = 0.3 + hash2(n, seed, 5) * 1.6;
      p[n * 3 + 2] = (hash2(n, seed, 6) - 0.5) * 4.6;
      v[n * 3] = (hash2(n, seed, 7) - 0.5) * 2.4 + this.front * (0.5 + hash2(n, seed, 10));
      v[n * 3 + 1] = 1.2 + hash2(n, seed, 8) * 2.6;
      v[n * 3 + 2] = (hash2(n, seed, 9) - 0.5) * 2.4;
      this.spin[n] = 0;
    }
    this.live = true;
    this.shrink = 1;
    this.mesh.visible = true;
    this.write(0);
  }

  /** Moves the cubes on; `shrink` (1 to 0) scales them all, for fading them away once they have settled. */
  update(dt: number, elapsed: number, shrink = 1): void {
    if (!this.live) return;
    this.shrink = shrink;
    const { p, v } = this;
    for (let n = 0; n < this.count; n++) {
      if (elapsed < (this.delay[n] as number)) continue;
      const i = n * 3;
      const half = (this.s[n] as number) / 2;
      v[i + 1] = (v[i + 1] as number) - 9.8 * dt;
      p[i] = (p[i] as number) + (v[i] as number) * dt;
      p[i + 1] = (p[i + 1] as number) + (v[i + 1] as number) * dt;
      p[i + 2] = (p[i + 2] as number) + (v[i + 2] as number) * dt;
      this.spin[n] = (this.spin[n] as number) + dt * (p[i + 1] as number > half + 0.01 ? 6 : 0);
      if ((p[i + 1] as number) < half) {
        p[i + 1] = half;
        v[i + 1] = Math.abs(v[i + 1] as number) * 0.3;
        if ((v[i + 1] as number) < 0.4) v[i + 1] = 0;
        v[i] = (v[i] as number) * 0.5;
        v[i + 2] = (v[i + 2] as number) * 0.5;
      }
    }
    this.write(elapsed);
  }

  /** Takes every cube away at once. */
  hide(): void {
    this.live = false;
    this.mesh.visible = false;
  }

  private write(elapsed: number): void {
    for (let n = 0; n < this.count; n++) {
      const i = n * 3;
      const s = Math.max(1e-4, (this.s[n] as number) * this.shrink * (elapsed < (this.delay[n] as number) ? 0 : 1));
      this.q.set(this.p[i] as number, this.p[i + 1] as number, this.p[i + 2] as number);
      this.m.makeRotationY(this.spin[n] as number).multiply(turn.makeRotationX((this.spin[n] as number) * 0.7));
      this.m.scale(this.size.set(s, s, s));
      this.m.setPosition(this.q);
      this.mesh.setMatrixAt(n, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeIn = (t: number): number => t * t;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Height of the flagpole above the lookout's deck: its top is the base's highest point, 2.4 tiles. */
const POLE = 2.4 - (16 * V + 0.04);

/** The swatting vine is drawn this much larger than built, so it reads from the lawn camera. */
const ARM_SCALE = 1.25;

/** The swatting vine of the plants' base: a stem with leaves and an acorn on the end, along +X. */
function buildArm(): Mesh {
  const b = new Builder();
  const { stem, leaf, leafDark, leafLight, walnut, walnutDark } = PALETTE;
  b.box(0, -0.05, -0.05, 0.3, 0.1, 0.1, stem, PALETTE.leafDark);
  b.box(0.28, -0.04, -0.04, 0.3, 0.08, 0.08, stem, PALETTE.leafDark);
  b.box(0.56, -0.035, -0.035, 0.18, 0.07, 0.07, stem, PALETTE.leafDark);
  for (const [x, side] of [[0.18, 1], [0.38, -1], [0.55, 1]] as const) {
    b.box(x, 0.02, side > 0 ? 0.04 : -0.16, 0.12, 0.03, 0.12, leafDark, leaf);
    b.box(x + 0.03, 0.05, side > 0 ? 0.07 : -0.13, 0.06, 0.02, 0.06, leaf, leafLight);
  }
  // The acorn club.
  b.box(0.7, -0.09, -0.09, 0.18, 0.18, 0.18, walnut, PALETTE.walnutLight);
  b.box(0.68, 0.06, -0.1, 0.2, 0.06, 0.2, walnutDark, walnut);
  b.box(0.76, 0.12, -0.02, 0.04, 0.05, 0.04, stem);
  const mesh = new Mesh(b.solid.build());
  mesh.name = 'base-arm';
  mesh.userData.boxes = b.boxes;
  mesh.castShadow = true;
  return mesh;
}

/** The flag: green with a yellow pea on it, along +X from its pole; torn, then tattered. */
function buildFlag(state: 0 | 2 | 3): Mesh {
  const cell = 0.05;
  const vol = new Volume(cell, [0, -6 * cell, 0]);
  for (let a = 0; a < 12; a++) {
    for (let c = 0; c < 6; c++) {
      if (state === 2 && a >= 8 && c <= 3 && !(a === 8 && c === 3)) continue;
      if (state === 3 && (a >= 7 || (a === 6 && c !== 4) || (a === 5 && c <= 1))) continue;
      // A yellow pea in the middle, a stepped disc of eight cells.
      const dot = a >= 4 && a <= 7 && c >= 1 && c <= 4 && !((a === 4 || a === 7) && (c === 1 || c === 4));
      // A cream edge, so the green flag still reads against green leaves.
      const edge = c === 5 || c === 0 || a === 11;
      // The cloth steps back and forth a little, as if it were waving.
      const k = a % 6 >= 2 && a % 6 <= 4 ? 1 : 0;
      const color = dot ? PALETTE.petal : edge ? PALETTE.bone : a % 2 ? FX.flag : FX.flagDark;
      vol.set(a, c, k, hex(color), hex(dot ? PALETTE.petal : edge ? PALETTE.bone : FX.flag));
    }
  }
  const b = new Builder();
  vol.mesh(b);
  const geometry = b.solid.build();
  geometry.translate(0.01, 0, -0.04);
  const mesh = new Mesh(geometry);
  mesh.name = 'base-flag';
  mesh.userData.boxes = b.boxes;
  mesh.castShadow = false;
  return mesh;
}

/**
 * One base on the island: built for all four damage states at once, then switched with
 * `setHealth`. It shudders when hit, the plants' base swats at zombies biting it, and it
 * collapses into debris when its side loses. Every geometry and material is the view's own.
 */
export class BaseView {
  readonly group = new Group();

  private readonly side: Faction;
  /** What shudders and falls; the debris and ruins stay put. */
  private readonly body = new Group();
  private readonly states: Group[] = [];
  private readonly ruins: Group;
  private readonly anchors: Vector3[][] = [];
  private readonly plastic: MeshStandardMaterial;
  private readonly glowing: MeshStandardMaterial;
  private readonly glowBase: number;
  private readonly debris: Debris;
  private readonly flag: { pole: Group; cloth: Mesh[] } | null = null;
  private readonly arm: Group | null = null;
  private state: DamageState = 0;
  private shudderLeft = 0;
  private shudderTilt = 0;
  private flashLeft = 0;
  private strikeAt = -1;
  private collapseAt = -1;
  /** Seconds the debris keeps moving after the fall, to settle, and then takes to shrink away. */
  private settleLeft = 0.8;
  private fadeLeft = 1;
  /** Ends the fall by the clock if `update` stops being called (a paused game, a hidden tab). */
  private safety: ReturnType<typeof setTimeout> | null = null;
  private collapsed: Promise<void> | null = null;
  private resolveCollapse: (() => void) | null = null;

  constructor(side: Faction) {
    this.side = side;
    const [x0, x1] = side === 'plants' ? PLANT_BASE_X : ZOMBIE_BASE_X;
    this.group.name = `base-${side}`;
    this.group.position.set((x0 + x1) / 2, 0, 2.5);
    this.group.add(this.body);

    this.plastic = new MeshStandardMaterial({ ...MATTE_PLASTIC, emissive: '#FFFFFF', emissiveIntensity: 0 });
    this.glowBase = side === 'plants' ? LAMP_GLOW : CRYPT_GLOW;
    this.glowing = glowMaterial(this.glowBase);

    const build = side === 'plants' ? plantBase : cryptBase;
    for (const state of [0, 1, 2, 3] as const) {
      const built = build(state);
      const group = this.meshes(built.builder, `state-${state}`, built.high);
      group.visible = state === 0;
      this.body.add(group);
      this.states.push(group);
      this.anchors.push(built.smoke);
    }
    this.ruins = this.meshes(build(RUINS).builder, 'ruins');
    this.ruins.visible = false;
    this.group.add(this.ruins);

    const front = side === 'plants' ? 1 : -1;
    const colors =
      side === 'plants'
        ? [PALETTE.leaf, PALETTE.leafDark, PALETTE.walnut, PALETTE.walnutDark, FX.plank, FX.leafDry]
        : [FX.cryptStone, FX.cryptStoneDark, FX.cryptRoof, FX.cryptStoneLight, PALETTE.stoneDark, FX.spireDim];
    this.debris = new Debris(90, colors, front, side === 'plants' ? 7 : 8);
    this.group.add(this.debris.mesh);

    if (side === 'plants') {
      // The flag's pole stands at the lookout's back corner; the cloth waves from its top.
      const pole = new Group();
      pole.name = 'base-flagpole';
      pole.position.set(DECK.x0 + 0.04, DECK.y + 0.04, DECK.z0 + 0.04);
      const stick = new Builder();
      stick.boxOn(0, 0, 0, 0.04, POLE - 0.02, 0.04, PALETTE.walnutDark, PALETTE.walnut);
      stick.boxOn(0, POLE - 0.02, 0, 0.05, 0.02, 0.05, PALETTE.petal);
      const stickMesh = new Mesh(stick.solid.build(), this.plastic);
      stickMesh.userData.boxes = stick.boxes;
      stickMesh.castShadow = false;
      pole.add(stickMesh);
      const cloth = ([0, 2, 3] as const).map((s) => {
        const mesh = buildFlag(s);
        mesh.material = this.plastic;
        mesh.position.set(0.02, POLE - 0.03, 0);
        mesh.visible = s === 0;
        pole.add(mesh);
        return mesh;
      });
      this.body.add(pole);
      this.flag = { pole, cloth };

      const arm = new Group();
      arm.name = 'base-strike';
      const vine = buildArm();
      vine.material = this.plastic;
      arm.add(vine);
      arm.visible = false;
      arm.position.set(0.55, 0.5, 0);
      this.body.add(arm);
      this.arm = arm;
    }
    this.group.updateMatrixWorld(true);
  }

  /** Shows the damage state for `fraction` of full health. */
  setHealth(fraction: number): void {
    if (this.collapseAt >= 0) return;
    const state: DamageState = fraction >= 0.75 ? 0 : fraction >= 0.5 ? 1 : fraction >= 0.25 ? 2 : 3;
    if (state === this.state) return;
    this.state = state;
    this.states.forEach((group, i) => (group.visible = i === state));
    if (this.flag) {
      const [full, torn, tattered] = this.flag.cloth as [Mesh, Mesh, Mesh];
      full.visible = state <= 1;
      torn.visible = state === 2;
      tattered.visible = state === 3;
      // At the last, the pole leans.
      this.flag.pole.rotation.set(state === 3 ? 0.2 : 0, 0, state === 3 ? 0.35 : 0);
      this.flag.pole.position.y = DECK.y + 0.04 - (state === 3 ? 0.18 : 0);
    }
  }

  /** A short shudder and flash: the base has been hit, from `lane` if it is known. */
  hit(lane: number | null): void {
    if (this.collapseAt >= 0) return;
    this.shudderLeft = SHUDDER_SECONDS;
    this.flashLeft = FLASH_SECONDS;
    this.shudderTilt = lane === null ? 0 : Math.sign(lane - 2) * 0.012;
  }

  /** The plants' base strikes back: a vine swats towards `lane` over a quarter of a second. Zombies' base: nothing. */
  strike(lane: number): void {
    if (!this.arm || this.collapseAt >= 0) return;
    this.arm.position.z = Math.min(4.5, Math.max(0.5, lane + 0.5)) - 2.5;
    this.arm.visible = true;
    this.strikeAt = 0;
    this.poseArm(0);
  }

  /**
   * Breaks the base into debris over 1.6 s of updates and resolves when it has fallen. If the
   * updates stop (a paused game, a hidden tab), a clock ends it 0.75 s after it was due.
   */
  collapse(): Promise<void> {
    if (this.collapsed) return this.collapsed;
    this.collapsed = new Promise<void>((resolve) => (this.resolveCollapse = resolve));
    this.collapseAt = 0;
    this.shudderLeft = 0;
    this.strikeAt = -1;
    if (this.arm) this.arm.visible = false;
    this.debris.start();
    this.safety = setTimeout(() => this.endCollapse(true), (COLLAPSE_SECONDS + COLLAPSE_GRACE) * 1000);
    return this.collapsed;
  }

  /** Where smoke should rise at the current state, in world space. Empty while unhurt and after the fall. */
  smokeAnchors(): Vector3[] {
    if (this.collapseAt >= COLLAPSE_SECONDS) return [];
    this.group.updateMatrixWorld();
    return (this.anchors[this.state] as Vector3[]).map((p) => this.group.localToWorld(p.clone()));
  }

  /** Moves the shudder, the swat, the fall, the flag and the glow on. */
  update(dtSeconds: number, timeSeconds: number): void {
    const dt = Math.max(0, dtSeconds);
    const body = this.body;

    // The flag waves; the lamp and the crystals breathe, and flicker once hurt.
    if (this.flag) {
      const cloth = this.flag.cloth;
      const wave = Math.sin(timeSeconds * 3.2) * 0.22 + Math.sin(timeSeconds * 7.3) * 0.06;
      for (let i = 0; i < cloth.length; i++) (cloth[i] as Mesh).rotation.y = wave;
    }
    const flicker = this.state >= 2 && hash2(Math.floor(timeSeconds * 9), this.state, 141) < 0.25 * (this.state - 1) ? 0.55 : 1;
    this.glowing.emissiveIntensity = this.glowBase * (1 + 0.1 * Math.sin(timeSeconds * 2.3)) * flicker;

    // Hit: a quick shake that dies away, and a white flash at the start.
    if (this.shudderLeft > 0) {
      this.shudderLeft = Math.max(0, this.shudderLeft - dt);
      const k = this.shudderLeft / SHUDDER_SECONDS;
      const t = SHUDDER_SECONDS - this.shudderLeft;
      body.position.x = Math.sin(t * 75) * 0.04 * k;
      body.rotation.x = this.shudderTilt * Math.sin(t * 60) * k;
      body.rotation.z = Math.sin(t * 55 + 1) * 0.01 * k;
      if (this.shudderLeft === 0) {
        body.position.x = 0;
        body.rotation.set(0, 0, 0);
      }
    }
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.plastic.emissiveIntensity = this.flashLeft > 0 ? 0.35 * (this.flashLeft / FLASH_SECONDS) : 0;

    if (this.strikeAt >= 0) {
      this.strikeAt += dt;
      if (this.strikeAt >= STRIKE_SECONDS) {
        this.strikeAt = -1;
        if (this.arm) this.arm.visible = false;
      } else {
        this.poseArm(this.strikeAt);
      }
    }

    if (this.collapseAt >= 0 && this.collapseAt < COLLAPSE_SECONDS) {
      this.collapseAt = Math.min(COLLAPSE_SECONDS, this.collapseAt + dt);
      const t = this.collapseAt;
      // Shakes hard, then sinks and squashes into the ground while the cubes fly.
      const shake = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.9);
      body.position.x = Math.sin(t * 70) * 0.05 * shake;
      body.rotation.z = Math.sin(t * 43) * 0.02 * shake;
      const fall = easeIn(clamp01((t - 0.3) / 1.0));
      body.position.y = -1.4 * fall;
      body.scale.set(1 + 0.08 * fall, Math.max(0.05, 1 - 0.75 * fall), 1 + 0.04 * fall);
      body.visible = t < 1.32;
      this.ruins.visible = t > 0.85;
      this.ruins.position.y = -0.5 * (1 - easeOut(clamp01((t - 0.85) / 0.6)));
      this.debris.update(dt, t);
      if (this.collapseAt >= COLLAPSE_SECONDS) this.endCollapse(false);
    } else if (this.collapseAt >= COLLAPSE_SECONDS && this.settleLeft > 0) {
      // The last cubes come to rest …
      this.settleLeft = Math.max(0, this.settleLeft - dt);
      this.debris.update(dt, COLLAPSE_SECONDS);
    } else if (this.collapseAt >= COLLAPSE_SECONDS && this.fadeLeft > 0) {
      // … then shrink away, so none is left lying on the lawn; only the ruins stay.
      this.fadeLeft = Math.max(0, this.fadeLeft - dt);
      if (this.fadeLeft > 0) this.debris.update(dt, COLLAPSE_SECONDS, this.fadeLeft);
      else this.debris.hide();
    }
  }

  /**
   * The end of the fall: the ruins in place, the base gone, the promise kept. `snap` is the
   * clock's safety net firing because `update` stopped: everything jumps to the end at once.
   */
  private endCollapse(snap: boolean): void {
    if (this.safety !== null) clearTimeout(this.safety);
    this.safety = null;
    this.collapseAt = COLLAPSE_SECONDS;
    this.ruins.visible = true;
    this.ruins.position.y = 0;
    this.body.visible = false;
    if (snap) {
      this.settleLeft = 0;
      this.fadeLeft = 0;
      this.debris.hide();
    }
    this.resolveCollapse?.();
    this.resolveCollapse = null;
  }

  /** Frees every geometry and material of this base. Take `group` out of the scene first. */
  dispose(): void {
    if (this.safety !== null) clearTimeout(this.safety);
    this.safety = null;
    this.group.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    (this.debris.mesh.material as MeshStandardMaterial).dispose();
    this.debris.mesh.dispose();
    this.plastic.dispose();
    this.glowing.dispose();
  }

  /** Wind up, swat down across the lawn's edge, swing back and tuck away. */
  private poseArm(t: number): void {
    const arm = this.arm;
    if (!arm) return;
    let angle: number;
    let scale: number;
    if (t < 0.08) {
      const k = easeOut(t / 0.08);
      angle = 1.3 + 0.45 * k;
      scale = 0.4 + 0.6 * k;
    } else if (t < 0.15) {
      angle = 1.75 - 2.1 * easeIn((t - 0.08) / 0.07);
      scale = 1;
    } else {
      const k = easeOut((t - 0.15) / 0.1);
      angle = -0.35 + 1.6 * k;
      scale = 1 - 0.7 * k;
    }
    arm.rotation.set(0, 0, angle);
    arm.scale.setScalar(scale * ARM_SCALE);
  }

  private meshes(builder: Builder, name: string, high?: Builder): Group {
    const group = new Group();
    group.name = name;
    const solid = new Mesh(builder.solid.build(), this.plastic);
    solid.name = `${name}:solid`;
    solid.castShadow = true;
    solid.receiveShadow = true;
    group.add(solid);
    const glowGeometry = builder.glow.build();
    if ((glowGeometry.index?.count ?? 0) > 0) {
      const glow = new Mesh(glowGeometry, this.glowing);
      glow.name = `${name}:glow`;
      glow.castShadow = true;
      group.add(glow);
    } else {
      glowGeometry.dispose();
    }
    // The test of the damage states counts boxes; the glowing ones are in the plain mesh's tally.
    solid.userData.boxes = builder.boxes;
    if (high && high.boxes > 0) {
      const raised = new Mesh(high.solid.build(), this.plastic);
      raised.name = `${name}:high`;
      raised.castShadow = false;
      raised.receiveShadow = true;
      raised.userData.boxes = high.boxes;
      group.add(raised);
    }
    return group;
  }
}
