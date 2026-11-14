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

/** A flat-topped mesa of stepped sandstone layers, `h` tall and `w` wide. */
function mesa(batch: BoxBatch, x: number, z: number, w: number, d: number, h: number, random: () => number): void {
  const bands = ['#D2864A', '#C4743E', '#DE9858', '#B86A38'];
  const layers = Math.max(3, Math.round(h / 0.18));
  let width = w;
  let depth = d;
  for (let i = 0; i < layers; i++) {
    const y = (i * h) / layers;
    const band = bands[i % bands.length] as string;
    // Wider at the foot, a ledge now and then.
    const step = i < 2 ? 0.92 : random() < 0.3 ? 0.9 : 0.985;
    batch.boxOn(x + (random() - 0.5) * 0.04, y, z, width, h / layers + 0.001, depth, shade(band, (random() - 0.5) * 0.04), shade('#E8A868', 0.02));
    width *= step;
    depth *= step;
  }
}

/** A boxy saguaro cactus, `h` tall, with an arm or two. */
function cactus(batch: BoxBatch, x: number, z: number, h: number, yaw: number, random: () => number): void {
  const green = '#4F9A4A';
  const dark = '#3B7A3A';
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.12 * h, h, 0.12 * h, dark, green);
    const arms = random() < 0.5 ? [-1, 1] : [random() < 0.5 ? -1 : 1];
    for (const side of arms) {
      const y = h * (0.35 + random() * 0.2);
      batch.boxOn(side * 0.11 * h, y, 0, 0.12 * h, 0.08 * h, 0.08 * h, dark, green);
      batch.boxOn(side * 0.17 * h, y, 0, 0.08 * h, h * (0.28 + random() * 0.12), 0.08 * h, dark, green);
    }
    // A pink flower on top.
    batch.boxOn(0, h, 0, 0.06 * h, 0.04 * h, 0.06 * h, '#FF8FB1');
  });
}

/** A boxy animal skull lying on the sand (goofy, not frightening). */
function skull(batch: BoxBatch, x: number, z: number, yaw: number, s: number): void {
  const { bone: b, boneShadow } = PALETTE;
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.16 * s, 0.09 * s, 0.12 * s, boneShadow, b);
    batch.boxOn(0.1 * s, 0, 0, 0.08 * s, 0.06 * s, 0.08 * s, boneShadow, b);
    batch.boxOn(-0.03 * s, 0.06 * s, 0.062 * s, 0.03 * s, 0.025 * s, 0.004, PALETTE.socket);
    batch.boxOn(-0.03 * s, 0.06 * s, -0.062 * s, 0.03 * s, 0.025 * s, 0.004, PALETTE.socket);
    for (const side of [-1, 1]) batch.boxOn(-0.06 * s, 0.07 * s, side * 0.09 * s, 0.03 * s, 0.03 * s, 0.08 * s, boneShadow, b);
  });
}

/** A broken sandstone pillar, `h` tall. */
function pillar(batch: BoxBatch, x: number, z: number, h: number, yaw: number): void {
  const stone = '#C9A06A';
  const dark = '#A57E4E';
  at(batch, x, z, yaw, 0, () => {
    batch.boxOn(0, 0, 0, 0.26, 0.06, 0.26, dark, stone);
    batch.boxOn(0, 0.06, 0, 0.18, h - 0.06, 0.18, dark, stone);
    batch.boxOn(0.04, h, 0.02, 0.1, 0.05, 0.12, dark, stone);
  });
}

/** The Desert: mesas behind the island, cacti, skulls and a broken colonnade by the graves. */
export function buildDesertProps(): Props {
  const random = seededRandom(20261203);
  const solid = new BoxBatch();
  const glow = new BoxBatch();
  const sandRock = '#B8875A';

  // --- Lukas's end: mesas along the back, cacti and boulders before them.
  mesa(solid, -2.0, -0.9, 1.3, 0.9, 1.3, random);
  mesa(solid, 3.2, -1.15, 1.6, 0.7, 0.9, random);
  mesa(solid, 6.6, -1.05, 1.0, 0.6, 0.62, random);
  cactus(solid, 0.6, -0.62, 0.75, 0.2, random);
  cactus(solid, 1.9, -0.82, 0.55, -0.4, random);
  cactus(solid, 5.2, -0.7, 0.8, 0.5, random);
  cactus(solid, -2.15, 2.6, 0.9, 0.1, random);
  cactus(solid, -2.3, 4.4, 0.6, 0.6, random);
  rock(solid, 2.6, -0.62, 1.3, sandRock, 0.4);
  rock(solid, 4.3, -0.55, 0.8, sandRock, 1.1);
  rock(solid, -2.1, 1.0, 1.1, sandRock, 0.7);
  skull(solid, -1.4, -0.5, 0.6, 1.4);

  // Front rim: low things only.
  for (const [x, z, s, yaw] of [[1.9, 5.5, 0.9, 0.3], [5.7, 5.62, 1.1, 2.2], [-0.7, 5.5, 0.7, 1.4], [3.6, 5.45, 0.6, 0.8]] as const) rock(solid, x, z, s, sandRock, yaw);
  skull(solid, 4.6, 5.5, -0.4, 1.1);
  for (let i = 0; i < 7; i++) bone(solid, -1.5 + random() * 8.6, 5.25 + random() * 0.35, random() * 3, 1.0);
  // Pebbles in the corners of the first columns.
  for (let lane = 0; lane < LAWN_LANES; lane++) {
    const [dx, dz] = tileCorner(random);
    solid.boxOn(dx, 0, lane + dz, 0.05, 0.03, 0.045, shade(sandRock, -0.05), sandRock);
  }

  // --- Toby's end: a broken colonnade, sandstone graves, skulls and bones.
  pillar(solid, 8.6, -0.55, 0.7, 0.1);
  pillar(solid, 9.6, -0.6, 0.42, -0.1);
  pillar(solid, 11.0, -0.55, 0.85, 0.2);
  mesa(solid, 12.4, -0.85, 1.0, 0.7, 1.1, random);
  gravestone(solid, 10.3, -0.5, 0.48, 0.2, 0.08);
  gravestone(solid, 8.75, 5.5, 0.26, 0.2, -0.1);
  gravestone(solid, 12.1, 1.1, 0.34, -1.2, 0.08, true);
  gravestone(solid, 12.15, 3.9, 0.3, -1.4, -0.1);
  skull(solid, 9.9, 5.5, 0.4, 1.2);
  for (let i = 0; i < 6; i++) bone(solid, 8.3 + random() * 3.6, -0.28 + random() * 0.12, random() * 3, 1.1);
  graveTiles(solid, random, shade('#6E4E62', -0.09), ['#8C6A72', '#A88690']);

  return { solid: solid.build(), glow: glow.build() };
}

/** What stands on a Desert islet: a small mesa or a cactus, or a sandstone grave. */
export function desertIslet(batch: BoxBatch, grave: boolean, random: () => number): void {
  if (grave) {
    gravestone(batch, -0.1, 0, 0.42, 0.2, 0.1);
    skull(batch, 0.4, 0.35, 0.8, 1.1);
    return;
  }
  cactus(batch, -0.1, 0, 0.7, 0.3, random);
  rock(batch, 0.4, 0.3, 1.1, '#B8875A', 0.5);
}

