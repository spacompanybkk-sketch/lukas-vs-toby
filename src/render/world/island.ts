import { type BufferGeometry, type Color } from 'three';
import { GRAVE_FROM_COL, LAWN_COLS, LAWN_LANES, PLANT_BASE_X, ZOMBIE_BASE_X } from '../coords';
import { PALETTE } from '../palette';
import { BoxBatch, hash2, shade, valueNoise } from './boxes';
import { bone, bush, flower, gravestone } from './props';

/** Island voxels are a quarter of a tile. */
const CELL = 0.25;
const GRID_X0 = -3.25;
const GRID_Z0 = -1.75;
const GRID_NX = 66;
const GRID_NZ = 34;

/** Ground that must exist whatever the edge noise says: the lawn, both base pads and a walkway round them. */
const SOLID = { x0: PLANT_BASE_X[0] - 0.25, x1: ZOMBIE_BASE_X[1] + 0.25, z0: -0.3, z1: LAWN_LANES + 0.3 };

/** How far inside the island's edge a point is, in tiles; zero or less is open sky. */
export function insideIsland(x: number, z: number): number {
  const radius = 1.5;
  const qx = Math.abs(x - LAWN_COLS / 2) - (7.05 - radius);
  const qz = Math.abs(z - LAWN_LANES / 2) - (3.3 - radius);
  const sdf = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - radius;
  const ragged = (valueNoise(x * 0.5, z * 0.5, 3) - 0.5) * 0.7 + (valueNoise(x * 1.6, z * 1.6, 5) - 0.5) * 0.25;
  const core = Math.min(x - SOLID.x0, SOLID.x1 - x, z - SOLID.z0, SOLID.z1 - z) + CELL;
  return Math.max(-(sdf + ragged), core);
}

/** How deep the island reaches below a point `inside` tiles from its edge. */
function islandDepth(x: number, z: number, inside: number): number {
  if (inside <= 0) return 0;
  // The outermost ring is a clean band: one voxel of turf on two of soil.
  if (inside <= CELL) return 3 * CELL;
  // Behind it a rock cliff, stepping back slowly enough to be seen from the camera …
  const cliff = 0.75 + (inside - CELL) * 4.2;
  // … down to a belly whose depth wanders along the island and hangs in a few rocky teeth.
  const ridge = valueNoise(x * 0.42 + 1.7, z * 0.3, 9);
  const tooth = Math.max(0, valueNoise(x * 0.9, z * 0.9, 17) - 0.6) * 4.5;
  const belly = 2.5 + ridge * ridge * 2.3 + tooth;
  const depth = Math.min(cliff, belly);
  // Soil in quarter-tile layers, rock in chunkier half-tile blocks.
  return depth <= 1 ? Math.round(depth / CELL) * CELL : Math.round(depth / 0.5) * 0.5;
}

/** True where the ground belongs to Toby's end. The border wanders so it does not read as a ruled line. */
export function onGraveSide(x: number, z: number): boolean {
  return x + (valueNoise(x * 1.1, z * 1.1, 13) - 0.5) * 1.1 > GRAVE_FROM_COL + 0.45;
}

/** True on the 10 × 5 playable tiles. */
export const inLawn = (x: number, z: number): boolean => x > 0 && x < LAWN_COLS && z > 0 && z < LAWN_LANES;

/** Colour of the top face of the ground voxel centred on (x, z). */
function groundColor(x: number, z: number, i: number, k: number): Color {
  const speckle = (hash2(i, k, 1) - 0.5) * 0.022;
  const patch = (valueNoise(x * 0.55, z * 0.55, 7) - 0.5) * 0.04;
  if (inLawn(x, z)) {
    const col = Math.floor(x);
    const lane = Math.floor(z);
    const light = (col + lane) % 2 === 0;
    const tile = (hash2(col, lane, 2) - 0.5) * 0.014;
    if (col < GRAVE_FROM_COL) return shade(light ? PALETTE.grassLight : PALETTE.grassDark, speckle + patch + tile);
    return shade(light ? PALETTE.graveLight : PALETTE.graveDark, speckle * 0.8 + patch * 0.6 + tile);
  }
  // The rim falls away a little towards the island's edge, which gives the slab some form.
  const edge = 1 - 0.14 * (1 - Math.min(1, Math.max(0, insideIsland(x, z) / 0.9)));
  if (onGraveSide(x, z)) {
    // Toby's base stands on worn flagstones, half a tile each.
    const paved = x > ZOMBIE_BASE_X[0] && x < ZOMBIE_BASE_X[1] + 0.25 && z > 0 && z < LAWN_LANES;
    const slab = paved ? (hash2(Math.floor(x / 0.5), Math.floor(z / 0.5), 31) - 0.5) * 0.05 + 0.02 : 0;
    return shade(PALETTE.rimGrave, speckle + patch * 0.7 + slab).multiplyScalar(edge);
  }
  return shade(PALETTE.rimGrass, speckle * 1.3 + patch * 1.2).multiplyScalar(edge);
}

