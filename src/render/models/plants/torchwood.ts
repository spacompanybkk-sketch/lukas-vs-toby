import { cheerJump, flameIdle, hitWobble, spawnRise, wilt } from '../../voxel/clips';
import type { Box, ModelDef } from '../../voxel/types';
import { bothSides, lv, round, span } from './kit';

// Torchwood. Faces +X. A stout tree stump with grooved bark, pale rings on its cut top and a
// fierce face carved into the bark, burning with a stepped voxel flame: orange at the base,
// yellow higher up, a pale tip. Peas that pass through it catch fire. The stump is turned to
// the player and tipped back a little, as the Peashooter's head.
//
// The stump is authored on x = 0, z = 0: two crossing boxes 8 x 6 and 6 x 8 from y 1.5 to 9, its
// front (the face) at x 4. The flame is two parts so they can flicker apart: `flame`, the base
// and middle, and `flameTip`, the top, each scaled about its own base.
//
// Every level adds something the lawn camera can see, above the stump or round it:
//
//   2  a taller flame with side tongues; a leafy sprout and a red-capped mushroom on the stump
//   3  iron bands round the stump, at its foot and round the rim
//   4  a blue-white crystal flame; crystal bands
//   5  a gold foot band and a crown of gold points round a tall, bright flame; warm lights in the eyes

const MOUTH = '#2A1608';
const TOOTH = '#F4E6C8';
/** The bands from level 3: matte here, the trim, so iron, crystal and gold from 3 to 5. */
const BAND = 'iron';

/** The flame's colours at each height, bottom to top, and how strongly each glows. */
interface Fire {
  base: string;
  middle: string;
  upper: string;
  tip: string;
}
const ORANGE: Fire = { base: '#FF4A0A', middle: 'fire', upper: 'fireLight', tip: '#FFF3B8' };
const BLUE: Fire = { base: 'levelCrystalDeep', middle: 'levelCrystal', upper: '#C8F4FF', tip: '#FFFFFF' };
const BRIGHT: Fire = { base: 'fire', middle: '#FFB02E', upper: 'fireLight', tip: '#FFFFFF' };

/** The base and middle of a flame: wide at the bottom, leaning a little back. */
function flameLow(f: Fire, licks: boolean): Box[] {
  return [
    span(-2.5, 2.5, 9, 10.5, -2, 2, f.base, { emissive: 2.5 }),
    span(-2, 2, 9, 10.5, -2.5, 2.5, f.base, { emissive: 2.5 }),
    span(-2, 1.5, 10.5, 12.5, -1.5, 1.5, f.middle, { emissive: 2.5 }),
    span(-1.5, 1, 10.5, 12.5, -2, 2, f.middle, { emissive: 2.5 }),
    // A yellow heart showing at the front of the base.
    span(1.5, 2.75, 9.5, 10.5, -1, 1, f.upper, { emissive: 2.2 }),
    ...(licks
      ? [
          // Tongues licking up off the sides.
          span(1, 2, 10.5, 12, 1.5, 2.5, f.middle, { emissive: 2.5 }),
          span(1.5, 2, 12, 13, 1.75, 2.25, f.upper, { emissive: 2.2 }),
          span(-2.5, -1.5, 10.5, 13, -2.5, -1.5, f.middle, { emissive: 2.5 }),
          span(-2.25, -1.75, 13, 14, -2.25, -1.75, f.upper, { emissive: 2.2 }),
        ]
      : []),
  ];
}

/** The top of a flame from y 12.5, `tall` voxels high: yellow, narrowing to a pale tip. */
function flameHigh(f: Fire, tall: number): Box[] {
  const top = 12.5 + tall;
  return [
    span(-1.5, 1, 12.5, top - 2, -1, 1, f.upper, { emissive: 2.2 }),
    span(-1, 0.5, 12.5, top - 2, -1.5, 1.5, f.upper, { emissive: 2.2 }),
    span(-1, 0.5, top - 2, top - 1, -0.5, 0.5, f.upper, { emissive: 2.2 }),
    span(-1.5, 0, top - 1, top, -0.5, 0.5, f.tip, { emissive: 2 }),
  ];
}

