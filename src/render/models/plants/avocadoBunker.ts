import { breathe, cheerJump, hitWobble, spawnRise, wilt } from '../../voxel/clips';
import type { Box, ModelDef, PartDef } from '../../voxel/types';
import { bothSides, lv, span } from './kit';

// Avocado Bunker. Faces +X. Half an avocado standing on end like a wall across its lane:
// dark green bumpy skin, the pale cut face to the front with its big round brown stone
// sticking out as a nose, two eyes above it under one heavy stubborn brow, and a grumpy
// little mouth below. The widest, heaviest plant on the lawn. The whole avocado is turned
// 42 degrees to the player and leans back 5 degrees, so the cut face shows from above.
//
// Authored straight: the skin is a stepped pear in the Y-Z plane, from x -1.5 to 2, with a
// rounded back from -3; the cut face is its +X side, at x 2. The lower half (body) runs from
// y 1 to 7, the upper half (head, with the eyes) from 7 to 13.5.
//
// Every level adds something the lawn camera can see, on top or round the outside:
//
//   2  a studded rind: knobs round the rim of the cut face, on the near flank and on top
//   3  riveted iron plates on the near flank and the crown; the knobs turn iron
//   4  the plates turn to glowing crystal, with crystal shields standing out at both edges
//   5  a gold battlement round the crown on iron plates, warm lights in the rivets and eyes
//
// Damage: the part `cracks` is built hidden; the view shows it below half health.

/** The outline of the avocado, bottom to top: [y0, y1, half-width in z]. */
const OUTLINE: [number, number, number][] = [
  [1, 2, 3.5],
  [2, 7, 4.5],
  [7, 10.5, 4],
  [10.5, 12, 3.5],
  [12, 13, 2.5],
  [13, 13.5, 1.5],
];
const MOUTH = '#2E3A12';
const BROW = 'avocadoSkinDark';
const CRACK = '#1E2A0E';

/** The slices of the outline between y0 and y1, as boxes from x0 to x1, inset by `inset` all round. */
function slices(y0: number, y1: number, x0: number, x1: number, color: string, inset = 0, extra: Partial<Box> = {}): Box[] {
  const out: Box[] = [];
  OUTLINE.forEach(([a, b, hz], i) => {
    // The inset comes off the very bottom and top as well as the sides.
    const low = Math.max(a, y0, i === 0 ? a + inset : a);
    const high = Math.min(b, y1, i === OUTLINE.length - 1 ? b - inset : b);
    const half = hz - inset;
    if (high - low > 0 && half > 0) out.push(span(x0, x1, low, high, -half, half, color, extra));
  });
  return out;
}

/** Riveted plates: iron at level 3, crystal at 4, iron again at 5; a rim and a face a voxel proud. */
function plates(rim: [number, number, number, number, number, number], face: [number, number, number, number, number, number]): Box[] {
  const [a, b, c, d, e, f] = rim;
  const [g, h, i, j, k, l] = face;
  return [
    span(a, b, c, d, e, f, 'levelIronDark', { minLevel: 3, maxLevel: 3 }),
    span(g, h, i, j, k, l, 'levelIron', { minLevel: 3, maxLevel: 3 }),
    span(a, b, c, d, e, f, 'levelCrystalDeep', { minLevel: 4, maxLevel: 4 }),
    span(g, h, i, j, k, l, 'levelCrystal', { minLevel: 4, maxLevel: 4 }),
    // At level 5 the plates stay iron: the gold is the battlement on the crown.
    span(a, b, c, d, e, f, 'levelIronDark', { minLevel: 5 }),
    span(g, h, i, j, k, l, 'levelIron', { minLevel: 5 }),
  ];
}

/** Knobs on the rind from level 2 (the trim, so iron, crystal and gold from 3). */
const STUD = 'huskDark';
const STUDS_LOW: Box[] = [
  // Round the rim of the cut face, on the skin between the flesh and the edge.
  ...bothSides([span(2, 2.5, 2.5, 3.5, 3.5, 4.5, STUD), span(2, 2.5, 5.5, 6.5, 3.5, 4.5, STUD)]),
  // On the near flank, a voxel proud.
  span(-0.5, 0.5, 3, 4, 4.5, 5.5, STUD),
  span(-0.5, 0.5, 5.5, 6.5, 4.5, 5.5, STUD),
];
const STUDS_HIGH: Box[] = [
  ...bothSides([span(2, 2.5, 8.5, 9.5, 3, 4, STUD), span(2, 2.5, 11, 12, 2.5, 3.5, STUD)]),
  span(-0.5, 0.5, 8.5, 9.5, 4, 5, STUD),
  // On the crown.
  span(-0.5, 0.5, 13.5, 14.5, -1, 0, STUD),
  span(-1.5, -0.5, 13, 14, 1.5, 2.5, STUD),
];