/**
 * Darkening at a ground vertex: lane edges and the lawn's outline are drawn as soft creases
 * in the vertex colours, so there is no thin geometry to shimmer.
 */
function crease(vx: number, vz: number): number {
  const onX = Math.abs(vx - Math.round(vx)) < 1e-6 && vx >= 0 && vx <= LAWN_COLS;
  const onZ = Math.abs(vz - Math.round(vz)) < 1e-6 && vz >= 0 && vz <= LAWN_LANES;
  const withinX = vx >= -1e-6 && vx <= LAWN_COLS + 1e-6;
  const withinZ = vz >= -1e-6 && vz <= LAWN_LANES + 1e-6;
  // The filmic curve flattens bright greens, so these have to be bolder than they sound.
  let factor = 1;
  if (onZ && withinX) {
    const z = Math.round(vz);
    factor = z === 0 || z === LAWN_LANES ? 0.58 : 0.66;
  }
  if (onX && withinZ) {
    const x = Math.round(vx);
    factor = Math.min(factor, x === 0 || x === LAWN_COLS ? 0.58 : x === GRAVE_FROM_COL ? 0.62 : 0.88);
  }
  return factor;
}

/** Colour of the side of the island voxel in layer `n` (0 is the lip) at (x, z). */
function wallColor(x: number, z: number, n: number): Color {
  const grave = onGraveSide(x, z);
  // Colours are picked per half-tile block so the rock reads as big chunks.
  const bx = Math.floor(x / 0.5);
  const bz = Math.floor(z / 0.5);
  const by = Math.floor(n / 2);
  const block = hash2(bx * 31 + by * 7, bz * 17 - by * 3, 21);
  const speckle = (hash2(Math.floor(x / CELL) * 13 + n * 5, Math.floor(z / CELL) * 11 - n, 23) - 0.5) * 0.02;

  if (n === 0) return shade(grave ? PALETTE.rimGrave : PALETTE.leafDark, grave ? -0.02 + speckle : 0.02 + speckle);

  // The soil band is two or three layers thick depending on the block.
  const soilLayers = 2 + (block > 0.55 ? 1 : 0);
  if (n <= soilLayers) {
    const dark = n === soilLayers || block < 0.18;
    const soil = grave ? PALETTE.graveSoil : dark ? PALETTE.soilDark : PALETTE.soil;
    return shade(soil, (grave && dark ? -0.035 : 0) + speckle + (block - 0.5) * 0.03);
  }

  const depth = n * CELL;
  const fade = 1 - 0.24 * Math.min(1, Math.max(0, (depth - 0.9) / 3.6));
  const tone = block < 0.2 ? -0.07 : block < 0.5 ? -0.025 : block < 0.82 ? 0.015 : 0.06;
  return shade(grave ? PALETTE.graveRock : PALETTE.islandRock, tone + speckle).multiplyScalar(fade);
}

