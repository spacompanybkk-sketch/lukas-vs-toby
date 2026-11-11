import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  type BufferGeometry,
  type ColorRepresentation,
} from 'three';
import { LAWN_COLS, LAWN_LANES, PLANT_BASE_X, ZOMBIE_BASE_X } from '../coords';
import { BoxBatch, hash2, paint, seededRandom, shade, valueNoise } from './boxes';

// Art bible section 3. World colours first, then the few plant and zombie colours the props borrow.
const GRASS_LIGHT = '#7FD14B';
const GRASS_DARK = '#6BBE3F';
const SOIL = '#8B5A2B';
const SOIL_DARK = '#6B4423';
const ROCK = '#7A6A5A';
const GRAVE_LIGHT = '#5B4B7A';
const GRAVE_DARK = '#4A3C66';
const LEAF = '#58C13B';
const LEAF_DARK = '#3E9A2E';
const LEAF_LIGHT = '#8BE05A';
const STEM = '#2F7D32';
const PETAL = '#FFC928';
const PETAL_DARK = '#F59F0B';
const FLOWER_FACE = '#8A5A2B';
const WALNUT = '#A8703A';
const WALNUT_DARK = '#7B4A22';
const WALNUT_LIGHT = '#C98F55';
const TERRACOTTA = '#C8643C';
const BONE = '#EDE6D3';
const BONE_SHADOW = '#C9BFA5';
const SUN_YELLOW = '#FFD54A';
/** The zombies' cloth purple and speed red, pushed brighter so they stay purple and red as a thin wash over green grass. */
const LANE_PURPLE = '#A35CFF';
const DENY_RED = '#F2281E';
// Mixes of the above for ground that is neither tile nor prop.
const RIM_GRASS = '#5DB53C';
const RIM_GRAVE = '#473B65';
const GRAVE_SOIL = '#51405A';
const GRAVE_ROCK = '#625A70';
const STONE = '#8E89A6';
const STONE_DARK = '#6C6787';
const CRYSTAL = '#C9A6FF';
const CRYSTAL_GLOW = '#A070FF';

/** The graveyard strip starts at this column. */
const GRAVE_FROM_COL = 8;

/** Island voxels are a quarter of a tile. */
const CELL = 0.25;
const GRID_X0 = -3.25;
const GRID_Z0 = -1.75;
const GRID_NX = 66;
const GRID_NZ = 34;

/** Ground that must exist whatever the edge noise says: the lawn, both base pads and a walkway round them. */
const SOLID = { x0: PLANT_BASE_X[0] - 0.25, x1: ZOMBIE_BASE_X[1] + 0.25, z0: -0.3, z1: LAWN_LANES + 0.3 };