/**
 * Where the avocado really stands: half a voxel further forward than authored, so that tipped
 * back its head still sits over the middle of its tile.
 */
const SHIFT = 0.5;
function placed(part: PartDef): PartDef {
  const move = ([x, y, z]: [number, number, number]): [number, number, number] => [x + SHIFT, y, z];
  return { ...part, pivot: move(part.pivot), boxes: part.boxes.map((box) => ({ ...box, at: move(box.at) })) };
}

export const avocadoBunker: ModelDef = {
  key: 'avocadoBunker',
  trim: [STUD],
  eyes: ['eyes'],
  parts: [
    {
      // A low heap of soil. The whole avocado is turned to the player from here.
      name: 'root',
      pivot: [0, 0, 0],
      rot: [0, -42, 0],
      boxes: [span(-3, 3, 0, 1, -3.25, 3.25, 'soil'), span(-2, 2, 0, 1, -4.25, 4.25, 'soil'), span(2, 3.5, 1, 1.5, -2, 2, 'soilDark'), span(-2.5, -0.5, 1, 1.5, 3, 4.25, 'soilDark')],
    },
    ...(
    [
      {
        // The lower half, leaning back with everything on it; it heaves as it breathes.
        name: 'body',
        parent: 'root',
        pivot: [0, 1, 0],
        rot: [0, 0, 5],
        boxes: [
          ...slices(1, 7, -1.5, 2, 'avocadoSkin'),
          ...slices(1, 7, -3, -1.5, 'avocadoSkinDark', 1.5),
          // The cut face: a green ring of flesh by the skin, pale yellow-green inside.
          ...slices(1, 7, 1.5, 2, 'avocadoFleshDark', 1),
          ...slices(1, 7, 1.5, 2, 'avocadoFlesh', 2),
          // The stone, a big round nose, standing out of the flesh.
          // A stepped disc five across: dark underneath, a shine on its upper side.
          span(2, 3, 3, 8, -1, 1, 'avocadoStone'),
          span(2, 3, 3.5, 7.5, -2, 2, 'avocadoStone'),
          span(2, 3, 4.5, 6.5, -2.5, 2.5, 'avocadoStone'),
          span(3, 3.5, 4, 7, -1, 1, 'avocadoStone'),
          span(3, 3.5, 4.5, 6.5, -2, 2, 'avocadoStone'),
          span(2.5, 3, 3, 4, -1, 1, 'avocadoStoneDark'),
          span(2.5, 3, 3.5, 4.5, -2, -1, 'avocadoStoneDark'),
          span(3.25, 3.5, 5.5, 6.5, -1.5, -0.5, 'walnutLight'),
          span(2.75, 3, 7, 7.5, -1.5, -1, 'walnutLight'),
          // A grumpy mouth, the corners turned down.
          span(1.75, 2, 2.5, 3, -1.5, 1.5, MOUTH),
          ...bothSides([span(1.75, 2, 2, 2.5, 1.5, 2, MOUTH)]),
          // Bumpy skin: darker knobs flush with the near flank.
          span(-0.5, 0.5, 1.5, 2.5, 4, 4.5, 'avocadoSkinDark'),
          span(0.5, 1.5, 4, 5, 4, 4.5, 'avocadoSkinDark'),
          span(-1, 0, 6, 7, 4, 4.5, 'avocadoSkinDark'),
          ...lv(2, 5, STUDS_LOW),
          // Level 3 up: a plate on the near flank.
          ...plates([-1, 1.5, 2, 7, 4.5, 5.25], [-0.5, 1, 2.5, 6.5, 5.25, 5.75]),
          // Level 4: crystal shields standing out at both edges of the face.
          ...lv(4, 4, bothSides([span(2, 3, 2, 9, 4.5, 5.5, 'levelCrystalDeep'), span(2.5, 3.5, 3, 8, 5, 6, 'levelCrystal')])),
          // Level 5: rivets alight.
          ...lv(5, 5, [span(0, 0.5, 3, 3.5, 5.75, 6, 'fireLight', { emissive: 2 }), span(0, 0.5, 5.5, 6, 5.75, 6, 'fireLight', { emissive: 2 })]),
        ],
      },
      {
        // The upper half, with the eyes and the brow.
        name: 'head',
        parent: 'body',
        pivot: [0, 7, 0],
        shadedBy: ['eyes'],
        boxes: [
          ...slices(7, 13.5, -1.5, 2, 'avocadoSkin'),
          ...slices(7, 13.5, -3, -1.5, 'avocadoSkinDark', 1.5),
          ...slices(7, 13.5, 1.5, 2, 'avocadoFleshDark', 1),
          ...slices(7, 13.5, 1.5, 2, 'avocadoFlesh', 2),
          // One heavy brow across both eyes, lower in the middle: stubborn.
          span(2, 3, 11, 12, -1, 1, BROW),
          ...bothSides([span(2, 3, 11.5, 12.5, 1, 3, BROW)]),
          span(-0.5, 0.5, 8, 9, 3.5, 4, 'avocadoSkinDark'),
          span(-1, 0, 11, 12, 3, 3.5, 'avocadoSkinDark'),
          ...lv(2, 5, STUDS_HIGH),
          // Level 3 up: a plate over the crown.
          ...plates([-2, 1.5, 13.5, 14.25, -1.5, 1.5], [-1.5, 1, 14.25, 14.75, -1, 1]),
          // Level 4: the crystal shields' tops.
          ...lv(4, 4, bothSides([span(2.25, 3.25, 9, 12, 3.75, 4.75, 'levelCrystal')])),
          // Level 5: a battlement round the crown, and towers on the shoulders.
          ...lv(5, 5, [
            ...bothSides([span(-2, 1.5, 14.75, 16, 0.5, 1.5, 'levelGold'), span(-1.5, 1, 12, 14.5, 2.5, 3.5, 'levelGold'), span(-1.5, -0.5, 14.5, 15.5, 2.5, 3.5, 'levelGold'), span(0, 1, 14.5, 15.5, 2.5, 3.5, 'levelGold')]),
            span(0, 0.5, 14.75, 15.25, -0.25, 0.25, 'fireLight', { emissive: 2 }),
          ]),
        ],
      },
      {
        name: 'eyes',
        parent: 'head',
        pivot: [2.25, 9.5, 0],
        shadedBy: ['head'],
        boxes: [
          ...bothSides([span(2, 2.5, 8, 11, 0.5, 2.5, 'eye')]),
          span(2, 2.5, 10, 11, 0.5, 1.5, 'eyeGlint'),
          span(2, 2.5, 10, 11, -2.5, -1.5, 'eyeGlint'),
          ...lv(5, 5, bothSides([span(2, 2.5, 8.5, 9.5, 1.5, 2.5, 'fireLight', { emissive: 3 })])),
        ],
      },
      {
        name: 'cracks',
        parent: 'head',
        pivot: [0, 9, 0],
        hidden: true,
        boxes: [
          // Across the flesh, from the stone out to the far edge.
          span(2, 2.25, 6.5, 7.5, -3.5, -2.5, CRACK),
          span(2, 2.25, 5, 6.5, -3.5, -3, CRACK),
          span(2, 2.25, 3.5, 5, -3.5, -2.75, CRACK),
          // Down the near flank of the skin.
          span(-0.5, 1, 10, 10.5, 4, 4.25, CRACK),
          span(0.5, 1, 8.5, 10, 4, 4.25, CRACK),
          span(1, 1.75, 7.5, 8.5, 4.5, 4.75, CRACK),
          // Across the brow.
          span(3, 3.25, 11.25, 12, 0.25, 0.75, CRACK),
        ],
      },
    ] satisfies PartDef[]
    ).map(placed),
  ],
  clips: {
    idle: breathe({ body: 'body', head: 'head' }),
    hit: hitWobble('body', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'body', head: 'head' }),
    cheer: cheerJump('root'),
  },
};
