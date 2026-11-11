import { cheerJump, fuseSwell, hitRecoil, pairBob, spawnRise, swellBlast } from '../../voxel/clips';
import type { Box, ModelDef, PartDef } from '../../voxel/types';
import { bothSides, lv, span } from './kit';

// Cherry Bomber. Faces +X. Two round red cherries one behind the other down the lane, the
// back one sitting up on a heap of soil to peer over the front one's shoulder, joined by
// green stems that meet in a knot with a big leaf on top; each has its own angry little face
// and a lit fuse. Each cherry is turned to the player and tipped back, the back one further,
// so both faces show from the lawn camera.
//
// Each cherry is authored about its own centre line (x = CX for the front one, -CX for the
// back one): a stepped ball 5 long and 6 wide at level 1, 6 by 7 from level 2, its front (the
// face) at CX + its half-length. Kept to whole and half voxels: an odd size cuts every face it touches.
//
// Every level adds something the lawn camera can see, on top or out to the side:
//
//   2  bigger cherries, longer stems and a bigger leaf
//   3  an iron cap on each cherry, down over its brows
//   4  glowing crystal shells over the cherries' near shoulders; crystal caps
//   5  gold shells and caps, a gold leaf, two fuses each, warm lights in the eyes

/** The front cherry's centre line; the back one is at -CX. */
const CX = 2.5;
/** How far the back cherry sits up, on a heap of soil, so its face shows over the front one. */
const LIFT = 2;
const MOUTH = '#4A0A12';
const BROW = '#2E0810';
const SHINE = '#FF9A9A';
const CORD = '#3B2A1A';
/** The caps from level 3: matte here, the trim, so iron, crystal and gold from 3 to 5. */
const CAP = 'iron';

interface Size {
  /** Half the length (x) and width (z) of the ball's long box; its main layer from y 2 to `y1`; its top. */
  r: number;
  w: number;
  y1: number;
  top: number;
}
const SMALL: Size = { r: 2.5, w: 2, y1: 5, top: 6 };
const BIG: Size = { r: 3, w: 2.5, y1: 6, top: 7 };

/** Raises boxes by `dy`. */
const up = (dy: number, boxes: Box[]): Box[] => boxes.map((box) => ({ ...box, at: [box.at[0], box.at[1] + dy, box.at[2]] }));

/** One cherry's ball, mouth, brows, shine and fuse, about centre line `cx`. */
function ball(cx: number, size: Size): Box[] {
  const { r, w, y1, top } = size;
  const front = cx + r;
  return [
    span(cx - r + 1, cx + r - 1, 1, 2, -w, w, 'cherryDark'),
    span(cx - r, cx + r, 2, y1, -w, w, 'cherry'),
    span(cx - r + 1, cx + r - 1, 2, y1, -w - 1, w + 1, 'cherry'),
    span(cx - r + 1, cx + r - 1, y1, top, -w, w, 'cherry'),
    // A shine on the shoulder towards the sun.
    span(cx - 1.5, cx - 0.5, y1 - 1, y1, w + 0.5, w + 1, SHINE),
    span(cx - 1.5, cx - 0.5, top - 0.5, top, -1.5, -0.5, SHINE),
    // An angry little mouth: a frown.
    span(front - 0.5, front, 2.5, 3, -0.5, 0.5, MOUTH),
    ...bothSides([span(front - 0.5, front, 2, 2.5, 0.5, 1.5, MOUTH)]),
    // Brows on the ledge over the eyes, low in the middle: cross.
    ...bothSides([span(front - 1, front, y1, y1 + 0.5, 0, 1, BROW), span(front - 1, front, y1, top, 1, w, BROW)]),
    // The fuse, from the top towards the back, with a glowing tip.
    span(cx - 1.5, cx - 0.5, top, top + 1, -0.5, 0.5, CORD),
    span(cx - 2.5, cx - 1.5, top + 0.5, top + 1.5, -0.5, 0.5, CORD),
    span(cx - 3, cx - 2, top + 1.5, top + 2.5, -0.5, 0.5, 'fireLight', { emissive: 2.5 }),
  ];
}

/** Level 3 up: a cap down over the brows; level 4 up, a shell over the near shoulder; level 5, a second fuse. */
function armour(cx: number): Box[] {
  const { r, w, y1, top } = BIG;
  return [
    ...lv(3, 5, [span(cx - r + 0.5, cx + r, top - 0.5, top + 0.5, -w, w, CAP), span(cx - r + 1, cx + r - 1, top - 0.5, top + 0.5, -w - 0.5, w + 0.5, CAP), span(cx - 1, cx + 1, top + 0.5, top + 1, -1, 1, CAP)]),
    ...lv(4, 4, [span(cx - 2, cx + 1.5, 3, y1, w + 1, w + 1.5, 'levelCrystalDeep'), span(cx - 1.5, cx + 1, 3.5, y1 - 0.5, w + 1.5, w + 2, 'levelCrystal')]),
    ...lv(5, 5, [span(cx - 2, cx + 1.5, 3, y1, w + 1, w + 1.5, 'levelGoldDark'), span(cx - 1.5, cx + 1, 3.5, y1 - 0.5, w + 1.5, w + 2, 'levelGold')]),
    ...lv(5, 5, [span(cx + 0.5, cx + 1.5, top + 1, top + 2, -0.5, 0.5, CORD), span(cx + 1, cx + 2, top + 2, top + 3, -0.5, 0.5, 'fireLight', { emissive: 2.5 })]),
  ];
}

