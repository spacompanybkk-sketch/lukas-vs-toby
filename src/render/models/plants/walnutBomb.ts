import { breathe, cheerJump, hitWobble, spawnRise, swellBlast } from '../../voxel/clips';
import type { Box, ColorRef, ModelDef } from '../../voxel/types';

// Walnut Bomb. Faces +X. A fat walnut sitting in a heap of soil, its shell in two halves
// with a dark seam between and a ridge over the top, a cross face on the upper half (a
// heavy brow, fierce eyes, gritted teeth) and a short fuse at the back with a glowing tip.
// A nut is round, so the whole model is turned well round to the player (25 degrees) and
// leans back in its soil, so that the face shows from the lawn camera. Its trim is the
// fuse's cap and, from level 2, the bands round the nut.
//
// The nut is authored straight, centred on x = CX: each layer is three crossing boxes, a
// stepped round (the near flank, at z 4, runs from x -1.5 to 2.5), the lower half from
// y 1 to 6 and the upper half from 6 to 12.5.
//
// Every level adds something the lawn camera can see, on top or round the outside:
//
//   2  bands: one round the seam, one over the top; a longer fuse
//   3  riveted iron plates on the crown, the flanks and the back; iron bands and cap
//   4  crystal spikes on the shoulders and a glowing crack pattern; crystal bands
//   5  gold plates and bands, a second fuse, warm lights in the rivets and the eyes
//
// Damage: the part `cracks` is built hidden; the view shows it below half health.

/** The nut's centre line. A little ahead of the tile's centre, so its face is forward. */
const CX = 0.5;
const SEAM = 'walnutDark';
const CORD = '#3B2A1A';
const MOUTH = '#24140A';
const TEETH = '#F4EBDD';
const CRACK = '#2B1A0C';

type Arms = [number, number][];
/** Half-widths (x, z) of the boxes that make each size of stepped round. */
const R45: Arms = [[4.5, 2.5], [3.5, 3.5], [2, 4]];
const R40: Arms = [[4, 2.25], [3, 3.25], [2, 3.75]];
/** The shoulders: round at the flanks, still flat in front where the face is. */
const SHOULDER: Arms = [[4.5, 2.5], [3, 3.25], [1.75, 3.75]];
const R35: Arms = [[3.5, 2], [2.5, 3], [1.5, 3.5]];
const R25: Arms = [[2.5, 1.5], [1.5, 2.5]];

/** A stepped round of the given arms from y0 to y1, centred on CX, grown by `grow` all round. */
function round(arms: Arms, y0: number, y1: number, color: ColorRef, grow = 0, extra: Partial<Box> = {}): Box[] {
  return arms.map(([hx, hz]) => ({
    at: [CX - hx - grow, y0, -hz - grow],
    size: [2 * (hx + grow), y1 - y0, 2 * (hz + grow)],
    color,
    ...extra,
  }));
}

/** A box that exists only from level `from` to level `to`. */
const at = (box: Box, from: number, to = 5): Box => ({ ...box, minLevel: from, ...(to < 5 ? { maxLevel: to } : {}) });

/** Riveted plates: iron at levels 3 and 4, gold at 5, each a face plate on a darker rim. */
function plate(rim: Pick<Box, 'at' | 'size'>, face: Pick<Box, 'at' | 'size'>): Box[] {
  return [
    at({ ...rim, color: 'levelIronDark' }, 3, 4),
    at({ ...face, color: 'levelIron' }, 3, 4),
    at({ ...rim, color: 'levelGoldDark' }, 5),
    at({ ...face, color: 'levelGold' }, 5),
  ];
}

/** Rivets: iron at 3 and 4; at level 5, warm lights. */
function rivets(boxes: Pick<Box, 'at' | 'size'>[]): Box[] {
  return boxes.flatMap((box) => [at({ ...box, color: 'levelIron' }, 3, 4), at({ ...box, color: 'fireLight', emissive: 2 }, 5)]);
}

/** The same boxes on the far side: z mirrored. */
const farSide = (boxes: Box[]): Box[] =>
  boxes.map((box) => ({ ...box, at: [box.at[0], box.at[1], -box.at[2] - box.size[2]] as [number, number, number] }));

/** Grooves in the shell, flush with the near flank (z = 4): short steps, so they wander. */
const GROOVES: Box[] = [
  { at: [-1.75, 2, 3.75], size: [0.5, 1.5, 0.25], color: SEAM },
  { at: [-1.25, 3.5, 3.75], size: [0.5, 1.5, 0.25], color: SEAM },
  { at: [1.75, 2.5, 3.75], size: [0.5, 2.5, 0.25], color: SEAM },
  { at: [-1.75, 6.5, 3.75], size: [0.5, 1.5, 0.25], color: SEAM },
  { at: [-1.25, 8, 3.75], size: [0.5, 1.25, 0.25], color: SEAM },
  { at: [1.5, 6.5, 3.75], size: [0.5, 1.25, 0.25], color: SEAM },
  { at: [2, 7.75, 3.75], size: [0.5, 1.5, 0.25], color: SEAM },
];