/** How far inside the island's edge a point is, in tiles; zero or less is open sky. */
function insideIsland(x: number, z: number): number {
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
function onGraveSide(x: number, z: number): boolean {
  return x + (valueNoise(x * 1.1, z * 1.1, 13) - 0.5) * 1.1 > GRAVE_FROM_COL + 0.45;
}

const inLawn = (x: number, z: number): boolean => x > 0 && x < LAWN_COLS && z > 0 && z < LAWN_LANES;

/** Colour of the top face of the ground voxel centred on (x, z). */
function groundColor(x: number, z: number, i: number, k: number): Color {
  const speckle = (hash2(i, k, 1) - 0.5) * 0.022;
  const patch = (valueNoise(x * 0.55, z * 0.55, 7) - 0.5) * 0.04;
  if (inLawn(x, z)) {
    const col = Math.floor(x);
    const lane = Math.floor(z);
    const light = (col + lane) % 2 === 0;
    const tile = (hash2(col, lane, 2) - 0.5) * 0.014;
    if (col < GRAVE_FROM_COL) return shade(light ? GRASS_LIGHT : GRASS_DARK, speckle + patch + tile);
    return shade(light ? GRAVE_LIGHT : GRAVE_DARK, speckle * 0.8 + patch * 0.6 + tile);
  }
  // The rim falls away a little towards the island's edge, which gives the slab some form.
  const edge = 1 - 0.14 * (1 - Math.min(1, Math.max(0, insideIsland(x, z) / 0.9)));
  if (onGraveSide(x, z)) {
    // Toby's base stands on worn flagstones, half a tile each.
    const paved = x > ZOMBIE_BASE_X[0] && x < ZOMBIE_BASE_X[1] + 0.25 && z > 0 && z < LAWN_LANES;
    const slab = paved ? (hash2(Math.floor(x / 0.5), Math.floor(z / 0.5), 31) - 0.5) * 0.05 + 0.02 : 0;
    return shade(RIM_GRAVE, speckle + patch * 0.7 + slab).multiplyScalar(edge);
  }
  return shade(RIM_GRASS, speckle * 1.3 + patch * 1.2).multiplyScalar(edge);
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

  if (n === 0) return shade(grave ? RIM_GRAVE : LEAF_DARK, grave ? -0.02 + speckle : 0.02 + speckle);

  // The soil band is two or three layers thick depending on the block.
  const soilLayers = 2 + (block > 0.55 ? 1 : 0);
  if (n <= soilLayers) {
    const dark = n === soilLayers || block < 0.18;
    const soil = grave ? GRAVE_SOIL : dark ? SOIL_DARK : SOIL;
    return shade(soil, (grave && dark ? -0.035 : 0) + speckle + (block - 0.5) * 0.03);
  }

  const depth = n * CELL;
  const fade = 1 - 0.24 * Math.min(1, Math.max(0, (depth - 0.9) / 3.6));
  const tone = block < 0.2 ? -0.07 : block < 0.5 ? -0.025 : block < 0.82 ? 0.015 : 0.06;
  return shade(grave ? GRAVE_ROCK : ROCK, tone + speckle).multiplyScalar(fade);
}

/** The island as one mesh: grass, tiles and graveyard strip on top, soil rim and rock underneath. */
function buildIsland(): BufferGeometry {
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

// ---------------------------------------------------------------------------------------
// Props. Everything is boxes; sizes are in tiles. Nothing on a playable tile is taller
// than 0.25.

const turn = new Matrix4();
const place = new Matrix4();

/** Runs `build` with the batch's origin moved to (x, 0, z), turned by `yaw` and leaning by `lean` radians. */
function at(batch: BoxBatch, x: number, z: number, yaw: number, lean: number, build: () => void): void {
  place.makeTranslation(x, 0, z).multiply(turn.makeRotationY(yaw)).multiply(turn.makeRotationZ(lean));
  batch.transformed(place.clone(), build);
}

/** A tiny daisy: stem, four petals and a centre. About 0.12 tall at scale 1. */
function flower(batch: BoxBatch, x: number, z: number, petal: ColorRepresentation, scale = 1): void {
  const u = 0.032 * scale;
  const stem = 0.075 * scale;
  at(batch, x, z, 0, 0, () => {
    batch.boxOn(0, 0, 0, u * 0.7, stem, u * 0.7, STEM);
    batch.boxOn(-u, stem, 0, u, u * 0.8, u, petal);
    batch.boxOn(u, stem, 0, u, u * 0.8, u, petal);
    batch.boxOn(0, stem, -u, u, u * 0.8, u, petal);
    batch.boxOn(0, stem, u, u, u * 0.8, u, petal);
    batch.boxOn(0, stem, 0, u, u * 1.15, u, petal === PETAL ? FLOWER_FACE : PETAL);
  });
}

/** A rounded shrub made of a few stacked blocks. */
function bush(batch: BoxBatch, x: number, z: number, s: number, random: () => number): void {
  at(batch, x, z, (random() - 0.5) * 0.6, 0, () => {
    batch.boxOn(0, 0, 0, 0.5 * s, 0.2 * s, 0.4 * s, LEAF_DARK, LEAF);
    batch.boxOn(-0.04 * s, 0.2 * s, 0.01 * s, 0.38 * s, 0.14 * s, 0.32 * s, LEAF, shade(LEAF, 0.03));
    batch.boxOn(0.05 * s, 0.34 * s, -0.01 * s, 0.22 * s, 0.1 * s, 0.2 * s, shade(LEAF, 0.03), LEAF_LIGHT);
    batch.boxOn(0.27 * s, 0, 0.1 * s, 0.16 * s, 0.13 * s, 0.18 * s, LEAF_DARK, LEAF);
  });
}

function rock(batch: BoxBatch, x: number, z: number, s: number, color: ColorRepresentation, yaw: number): void {
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.2 * s, 0.1 * s, 0.16 * s, shade(color, -0.04), color);
    batch.boxOn(-0.02 * s, 0.1 * s, 0.01 * s, 0.11 * s, 0.05 * s, 0.1 * s, color, shade(color, 0.05));
  });
}

function mushroom(batch: BoxBatch, x: number, z: number, s: number): void {
  at(batch, x, z, 0, 0, () => {
    batch.boxOn(0, 0, 0, 0.035 * s, 0.06 * s, 0.035 * s, BONE_SHADOW, BONE);
    batch.boxOn(0, 0.06 * s, 0, 0.11 * s, 0.035 * s, 0.11 * s, TERRACOTTA, shade(TERRACOTTA, 0.04));
    batch.boxOn(0, 0.095 * s, 0, 0.065 * s, 0.03 * s, 0.065 * s, shade(TERRACOTTA, 0.04), shade(TERRACOTTA, 0.08));
    batch.boxOn(0.03 * s, 0.096 * s, 0.03 * s, 0.022 * s, 0.006 * s, 0.022 * s, BONE);
    batch.boxOn(-0.035 * s, 0.096 * s, -0.01 * s, 0.018 * s, 0.006 * s, 0.018 * s, BONE);
  });
}

