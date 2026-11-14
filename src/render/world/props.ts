import { Matrix4, Mesh, MeshStandardMaterial, type BufferGeometry, type ColorRepresentation, type Object3D } from 'three';
import { GRAVE_FROM_COL, LAWN_COLS, LAWN_LANES } from '../coords';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import { BoxBatch, seededRandom, shade } from './boxes';

// Props. Everything is boxes; sizes are in tiles. Nothing on a playable tile is taller
// than 0.25.

const turn = new Matrix4();
const place = new Matrix4();

/** Runs `build` with the batch's origin moved to (x, 0, z), turned by `yaw` and leaning by `lean` radians. */
export function at(batch: BoxBatch, x: number, z: number, yaw: number, lean: number, build: () => void): void {
  place.makeTranslation(x, 0, z).multiply(turn.makeRotationY(yaw)).multiply(turn.makeRotationZ(lean));
  batch.transformed(place.clone(), build);
}

/** A tiny daisy: stem, four petals and a centre. About 0.12 tall at scale 1. */
export function flower(batch: BoxBatch, x: number, z: number, petal: ColorRepresentation, scale = 1): void {
  const u = 0.032 * scale;
  const stem = 0.075 * scale;
  at(batch, x, z, 0, 0, () => {
    batch.boxOn(0, 0, 0, u * 0.7, stem, u * 0.7, PALETTE.stem);
    batch.boxOn(-u, stem, 0, u, u * 0.8, u, petal);
    batch.boxOn(u, stem, 0, u, u * 0.8, u, petal);
    batch.boxOn(0, stem, -u, u, u * 0.8, u, petal);
    batch.boxOn(0, stem, u, u, u * 0.8, u, petal);
    batch.boxOn(0, stem, 0, u, u * 1.15, u, petal === PALETTE.petal ? PALETTE.sunflowerFace : PALETTE.petal);
  });
}

/** A rounded shrub made of a few stacked blocks. */
export function bush(batch: BoxBatch, x: number, z: number, s: number, random: () => number): void {
  const { leaf, leafDark, leafLight } = PALETTE;
  at(batch, x, z, (random() - 0.5) * 0.6, 0, () => {
    batch.boxOn(0, 0, 0, 0.5 * s, 0.2 * s, 0.4 * s, leafDark, leaf);
    batch.boxOn(-0.04 * s, 0.2 * s, 0.01 * s, 0.38 * s, 0.14 * s, 0.32 * s, leaf, shade(leaf, 0.03));
    batch.boxOn(0.05 * s, 0.34 * s, -0.01 * s, 0.22 * s, 0.1 * s, 0.2 * s, shade(leaf, 0.03), leafLight);
    batch.boxOn(0.27 * s, 0, 0.1 * s, 0.16 * s, 0.13 * s, 0.18 * s, leafDark, leaf);
  });
}

export function rock(batch: BoxBatch, x: number, z: number, s: number, color: ColorRepresentation, yaw: number): void {
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.2 * s, 0.1 * s, 0.16 * s, shade(color, -0.04), color);
    batch.boxOn(-0.02 * s, 0.1 * s, 0.01 * s, 0.11 * s, 0.05 * s, 0.1 * s, color, shade(color, 0.05));
  });
}

export function mushroom(batch: BoxBatch, x: number, z: number, s: number): void {
  const { bone: spot, boneShadow, terracotta } = PALETTE;
  at(batch, x, z, 0, 0, () => {
    batch.boxOn(0, 0, 0, 0.035 * s, 0.06 * s, 0.035 * s, boneShadow, spot);
    batch.boxOn(0, 0.06 * s, 0, 0.11 * s, 0.035 * s, 0.11 * s, terracotta, shade(terracotta, 0.04));
    batch.boxOn(0, 0.095 * s, 0, 0.065 * s, 0.03 * s, 0.065 * s, shade(terracotta, 0.04), shade(terracotta, 0.08));
    batch.boxOn(0.03 * s, 0.096 * s, 0.03 * s, 0.022 * s, 0.006 * s, 0.022 * s, spot);
    batch.boxOn(-0.035 * s, 0.096 * s, -0.01 * s, 0.018 * s, 0.006 * s, 0.018 * s, spot);
  });
}

