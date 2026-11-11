import { cheerJump, hitRecoil, idleBob, spawnRise, sunPulse, wilt } from '../../voxel/clips';
import type { Box, ColorRef, ModelDef } from '../../voxel/types';

// Sunflower. Faces +X. A rosette of leaves on a soil mound, a tall stem, and a big round
// face ringed by twelve petals, smiling wide. The flower is tipped well back and turned to
// the player, so the whole face shows from the lawn camera, which looks down from behind.
// Its trim is the pale tip of each petal.
//
// The flower is authored upright, facing +X: the face is a stepped disc in the Y-Z plane
// (front at x 3.5, centre y 11.5), the petals a layer behind it, a green calyx behind them.
//
// Every level adds something the lawn camera can see, out past the flower or on top of it:
//
//   2  a second ring of twelve longer, darker petals between the first; a second pair of leaves
//   3  iron points on every front petal; an iron brace on the stem
//   4  the back ring turns to glowing crystal; crystal points
//   5  the back ring gold, gold points, a gold halo over the flower; the seeds glow warm

/** Face centre: the flower turns and its petals flare about here. */
const CY = 11.5;
const MOUTH = '#3A1E0C';
const SEED = '#5E3A17';

type Span = [number, number, number, number];

/** Boxes in the layer from x0 to x1, one per [z0, z1, y0, y1] span, the y measured from the face centre. */
function layer(x0: number, x1: number, spans: Span[], color: ColorRef, extra: Partial<Box> = {}): Box[] {
  return spans.map(([z0, z1, y0, y1]) => ({ at: [x0, CY + y0, z0], size: [x1 - x0, y1 - y0, z1 - z0], color, ...extra }));
}

/** The spans as written (all on the near side, z > 0) and their mirror images on the far side. */
function bothSides(near: Span[]): Span[] {
  return [...near, ...near.map(([z0, z1, y0, y1]): Span => [-z1, -z0, y0, y1])];
}

// The front ring: twelve petals, one every 30 degrees, each tucked half a voxel under the
// face's edge. Written as the near half (z ≥ 0) plus the two on the centre line.
const FRONT_NEAR: Span[] = [
  [1.5, 3, 2.5, 4], //  30°
  [2.5, 4, 1.5, 3], //  60°
  [3, 4.25, -1, 1], //  90°
  [2.5, 4, -3, -1.5], // 120°
  [1.5, 3, -4, -2.5], // 150°
];
const FRONT: Span[] = [[-1, 1, 3, 4.5], [-1, 1, -4.5, -3], ...bothSides(FRONT_NEAR)];
/** The outer half voxel of each front petal: the trim, pale at levels 1 and 2. */
const FRONT_TIPS: Span[] = [
  [-1, 1, 4, 4.5],
  [-1, 1, -4.5, -4],
  ...bothSides([
    [1.5, 3, 3.5, 4],
    [3.5, 4, 1.5, 3],
    [3.75, 4.25, -1, 1],
    [3.5, 4, -3, -1.5],
    [1.5, 3, -4, -3.5],
  ]),
];
/** Level 3 up: a point a voxel long on every front petal. */
const POINTS: Span[] = [
  [-0.5, 0.5, 4.5, 5.5],
  [-0.5, 0.5, -5.5, -4.5],
  ...bothSides([
    [2, 3, 4, 5],
    [4, 5, 2, 3],
    [4.25, 5.25, -0.5, 0.5],
    [4, 5, -3, -2],
    [2, 3, -5, -4],
  ]),
];
// The back ring, from level 2: twelve longer petals, offset 15 degrees so each shows
// between two of the front ring.
const BACK: Span[] = bothSides([
  [0.5, 2, 3.5, 5.5], //  15°
  [2.75, 4.25, 2.75, 4.25], //  45°
  [3.5, 5.5, 0.5, 2], //  75°
  [3.5, 5.5, -2, -0.5], // 105°
  [2.75, 4.25, -4.25, -2.75], // 135°
  [0.5, 2, -5.5, -3.5], // 165°
]);
/** The raised middle of the face, where the eyes and smile are: a stepped plate, lighter than the rim. */
const PLATE: Span[] = [[-2.5, 2.5, -1.5, 2.5], [-1.5, 1.5, -2.5, 3]];
/** Seeds: darker dots round the rim, outside the plate. */
const SEEDS: Span[] = [[-0.5, 0.5, 3, 3.5], ...bothSides([[2.5, 3.5, -0.5, 0.5], [2, 2.5, -3, -2.5]])];

