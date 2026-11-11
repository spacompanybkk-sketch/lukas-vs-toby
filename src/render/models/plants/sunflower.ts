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
//   4  the back ring and the points turn to glowing crystal; crystal shards rise behind the
//      top petals
//   5  the back ring gold, gold points, gold rays with warm tips behind the top petals; the
//      seeds glow warm

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
const PLATE: Span[] = [[-2.75, 2.75, -1.5, 2.5], [-1.5, 1.5, -2.5, 3]];
/** Seeds: darker dots round the rim, outside the plate. */
const SEEDS: Span[] = [[-0.5, 0.5, 3, 3.5], ...bothSides([[2.75, 3.5, -0.5, 0.5], [2, 2.5, -3, -2.5]])];
/**
 * Level 4 crystal shards, level 5 gold rays: points rising behind the top petals, in a layer
 * behind the back ring, so they change the flower's outline from above. Each is a shaft and
 * a narrower tip, written as [z0, z1, y0, y1] pairs from the face centre.
 */
const RAY_SHAFTS: Span[] = [[-0.5, 0.5, 4.5, 6.5], ...bothSides([[1.75, 2.75, 4, 5.75], [3.5, 4.25, 2.5, 3.75]])];
const RAY_TIPS: Span[] = [[-0.25, 0.25, 6.5, 7.25], ...bothSides([[2.25, 2.75, 5.75, 6.5], [4.25, 4.75, 3.25, 4]])];
/** A pale row of teeth along the top of the smile. */
const TEETH = '#FFF4DC';

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
        { at: [-1.5, 0.75, -1.5], size: [3, 6.75, 3], color: 'stem' },
        // Level 3 up: a brace, two bands joined by a strap up the front.
        { at: [-1.75, 2.5, -1.75], size: [3.5, 0.75, 3.5], color: 'petalLight', minLevel: 3 },
        { at: [-1.75, 5.5, -1.75], size: [3.5, 0.75, 3.5], color: 'petalLight', minLevel: 3 },
        { at: [1.5, 3.25, -0.5], size: [0.5, 2.25, 1], color: 'petalLight', minLevel: 3 },
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
        { at: [-0.5, 7.75, -1], size: [1.75, 1.75, 2], color: 'stem' },
        ...layer(0.5, 1.5, [[-2.5, 2.5, -1.5, 1.5], [-1.5, 1.5, -2.5, 2.5]], 'leafDark'),
        // The face: a stepped disc seven across, its rim dotted with seeds (warm and glowing
        // at level 5), and a lighter plate standing half a voxel proud in the middle.
        ...layer(2.5, 3.5, [[-3.5, 3.5, -1.5, 1.5], [-2.5, 2.5, -2.5, 2.5], [-1.5, 1.5, -3.5, 3.5]], 'sunflowerFace'),
        ...layer(3, 3.5, SEEDS, SEED, { maxLevel: 4 }),
        ...layer(3, 3.5, SEEDS, 'fireLight', { minLevel: 5, emissive: 2 }),
        ...layer(3.5, 4, PLATE, 'walnutLight'),
        // A wide open smile, turned up at the corners, with a pale row of teeth along its top
        // and a tongue, and rosy cheeks on the rim beside it.
        ...layer(3.5, 4, [[-1.75, 1.75, -2.5, -1.25], [1.75, 2.5, -1.75, -0.75], [-2.5, -1.75, -1.75, -0.75]], MOUTH),
        ...layer(3.75, 4, [[-1.25, 1.25, -1.6, -1.25]], TEETH),
        ...layer(3.75, 4, [[-0.75, 0.75, -2.5, -2]], 'terracotta'),
        ...layer(3, 3.5, [[2.75, 3.5, -1.5, -0.5], [-3.5, -2.75, -1.5, -0.5]], 'petalDark'),
        // Level 4: crystal shards behind the top petals; level 5: gold rays with warm tips.
        ...layer(-0.5, 0.5, RAY_SHAFTS, 'levelCrystal', { minLevel: 4, maxLevel: 4 }),
        ...layer(-0.5, 0.5, RAY_TIPS, 'levelCrystal', { minLevel: 4, maxLevel: 4 }),
        ...layer(-0.5, 0.5, RAY_SHAFTS, 'levelGold', { minLevel: 5 }),
        ...layer(-0.5, 0.5, RAY_TIPS, 'fireLight', { minLevel: 5, emissive: 2 }),
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
        // A voxel and a half wide, two and a half apart, two and a half tall rather than the art
        // bible's three: this face is tipped back so far that the lawn camera hardly
        // foreshortens it, and at three they came out tall.
        ...layer(4, 4.5, [[1.25, 2.75, 0, 2.5], [-2.75, -1.25, 0, 2.5]], 'eye'),
        ...layer(4, 4.5, [[1.25, 2.25, 1.5, 2.5], [-2.75, -1.75, 1.5, 2.5]], 'eyeGlint'),
        // Level 5: a small warm light in each.
        ...layer(4, 4.5, [[1.75, 2.75, 0.25, 1.25], [-2.25, -1.25, 0.25, 1.25]], 'fireLight', { minLevel: 5, emissive: 3 }),
      ],
    },
  ],
  clips: {
    idle: idleBob({ body: 'stem', head: 'head', sway: ['leaves', 'leaves2', 'petals'] }),
    shoot: sunPulse('head', 'petals'),
    hit: hitRecoil('root', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'stem', head: 'head' }),
    cheer: cheerJump('root'),
  },
};
