import type { BufferGeometry, ColorRepresentation } from 'three';
import { GRAVE_FROM_COL, LAWN_COLS, LAWN_LANES } from '../coords';
import { PALETTE } from '../palette';
import { BoxBatch, seededRandom, shade } from './boxes';
import { at, bone, bush, crack, deadTree, flower, gravestone, rock, tileCorner, tree } from './props';

// The props of the worlds after the Backyard. Same rules as `props.ts`: everything is boxes,
// sizes in tiles, nothing on a playable tile taller than 0.25, nothing on the front rim tall
// enough to hide lane 4. Each world keeps the zombies' end a graveyard in its own materials,
// so the two ends of the lawn read as the two sides in every world.

type Props = { solid: BufferGeometry; glow: BufferGeometry };

/** A glowing mushroom: stem in `solid`, cap in `glow`. About 0.14 tall at scale 1. */
function glowShroom(solid: BoxBatch, glow: BoxBatch, x: number, z: number, s: number): void {
  at(solid, x, z, 0, 0, () => solid.boxOn(0, 0, 0, 0.035 * s, 0.08 * s, 0.035 * s, PALETTE.bone, PALETTE.boneShadow));
  at(glow, x, z, 0, 0, () => {
    glow.boxOn(0, 0.08 * s, 0, 0.12 * s, 0.04 * s, 0.12 * s, '#8FE9FF', '#C8F6FF');
    glow.boxOn(0, 0.12 * s, 0, 0.07 * s, 0.03 * s, 0.07 * s, '#C8F6FF');
  });
}

/** A clump of tall grass blades, `h` tall. */
function tallGrass(batch: BoxBatch, x: number, z: number, h: number, color: ColorRepresentation, random: () => number): void {
  for (let i = 0; i < 5; i++) {
    const dx = (random() - 0.5) * 0.18;
    const dz = (random() - 0.5) * 0.12;
    const bh = h * (0.55 + random() * 0.45);
    at(batch, x + dx, z + dz, random() * 1.5, (random() - 0.5) * 0.3, () => {
      batch.boxOn(0, 0, 0, 0.035, bh, 0.035, shade(color, -0.04), shade(color, 0.05));
    });
  }
}

/** A run of dry-stone wall along +X from `x0` to `x1` at depth `z`. */
function stoneWall(batch: BoxBatch, x0: number, x1: number, z: number, stone: string, random: () => number): void {
  let x = x0;
  let row = 0;
  for (const y of [0, 0.1, 0.2]) {
    x = x0 + (row % 2) * 0.12;
    while (x < x1 - 0.05) {
      const w = Math.min(0.18 + random() * 0.14, x1 - x);
      batch.box(x, y, z - 0.07, w - 0.012, 0.1 - 0.008, 0.14, shade(stone, (random() - 0.5) * 0.08), shade(stone, 0.05 + (random() - 0.5) * 0.05));
      x += w;
    }
    row++;
  }
}

/** A lamp post: a wooden post, a little roof and a glowing lamp (in `glow`). */
function lantern(solid: BoxBatch, glow: BoxBatch, x: number, z: number, h: number): void {
  const { walnut, walnutDark } = PALETTE;
  at(solid, x, z, 0, 0, () => {
    solid.boxOn(0, 0, 0, 0.07, h, 0.07, walnutDark, walnut);
    solid.boxOn(0, h, 0, 0.18, 0.03, 0.18, walnutDark, walnut);
    solid.boxOn(0, h + 0.17, 0, 0.2, 0.035, 0.2, walnutDark, walnut);
  });
  at(glow, x, z, 0, 0, () => glow.boxOn(0, h + 0.03, 0, 0.12, 0.14, 0.12, '#C8F6FF'));
}

/** Flat bones, cracks and pebbles near the corners of the zombies' tiles, as in the Backyard. */
function graveTiles(solid: BoxBatch, random: () => number, crackColor: ColorRepresentation, pebble: [string, string]): void {
  for (let lane = 0; lane < LAWN_LANES; lane++) {
    for (let col = GRAVE_FROM_COL; col < LAWN_COLS; col++) {
      const [dx, dz] = tileCorner(random);
      if (random() < 0.6) bone(solid, col + dx, lane + dz, random() * 3, 0.95);
      const [cx, cz] = tileCorner(random);
      crack(solid, col + cx, lane + cz, random() * 3, 0.9 + random() * 0.6, crackColor);
      if (random() < 0.5) {
        const [px, pz] = tileCorner(random);
        solid.boxOn(col + px, 0, lane + pz, 0.045, 0.03, 0.04, pebble[0], pebble[1]);
      }
    }
  }
}