/** A gravestone with stepped shoulders, `h` tall, facing the camera. */
function gravestone(batch: BoxBatch, x: number, z: number, h: number, yaw: number, lean: number, cross = false): void {
  const w = h * 0.62;
  const t = h * 0.24;
  at(batch, x, z, yaw, lean, () => {
    batch.boxOn(0, 0, 0, w * 1.25, h * 0.12, t * 1.5, STONE_DARK, shade(STONE_DARK, 0.03));
    if (cross) {
      batch.boxOn(0, h * 0.12, 0, w * 0.34, h * 0.88, t, STONE, shade(STONE, 0.05));
      batch.boxOn(0, h * 0.56, 0, w, h * 0.2, t, STONE, shade(STONE, 0.05));
    } else {
      batch.boxOn(0, h * 0.12, 0, w, h * 0.62, t, STONE, shade(STONE, 0.05));
      batch.boxOn(0, h * 0.74, 0, w * 0.74, h * 0.16, t, STONE, shade(STONE, 0.05));
      batch.boxOn(0, h * 0.9, 0, w * 0.4, h * 0.1, t, STONE, shade(STONE, 0.07));
      // A chiselled line or two on the face.
      batch.boxOn(0, h * 0.52, t / 2, w * 0.5, h * 0.05, 0.006, STONE_DARK);
      batch.boxOn(0, h * 0.38, t / 2, w * 0.34, h * 0.05, 0.006, STONE_DARK);
    }
  });
}

/** A small leafy tree, `h` tall. */
function tree(batch: BoxBatch, x: number, z: number, h: number, yaw: number): void {
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.13 * h, 0.42 * h, 0.13 * h, WALNUT_DARK, WALNUT);
    batch.boxOn(0, 0.36 * h, 0, 0.62 * h, 0.26 * h, 0.56 * h, LEAF_DARK, LEAF);
    batch.boxOn(-0.02 * h, 0.62 * h, 0.01 * h, 0.48 * h, 0.2 * h, 0.44 * h, LEAF, shade(LEAF, 0.03));
    batch.boxOn(0.03 * h, 0.82 * h, -0.01 * h, 0.28 * h, 0.16 * h, 0.26 * h, shade(LEAF, 0.03), LEAF_LIGHT);
    batch.boxOn(0.3 * h, 0.44 * h, 0.1 * h, 0.2 * h, 0.16 * h, 0.22 * h, LEAF_DARK, LEAF);
  });
}

/** A leafless, crooked tree for the graveyard, `h` tall. */
function deadTree(batch: BoxBatch, x: number, z: number, h: number, yaw: number): void {
  const bark = '#5A4960';
  const pale = '#73607A';
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.2 * h, 0.1 * h, 0.2 * h, bark, pale);
    batch.boxOn(0, 0.1 * h, 0, 0.13 * h, 0.4 * h, 0.13 * h, bark, pale);
    batch.boxOn(0.05 * h, 0.5 * h, 0, 0.11 * h, 0.3 * h, 0.11 * h, bark, pale);
    batch.boxOn(0, 0.8 * h, 0, 0.085 * h, 0.2 * h, 0.085 * h, bark, pale);
    // Right bough and its upturned tip.
    batch.boxOn(0.22 * h, 0.56 * h, 0, 0.3 * h, 0.075 * h, 0.075 * h, bark, pale);
    batch.boxOn(0.34 * h, 0.63 * h, 0, 0.07 * h, 0.2 * h, 0.07 * h, bark, pale);
    // Left bough, lower.
    batch.boxOn(-0.17 * h, 0.34 * h, 0, 0.24 * h, 0.065 * h, 0.065 * h, bark, pale);
    batch.boxOn(-0.26 * h, 0.4 * h, 0, 0.06 * h, 0.17 * h, 0.06 * h, bark, pale);
    // A twig near the top.
    batch.boxOn(-0.09 * h, 0.86 * h, 0, 0.14 * h, 0.05 * h, 0.05 * h, bark, pale);
    batch.boxOn(-0.14 * h, 0.9 * h, 0, 0.045 * h, 0.1 * h, 0.045 * h, bark, pale);
  });
}