export const sunflower: ModelDef = {
  key: 'sunflower',
  trim: ['petalLight'],
  eyes: ['eyes'],
  // The face: where a sun pops out when it pays.
  muzzle: { part: 'head', at: [4, CY, 0] },
  parts: [
    {
      name: 'root',
      pivot: [0, 0, 0],
      boxes: [{ at: [-2.5, 0, -2.5], size: [5, 1, 5], color: 'soil' }],
    },
    {
      // A pair of leaves rocking about the stem, swung round so that one reaches towards the
      // player. Dark wings, a lighter rib, a drooping tip.
      name: 'leaves',
      parent: 'root',
      pivot: [0, 1, 0],
      rot: [0, -30, 0],
      boxes: [
        { at: [1, 1, -1.5], size: [3, 1, 3], color: 'leafDark' },
        { at: [1, 1.5, -0.75], size: [3.5, 1, 1.5], color: 'leaf' },
        { at: [4.5, 1, -0.75], size: [1, 1, 1.5], color: 'leaf' },
        { at: [-4, 1, -1.5], size: [3, 1, 3], color: 'leafDark' },
        { at: [-4.5, 1.5, -0.75], size: [3.5, 1, 1.5], color: 'leaf' },
        { at: [-5.5, 1, -0.75], size: [1, 1, 1.5], color: 'leaf' },
      ],
    },
    {
      // Level 2: a second, longer pair across the first.
      name: 'leaves2',
      parent: 'root',
      pivot: [0, 1.25, 0],
      rot: [0, 55, 0],
      boxes: [
        { at: [1, 1.25, -1.5], size: [3.5, 1, 3], color: 'leafDark', minLevel: 2 },
        { at: [1, 1.75, -0.75], size: [4.5, 1, 1.5], color: 'leaf', minLevel: 2 },
        { at: [5.5, 1.25, -0.75], size: [1, 1, 1.5], color: 'leaf', minLevel: 2 },
        { at: [-4.5, 1.25, -1.5], size: [3.5, 1, 3], color: 'leafDark', minLevel: 2 },
        { at: [-5.5, 1.75, -0.75], size: [4.5, 1, 1.5], color: 'leaf', minLevel: 2 },
        { at: [-6.5, 2.25, -0.75], size: [1, 1, 1.5], color: 'leaf', minLevel: 2 },
      ],
    },
    {
      name: 'stem',
      parent: 'root',
      pivot: [0, 1, 0],
      boxes: [
        { at: [-1, 0.75, -1], size: [2, 6.75, 2], color: 'stem' },
        // Level 3 up: a brace, two bands joined by a strap up the front.
        { at: [-1.25, 2.5, -1.25], size: [2.5, 0.75, 2.5], color: 'petalLight', minLevel: 3 },
        { at: [-1.25, 5.5, -1.25], size: [2.5, 0.75, 2.5], color: 'petalLight', minLevel: 3 },
        { at: [1, 3.25, -0.5], size: [0.5, 2.25, 1], color: 'petalLight', minLevel: 3 },
      ],
    },
    {
      // The flower. Tipped well back and turned to the player.
      name: 'head',
      parent: 'stem',
      pivot: [0.5, 7.5, 0],
      rot: [0, -14, 45],
      shadedBy: ['eyes', 'petals'],
      boxes: [
        // Neck and calyx, the green behind the petals.
        { at: [-0.5, 7.5, -1], size: [1.75, 2, 2], color: 'stem' },
        ...layer(0.5, 1.5, [[-2.5, 2.5, -1.5, 1.5], [-1.5, 1.5, -2.5, 2.5]], 'leafDark'),
        // The face: a stepped disc seven across, its rim dotted with seeds (warm and glowing
        // at level 5), and a lighter plate standing half a voxel proud in the middle.
        ...layer(2.5, 3.5, [[-3.5, 3.5, -1.5, 1.5], [-2.5, 2.5, -2.5, 2.5], [-1.5, 1.5, -3.5, 3.5]], 'sunflowerFace'),
        ...layer(3, 3.5, SEEDS, SEED, { maxLevel: 4 }),
        ...layer(3, 3.5, SEEDS, 'fireLight', { minLevel: 5, emissive: 2 }),
        ...layer(3.5, 4, PLATE, 'walnutLight'),
        // A wide smile, turned up at the corners, and rosy cheeks on the rim beside it.
        ...layer(3.5, 4, [[-1.5, 1.5, -2.5, -1.5], [1.5, 2.5, -1.75, -0.75], [-2.5, -1.5, -1.75, -0.75]], MOUTH),
        ...layer(3.75, 4, [[-0.75, 0.75, -2.5, -2]], 'terracotta'),
        ...layer(3, 3.5, [[2.5, 3.5, -1.5, -0.5], [-3.5, -2.5, -1.5, -0.5]], 'petalDark'),
      ],
    },
    {
      // Both rings of petals, one part, so they flare together when the flower pays out.
      name: 'petals',
      parent: 'head',
      pivot: [2, CY, 0],
      boxes: [
        ...layer(1.5, 2.5, FRONT, 'petal'),
        ...layer(1.5, 2.5, FRONT_TIPS, 'petalLight'),
        ...layer(1.5, 2.5, POINTS, 'petalLight', { minLevel: 3 }),
        ...layer(0.5, 1.5, BACK, 'petalDark', { minLevel: 2, maxLevel: 3 }),
        ...layer(0.5, 1.5, BACK, 'levelCrystal', { minLevel: 4, maxLevel: 4 }),
        ...layer(0.5, 1.5, BACK, 'levelGold', { minLevel: 5 }),
      ],
    },
    {
      name: 'eyes',
      parent: 'head',
      pivot: [4.25, CY + 1, 0],
      shadedBy: ['head'],
      boxes: [
        // Black, half a voxel proud of the face, a glint in the top corner nearest the sun.
        // Two and a half tall rather than the art bible's three: this face is tipped back so far
        // that the lawn camera hardly foreshortens it, and at three they came out tall.
        ...layer(4, 4.5, [[0.75, 2.75, 0.25, 2.75], [-2.75, -0.75, 0.25, 2.75]], 'eye'),
        ...layer(4, 4.5, [[0.75, 1.75, 1.75, 2.75], [-2.75, -1.75, 1.75, 2.75]], 'eyeGlint'),
        // Level 5: a small warm light in each.
        ...layer(4, 4.5, [[1.75, 2.75, 0.75, 1.75], [-1.75, -0.75, 0.75, 1.75]], 'fireLight', { minLevel: 5, emissive: 3 }),
      ],
    },
    {
      // Level 5: a gold halo over the flower, its corners left off so it reads round, with a
      // warm light at the middle of each side.
      name: 'halo',
      parent: 'stem',
      pivot: [-1.5, 17.5, 0],
      boxes: [
        { at: [-3.5, 17.5, -3], size: [4, 0.75, 1], color: 'levelGold', minLevel: 5 },
        { at: [-3.5, 17.5, 2], size: [4, 0.75, 1], color: 'levelGold', minLevel: 5 },
        { at: [-4.5, 17.5, -2], size: [1, 0.75, 4], color: 'levelGold', minLevel: 5 },
        { at: [0.5, 17.5, -2], size: [1, 0.75, 4], color: 'levelGold', minLevel: 5 },
        { at: [-2, 18.25, 2.25], size: [1, 0.5, 0.5], color: 'fireLight', emissive: 2, minLevel: 5 },
        { at: [-2, 18.25, -2.75], size: [1, 0.5, 0.5], color: 'fireLight', emissive: 2, minLevel: 5 },
        { at: [0.75, 18.25, -0.5], size: [0.5, 0.5, 1], color: 'fireLight', emissive: 2, minLevel: 5 },
        { at: [-4.25, 18.25, -0.5], size: [0.5, 0.5, 1], color: 'fireLight', emissive: 2, minLevel: 5 },
      ],
    },
  ],
  clips: {
    idle: idleBob({ body: 'stem', head: 'head', sway: ['leaves', 'leaves2', 'petals', 'halo'] }),
    shoot: sunPulse('head', 'petals'),
    hit: hitRecoil('root', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'stem', head: 'head' }),
    cheer: cheerJump('root'),
  },
};