/** One cherry's eyes: one and a half by two and a half at level 1, two by three from 2, a glint in each. */
function eyes(cx: number): Box[] {
  const small = cx + SMALL.r;
  const big = cx + BIG.r;
  return [
    ...lv(1, 1, [
      ...bothSides([span(small, small + 0.5, 2.5, 5, 0.5, 2, 'eye')]),
      span(small, small + 0.5, 4, 5, 0.5, 1.5, 'eyeGlint'),
      span(small, small + 0.5, 4, 5, -2, -1, 'eyeGlint'),
    ]),
    ...lv(2, 5, [
      ...bothSides([span(big, big + 0.5, 3, 6, 0.5, 2.5, 'eye')]),
      span(big, big + 0.5, 5, 6, 0.5, 1.5, 'eyeGlint'),
      span(big, big + 0.5, 5, 6, -2.5, -1.5, 'eyeGlint'),
    ]),
    ...lv(5, 5, bothSides([span(big, big + 0.5, 3.5, 4.5, 1.5, 2.5, 'fireLight', { emissive: 3 })])),
  ];
}

/** A cherry and its eyes, as two parts on the stem, raised `lift` and turned `turn` degrees to the player. */
function cherry(name: string, cx: number, lift: number, turn: number): PartDef[] {
  return [
    {
      name,
      parent: 'stem',
      pivot: [cx, 3.5 + lift, 0],
      rot: [0, -turn, 6],
      shadedBy: [`${name}Eyes`],
      boxes: up(lift, [...lv(1, 1, ball(cx, SMALL)), ...lv(2, 5, ball(cx, BIG)), ...armour(cx)]),
    },
    { name: `${name}Eyes`, parent: name, pivot: [cx + BIG.r, 4.5 + lift, 0], shadedBy: [name], boxes: up(lift, eyes(cx)) },
  ];
}

/** The leaf on the knot from height `y`, reaching towards the player; `big` from level 2. */
function leaf(y: number, big: boolean, blade: string, rib: string): Box[] {
  const g = big ? 0.5 : 0;
  return [
    span(-0.5, 0.5, y, y + 0.5, 0.5, 1.5, 'stem'),
    span(-2 - g, 1.5 + g, y + 0.5, y + 1, 1.5, 4 + g, blade),
    span(-1 - g, 1, y + 0.5, y + 1, 4 + g, 5 + g, blade === 'leaf' ? 'leafLight' : blade),
    span(-0.5, 0.5, y + 0.75, y + 1, 1.5, 4 + g, rib),
  ];
}

export const cherryBomber: ModelDef = {
  key: 'cherryBomber',
  trim: [CAP],
  eyes: ['frontEyes', 'backEyes'],
  // Where the blast goes off: between the two.
  muzzle: { part: 'stem', at: [0, 3.5, 0] },
  parts: [
    {
      name: 'root',
      pivot: [0, 0, 0],
      boxes: [
        span(-5, 5, 0, 1, -2, 2, 'soil'),
        span(-4, 4, 0, 1, -3, 3, 'soil'),
        // The heap the back cherry sits on.
        span(-5, -0.5, 1, 3, -2.25, 2.25, 'soil'),
        span(-4.5, -1, 1, 3, -2.75, 2.75, 'soil'),
        span(-3.5, -1.5, 2.5, 3.25, 2.75, 3.25, 'soilDark'),
      ],
    },
    {
      // The stems, from the top of each cherry up to a knot. Everything hangs from here.
      name: 'stem',
      parent: 'root',
      pivot: [0, 1, 0],
      boxes: [
        span(2, 3, 5.5, 9.5, -0.5, 0.5, 'stem'),
        span(1, 2, 9.5, 11.5, -0.5, 0.5, 'stem'),
        span(-3, -2, 7.5, 10.5, -0.5, 0.5, 'stem'),
        span(-2, -1, 10.5, 11.5, -0.5, 0.5, 'stem'),
        span(-1, 1, 11.5, 12.5, -0.5, 0.5, 'leafDark'),
        // Level 2 up: longer stems, the knot a voxel higher.
        ...lv(2, 5, [span(-0.5, 0.5, 12.5, 13.5, -0.5, 0.5, 'stem')]),
        // Level 5: gold rings round the stems.
        ...lv(5, 5, [span(1.75, 3.25, 8, 8.5, -0.75, 0.75, 'levelGold'), span(-3.25, -1.75, 10, 10.5, -0.75, 0.75, 'levelGold')]),
      ],
    },
    {
      // The leaf on the knot, reaching towards the player.
      name: 'leaf',
      parent: 'stem',
      pivot: [0, 12.5, 0],
      boxes: [
        ...lv(1, 1, leaf(12.5, false, 'leaf', 'leafDark')),
        ...lv(2, 4, leaf(13.5, true, 'leaf', 'leafDark')),
        ...lv(5, 5, leaf(13.5, true, 'levelGold', 'levelGoldDark')),
      ],
    },
    ...cherry('front', CX, 0, 12),
    ...cherry('back', -CX, LIFT, 35),
  ],
  clips: {
    idle: pairBob({ body: 'stem', a: 'front', b: 'back', sway: ['leaf'] }),
    shoot: fuseSwell(['front', 'back']),
    hit: hitRecoil('stem', -1),
    spawn: spawnRise('root'),
    die: swellBlast('stem'),
    cheer: cheerJump('stem'),
  },
};