/** The Meadow at night: a dry-stone wall, tall grass, pale flowers, glowing mushrooms and lamps. */
export function buildMeadowProps(): Props {
  const random = seededRandom(20261202);
  const solid = new BoxBatch();
  const glow = new BoxBatch();
  const wall = '#7C86A8';
  const reeds = '#3F8F76';
  const petals = ['#FFFFFF', '#C9DCFF', '#9DB8FF', '#FFF2B0'];
  const anyPetal = (): string => petals[Math.floor(random() * petals.length)] as string;

  // --- Lukas's end: the wall along the back, tall grass and two trees behind it.
  stoneWall(solid, 0.15, 7.55, -0.46, wall, random);
  for (let i = 0; i < 9; i++) tallGrass(solid, 0.4 + i * 0.85 + random() * 0.3, -0.8 - random() * 0.12, 0.34, reeds, random);
  tree(solid, 2.4, -0.95, 1.1, 0.3);
  tree(solid, 5.6, -0.9, 0.9, -0.2);
  tree(solid, -2.0, -0.45, 1.15, 0.2);
  bush(solid, -2.2, 4.3, 1.0, random);
  bush(solid, -2.15, 0.5, 0.8, random);
  lantern(solid, glow, -0.55, -0.45, 0.62);
  lantern(solid, glow, -1.1, 5.4, 0.5);
  for (const [x, z, s] of [[1.3, -0.72, 1.3], [1.45, -0.62, 0.9], [4.4, -0.75, 1.1], [6.9, -0.7, 1.2], [-2.3, 2.1, 1.3], [-2.05, 2.3, 0.9], [-2.4, 3.3, 1.0]] as const) {
    glowShroom(solid, glow, x, z, s);
  }
  for (let i = 0; i < 6; i++) flower(solid, -2.2 + random() * 0.3, 1.2 + random() * 2.6, anyPetal(), 1.2);

  // Front rim: low things only.
  for (let i = 0; i < 16; i++) flower(solid, -1.6 + random() * 9.2, 5.2 + random() * 0.45, anyPetal(), 1.1 + random() * 0.3);
  rock(solid, 1.9, 5.5, 0.9, wall, 0.3);
  rock(solid, 5.7, 5.62, 1.1, wall, 2.2);
  for (const [x, z, s] of [[3.3, 5.48, 1.0], [3.47, 5.58, 0.7], [6.9, 5.42, 0.9]] as const) glowShroom(solid, glow, x, z, s);

  // Pale flowers on the first two columns, tucked into the tile corners.
  for (let lane = 0; lane < LAWN_LANES; lane++) {
    for (let col = 0; col < 2; col++) {
      const [dx, dz] = tileCorner(random);
      flower(solid, col + dx, lane + dz, anyPetal(), 0.95);
    }
  }

  // --- Toby's end: gravestones, a dead tree, bones; mushrooms glow among the graves.
  gravestone(solid, 8.55, -0.5, 0.62, 0.1, 0.06);
  gravestone(solid, 9.35, -0.62, 0.56, -0.15, -0.09, true);
  gravestone(solid, 10.6, -0.5, 0.44, 0.25, 0.1);
  deadTree(solid, 12.05, -0.4, 1.25, 0.15);
  gravestone(solid, 8.75, 5.5, 0.26, 0.2, -0.1);
  gravestone(solid, 12.1, 1.1, 0.34, -1.2, 0.08, true);
  gravestone(solid, 12.15, 3.9, 0.3, -1.4, -0.1);
  for (let i = 0; i < 6; i++) bone(solid, 8.3 + random() * 3.6, -0.28 + random() * 0.12, random() * 3, 1.1);
  for (let i = 0; i < 6; i++) bone(solid, 8.3 + random() * 3.4, 5.2 + random() * 0.35, random() * 3, 1.1);
  for (const [x, z, s] of [[9.9, -0.45, 1.2], [11.4, -0.6, 1.0], [12.3, 2.5, 1.1], [10.4, 5.5, 1.0]] as const) glowShroom(solid, glow, x, z, s);
  graveTiles(solid, random, shade('#33295A', -0.09), [PALETTE.stoneDark, PALETTE.stone]);

  return { solid: solid.build(), glow: glow.build() };
}

/** What stands on a Meadow islet: tall grass and a glowing mushroom, or a gravestone. */
export function meadowIslet(batch: BoxBatch, grave: boolean, random: () => number): void {
  if (grave) {
    gravestone(batch, -0.1, 0, 0.42, 0.2, 0.1);
    bone(batch, 0.4, 0.35, 0.8, 1.3);
    return;
  }
  tallGrass(batch, -0.2, -0.1, 0.4, '#3F8F76', random);
  bush(batch, 0.3, 0.1, 0.7, random);
  flower(batch, 0.45, 0.35, '#C9DCFF', 1.6);
}