/** A terracotta pot with a seedling. */
function pot(batch: BoxBatch, x: number, z: number, s: number): void {
  at(batch, x, z, 0.3, 0, () => {
    batch.boxOn(0, 0, 0, 0.15 * s, 0.12 * s, 0.15 * s, shade(TERRACOTTA, -0.04), TERRACOTTA);
    batch.boxOn(0, 0.12 * s, 0, 0.19 * s, 0.045 * s, 0.19 * s, TERRACOTTA, SOIL_DARK);
    batch.boxOn(0, 0.165 * s, 0, 0.03 * s, 0.1 * s, 0.03 * s, STEM);
    batch.boxOn(-0.045 * s, 0.24 * s, 0, 0.08 * s, 0.03 * s, 0.05 * s, LEAF, LEAF_LIGHT);
    batch.boxOn(0.045 * s, 0.27 * s, 0, 0.08 * s, 0.03 * s, 0.05 * s, LEAF, LEAF_LIGHT);
  });
}

/** A bone lying flat. */
function bone(batch: BoxBatch, x: number, z: number, yaw: number, s = 1): void {
  const u = 0.03 * s;
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.15 * s, u, u, BONE_SHADOW, BONE);
    for (const end of [-1, 1]) {
      batch.boxOn(end * 0.085 * s, 0, -u * 0.6, u * 1.2, u * 1.25, u * 1.1, BONE_SHADOW, BONE);
      batch.boxOn(end * 0.085 * s, 0, u * 0.6, u * 1.2, u * 1.25, u * 1.1, BONE_SHADOW, BONE);
    }
  });
}

/** A crack in the graveyard ground: a few hair-thin dark slabs. */
function crack(batch: BoxBatch, x: number, z: number, yaw: number, s: number): void {
  const dark = shade(GRAVE_DARK, -0.09);
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.16 * s, 0.004, 0.022, dark);
    batch.boxOn(0.1 * s, 0, 0.035 * s, 0.1 * s, 0.004, 0.02, dark);
    batch.boxOn(-0.09 * s, 0, -0.03 * s, 0.07 * s, 0.004, 0.018, dark);
  });
}

/** A cluster of crystal shards (goes in the glowing mesh). */
function crystals(batch: BoxBatch, x: number, y: number, z: number, s: number, random: () => number): void {
  const shard = (dx: number, dz: number, w: number, h: number, yaw: number, lean: number): void => {
    place
      .makeTranslation(x + dx * s, y, z + dz * s)
      .multiply(turn.makeRotationY(yaw))
      .multiply(turn.makeRotationZ(lean));
    batch.transformed(place.clone(), () => {
      batch.boxOn(0, 0, 0, w * s, h * s, w * s, shade(CRYSTAL, -0.12), CRYSTAL);
      batch.boxOn(0, h * s, 0, w * 0.55 * s, w * 0.6 * s, w * 0.55 * s, CRYSTAL, shade(CRYSTAL, 0.06));
    });
  };
  shard(0, 0, 0.09, 0.3, random() * 1.5, 0.12);
  shard(0.1, 0.03, 0.065, 0.19, random() * 1.5, -0.32);
  shard(-0.09, 0.04, 0.055, 0.15, random() * 1.5, 0.38);
}

/** A run of garden fence along +X from `x0` to `x1` at depth `z`. */
function fence(batch: BoxBatch, x0: number, x1: number, z: number, random: () => number): void {
  const gap = 0.26;
  const count = Math.round((x1 - x0) / gap);
  for (let i = 0; i <= count; i++) {
    const x = x0 + ((x1 - x0) * i) / count;
    const tall = i % 4 === 0;
    const h = (tall ? 0.36 : 0.29) + (random() - 0.5) * 0.02;
    const wood = shade(WALNUT_LIGHT, (random() - 0.5) * 0.05);
    at(batch, x, z, 0, (random() - 0.5) * 0.05, () => {
      batch.boxOn(0, 0, 0, tall ? 0.085 : 0.07, h, 0.045, wood, shade(wood, 0.05));
      batch.boxOn(0, h, 0, tall ? 0.05 : 0.04, 0.035, 0.045, wood, shade(wood, 0.05));
    });
  }
  batch.box(x0, 0.09, z - 0.045, x1 - x0, 0.035, 0.03, WALNUT, WALNUT_LIGHT);
  batch.box(x0, 0.2, z - 0.045, x1 - x0, 0.035, 0.03, WALNUT, WALNUT_LIGHT);
}

/** Where a small prop may stand on a tile: near a corner, clear of whoever stands in the middle. */
function tileCorner(random: () => number): [number, number] {
  const near = (): number => (random() < 0.5 ? 0.07 + random() * 0.14 : 0.79 + random() * 0.14);
  return [near(), near()];
}