/** Paler bumps on the upper shell, flush with the near flank and the crown. */
const BUMPS: Box[] = [
  { at: [-0.5, 6.5, 3.75], size: [1, 0.75, 0.25], color: 'walnutLight' },
  { at: [-1.75, 8.25, 3.75], size: [0.5, 0.75, 0.25], color: 'walnutLight' },
  { at: [0.25, 8.5, 3.75], size: [0.75, 0.5, 0.25], color: 'walnutLight' },
  { at: [-2.5, 11.5, 1], size: [1, 0.25, 1], color: 'walnutLight' },
  { at: [-3.5, 10.25, -1.5], size: [1, 0.25, 1], color: 'walnutLight' },
];

/** Crystal veins, flush with the lower flank: a zigzag that glows. */
const VEINS: Box[] = [
  { at: [-2, 2.25, 3.75], size: [1, 1, 0.25], color: 'levelCrystal', minLevel: 4 },
  { at: [-1, 3.25, 3.75], size: [1, 0.75, 0.25], color: 'levelCrystal', minLevel: 4 },
  { at: [0, 2.75, 3.75], size: [1, 0.75, 0.25], color: 'levelCrystal', minLevel: 4 },
  { at: [0.25, 3.5, 3.75], size: [0.75, 1.25, 0.25], color: 'levelCrystal', minLevel: 4 },
  { at: [1.75, 2.25, 3.75], size: [0.75, 1, 0.25], color: 'levelCrystal', minLevel: 4 },
];

/** Crystal spikes on a shoulder, stepping up and out, and one on the back of the crown. */
const SPIKES: Box[] = [
  { at: [-1.5, 11.75, 2], size: [1.5, 1.5, 1], color: 'levelCrystal', minLevel: 4 },
  { at: [-1.25, 13.25, 2.25], size: [1, 1, 0.75], color: 'levelCrystal', minLevel: 4 },
  { at: [-1, 14.25, 2.5], size: [0.75, 0.75, 0.5], color: 'levelCrystal', minLevel: 4 },
];
const BACK_SPIKE: Box[] = [
  { at: [-3.75, 10.5, -0.5], size: [1, 1.5, 1], color: 'levelCrystal', minLevel: 4 },
  { at: [-4, 12, -0.375], size: [0.75, 1, 0.75], color: 'levelCrystal', minLevel: 4 },
];

/**
 * Cracks on the upper shell's near flank, standing a quarter voxel proud: on the shell at
 * levels 1 and 2, and on the iron (later gold) plate that covers that spot from level 3.
 */
const CRACK_SHAPE: [number, number, number, number][] = [
  // x, y, width, height
  [-1.25, 8.5, 0.75, 0.5],
  [-0.75, 7.75, 0.5, 1],
  [-0.5, 7.25, 0.75, 0.5],
  [-0.25, 6.5, 0.5, 1],
];
const CRACKS: Box[] = [
  ...CRACK_SHAPE.map(([x, y, w, h]): Box => ({ at: [x, y, 4], size: [w, h, 0.25], color: CRACK, maxLevel: 2 })),
  ...CRACK_SHAPE.map(([x, y, w, h]): Box => ({ at: [x, y, 4.75], size: [w, h, 0.25], color: CRACK, minLevel: 3 })),
];

