import { cheerJump, hitRecoil, idleBob, spawnRise, sunPulse, wilt } from '../../voxel/clips';
import type { Box, ColorRef, ModelDef } from '../../voxel/types';

// Sunflower. Faces +X. A rosette of leaves on a soil mound, a tall stem, and a big round
// face ringed by twelve petals, smiling wide. The flower is tipped well back and turned to
// the player, so the whole face shows from the lawn camera, which looks down from behind.
// It has no trim: its level materials are explicit boxes.
//
// The flower is authored upright, facing +X: the face is a stepped disc in the Y-Z plane
// (front at x 3.5, centre y 11.5), the petals a layer behind it, a green calyx behind them.
//
// Every level adds something the lawn camera can see, out past the flower or on top of it:
//
//   2  a second ring of twelve longer, darker petals between the first; a second pair of leaves
//   3  iron points on the front petals; a ladybird on the top petal
//   4  the back ring and the points turn to glowing crystal; crystal shards rise behind the
//      top petals
//   5  a small gold crown on the top of its face, orange petal points (the petals stay yellow
//      and orange, the gold is the crown);
//      the seeds glow warm

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
  [2.5, 4, -1, 1], //  90°
  [2.5, 4, -3, -1.5], // 120°
  [1.5, 3, -4, -2.5], // 150°
];
const FRONT: Span[] = [[-1, 1, 3, 4.5], [-1, 1, -4.5, -3], ...bothSides(FRONT_NEAR)];
/** Level 3 up: a point a voxel long on every front petal. */
const POINTS: Span[] = [
  [-0.5, 0.5, 4.5, 5.5],
  [-0.5, 0.5, -5.5, -4.5],
  ...bothSides([
    [2, 3, 4, 5],
    [4, 5, 2, 3],
    [4, 5, -0.5, 0.5],
    [4, 5, -3, -2],
    [2, 3, -5, -4],
  ]),
];
// The back ring, from level 2: twelve longer petals, offset 15 degrees so each shows
// between two of the front ring.
const BACK: Span[] = bothSides([
  [0.5, 2, 3.5, 5.5], //  15°
  [3, 4.5, 3, 4.5], //  45°
  [3.5, 5.5, 0.5, 2], //  75°
  [3.5, 5.5, -2, -0.5], // 105°
  [3, 4.5, -4.5, -3], // 135°
  [0.5, 2, -5.5, -3.5], // 165°
]);
/**
 * The raised middle of the face, where the eyes and smile are: a stepped plate, lighter than
 * the rim, reaching down round the smile so that the smile sits on the face's light colour
 * and not in a dark band. Everything on the face is on the half voxel (a quarter-voxel edge
 * cuts every face of its box into more cells).
 */
const PLATE: Span[] = [[-3, 3, -1.5, 1.5], [-2, 2, -2.5, 2.5], [-1.5, 1.5, -3, 3]];
/** Seeds: darker dots round the rim, outside the plate. */
const SEEDS: Span[] = [[-0.5, 0.5, 3, 3.5], ...bothSides([[3, 3.5, -0.5, 0.5]])];
/**
 * Level 4 crystal shards, level 5 gold rays: points rising behind the top petals, in a layer
 * behind the back ring, so they change the flower's outline from above. Each is a shaft and
 * a narrower tip, written as [z0, z1, y0, y1] pairs from the face centre.
 */
const RAY_SHAFTS: Span[] = [[-0.5, 0.5, 4.5, 6.5], ...bothSides([[2, 3, 4, 6], [3.5, 4.5, 2.5, 4]])];
const RAY_TIPS: Span[] = [[-0.5, 0.5, 6.5, 7.5], ...bothSides([[2, 3, 6, 6.5], [4, 4.5, 4, 4.5]])];
/**
 * Level 5's crown, worn on the top rim of the face in front of the petals: a band and three
 * points standing up over the top petals.
 */
const CROWN: Span[] = [[-2, 2, 3, 3.5], [-0.5, 0.5, 3.5, 5], ...bothSides([[1.5, 2, 3.5, 4.5]])];
const CROWN_JEWELS: Span[] = [[-0.5, 0.5, 3, 3.5]];
/** A pale row of teeth along the top of the smile. */
const TEETH = '#FFF4DC';