function buildProps(): { solid: BufferGeometry; glow: BufferGeometry } {
  const random = seededRandom(20261111);
  const solid = new BoxBatch();
  const glow = new BoxBatch();
  const petals = [PETAL, PETAL, BONE, PETAL_DARK];
  const anyPetal = (): string => petals[Math.floor(random() * petals.length)] as string;

  // --- Lukas's end: a garden fence along the back with shrubs behind it.
  fence(solid, 0.15, 7.55, -0.46, random);
  bush(solid, 1.15, -0.78, 1.05, random);
  bush(solid, 3.7, -0.8, 0.85, random);
  bush(solid, 6.2, -0.76, 1.15, random);
  bush(solid, -2.15, 0.5, 0.8, random);
  bush(solid, -2.2, 4.3, 1.0, random);
  rock(solid, 2.5, -0.78, 1.2, ROCK, 0.4);
  rock(solid, 4.9, -0.2, 0.7, ROCK, 1.1);
  tree(solid, -2.0, -0.45, 1.05, 0.2);
  pot(solid, -0.45, -0.5, 1.3);
  pot(solid, -0.75, -0.42, 1.0);
  pot(solid, -1.2, 5.45, 1.15);
  for (let i = 0; i < 9; i++) flower(solid, 0.3 + random() * 7.2, -0.3 + random() * 0.16, anyPetal(), 1.15);
  for (let i = 0; i < 5; i++) flower(solid, -2.2 + random() * 0.3, 1.2 + random() * 2.6, anyPetal(), 1.2);

  // Front rim: low things only, so nothing hides lane 4.
  for (let i = 0; i < 16; i++) flower(solid, -1.6 + random() * 9.2, 5.2 + random() * 0.45, anyPetal(), 1.1 + random() * 0.3);
  rock(solid, 1.9, 5.5, 0.9, ROCK, 0.3);
  rock(solid, 5.7, 5.62, 1.1, ROCK, 2.2);
  rock(solid, -0.7, 5.5, 0.7, ROCK, 1.4);
  mushroom(solid, 3.3, 5.48, 1.2);
  mushroom(solid, 3.47, 5.56, 0.8);
  mushroom(solid, 6.9, 5.42, 1.0);

  // Daisies on the first two columns, tucked into the tile corners.
  for (let lane = 0; lane < LAWN_LANES; lane++) {
    for (let col = 0; col < 2; col++) {
      const n = col === 0 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const [dx, dz] = tileCorner(random);
        flower(solid, col + dx, lane + dz, anyPetal(), 0.95);
      }
    }
  }
  // A few more scattered up the lawn so the garden does not stop dead.
  for (let i = 0; i < 9; i++) {
    const [dx, dz] = tileCorner(random);
    flower(solid, 2 + Math.floor(random() * 5) + dx, Math.floor(random() * LAWN_LANES) + dz, anyPetal(), 0.85);
  }

  // --- Toby's end: gravestones, bones, cracked ground and crystals.
  gravestone(solid, 8.55, -0.5, 0.62, 0.1, 0.06);
  gravestone(solid, 9.35, -0.62, 0.56, -0.15, -0.09, true);
  gravestone(solid, 9.95, -0.42, 0.38, 0.3, 0.14);
  gravestone(solid, 11.1, -0.55, 0.5, -0.2, 0.05);
  deadTree(solid, 12.05, -0.4, 1.2, 0.15);
  gravestone(solid, 8.75, 5.5, 0.26, 0.2, -0.1);
  gravestone(solid, 9.7, 5.42, 0.22, -0.3, 0.12);
  gravestone(solid, 12.1, 1.1, 0.34, -1.2, 0.08, true);
  gravestone(solid, 12.15, 3.9, 0.3, -1.4, -0.1);
  rock(solid, 10.6, 5.5, 1.0, STONE_DARK, 0.7);
  rock(solid, 8.2, -0.75, 0.9, STONE_DARK, 2.0);
  // The last fence panel has given up.
  at(solid, 7.86, -0.44, 0.22, 0.42, () => {
    solid.boxOn(0, 0, 0, 0.07, 0.3, 0.045, shade(WALNUT, -0.03), WALNUT_LIGHT);
  });
  at(solid, 8.12, -0.36, 0.5, 1.25, () => {
    solid.boxOn(0, 0, 0, 0.07, 0.3, 0.045, shade(WALNUT, -0.05), WALNUT);
  });

  for (let i = 0; i < 7; i++) bone(solid, 8.3 + random() * 3.6, -0.28 + random() * 0.12, random() * 3, 1.1);
  for (let i = 0; i < 8; i++) bone(solid, 8.3 + random() * 3.4, 5.2 + random() * 0.35, random() * 3, 1.1);
  // On the strip itself: flat bones and cracks only, near the tile corners.
  for (let lane = 0; lane < LAWN_LANES; lane++) {
    for (let col = GRAVE_FROM_COL; col < LAWN_COLS; col++) {
      const [dx, dz] = tileCorner(random);
      if (random() < 0.75) bone(solid, col + dx, lane + dz, random() * 3, 0.95);
      const [cx, cz] = tileCorner(random);
      crack(solid, col + cx, lane + cz, random() * 3, 0.9 + random() * 0.6);
      if (random() < 0.5) {
        const [px, pz] = tileCorner(random);
        solid.boxOn(col + px, 0, lane + pz, 0.045, 0.03, 0.04, STONE_DARK, STONE);
      }
    }
  }

  crystals(glow, 10.65, 0, -0.62, 1.1, random);
  crystals(glow, 12.25, 0, 2.5, 0.9, random);
  crystals(glow, 9.25, 0, 5.55, 0.7, random);
  crystals(glow, 11.55, 0, 5.5, 1.0, random);

  return { solid: solid.build(), glow: glow.build() };
}

