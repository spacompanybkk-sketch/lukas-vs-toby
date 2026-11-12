import { breathe, cheerJump, hitWobble, spawnRise, swellBlast } from '../../voxel/clips';
import type { Box, ColorRef, ModelDef, PartDef } from '../../voxel/types';

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
//   3  a riveted iron plate on the crown with a crest along the ridge, a plate on the near
//      flank; iron bands and cap
//   4  crystal spikes on the shoulders and a glowing crack pattern; crystal bands
//   5  a gold crown plate and crest and gold bands (the flank plate stays iron), a second
//      fuse, warm lights in the rivets and the eyes
//
// Damage: the part `cracks` is built hidden; the view shows it below half health.

/** The nut's centre line, as authored: the face's front at x 5. */
const CX = 0.5;
/**
 * Where the nut really stands: half a voxel further back than authored, so that turned 35
 * degrees to the player it still fits the level-1 envelope.
 */
const NUT_X = -0.5;

/** A part of the nut moved to where it really stands (see NUT_X). */
function placed(part: PartDef): PartDef {
  const move = ([x, y, z]: [number, number, number]): [number, number, number] => [x + NUT_X, y, z];
  return { ...part, pivot: move(part.pivot), boxes: part.boxes.map((box) => ({ ...box, at: move(box.at) })) };
}
const SEAM = 'walnutDark';
const CORD = '#3B2A1A';
const MOUTH = '#24140A';
const TEETH = '#F4EBDD';
/** The pale plate the face is set in, so black eyes and white teeth stand out. */
const FACE = 'potatoLight';
const CRACK = '#2B1A0C';

type Arms = [number, number][];
/**
 * Half-widths (x, z) of the boxes that make each size of stepped round. Every size and every
 * edge is on the half voxel: an odd size cuts every face of its box into more cells, and the
 * old quarter-voxel nut cost 6,000 to 8,500 triangles.
 */
const R45: Arms = [[4.5, 2.5], [3.5, 3.5], [2, 4]];
const R40: Arms = [[4, 2], [3, 3], [2, 3.5]];
/** The lower half's widest: half a voxel short of the face in front, so the leaning nut's chin stays in its tile. */
const LOW45: Arms = [[4, 2.5], [3.5, 3], [2, 4]];
/** The upper half: a flat front five voxels wide for the face. */
const HEAD45: Arms = R45;
/** The shoulders: round at the flanks, still flat in front where the face is. */
const SHOULDER: Arms = [[4.5, 2.5], [3, 3.5]];
const R35: Arms = [[3.5, 2], [2.5, 3], [1.5, 3.5]];
const R25: Arms = [[2.5, 1.5], [1.5, 2.5]];

/**
 * A stepped round of the given arms from y0 to y1, centred on CX, grown by `grow` all round.
 * The long arms are a voxel shorter at the back than in front: the face wants a flat front,
 * and a short back keeps the turned nut inside its tile.
 */
function round(arms: Arms, y0: number, y1: number, color: ColorRef, grow = 0, extra: Partial<Box> = {}): Box[] {
  return arms.map(([hx, hz]) => {
    const back = hx >= 3 ? 1 : 0;
    return {
      at: [CX - hx + back - grow, y0, -hz - grow],
      size: [2 * (hx + grow) - back, y1 - y0, 2 * (hz + grow)],
      color,
      ...extra,
    };
  });
}

/** A box that exists only from level `from` to level `to`. */
const at = (box: Box, from: number, to = 5): Box => ({ ...box, minLevel: from, ...(to < 5 ? { maxLevel: to } : {}) });

/** The same boxes on the far side: z mirrored. */
const farSide = (boxes: Box[]): Box[] =>
  boxes.map((box) => ({ ...box, at: [box.at[0], box.at[1], -box.at[2] - box.size[2]] as [number, number, number] }));

/** Grooves in the shell, flush with the near flank (z 4): a few short steps, so they wander. */
const GROOVES: Box[] = [
  { at: [-1.5, 2, 3.5], size: [0.5, 2, 0.5], color: SEAM },
  { at: [1.5, 3, 3.5], size: [0.5, 2, 0.5], color: SEAM },
  { at: [-1, 7, 3.5], size: [0.5, 2, 0.5], color: SEAM },
];

/** Crystal veins on the lower flank, standing half a voxel proud: a zigzag that glows. */
const VEINS: Box[] = [
  { at: [-1.5, 2.5, 4], size: [1.5, 0.5, 0.5], color: 'levelCrystal', minLevel: 4 },
  { at: [-0.5, 3, 4], size: [0.5, 1, 0.5], color: 'levelCrystal', minLevel: 4 },
  { at: [-0.5, 4, 4], size: [1.5, 0.5, 0.5], color: 'levelCrystal', minLevel: 4 },
];