/** A gravestone with stepped shoulders, `h` tall, facing the camera. */
export function gravestone(batch: BoxBatch, x: number, z: number, h: number, yaw: number, lean: number, cross = false): void {
  const { stone, stoneDark } = PALETTE;
  const w = h * 0.62;
  const t = h * 0.24;
  at(batch, x, z, yaw, lean, () => {
    batch.boxOn(0, 0, 0, w * 1.25, h * 0.12, t * 1.5, stoneDark, shade(stoneDark, 0.03));
    if (cross) {
      batch.boxOn(0, h * 0.12, 0, w * 0.34, h * 0.88, t, stone, shade(stone, 0.05));
      batch.boxOn(0, h * 0.56, 0, w, h * 0.2, t, stone, shade(stone, 0.05));
    } else {
      batch.boxOn(0, h * 0.12, 0, w, h * 0.62, t, stone, shade(stone, 0.05));
      batch.boxOn(0, h * 0.74, 0, w * 0.74, h * 0.16, t, stone, shade(stone, 0.05));
      batch.boxOn(0, h * 0.9, 0, w * 0.4, h * 0.1, t, stone, shade(stone, 0.07));
      // A chiselled line or two on the face.
      batch.boxOn(0, h * 0.52, t / 2, w * 0.5, h * 0.05, 0.006, stoneDark);
      batch.boxOn(0, h * 0.38, t / 2, w * 0.34, h * 0.05, 0.006, stoneDark);
    }
  });
}

/** A small leafy tree, `h` tall. */
export function tree(batch: BoxBatch, x: number, z: number, h: number, yaw: number): void {
  const { leaf, leafDark, leafLight, walnut, walnutDark } = PALETTE;
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.13 * h, 0.42 * h, 0.13 * h, walnutDark, walnut);
    batch.boxOn(0, 0.36 * h, 0, 0.62 * h, 0.26 * h, 0.56 * h, leafDark, leaf);
    batch.boxOn(-0.02 * h, 0.62 * h, 0.01 * h, 0.48 * h, 0.2 * h, 0.44 * h, leaf, shade(leaf, 0.03));
    batch.boxOn(0.03 * h, 0.82 * h, -0.01 * h, 0.28 * h, 0.16 * h, 0.26 * h, shade(leaf, 0.03), leafLight);
    batch.boxOn(0.3 * h, 0.44 * h, 0.1 * h, 0.2 * h, 0.16 * h, 0.22 * h, leafDark, leaf);
  });
}

/** A leafless, crooked tree for the graveyard, `h` tall. */
export function deadTree(batch: BoxBatch, x: number, z: number, h: number, yaw: number): void {
  const bark = PALETTE.deadBark;
  const pale = PALETTE.deadBarkLight;
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
export function pot(batch: BoxBatch, x: number, z: number, s: number): void {
  const { leaf, leafLight, soilDark, stem, terracotta } = PALETTE;
  at(batch, x, z, 0.3, 0, () => {
    batch.boxOn(0, 0, 0, 0.15 * s, 0.12 * s, 0.15 * s, shade(terracotta, -0.04), terracotta);
    batch.boxOn(0, 0.12 * s, 0, 0.19 * s, 0.045 * s, 0.19 * s, terracotta, soilDark);
    batch.boxOn(0, 0.165 * s, 0, 0.03 * s, 0.1 * s, 0.03 * s, stem);
    batch.boxOn(-0.045 * s, 0.24 * s, 0, 0.08 * s, 0.03 * s, 0.05 * s, leaf, leafLight);
    batch.boxOn(0.045 * s, 0.27 * s, 0, 0.08 * s, 0.03 * s, 0.05 * s, leaf, leafLight);
  });
}

/** A bone lying flat. */
export function bone(batch: BoxBatch, x: number, z: number, yaw: number, s = 1): void {
  const u = 0.03 * s;
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.15 * s, u, u, PALETTE.boneShadow, PALETTE.bone);
    for (const end of [-1, 1]) {
      batch.boxOn(end * 0.085 * s, 0, -u * 0.6, u * 1.2, u * 1.25, u * 1.1, PALETTE.boneShadow, PALETTE.bone);
      batch.boxOn(end * 0.085 * s, 0, u * 0.6, u * 1.2, u * 1.25, u * 1.1, PALETTE.boneShadow, PALETTE.bone);
    }
  });
}