// ---------------------------------------------------------------------------------------
// Grass tufts: one instanced mesh, bent by the wind in the vertex shader.

const TUFT_HEIGHT = 0.12;

function buildTuft(): BufferGeometry {
  const batch = new BoxBatch();
  // Shades of grey: the green comes from each instance's own colour.
  const root = new Color(0.55, 0.55, 0.55);
  const tip = new Color(1, 1, 1);
  const blade = (cx: number, cz: number, w: number, h: number): void => {
    const a = w / 2;
    const b = w / 4; // the tip is half as wide as the root
    const corners = (y: number, r: number): [number, number, number][] => [
      [cx - r, y, cz + r],
      [cx + r, y, cz + r],
      [cx + r, y, cz - r],
      [cx - r, y, cz - r],
    ];
    const low = corners(0, a);
    const high = corners(h, b);
    const normals: [number, number, number][] = [
      [0, 0.3, 1],
      [1, 0.3, 0],
      [0, 0.3, -1],
      [-1, 0.3, 0],
    ];
    for (let s = 0; s < 4; s++) {
      const t = (s + 1) % 4;
      batch.quad(
        low[s] as [number, number, number],
        low[t] as [number, number, number],
        high[t] as [number, number, number],
        high[s] as [number, number, number],
        normals[s] as [number, number, number],
        [root, root, tip, tip],
      );
    }
    batch.quad(
      high[0] as [number, number, number],
      high[1] as [number, number, number],
      high[2] as [number, number, number],
      high[3] as [number, number, number],
      [0, 1, 0],
      tip,
    );
  };
  blade(0, 0, 0.034, TUFT_HEIGHT);
  blade(-0.042, 0.02, 0.028, TUFT_HEIGHT * 0.68);
  blade(0.038, -0.022, 0.028, TUFT_HEIGHT * 0.8);
  blade(0.008, 0.045, 0.024, TUFT_HEIGHT * 0.52);
  return batch.build();
}

interface Tuft {
  x: number;
  z: number;
  scale: number;
  yaw: number;
  color: Color;
}

function scatterTufts(): Tuft[] {
  const random = seededRandom(777);
  const tufts: Tuft[] = [];
  const greens = [LEAF, LEAF, shade(LEAF, 0.04), shade(GRASS_DARK, -0.05), LEAF_LIGHT];
  const green = (): Color => paint(greens[Math.floor(random() * greens.length)] as ColorRepresentation);

  // On the grass tiles: short, and round the edges of each tile rather than under the plants.
  for (let lane = 0; lane < LAWN_LANES; lane++) {
    for (let col = 0; col < GRAVE_FROM_COL; col++) {
      const count = 3 + Math.floor(random() * 2);
      for (let i = 0; i < count; i++) {
        let dx = random();
        let dz = random();
        if (Math.hypot(dx - 0.5, dz - 0.5) < 0.33) {
          // Push it out of the middle towards the nearest edge.
          if (Math.abs(dx - 0.5) > Math.abs(dz - 0.5)) dx = dx < 0.5 ? dx * 0.3 : 1 - (1 - dx) * 0.3;
          else dz = dz < 0.5 ? dz * 0.3 : 1 - (1 - dz) * 0.3;
        }
        tufts.push({ x: col + dx, z: lane + dz, scale: 0.6 + random() * 0.45, yaw: random() * Math.PI, color: green() });
      }
    }
  }
  // On the grass rim: taller and thicker.
  for (let i = 0; i < 520 && tufts.length < 720; i++) {
    const x = -2.6 + random() * 11.6;
    const z = -1.2 + random() * 7.4;
    if (inLawn(x, z) || onGraveSide(x, z)) continue;
    if (insideIsland(x, z) < 0.3) continue;
    // Keep Lukas's base pad clear for the fortress.
    if (x > PLANT_BASE_X[0] - 0.1 && x < PLANT_BASE_X[1] + 0.1 && z > 0 && z < LAWN_LANES) continue;
    tufts.push({ x, z, scale: 0.9 + random() * 0.8, yaw: random() * Math.PI, color: green() });
  }
  return tufts;
}

// ---------------------------------------------------------------------------------------
// Placement highlight: a rounded outline with a soft fill, drawn in one quad.