export const walnutBomb: ModelDef = {
  key: 'walnutBomb',
  trim: ['iron'],
  eyes: ['eyes'],
  parts: [
    {
      // The soil it sits in, heaped round the bottom of the nut. The whole model is turned
      // to the player from here.
      name: 'root',
      pivot: [0, 0, 0],
      rot: [0, -25, 0],
      boxes: [
        { at: [-4.75, 0, -2.5], size: [9.5, 1, 5], color: 'soil' },
        { at: [-3.75, 0, -3.75], size: [7.5, 1, 7.5], color: 'soil' },
        { at: [-2.5, 0, -4.25], size: [5, 1, 8.5], color: 'soil' },
        // Its sides stand clear of the nut's, which share their planes and would flicker.
        { at: [-3.5, 1, -2.4], size: [8, 0.75, 4.8], color: 'soilDark' },
        { at: [-2.5, 1, -3.4], size: [6, 0.75, 6.8], color: 'soilDark' },
        { at: [-1.5, 1, -3.9], size: [4, 0.75, 7.8], color: 'soilDark' },
      ],
    },
    {
      // The lower half, leaning back about the seam with everything on it. It heaves as it
      // breathes and swells before it blows.
      name: 'body',
      parent: 'root',
      pivot: [CX, 6, 0],
      rot: [0, 0, 8],
      boxes: [
        // Narrower at the bottom, like an egg.
        ...round(R35, 1, 2, 'walnut'),
        ...round(R40, 2, 3.5, 'walnut'),
        ...round(R45, 3.5, 6, 'walnut'),
        ...GROOVES.filter((box) => box.at[1] < 6),
        ...farSide(GROOVES.filter((box) => box.at[1] < 6)),
        ...VEINS,
        ...farSide(VEINS),
        // The seam between the halves.
        ...round(R45, 5.5, 6, SEAM),
        // Level 2 up: a band round the seam, and the band over the top coming down the flanks.
        ...round(R45, 5, 6, 'iron', 0.5, { minLevel: 2 }),
        at({ at: [1, 2, 4], size: [1.5, 3, 0.5], color: 'iron' }, 2),
        at({ at: [1, 2, -4.5], size: [1.5, 3, 0.5], color: 'iron' }, 2),
      ],
    },
    {
      // The upper half, with the face on its front.
      name: 'head',
      parent: 'body',
      pivot: [CX, 6, 0],
      shadedBy: ['eyes'],
      boxes: [
        ...round(R45, 6, 9.25, 'walnut'),
        ...round(SHOULDER, 9.25, 10.5, 'walnut'),
        ...round(R35, 10.5, 11.75, 'walnut'),
        ...round(R25, 11.75, 12.5, 'walnutLight'),
        ...GROOVES.filter((box) => box.at[1] >= 6),
        ...farSide(GROOVES.filter((box) => box.at[1] >= 6)),
        ...BUMPS,
        // The ridge over the top, front to back, where the two shells of a walnut meet.
        { at: [0, 12.5, -0.5], size: [3, 0.5, 1], color: 'walnut' },
        { at: [3, 11.75, -0.5], size: [1, 0.75, 1], color: 'walnut' },

        // A heavy brow, high at the ends and low in the middle, where it comes down over the
        // tops of the eyes and dips between them into a scowl.
        { at: [4, 11, 1.5], size: [1.75, 0.75, 1.25], color: 'walnutDark' },
        { at: [4, 11, -2.75], size: [1.75, 0.75, 1.25], color: 'walnutDark' },
        { at: [4, 10.5, 0.25], size: [1.5, 0.75, 1.25], color: 'walnutDark' },
        { at: [4, 10.5, -1.5], size: [1.5, 0.75, 1.25], color: 'walnutDark' },
        { at: [5.5, 10, 0.25], size: [0.75, 1.25, 1.25], color: 'walnutDark' },
        { at: [5.5, 10, -1.5], size: [0.75, 1.25, 1.25], color: 'walnutDark' },
        { at: [4, 9.75, -0.25], size: [2.25, 1.5, 0.5], color: 'walnutDark' },
        // Gritted teeth: two rows of three in a dark mouth.
        { at: [4.5, 6.25, -2], size: [0.5, 1.1, 4], color: MOUTH },
        ...[6.4, 6.85].flatMap((y) =>
          [-1.75, -0.5, 0.75].map((z): Box => ({ at: [4.75, y, z], size: [0.25, 0.35, 1], color: TEETH })),
        ),

        // Level 2: the band over the top, stepping down the shoulders. Plated over from 3.
        at({ at: [1, 12.5, -2.5], size: [1.5, 0.5, 5], color: 'iron' }, 2, 2),
        at({ at: [1, 11.75, 2.5], size: [1.5, 1.25, 1], color: 'iron' }, 2),
        at({ at: [1, 11.75, -3.5], size: [1.5, 1.25, 1], color: 'iron' }, 2),
        at({ at: [1, 10.5, 3.5], size: [1.5, 1.75, 0.5], color: 'iron' }, 2),
        at({ at: [1, 10.5, -4], size: [1.5, 1.75, 0.5], color: 'iron' }, 2),
        at({ at: [1, 9.25, 3.75], size: [1.5, 1.25, 0.5], color: 'iron' }, 2),
        at({ at: [1, 9.25, -4.25], size: [1.5, 1.25, 0.5], color: 'iron' }, 2),
        at({ at: [1, 6, 4], size: [1.5, 3.25, 0.5], color: 'iron' }, 2),
        at({ at: [1, 6, -4.5], size: [1.5, 3.25, 0.5], color: 'iron' }, 2),

        // Level 3 up: riveted plates on the crown, the flanks and the back.
        ...plate({ at: [0, 12.5, -1.75], size: [3, 0.5, 3.5] }, { at: [0.25, 12.75, -1.5], size: [2.5, 0.5, 3] }),
        ...plate({ at: [-1.5, 6.25, 4], size: [2.5, 3, 0.5] }, { at: [-1.25, 6.5, 4.25], size: [2, 2.5, 0.5] }),
        ...plate({ at: [-1.5, 6.25, -4.5], size: [2.5, 3, 0.5] }, { at: [-1.25, 6.5, -4.75], size: [2, 2.5, 0.5] }),
        ...plate({ at: [-4.5, 7, -2], size: [0.5, 3, 4] }, { at: [-4.75, 7.25, -1.75], size: [0.5, 2.5, 3.5] }),
        ...rivets([
          { at: [0.5, 13.25, -1.25], size: [0.5, 0.25, 0.5] },
          { at: [0.5, 13.25, 0.75], size: [0.5, 0.25, 0.5] },
          { at: [-1, 6.75, 4.75], size: [0.5, 0.5, 0.25] },
          { at: [0.25, 8.5, 4.75], size: [0.5, 0.5, 0.25] },
          { at: [-1, 6.75, -5], size: [0.5, 0.5, 0.25] },
          { at: [0.25, 8.5, -5], size: [0.5, 0.5, 0.25] },
        ]),

        // Level 4 up: crystal spikes on both shoulders and the back of the crown.
        ...SPIKES,
        ...farSide(SPIKES),
        ...BACK_SPIKE,
      ],
    },
    {
      name: 'eyes',
      parent: 'head',
      pivot: [5.25, 9, 0],
      shadedBy: ['head'],
      boxes: [
        // Black, standing half a voxel proud, glint in the top corner nearest the sun.
        { at: [5, 7.5, 0.5], size: [0.5, 3, 2], color: 'eye' },
        // (The near eye's top inner corner is under the brow, so its glint sits just below.)
        { at: [5, 9, 0.5], size: [0.5, 1, 1], color: 'eyeGlint' },
        { at: [5, 7.5, -2.5], size: [0.5, 3, 2], color: 'eye' },
        { at: [5, 9.5, -2.5], size: [0.5, 1, 1], color: 'eyeGlint' },
        // Level 5: a small warm light in each.
        { at: [5, 8.5, 1.5], size: [0.5, 1, 1], color: 'fireLight', emissive: 3, minLevel: 5 },
        { at: [5, 8.5, -1.5], size: [0.5, 1, 1], color: 'fireLight', emissive: 3, minLevel: 5 },
      ],
    },
    {
      // The fuse at the back of the crown: a cap (the trim), a cord stepping back, a glowing
      // tip. Longer from level 2; two of them at level 5.
      name: 'fuse',
      parent: 'head',
      pivot: [-1, 12.5, 0],
      boxes: [
        { at: [-2, 12.5, -1], size: [2, 0.75, 2], color: 'iron' },
        { at: [-1.5, 13.25, -0.5], size: [1, 1.25, 1], color: CORD },
        // Level 1: a short cord and the spark.
        { at: [-2.25, 14.25, -0.5], size: [1, 0.75, 1], color: CORD, maxLevel: 1 },
        { at: [-3, 14.5, -0.5], size: [1, 1, 1], color: 'fire', emissive: 2, maxLevel: 1 },
        // Level 2 up: a voxel longer.
        { at: [-2.25, 14.25, -0.5], size: [1, 1.75, 1], color: CORD, minLevel: 2 },
        { at: [-3, 15.25, -0.5], size: [1, 1, 1], color: CORD, minLevel: 2 },
        { at: [-3.75, 15.75, -0.5], size: [1, 1, 1], color: 'fire', emissive: 2, minLevel: 2 },
        // Level 5: a second fuse, leaning the other way.
        { at: [-0.75, 14, -0.375], size: [0.75, 1, 0.75], color: CORD, minLevel: 5 },
        { at: [-0.25, 14.75, -0.375], size: [0.75, 1, 0.75], color: CORD, minLevel: 5 },
        { at: [0.25, 15.5, -0.375], size: [0.75, 0.75, 0.75], color: 'fire', emissive: 2, minLevel: 5 },
      ],
    },
    {
      name: 'cracks',
      parent: 'head',
      pivot: [CX, 9, 0],
      hidden: true,
      boxes: [...CRACKS, ...farSide(CRACKS)],
    },
  ],
  clips: {
    idle: breathe({ body: 'body', head: 'head', sway: ['fuse'] }),
    hit: hitWobble('body', -1),
    spawn: spawnRise('root'),
    die: swellBlast('body'),
    cheer: cheerJump('root'),
  },
};