/** A crack in the graveyard ground: a few hair-thin dark slabs. */
export function crack(batch: BoxBatch, x: number, z: number, yaw: number, s: number, dark: ColorRepresentation = shade(PALETTE.graveDark, -0.09)): void {
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.16 * s, 0.004, 0.022, dark);
    batch.boxOn(0.1 * s, 0, 0.035 * s, 0.1 * s, 0.004, 0.02, dark);
    batch.boxOn(-0.09 * s, 0, -0.03 * s, 0.07 * s, 0.004, 0.018, dark);
  });
}

/** A cluster of crystal shards (goes in the glowing mesh). */
export function crystals(batch: BoxBatch, x: number, y: number, z: number, s: number, random: () => number): void {
  const crystal = PALETTE.crystal;
  const shard = (dx: number, dz: number, w: number, h: number, yaw: number, lean: number): void => {
    place
      .makeTranslation(x + dx * s, y, z + dz * s)
      .multiply(turn.makeRotationY(yaw))
      .multiply(turn.makeRotationZ(lean));
    batch.transformed(place.clone(), () => {
      batch.boxOn(0, 0, 0, w * s, h * s, w * s, shade(crystal, -0.12), crystal);
      batch.boxOn(0, h * s, 0, w * 0.55 * s, w * 0.6 * s, w * 0.55 * s, crystal, shade(crystal, 0.06));
    });
  };
  shard(0, 0, 0.09, 0.3, random() * 1.5, 0.12);
  shard(0.1, 0.03, 0.065, 0.19, random() * 1.5, -0.32);
  shard(-0.09, 0.04, 0.055, 0.15, random() * 1.5, 0.38);
}

/** A run of garden fence along +X from `x0` to `x1` at depth `z`. */
export function fence(batch: BoxBatch, x0: number, x1: number, z: number, random: () => number): void {
  const gap = 0.26;
  const count = Math.round((x1 - x0) / gap);
  for (let i = 0; i <= count; i++) {
    const x = x0 + ((x1 - x0) * i) / count;
    const tall = i % 4 === 0;
    const h = (tall ? 0.36 : 0.29) + (random() - 0.5) * 0.02;
    const wood = shade(PALETTE.walnutLight, (random() - 0.5) * 0.05);
    at(batch, x, z, 0, (random() - 0.5) * 0.05, () => {
      batch.boxOn(0, 0, 0, tall ? 0.085 : 0.07, h, 0.045, wood, shade(wood, 0.05));
      batch.boxOn(0, h, 0, tall ? 0.05 : 0.04, 0.035, 0.045, wood, shade(wood, 0.05));
    });
  }
  batch.box(x0, 0.09, z - 0.045, x1 - x0, 0.035, 0.03, PALETTE.walnut, PALETTE.walnutLight);
  batch.box(x0, 0.2, z - 0.045, x1 - x0, 0.035, 0.03, PALETTE.walnut, PALETTE.walnutLight);
}

/** Where a small prop may stand on a tile: near a corner, clear of whoever stands in the middle. */
export function tileCorner(random: () => number): [number, number] {
  const near = (): number => (random() < 0.5 ? 0.07 + random() * 0.14 : 0.79 + random() * 0.14);
  return [near(), near()];
}

/**
 * Everything that stands on the island: `solid` is matte plastic, `glow` (the crystals)
 * gets an emissive material.
 */