/** The island as one mesh: grass, tiles and graveyard strip on top, soil rim and rock underneath. */
export function buildIsland(): BufferGeometry {
  const depth = new Float32Array(GRID_NX * GRID_NZ);
  for (let k = 0; k < GRID_NZ; k++) {
    for (let i = 0; i < GRID_NX; i++) {
      const x = GRID_X0 + (i + 0.5) * CELL;
      const z = GRID_Z0 + (k + 0.5) * CELL;
      depth[k * GRID_NX + i] = islandDepth(x, z, insideIsland(x, z));
    }
  }
  const depthAt = (i: number, k: number): number =>
    i < 0 || k < 0 || i >= GRID_NX || k >= GRID_NZ ? 0 : (depth[k * GRID_NX + i] as number);

  const batch = new BoxBatch();
  for (let k = 0; k < GRID_NZ; k++) {
    for (let i = 0; i < GRID_NX; i++) {
      const d = depthAt(i, k);
      if (d <= 0) continue;
      const x0 = GRID_X0 + i * CELL;
      const z0 = GRID_Z0 + k * CELL;
      const x1 = x0 + CELL;
      const z1 = z0 + CELL;
      const cx = x0 + CELL / 2;
      const cz = z0 + CELL / 2;

      const top = groundColor(cx, cz, i, k);
      const lawn = inLawn(cx, cz);
      // Outside the lawn only the vertices that lie on its outline are darkened.
      const tint = (vx: number, vz: number): Color => {
        const factor = crease(vx, vz);
        if (factor === 1) return top;
        return top.clone().multiplyScalar(lawn ? factor : 0.5 + factor / 2);
      };
      batch.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [
        tint(x0, z1),
        tint(x1, z1),
        tint(x1, z0),
        tint(x0, z0),
      ]);
      // The underside is never seen but it is what casts the island's own shadow.
      batch.quad([x0, -d, z0], [x1, -d, z0], [x1, -d, z1], [x0, -d, z1], [0, -1, 0], wallColor(cx, cz, Math.round(d / CELL)));

      const layers = Math.round(d / CELL);
      const wall = (neighbour: number, face: (yb: number, yt: number, color: Color) => void): void => {
        for (let n = Math.round(neighbour / CELL); n < layers; n++) {
          face(-(n + 1) * CELL, -n * CELL, wallColor(cx, cz, n));
        }
      };
      wall(depthAt(i, k + 1), (yb, yt, c) => batch.quad([x0, yb, z1], [x1, yb, z1], [x1, yt, z1], [x0, yt, z1], [0, 0, 1], c));
      wall(depthAt(i, k - 1), (yb, yt, c) => batch.quad([x1, yb, z0], [x0, yb, z0], [x0, yt, z0], [x1, yt, z0], [0, 0, -1], c));
      wall(depthAt(i + 1, k), (yb, yt, c) => batch.quad([x1, yb, z1], [x1, yb, z0], [x1, yt, z0], [x1, yt, z1], [1, 0, 0], c));
      wall(depthAt(i - 1, k), (yb, yt, c) => batch.quad([x0, yb, z0], [x0, yb, z1], [x0, yt, z1], [x0, yt, z0], [-1, 0, 0], c));
    }
  }
  return batch.build();
}

/**
 * A small rock adrift beside the island, its top at y = 0: a garden one with a shrub and
 * flowers, or a `grave` one with a gravestone and a bone.
 */
export function buildIslet(grave: boolean, random: () => number): BufferGeometry {
  const batch = new BoxBatch();
  const top = grave ? PALETTE.rimGrave : PALETTE.rimGrass;
  const lip = grave ? shade(PALETTE.rimGrave, -0.03) : PALETTE.leafDark;
  const rock = grave ? PALETTE.graveRock : PALETTE.islandRock;
  batch.boxOn(0, -0.25, 0, 1.5, 0.25, 1.25, lip, top);
  batch.boxOn(0.5, -0.25, 0.5, 0.75, 0.25, 0.75, lip, top);
  batch.boxOn(-0.05, -0.75, 0.05, 1.25, 0.5, 1.0, grave ? PALETTE.graveSoil : PALETTE.soil);
  batch.boxOn(0.1, -1.25, 0, 1.0, 0.5, 0.75, shade(rock, -0.02));
  batch.boxOn(-0.1, -1.75, 0.1, 0.5, 0.5, 0.5, shade(rock, -0.06));
  batch.boxOn(0.35, -1.5, -0.1, 0.25, 0.25, 0.25, shade(rock, 0.03));
  if (grave) {
    gravestone(batch, -0.1, 0, 0.42, 0.2, 0.1);
    bone(batch, 0.4, 0.35, 0.8, 1.3);
  } else {
    bush(batch, -0.15, -0.1, 0.9, random);
    flower(batch, 0.45, 0.3, PALETTE.petal, 1.6);
    flower(batch, 0.25, 0.42, PALETTE.bone, 1.4);
  }
  return batch.build();
}