export const torchwood: ModelDef = {
  key: 'torchwood',
  trim: [BAND],
  eyes: ['eyes'],
  parts: [
    {
      // Soil, and roots spreading out over it.
      name: 'root',
      pivot: [0, 0, 0],
      boxes: [
        span(-4, 4, 0, 1, -2, 2, 'soil'),
        span(-3, 3, 0, 1, -3, 3, 'soil'),
        span(-2, 2, 1, 1.5, -2, 2, 'soilDark'),
        span(3, 5.5, 1, 2, -1, 0, 'barkDark'),
        span(-1.5, -0.5, 1, 2, 3, 4.5, 'barkDark'),
        span(-5, -3, 1, 2, 0.5, 1.5, 'barkDark'),
        span(1.5, 2.5, 1, 2, 3, 4, 'barkDark'),
      ],
    },
    {
      // The stump, with the face. Turned to the player and tipped back.
      name: 'head',
      parent: 'root',
      pivot: [0, 1, 0],
      rot: [0, -22, 2],
      shadedBy: ['eyes'],
      boxes: [
        span(-4, 4, 1.5, 9, -3, 3, 'bark'),
        // (A little shorter behind, so that turned and tipped it stays on its tile.)
        span(-2.5, 3, 1.5, 9, -4, 4, 'bark'),
        // Bark: dark grooves running up the sides the camera sees.
        span(-2, -1, 1.5, 7, 3.5, 4, 'barkDark'),
        span(1, 2, 4, 9, 3.5, 4, 'barkDark'),
        span(3, 3.5, 1.5, 6, 3, 3.5, 'barkDark'),
        span(-1, 0, 7, 9, 3.5, 4, 'barkDark'),
        // Level 3 up: bands round the stump, at the foot and round the rim, with a rivet in front.
        ...lv(3, 4, [...round(0, 0, [[4.5, 3.5], [3.5, 4.5]], 1.5, 2.5, BAND), ...round(0, 0, [[4.5, 3.5], [3.5, 4.5]], 8, 9, BAND)]),
        // Level 5: a gold band at the foot and a crown of four gold points round
        // the flame: the stump stays wood, the gold is the crown.
        ...lv(5, 5, [
          ...round(0, 0, [[4.5, 3.5], [3.5, 4.5]], 1.5, 2.5, 'levelGold'),
          span(3, 4, 9, 10.5, -0.5, 0.5, 'levelGold'),
          span(-4, -3, 9, 10.5, -0.5, 0.5, 'levelGold'),
          span(-0.5, 0.5, 9, 10.5, 3, 4, 'levelGold'),
          span(-0.5, 0.5, 9, 10.5, -4, -3, 'levelGold'),
        ]),
        ...lv(3, 4, [span(4.5, 5, 8.25, 8.75, -0.25, 0.25, 'levelIronDark')]),
        ...lv(5, 5, [span(4.5, 5, 8.25, 8.75, -0.25, 0.25, 'fireLight', { emissive: 2 })]),
        // The cut top (painted over the band): pale wood with a darker ring in it and the bark round the rim.
        ...round(0, 0, [[3, 1.5], [2, 2.5], [1, 3]], 8, 9, 'barkLight'),
        ...round(0, 0, [[2, 1], [1, 2]], 8, 9, 'bark'),
        ...round(0, 0, [[1, 0.5], [0.5, 1]], 8, 9, 'barkLight'),
        // The face, carved into a pale patch of wood: fierce brows, gritted teeth.
        span(3.5, 4, 2.5, 8, -3, 3, 'barkLight'),
        span(3.5, 4, 3, 4, -1.5, 1.5, MOUTH),
        span(3.75, 4, 3.5, 4, -1, 1, TOOTH),
        ...bothSides([span(4, 5, 7.5, 8, 0.25, 1.25, 'barkDark'), span(4, 5, 8, 8.5, 1.25, 2.5, 'barkDark')]),
        // Level 2 up: a leafy sprout on the near flank, and a red-capped mushroom at its foot.
        ...lv(2, 5, [span(-1.5, -0.5, 6, 6.5, 4, 5, 'stem'), span(-2, 0, 6.5, 7, 4.5, 5.5, 'leaf'), span(-2.5, -1.5, 7, 7.5, 5, 5.5, 'leafLight')]),
        ...lv(2, 5, [
          span(1.5, 2.5, 2.5, 3.5, 4, 5, 'bone'),
          span(1, 3, 3.5, 4.5, 4, 6, 'cherry'),
          span(1.5, 2, 4, 4.5, 5, 5.5, 'tooth'),
          span(2.5, 3, 3.5, 4, 5.5, 6, 'tooth'),
        ]),
      ],
    },
    {
      name: 'eyes',
      parent: 'head',
      pivot: [4.25, 6, 0],
      shadedBy: ['head'],
      boxes: [
        ...bothSides([span(4, 4.5, 4.5, 7.5, 0.5, 2.5, 'eye')]),
        span(4, 4.5, 6.5, 7.5, 0.5, 1.5, 'eyeGlint'),
        span(4, 4.5, 6.5, 7.5, -2.5, -1.5, 'eyeGlint'),
        ...lv(5, 5, bothSides([span(4, 4.5, 5, 6, 1.5, 2.5, 'fireLight', { emissive: 3 })])),
      ],
    },
    {
      // The base and middle of the flame, on the cut top.
      name: 'flame',
      parent: 'head',
      pivot: [0, 9, 0],
      boxes: [...lv(1, 1, flameLow(ORANGE, false)), ...lv(2, 3, flameLow(ORANGE, true)), ...lv(4, 4, flameLow(BLUE, true)), ...lv(5, 5, flameLow(BRIGHT, true))],
    },
    {
      // The top of the flame: taller at level 2, tallest at 5.
      name: 'flameTip',
      parent: 'flame',
      pivot: [-0.25, 12.5, 0],
      boxes: [...lv(1, 1, flameHigh(ORANGE, 3.5)), ...lv(2, 3, flameHigh(ORANGE, 5.5)), ...lv(4, 4, flameHigh(BLUE, 5.5)), ...lv(5, 5, flameHigh(BRIGHT, 7.5))],
    },
  ],
  clips: {
    idle: flameIdle({ flames: ['flame', 'flameTip'], body: 'head' }),
    hit: hitWobble('head', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'head', head: 'flame' }),
    cheer: cheerJump('root'),
  },
};