export function buildProps(): { solid: BufferGeometry; glow: BufferGeometry } {
  const random = seededRandom(20261111);
  const solid = new BoxBatch();
  const glow = new BoxBatch();
  const { islandRock, stone, stoneDark, walnut, walnutLight } = PALETTE;
  const petals = [PALETTE.petal, PALETTE.petal, PALETTE.bone, PALETTE.petalDark];
  const anyPetal = (): string => petals[Math.floor(random() * petals.length)] as string;

  // --- Lukas's end: a garden fence along the back with shrubs behind it.
  fence(solid, 0.15, 7.55, -0.46, random);
  bush(solid, 1.15, -0.78, 1.05, random);
  bush(solid, 3.7, -0.8, 0.85, random);
  bush(solid, 6.2, -0.76, 1.15, random);
  bush(solid, -2.15, 0.5, 0.8, random);
  bush(solid, -2.2, 4.3, 1.0, random);
  rock(solid, 2.5, -0.78, 1.2, islandRock, 0.4);
  rock(solid, 4.9, -0.2, 0.7, islandRock, 1.1);
  tree(solid, -2.0, -0.45, 1.05, 0.2);
  pot(solid, -0.45, -0.5, 1.3);
  pot(solid, -0.75, -0.42, 1.0);
  pot(solid, -1.2, 5.45, 1.15);
  for (let i = 0; i < 9; i++) flower(solid, 0.3 + random() * 7.2, -0.3 + random() * 0.16, anyPetal(), 1.15);
  for (let i = 0; i < 5; i++) flower(solid, -2.2 + random() * 0.3, 1.2 + random() * 2.6, anyPetal(), 1.2);

  // Front rim: low things only, so nothing hides lane 4.
  for (let i = 0; i < 16; i++) flower(solid, -1.6 + random() * 9.2, 5.2 + random() * 0.45, anyPetal(), 1.1 + random() * 0.3);
  rock(solid, 1.9, 5.5, 0.9, islandRock, 0.3);
  rock(solid, 5.7, 5.62, 1.1, islandRock, 2.2);
  rock(solid, -0.7, 5.5, 0.7, islandRock, 1.4);
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
  rock(solid, 10.6, 5.5, 1.0, stoneDark, 0.7);
  rock(solid, 8.2, -0.75, 0.9, stoneDark, 2.0);
  // The last fence panel has given up.
  at(solid, 7.86, -0.44, 0.22, 0.42, () => {
    solid.boxOn(0, 0, 0, 0.07, 0.3, 0.045, shade(walnut, -0.03), walnutLight);
  });
  at(solid, 8.12, -0.36, 0.5, 1.25, () => {
    solid.boxOn(0, 0, 0, 0.07, 0.3, 0.045, shade(walnut, -0.05), walnut);
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
        solid.boxOn(col + px, 0, lane + pz, 0.045, 0.03, 0.04, stoneDark, stone);
      }
    }
  }

  crystals(glow, 10.65, 0, -0.62, 1.1, random);
  crystals(glow, 12.25, 0, 2.5, 0.9, random);
  crystals(glow, 9.25, 0, 5.55, 0.7, random);
  crystals(glow, 11.55, 0, 5.5, 1.0, random);

  return { solid: solid.build(), glow: glow.build() };
}

/** Height of a free-standing gravestone from `makeGravestone`, in tiles. */
export const GRAVESTONE_HEIGHT = 0.5;

let gravestoneGeometry: BufferGeometry | null = null;
let gravestoneMaterial: MeshStandardMaterial | null = null;

/**
 * A free-standing gravestone, half a tile tall, standing on its own origin and facing the
 * camera (+Z). Every gravestone shares one geometry and one material, which belong to this
 * module: remove the object from the scene when done with it, but do not dispose them.
 */
export function makeGravestone(): Object3D {
  if (!gravestoneGeometry) {
    const batch = new BoxBatch();
    gravestone(batch, 0, 0, GRAVESTONE_HEIGHT, 0, 0);
    gravestoneGeometry = batch.build();
  }
  gravestoneMaterial ??= new MeshStandardMaterial(MATTE_PLASTIC);
  const mesh = new Mesh(gravestoneGeometry, gravestoneMaterial);
  mesh.name = 'gravestone';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
