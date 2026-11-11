import { cheerJump, hitWobble, idleBob, leapSlam, spawnRise, wilt } from '../../voxel/clips';
import type { Box, ModelDef } from '../../voxel/types';
import { bothSides, lv, round, span } from './kit';

// Pumpkin Squash. Faces +X. A big ribbed orange pumpkin standing on two short vine legs, a
// determined face carved into its front (slanted eyes, a little nose, a jagged grin), a curly
// stem on top and a tendril curling off its near side. The biggest plant on the lawn. It
// leaps a tile into the air and comes down on a zombie with a squash. The whole pumpkin is
// turned to the player and tipped back a little, so the carved face shows from above.
//
// Authored straight on x = 0, z = 0: the pumpkin is a stepped round 9 across from y 2 to 12,
// its front (the face) at x 4.5; the legs stand under it from the ground.
//
// Every level adds something the lawn camera can see, on top or round the outside:
//
//   2  big leaves on both shoulders, like pads
//   3  an iron helmet band round the brow, riveted, with a crest over the top
//   4  the carved mouth and nose glow crystal blue from inside; crystal band and spikes
//   5  a gold crown round the stem, a gold band, a warm glow in the carvings and the eyes

/** The carved-out dark, and the lights inside the carvings at levels 4 and 5. */
const CARVED = '#2B1206';
const GLOW_CRYSTAL = '#3FC6F2';
const GLOW_WARM = '#FF9A26';
/** The band from level 3: matte here, the trim, so iron, crystal and gold from 3 to 5. */
const BAND = 'iron';

/** The pumpkin's plan, as half-widths [x, z] of three crossing boxes. */
const WIDE: [number, number][] = [[4.5, 2.5], [3.5, 3.5]];
const MID: [number, number][] = [[3.5, 2], [2.5, 3], [1.5, 3.5]];
const NARROW: [number, number][] = [[2.5, 1.5], [1.5, 2.5]];

/** The carvings in the front: nose and grin, dark, or alight in `light` at `glow`. */
function carvings(color: string, extra: Partial<Box> = {}): Box[] {
  return [
    // A little nose, stepped to a point.
    span(4, 4.5, 6.5, 7, -1, 1, color, extra),
    span(4, 4.5, 7, 7.5, -0.5, 0.5, color, extra),
    // A jagged grin, the corners turned up.
    span(4, 4.5, 4.5, 6, -2, 2, color, extra),
    ...bothSides([span(4, 4.5, 6, 6.5, 1.5, 2.5, color, extra)]),
  ];
}
/** The pumpkin's teeth, left standing in the grin: one up, one down, painted over the carving. */
const TEETH: Box[] = [span(4, 4.5, 5.5, 6, -1.5, -0.5, 'pumpkin'), span(4, 4.5, 4.5, 5, 0.5, 1.5, 'pumpkin')];

/** A leaf pad on the near shoulder (mirrored for the far one): dark underneath, a pale tip. */
const PAD: Box[] = [
  span(-2.5, 2, 9.5, 10, 3.5, 6, 'leafDark'),
  span(-2, 1.5, 10, 10.5, 3.5, 5.5, 'leaf'),
  span(-1, 0.5, 9.5, 10, 6, 7, 'leafLight'),
  span(-0.5, 0, 10.5, 11, 3, 5, 'leafDark'),
];