const MARK_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MARK_FRAGMENT = /* glsl */ `
  uniform vec2 uSize;
  uniform vec3 uFill;
  uniform vec3 uLine;
  uniform float uPulse;
  uniform float uFillOpacity;
  uniform float uStripes;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float radius = 0.13;
    vec2 q = abs(p) - (uSize * 0.5 - 0.035 - radius);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float aa = max(fwidth(d), 1e-4);
    float inside = 1.0 - smoothstep(-aa, aa, d);
    float line = inside * smoothstep(-0.055 - aa, -0.055 + aa, d);
    // Warning stripes: a thin red wash over green grass only comes out orange, so the
    // forbidden mark is drawn as nearly solid diagonal bands with grass between them.
    float band = abs(fract((p.x + p.y) * 3.5) - 0.5) * 2.0;
    float bandAa = max(fwidth((p.x + p.y) * 3.5) * 2.0, 1e-4);
    float stripe = uStripes * smoothstep(0.52 - bandAa, 0.52 + bandAa, band);
    float fill = inside * mix(uFillOpacity * (1.0 + 0.25 * uPulse), 0.9, stripe);
    gl_FragColor = vec4(mix(uFill, uLine, line), max(line * 0.96, fill));
  }
`;

type MarkState = 'ok' | 'bad';

class Mark {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(name: string, width: number, depth: number) {
    this.material = new ShaderMaterial({
      vertexShader: MARK_VERTEX,
      fragmentShader: MARK_FRAGMENT,
      uniforms: {
        uSize: { value: new Vector2(width, depth) },
        uFill: { value: new Color() },
        uLine: { value: new Color() },
        uPulse: { value: 0 },
        uFillOpacity: { value: 0.3 },
        uStripes: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    const geometry = new PlaneGeometry(width, depth);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = name;
    this.mesh.position.y = 0.012;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /**
   * Shows the mark centred on (x, z): `fill` at `fillOpacity` inside an outline of colour
   * `line`, with warning stripes if `striped`.
   */
  show(
    x: number,
    z: number,
    fill: ColorRepresentation,
    line: ColorRepresentation,
    fillOpacity: number,
    striped = false,
  ): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    (this.material.uniforms.uFill as { value: Color }).value.set(fill);
    // The outline is a little brighter than any lit surface, so it keeps a faint glow.
    (this.material.uniforms.uLine as { value: Color }).value.set(line).multiplyScalar(1.3);
    (this.material.uniforms.uFillOpacity as { value: number }).value = fillOpacity;
    (this.material.uniforms.uStripes as { value: number }).value = striped ? 1 : 0;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  pulse(amount: number): void {
    (this.material.uniforms.uPulse as { value: number }).value = amount;
  }
}

// ---------------------------------------------------------------------------------------

/** A small rock adrift beside the island. */
interface Islet {
  mesh: Mesh;
  y: number;
  phase: number;
}

function buildIslet(grave: boolean, random: () => number): BufferGeometry {
  const batch = new BoxBatch();
  const top = grave ? RIM_GRAVE : RIM_GRASS;
  const lip = grave ? shade(RIM_GRAVE, -0.03) : LEAF_DARK;
  batch.boxOn(0, -0.25, 0, 1.5, 0.25, 1.25, lip, top);
  batch.boxOn(0.5, -0.25, 0.5, 0.75, 0.25, 0.75, lip, top);
  batch.boxOn(-0.05, -0.75, 0.05, 1.25, 0.5, 1.0, grave ? GRAVE_SOIL : SOIL);
  batch.boxOn(0.1, -1.25, 0, 1.0, 0.5, 0.75, shade(grave ? GRAVE_ROCK : ROCK, -0.02));
  batch.boxOn(-0.1, -1.75, 0.1, 0.5, 0.5, 0.5, shade(grave ? GRAVE_ROCK : ROCK, -0.06));
  batch.boxOn(0.35, -1.5, -0.1, 0.25, 0.25, 0.25, shade(grave ? GRAVE_ROCK : ROCK, 0.03));
  if (grave) {
    gravestone(batch, -0.1, 0, 0.42, 0.2, 0.1);
    bone(batch, 0.4, 0.35, 0.8, 1.3);
  } else {
    bush(batch, -0.15, -0.1, 0.9, random);
    flower(batch, 0.45, 0.3, PETAL, 1.6);
    flower(batch, 0.25, 0.42, BONE, 1.4);
  }
  return batch.build();
}

/** The battlefield: a floating island with the 10 × 5 lawn on top. */
export class Lawn {
  readonly group = new Group();

  private readonly wind = { value: 0 };
  private readonly tileMark = new Mark('tile-mark', 1, 1);
  private readonly laneMark = new Mark('lane-mark', LAWN_COLS, 1);
  private readonly islets: Islet[] = [];

  constructor() {
    this.group.name = 'lawn';

    // Art bible section 4: matte toy plastic.
    const plastic = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });

    const island = new Mesh(buildIsland(), plastic);
    island.name = 'island';
    island.castShadow = true;
    island.receiveShadow = true;
    this.group.add(island);

    const props = buildProps();
    const solid = new Mesh(props.solid, plastic);
    solid.name = 'props';
    solid.castShadow = true;
    solid.receiveShadow = true;
    this.group.add(solid);

    const glow = new Mesh(
      props.glow,
      new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.35,
        metalness: 0,
        emissive: new Color(CRYSTAL_GLOW),
        emissiveIntensity: 5,
      }),
    );
    glow.name = 'crystals';
    glow.castShadow = true;
    this.group.add(glow);