/** Crystal spikes on a shoulder, stepping up and in, and one on the back of the crown. */
const SPIKES: Box[] = [
  { at: [-1.5, 11.5, 2], size: [1.5, 1.5, 1], color: 'levelCrystal', minLevel: 4 },
  { at: [-1, 13, 2], size: [1, 1, 1], color: 'levelCrystal', minLevel: 4 },
];
const BACK_SPIKE: Box[] = [{ at: [-3, 10.5, -0.5], size: [1, 2, 1], color: 'levelCrystal', minLevel: 4 }];

/**
 * Cracks on the upper shell's near flank, standing half a voxel proud: on the shell at levels
 * 1 and 2, and on the plate that covers that spot from level 3; one across the crown.
 */
const CRACK_SHAPE: [number, number, number, number][] = [
  // x, y, width, height
  [-1.5, 8.5, 1.5, 0.5],
  [-0.5, 7.5, 0.5, 1.5],
  [-0.5, 7, 1.5, 0.5],
];
const CRACKS: Box[] = [
  ...CRACK_SHAPE.map(([x, y, w, h]): Box => ({ at: [x, y, 4], size: [w, h, 0.5], color: CRACK, maxLevel: 2 })),
  ...CRACK_SHAPE.map(([x, y, w, h]): Box => ({ at: [x, y, 5], size: [w, h, 0.5], color: CRACK, minLevel: 3 })),
  { at: [-1, 12.5, 1], size: [1.5, 0.5, 0.5], color: CRACK, maxLevel: 2 },
  { at: [0, 12.5, 1.5], size: [0.5, 0.5, 1], color: CRACK, maxLevel: 2 },
  // From level 3 the crown crack runs across the plate.
  { at: [0.5, 13.5, 1], size: [2, 0.5, 0.5], color: CRACK, minLevel: 3 },
  { at: [1, 13.5, 1.5], size: [0.5, 0.5, 0.5], color: CRACK, minLevel: 3 },
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
      rot: [0, -38, 0],
      boxes: [
        // Its sides stand clear of the nut's low flanks (z 2, 3, 3.5 and 4), which share their
        // planes and would flicker.
        { at: [-4.5, 0, -2.25], size: [9, 1, 4.5], color: 'soil' },
        { at: [-3.5, 0, -3.25], size: [7, 1, 6.5], color: 'soil' },
        { at: [-2, 0, -4.25], size: [4, 1, 8.5], color: 'soil' },
      ],
    },
    ...(
    [
      {
        // The lower half, leaning back about the seam with everything on it. It heaves as it
        // breathes and swells before it blows.
        name: 'body',
        parent: 'root',
        pivot: [CX, 6, 0],
        rot: [0, 0, 12],
        boxes: [
          // Narrower at the bottom, like an egg.
          ...round(R35, 1, 2, 'walnut'),
          ...round(R40, 2, 3.5, 'walnut'),
          ...round(LOW45, 3.5, 6, 'walnut'),
          // Details go on the near flank only: the far one faces away from the lawn camera.
          ...GROOVES.filter((box) => box.at[1] < 6),
          ...VEINS,
          // The seam between the halves.
          ...round(LOW45, 5.5, 6, SEAM),
          // Level 2 up: a band round the seam, and the band over the top coming down the flank.
          ...round(LOW45, 5, 6, 'iron', 0.5, { minLevel: 2 }),
          at({ at: [1, 2, 4], size: [1.5, 3, 0.5], color: 'iron' }, 2),
        ],
      },
      {
        // The upper half, with the face on its front.
        name: 'head',
        parent: 'body',
        pivot: [CX, 6, 0],
        shadedBy: ['eyes'],
        boxes: [
          ...round(HEAD45, 6, 9.5, 'walnut'),
          ...round(SHOULDER, 9.5, 10.5, 'walnut'),
          ...round(R35, 10.5, 12, 'walnut'),
          ...round(R25, 12, 12.5, 'walnutLight'),
          ...GROOVES.filter((box) => box.at[1] >= 6),
          // The ridge over the top, front to back, where the two shells of a walnut meet.
          { at: [0, 12.5, -0.5], size: [3, 0.5, 1], color: 'walnut' },

          // The face: a big pale plate, flush with the front, so the face reads light on the
          // lawn and the dark eyes, brows and mouth stand out on it.
          { at: [4.5, 6, -2.5], size: [0.5, 4.5, 5], color: FACE },
          // Cross, not menacing: a short brow over each eye, tipped down towards the middle.
          { at: [4.5, 10.5, 1], size: [1, 0.5, 1.5], color: 'walnutDark' },
          { at: [4.5, 10, 0.5], size: [1, 0.5, 0.5], color: 'walnutDark' },
          { at: [4.5, 10.5, -2.5], size: [1, 0.5, 1.5], color: 'walnutDark' },
          { at: [4.5, 10, -1], size: [1, 0.5, 0.5], color: 'walnutDark' },
          // A tight-lipped grimace with three big teeth showing.
          { at: [4.5, 6.5, -2], size: [0.5, 1, 4], color: MOUTH },
          ...[-1.5, -0.5, 0.5].map((z): Box => ({ at: [5, 6.5, z], size: [0.5, 1, 0.5], color: TEETH })),

          // Level 2: the band over the top, stepping down the shoulder. Plated over from 3.
          at({ at: [1, 12.5, -2.5], size: [1.5, 0.5, 5], color: 'iron' }, 2, 2),
          at({ at: [1, 12, 2.5], size: [1.5, 0.5, 1], color: 'iron' }, 2),
          at({ at: [1, 10.5, 3.5], size: [1.5, 1.5, 0.5], color: 'iron' }, 2),
          at({ at: [1, 6, 4], size: [1.5, 4.5, 0.5], color: 'iron' }, 2),

          // Level 3 up: a riveted plate on the crown with a crest standing up along the ridge
          // (iron at 3 and 4, gold at 5), and a plate on the near flank (iron at every level).
          at({ at: [0, 12.5, -2], size: [3, 1, 4], color: 'levelIron' }, 3, 4),
          at({ at: [0.5, 13.5, -0.5], size: [2, 1.5, 1], color: 'levelIronDark' }, 3, 4),
          at({ at: [0, 12.5, -2], size: [3, 1, 4], color: 'levelGold' }, 5),
          at({ at: [0.5, 13.5, -0.5], size: [2, 1.5, 1], color: 'levelGoldDark' }, 5),
          at({ at: [-1.5, 6, 4], size: [2.5, 3.5, 1], color: 'levelIron' }, 3),
          at({ at: [0.5, 8.5, 5], size: [0.5, 0.5, 0.5], color: 'levelIronDark' }, 3, 4),
          at({ at: [-1.5, 6.5, 5], size: [0.5, 0.5, 0.5], color: 'levelIronDark' }, 3, 4),
          at({ at: [0.5, 8.5, 5], size: [0.5, 0.5, 0.5], color: 'fireLight', emissive: 2 }, 5),
          at({ at: [-1.5, 6.5, 5], size: [0.5, 0.5, 0.5], color: 'fireLight', emissive: 2 }, 5),

          // Level 4 up: crystal spikes on both shoulders and the back of the crown.
          ...SPIKES,
          ...farSide(SPIKES),
          ...BACK_SPIKE,
        ],
      },
      {
        name: 'eyes',
        parent: 'head',
        pivot: [5.25, 8.5, 0],
        shadedBy: ['head'],
        boxes: [
          // Black, two wide, standing half a voxel proud, a voxel apart, a glint in the top
          // corner nearest the sun. (Two and a half tall: the face is tipped back.)
          { at: [5, 7.5, 0.5], size: [0.5, 2.5, 2], color: 'eye' },
          { at: [5, 9, 0.5], size: [0.5, 1, 1], color: 'eyeGlint' },
          { at: [5, 7.5, -2.5], size: [0.5, 2.5, 2], color: 'eye' },
          { at: [5, 9, -2.5], size: [0.5, 1, 1], color: 'eyeGlint' },
          // Level 5: a small warm light in each.
          { at: [5, 8, 1.5], size: [0.5, 1, 1], color: 'fireLight', emissive: 3, minLevel: 5 },
          { at: [5, 8, -1.5], size: [0.5, 1, 1], color: 'fireLight', emissive: 3, minLevel: 5 },
        ],
      },
      {
        // The fuse at the back of the crown: a cap (the trim), a cord stepping back, a glowing
        // tip. Longer from level 2; two of them at level 5.
        name: 'fuse',
        parent: 'head',
        pivot: [-1, 12.5, 0],
        boxes: [
          { at: [-2, 12.5, -1], size: [2, 1, 2], color: 'iron' },
          { at: [-1.5, 13.5, -0.5], size: [1, 0.5, 1], color: CORD },
          // Level 1: a short cord and the spark.
          { at: [-2.5, 14, -0.5], size: [1, 0.5, 1], color: CORD, maxLevel: 1 },
          { at: [-3, 14.5, -0.5], size: [1, 1, 1], color: 'fire', emissive: 2, maxLevel: 1 },
          // Level 2 up: a voxel longer.
          { at: [-2.5, 14, -0.5], size: [1, 1.5, 1], color: CORD, minLevel: 2 },
          { at: [-3.5, 15, -0.5], size: [1, 1, 1], color: CORD, minLevel: 2 },
          { at: [-4, 16, -0.5], size: [1, 1, 1], color: 'fire', emissive: 2, minLevel: 2 },
          // Level 5: a second fuse, leaning the other way.
          { at: [-1, 14, -0.5], size: [1, 1, 1], color: CORD, minLevel: 5 },
          { at: [-0.5, 15, -0.5], size: [1, 1, 1], color: 'fire', emissive: 2, minLevel: 5 },
        ],
      },
      {
        name: 'cracks',
        parent: 'head',
        pivot: [CX, 9, 0],
        hidden: true,
        boxes: CRACKS,
      },
    ] satisfies PartDef[]
    ).map(placed),
  ],
  clips: {
    idle: breathe({ body: 'body', head: 'head', sway: ['fuse'] }),
    hit: hitWobble('body', -1),
    spawn: spawnRise('root'),
    die: swellBlast('body'),
    cheer: cheerJump('root'),
  },
};