export const pumpkinSquash: ModelDef = {
  key: 'pumpkinSquash',
  trim: [BAND],
  eyes: ['eyes'],
  // Where it lands its blow: the front of its foot.
  muzzle: { part: 'body', at: [4, 1, 0] },
  parts: [
    {
      name: 'root',
      pivot: [0, 0, 0],
      boxes: round(0, 0, [[4, 3], [3, 4]], 0, 1, 'soil'),
    },
    {
      // The pumpkin and its legs, all one: it leaps, squashes and wobbles as one.
      name: 'body',
      parent: 'root',
      pivot: [0, 1, 0],
      rot: [0, -22, 6],
      shadedBy: ['eyes'],
      boxes: [
        // Two short vine legs with leaf feet.
        ...bothSides([span(-1, 1, 1, 3, 1.5, 3, 'stem'), span(-1.5, 2, 1, 1.5, 1, 3.5, 'leafDark')]),
        // The pumpkin: rounder at the top than at the bottom.
        ...round(0, 0, NARROW, 2, 3, 'pumpkinDark'),
        ...round(0, 0, MID, 3, 4, 'pumpkin'),
        ...round(0, 0, WIDE, 4, 10, 'pumpkin'),
        // (The widest box sits a little forward, so that turned and tipped it stays on its tile.)
        span(-1, 2, 4, 10, -4.5, 4.5, 'pumpkin'),
        ...round(0, 0, MID, 10, 11, 'pumpkin'),
        ...round(0, 0, NARROW, 11, 12, 'pumpkin'),
        // Ribs: dark creases down the sides the camera sees, and across the top.
        span(-0.5, 0, 3.5, 10.5, 4, 4.5, 'pumpkinDark'),
        span(1, 1.5, 3.5, 10.5, 4, 4.5, 'pumpkinDark'),
        span(3, 3.5, 4, 10, 3, 3.5, 'pumpkinDark'),
        span(-3, -2.5, 4, 10, 3, 3.5, 'pumpkinDark'),
        span(-0.5, 0, 11.5, 12, 1, 2.5, 'pumpkinDark'),
        span(1, 2.5, 11.5, 12, -0.5, 0, 'pumpkinDark'),
        span(-2.5, -1, 11.5, 12, -0.5, 0, 'pumpkinDark'),
        // The carved face: dark at levels 1 to 3, lit crystal blue at 4 and warm at 5.
        ...lv(1, 3, carvings(CARVED)),
        ...lv(4, 4, carvings(GLOW_CRYSTAL, { emissive: 1.6 })),
        ...lv(5, 5, carvings(GLOW_WARM, { emissive: 2 })),
        ...TEETH,
        // Level 2 up: leaf pads on both shoulders.
        ...lv(2, 5, bothSides(PAD)),
        // Level 3 up: a band round the brow, rivets, and a crest over the top.
        ...lv(3, 5, round(0, 0, [[4, 2.5], [3, 3.5], [1.5, 4]], 10, 11, BAND)),
        ...lv(3, 4, bothSides([span(-0.5, 0.5, 12, 13, 1, 2.5, BAND), span(-1, 1, 11, 12, 2.5, 3, BAND)])),
        ...lv(3, 4, [span(4, 4.5, 10.25, 10.75, -0.25, 0.25, 'levelIronDark'), span(1.25, 1.75, 10.25, 10.75, 3.5, 4, 'levelIronDark')]),
        ...lv(5, 5, [span(4, 4.5, 10.25, 10.75, -0.25, 0.25, 'fireLight', { emissive: 2 }), span(1.25, 1.75, 10.25, 10.75, 3.5, 4, 'fireLight', { emissive: 2 })]),
        // Level 4: crystal spikes standing up off the band.
        ...lv(4, 4, [
          span(-3.5, -2.5, 11, 13, -0.75, 0.75, 'levelCrystal'),
          ...bothSides([span(-0.5, 0.5, 13, 14, 1.5, 2.5, 'levelCrystal'), span(2, 3, 11, 12.5, 2, 3, 'levelCrystal')]),
        ]),
      ],
    },
    {
      name: 'eyes',
      parent: 'body',
      pivot: [4.75, 8.5, 0],
      shadedBy: ['body'],
      boxes: [
        // Carved eyes, standing half a voxel proud as every eye does, the inner top corner left
        // in pumpkin so they slant: determined. A glint in each.
        ...bothSides([span(4.5, 5, 7.5, 10, 0.5, 2.5, CARVED)]),
        ...bothSides([span(4.5, 5, 9, 10, 0.5, 1.5, 'pumpkin')]),
        span(4.5, 5, 8, 9, 0.5, 1.5, 'eyeGlint'),
        span(4.5, 5, 9, 10, -2.5, -1.5, 'eyeGlint'),
        ...lv(5, 5, bothSides([span(4.5, 5, 7.5, 8.5, 1.5, 2.5, 'fireLight', { emissive: 3 })])),
      ],
    },
    {
      // A curly stem on top, with a tendril; at level 5, a gold crown round it.
      name: 'stem',
      parent: 'body',
      pivot: [0, 12, 0],
      boxes: [
        span(-1, 1, 12, 13.5, -1, 1, 'stem'),
        span(-1.5, 0.5, 13.5, 14.5, -0.5, 0.5, 'stem'),
        span(-2.5, -1, 14, 15, -0.5, 0.5, 'leafDark'),
        span(-3, -2, 13, 14, -0.5, 0.5, 'leafDark'),
        // A tendril curling off towards the player.
        span(0.5, 1, 12, 12.5, 1, 2.5, 'leafDark'),
        span(1, 1.5, 12.5, 13.5, 2.5, 3, 'leafDark'),
        span(0, 1, 13.5, 14, 2.5, 3, 'leaf'),
        // Level 5: the crown, a ring of gold with points at its corners and a jewel.
        ...lv(5, 5, [
          ...bothSides([span(-2, 2, 12, 13, 1.5, 2, 'levelGold'), span(-2, -1.5, 13, 14.5, 1.5, 2, 'levelGold'), span(1.5, 2, 13, 14.5, 1.5, 2, 'levelGold')]),
          span(1.5, 2, 12, 13, -1.5, 1.5, 'levelGold'),
          span(-2, -1.5, 12, 13, -1.5, 1.5, 'levelGold'),
          span(2, 2.25, 12.25, 12.75, -0.25, 0.25, 'fireLight', { emissive: 2.5 }),
        ]),
      ],
    },
  ],
  clips: {
    idle: idleBob({ body: 'body', sway: ['stem'] }),
    melee: leapSlam({ body: 'body' }),
    hit: hitWobble('body', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'body', head: 'stem' }),
    cheer: cheerJump('body'),
  },
};