    this.group.add(this.buildGrass());

    const random = seededRandom(4242);
    // Placed to show past the island's back corners in every window shape.
    const islets: [number, number, number, boolean, number][] = [
      [-4.3, -1.6, -4.7, false, 1.0],
      [12.6, -1.5, -5.3, true, 0.9],
      [0.9, -2.5, -6.4, false, 0.55],
    ];
    for (const [x, y, z, grave, scale] of islets) {
      const mesh = new Mesh(buildIslet(grave, random), plastic);
      mesh.name = 'islet';
      mesh.position.set(x, y, z);
      mesh.rotation.y = (random() - 0.5) * 0.8;
      mesh.scale.setScalar(scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.islets.push({ mesh, y, phase: random() * 6.28 });
    }

    this.group.add(this.tileMark.mesh, this.laneMark.mesh);
    this.update(0);
  }

  /** Moves the grass, the drifting rocks and the highlight pulse to `timeSeconds`. */
  update(timeSeconds: number): void {
    this.wind.value = timeSeconds;
    for (const islet of this.islets) {
      islet.mesh.position.y = islet.y + Math.sin(timeSeconds * 0.55 + islet.phase) * 0.07;
    }
    const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * 5.5);
    this.tileMark.pulse(pulse);
    this.laneMark.pulse(pulse);
  }

  /** Marks one tile as a good (`ok`) or forbidden (`bad`) place for a plant; `null` clears it. */
  highlightTile(lane: number, col: number, state: MarkState | null): void {
    if (state === null || !(lane >= 0 && lane < LAWN_LANES && col >= 0 && col < LAWN_COLS)) {
      this.tileMark.hide();
      return;
    }
    const x = Math.floor(col) + 0.5;
    const z = Math.floor(lane) + 0.5;
    if (state === 'ok') this.tileMark.show(x, z, SUN_YELLOW, '#FFFFFF', 0.3);
    else this.tileMark.show(x, z, DENY_RED, DENY_RED, 0.2, true);
  }

  /** Marks a whole lane as a good or forbidden place to send a zombie; a `null` lane clears it. */
  highlightLane(lane: number | null, state: MarkState): void {
    if (lane === null || !(lane >= 0 && lane < LAWN_LANES)) {
      this.laneMark.hide();
      return;
    }
    const z = Math.floor(lane) + 0.5;
    if (state === 'ok') this.laneMark.show(LAWN_COLS / 2, z, LANE_PURPLE, '#FFFFFF', 0.34);
    else this.laneMark.show(LAWN_COLS / 2, z, DENY_RED, DENY_RED, 0.2, true);
  }

  private buildGrass(): InstancedMesh {
    const tufts = scatterTufts();
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const wind = this.wind;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          #ifdef USE_INSTANCING
            // Each tuft leans with a slow gust and a quicker flutter, timed by where it stands.
            vec3 tuftRoot = instanceMatrix[3].xyz;
            float gust = sin(uWind * 1.3 + tuftRoot.x * 0.8 + tuftRoot.z * 1.1) * 0.65
                       + sin(uWind * 2.9 + tuftRoot.x * 2.3 - tuftRoot.z * 1.7) * 0.35;
            vec3 windLocal = normalize(transpose(mat3(instanceMatrix)) * vec3(1.0, 0.0, 0.3));
            float bend = position.y / ${TUFT_HEIGHT.toFixed(3)};
            transformed += windLocal * (0.03 + gust * 0.022) * bend * bend;
          #endif`,
        );
    };

    const mesh = new InstancedMesh(buildTuft(), material, tufts.length);
    mesh.name = 'grass';
    mesh.receiveShadow = true;
    const dummy = new Object3D();
    tufts.forEach((tuft, i) => {
      dummy.position.set(tuft.x, 0, tuft.z);
      dummy.rotation.set(0, tuft.yaw, 0);
      dummy.scale.setScalar(tuft.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tuft.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // The wind moves vertices outside each tuft's own bounds; never cull the patch as a whole.
    mesh.frustumCulled = false;
    return mesh;
  }
}