export const sunflower: ModelDef = {
  key: 'sunflower',
  trim: [],
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
        // (Whole and half voxels, and no raised rib: the flower covers most of the leaves from
        // the lawn camera, and each extra edge cuts them into more cells.)
        { at: [1, 1, -1.5], size: [3, 1, 3], color: 'leafDark' },
        { at: [4, 1, -1], size: [1.5, 1, 2], color: 'leaf' },
        { at: [-4, 1, -1.5], size: [3, 1, 3], color: 'leafDark' },
        { at: [-5.5, 1, -1], size: [1.5, 1, 2], color: 'leaf' },
      ],
    },
    {
      // Level 2: a second, longer pair across the first.
      name: 'leaves2',
      parent: 'root',
      pivot: [0, 1.5, 0],
      rot: [0, 55, 0],
      boxes: [
        { at: [1, 1.5, -1.5], size: [3.5, 1, 3], color: 'leafDark', minLevel: 2 },
        { at: [4.5, 1.5, -1], size: [2, 1, 2], color: 'leaf', minLevel: 2 },
        { at: [-4.5, 1.5, -1.5], size: [3.5, 1, 3], color: 'leafDark', minLevel: 2 },
        { at: [-6.5, 2, -1], size: [2, 1, 2], color: 'leaf', minLevel: 2 },
      ],
    },
    {
      name: 'stem',
      parent: 'root',
      pivot: [0, 1, 0],
      boxes: [
        { at: [-1.5, 0.75, -1.5], size: [3, 6.75, 3], color: 'stem' },
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
        { at: [-0.5, 8, -1], size: [1.5, 1.5, 2], color: 'stem' },
        ...layer(0.5, 1.5, [[-2.5, 2.5, -1.5, 1.5], [-1.5, 1.5, -2.5, 2.5]], 'leafDark'),
        // The face: a stepped disc seven across, its rim dotted with seeds (warm and glowing
        // at level 5), and a lighter plate standing half a voxel proud in the middle.
        ...layer(2.5, 3.5, [[-3.5, 3.5, -1.5, 1.5], [-2.5, 2.5, -2.5, 2.5], [-1.5, 1.5, -3.5, 3.5]], 'sunflowerFace'),
        ...layer(3, 3.5, SEEDS, SEED, { maxLevel: 4 }),
        ...layer(3, 3.5, SEEDS, 'fireLight', { minLevel: 5, emissive: 2 }),
        ...layer(3.5, 4, PLATE, 'walnutLight'),
        // A wide open smile, turned up at the corners, with a pale row of teeth along its top
        // and a tongue, and rosy cheeks on the rim beside it.
        // A big smile: four wide, turned up at the corners.
        ...layer(3.5, 4, [[-2, 2, -2.5, -1], [2, 2.5, -2, -0.5], [-2.5, -2, -2, -0.5]], MOUTH),
        // Teeth across the top and a big tongue filling it, so the dark shows only as a rim.
        ...layer(3.5, 4, [[-2, 2, -1.5, -1]], TEETH),
        ...layer(3.5, 4, [[-1.5, 1.5, -2.5, -1.5]], 'terracotta'),
        ...layer(3, 3.5, [[3, 3.5, -1.5, -0.5], [-3.5, -3, -1.5, -0.5]], 'petalDark'),
        // Level 4: crystal shards behind the top petals; level 5: gold rays with warm tips.
        ...layer(-0.5, 0.5, RAY_SHAFTS, 'levelCrystal', { minLevel: 4, maxLevel: 4 }),
        ...layer(-0.5, 0.5, RAY_TIPS, 'levelCrystal', { minLevel: 4, maxLevel: 4 }),
        // Level 5: a small gold crown on the top rim of the face, three points and a warm jewel.
        ...layer(3.5, 4.5, CROWN, 'levelGold', { minLevel: 5 }),
        ...layer(4, 4.5, CROWN_JEWELS, 'fireLight', { minLevel: 5, emissive: 2 }),
        // Level 3 up: a ladybird sitting on a petal on the camera's side, red with a black head
        // and spots, a new shape beside the face where the lawn camera sees it.
        ...layer(2.5, 3.5, [[2.5, 4, 1.5, 3]], 'cherry', { minLevel: 3 }),
        ...layer(3, 3.5, [[3, 3.5, 2.5, 3], [2.5, 3, 1.5, 2]], 'eye', { minLevel: 3 }),
        ...layer(2.5, 3.5, [[3.5, 4, 2.5, 3]], 'eye', { minLevel: 3 }),
      ],
    },
    {
      // Both rings of petals, one part, so they flare together when the flower pays out.
      name: 'petals',
      parent: 'head',
      pivot: [2, CY, 0],
      boxes: [
        ...layer(1.5, 2.5, FRONT, 'petal'),
        // The points: iron at 3, crystal at 4, and at 5 orange (the gold is the crown).
        ...layer(1.5, 2.5, POINTS, 'levelIron', { minLevel: 3, maxLevel: 3 }),
        ...layer(1.5, 2.5, POINTS, 'levelCrystal', { minLevel: 4, maxLevel: 4 }),
        ...layer(1.5, 2.5, POINTS, 'petalDark', { minLevel: 5 }),
        ...layer(0.5, 1.5, BACK, 'petalDark', { minLevel: 2, maxLevel: 3 }),
        ...layer(0.5, 1.5, BACK, 'levelCrystal', { minLevel: 4, maxLevel: 4 }),
        // Level 5 keeps its orange back ring: the gold is the rays, the points and the tips.
        ...layer(0.5, 1.5, BACK, 'petalDark', { minLevel: 5 }),
      ],
    },
    {
      name: 'eyes',
      parent: 'head',
      pivot: [4.25, CY + 1, 0],
      shadedBy: ['head'],
      boxes: [
        // Black, half a voxel proud of the face, a glint in the top corner nearest the sun.
        // A voxel and a half wide, two apart, two and a half tall rather than the art
        // bible's three: this face is tipped back so far that the lawn camera hardly
        // foreshortens it, and at three they came out tall.
        ...layer(4, 4.5, [[1, 2.5, 0, 2.5], [-2.5, -1, 0, 2.5]], 'eye'),
        ...layer(4, 4.5, [[1, 2, 1.5, 2.5], [-2.5, -1.5, 1.5, 2.5]], 'eyeGlint'),
        // Level 5: a small warm light in each.
        ...layer(4, 4.5, [[1.5, 2.5, 0, 1], [-2, -1, 0, 1]], 'fireLight', { minLevel: 5, emissive: 3 }),
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
