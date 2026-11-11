import { cheerJump, hitRecoil, idleBob, pultFling, spawnRise, wilt } from '../../voxel/clips';
import type { Box, ModelDef } from '../../voxel/types';
import { bothSides, lv, round, span } from './kit';

// Kernel-pult. Faces +X. A fat corn cob standing in its husk, a cheeky grin on its upper
// half, and behind it a green catapult stalk holding a leaf basket with a kernel in it over
// the back of its head. The head (the upper cob) is turned to the player and tipped back,
// as the Peashooter's.
//
// The cob is authored straight on x = 0, z = 0: two crossing boxes 6 x 5 and 5 x 6, from y 1.5
// to 13.5, its front (the face) at x 3. The husk wraps its lower half. The arm stands on the
// back of the cob at y 6, nearly upright (it leans back 4 degrees at rest), and its basket
// sits just over the back of the head, where the lawn camera sees it.
//
// Every level adds something the lawn camera can see, on top or out to the side:
//
//   2  a second basket beside the first (two kernels), the arm a voxel taller, husk tips curl out
//   3  husk ears standing up off the crown; iron baskets, and an iron hub and bands on the arm
//   4  crystal kernels in the baskets and a ring of crystal kernels on the crown
//   5  a gold crown of kernels, gold baskets, hub and husk tips, warm lights in the eyes (the cob
//      stays corn)

const MOUTH = '#5A2A08';
const TOOTH = '#FFF4DC';
const BROW = '#7A4A12';
/** A cream plate behind the eyes and the grin: the face stands out from the yellow cob, even in shade. */
const CREAM = '#FFF6DE';

/** A checker of darker kernels on the cob, flush with it: one box per dark kernel. */
function kernels(color: string): Box[] {
  const out: Box[] = [];
  // The near flank (z = 3), between the face and the back.
  for (let x = -2.5; x < 2.5; x++) for (let y = 7; y < 12; y++) if ((x + 0.5 + y) % 2 === 0) out.push(span(x, x + 1, y, y + 1, 2.5, 3, color));
  // The crown (y = 13), behind the tuft.
  for (let x = -2; x < 0; x++) for (let z = -2.5; z < 2.5; z++) if ((x + z + 0.5) % 2 === 0) out.push(span(x, x + 1, 12.5, 13, z, z + 1, color));
  return out;
}

/**
 * A leaf basket round a kernel, its floor from y `y`, from z0 to z1, at x -4 to -1: a dark
 * floor, pale leaf walls (the trim: iron, crystal and gold at levels 3 to 5) and a fat
 * kernel standing up out of it, paler on top.
 */
function basket(y: number, z0: number, z1: number, kernel: string, top: string, extra: Partial<Box> = {}): Box[] {
  return [
    span(-4, -1, y, y + 0.5, z0, z1, 'leafDark'),
    span(-4, -3.5, y + 0.5, y + 1.5, z0, z1, 'leafLight'),
    span(-1.5, -1, y + 0.5, y + 1.5, z0, z1, 'leafLight'),
    span(-3.5, -1.5, y + 0.5, y + 1.5, z1 - 0.5, z1, 'leafLight'),
    span(-3.5, -1.5, y + 0.5, y + 1.5, z0, z0 + 0.5, 'leafLight'),
    span(-3.5, -1.5, y + 0.5, y + 2, z0 + 0.5, z1 - 0.5, kernel, extra),
    span(-3, -2, y + 2, y + 2.5, z0 + 0.5, z1 - 0.5, top, extra),
  ];
}

export const kernelPult: ModelDef = {
  key: 'kernelPult',
  // The baskets' walls and, from level 3, the hub and bands on the arm.
  trim: ['leafLight'],
  eyes: ['eyes'],
  // Where a kernel leaves: the basket at the moment the arm lets go, leaning 30 degrees
  // forward of upright over the cob.
  muzzle: [2, 13.5, 0],
  parts: [
    {
      name: 'root',
      pivot: [0, 0, 0],
      boxes: round(0, 0, [[3.5, 2.5], [2.5, 3.5]], 0, 1, 'soil'),
    },
    {
      // The lower cob in its husk: four leaves wrapped round it, splaying out at the tips.
      name: 'body',
      parent: 'root',
      pivot: [0, 1, 0],
      boxes: [
        ...round(0, 0, [[3, 2.5], [2.5, 3]], 1.5, 7, 'corn'),
        // The near leaf and its mirror on the far side: dark wings, a pale middle, the tip curling out.
        ...bothSides([
          span(-2.5, 2.5, 1, 5.5, 3, 3.5, 'huskDark'),
          span(-1.5, 1.5, 1, 7, 3, 3.5, 'husk'),
          span(-1, 1, 7, 8, 3.5, 4, 'husk'),
          span(-0.5, 0.5, 8, 8.5, 4, 4.5, 'huskDark'),
        ]),
        // Front and back leaves, lower, so the face is clear.
        span(3, 3.5, 1, 4.5, -2, 2, 'huskDark'),
        span(3, 3.5, 1, 5.5, -1, 1, 'husk'),
        span(3.5, 4, 5.5, 6.5, -0.5, 0.5, 'husk'),
        span(-3.5, -3, 1, 6, -2, 2, 'husk'),
        // Level 2 up: the husk tips curl further out, on the near side and in front.
        ...lv(2, 5, [span(-0.5, 0.5, 8.5, 9.5, 4.5, 5, 'huskDark'), span(4, 4.5, 6.5, 7.5, -0.5, 0.5, 'huskDark')]),
        // Level 5: gold husk tips.
        ...lv(5, 5, [span(-0.5, 0.5, 9.5, 10, 4.5, 5, 'levelGold'), span(4.5, 5, 7, 7.5, -0.5, 0.5, 'levelGold')]),
      ],
    },
    {
      // The upper cob, with the face. Turned to the player and tipped back.
      name: 'head',
      parent: 'body',
      pivot: [0, 7, 0],
      rot: [0, -32, 8],
      shadedBy: ['eyes'],
      boxes: [
        span(-3, 3, 7, 12.5, -2.5, 2.5, 'corn'),
        span(-2.5, 2.5, 7, 12.5, -3, 3, 'corn'),
        span(-2.5, 2.5, 12.5, 13, -2, 2, 'corn'),
        span(-2, 2, 12.5, 13, -2.5, 2.5, 'corn'),
        // Silk: a pale tuft at the front of the crown.
        span(0, 2, 13, 13.5, -1, 1, 'cornLight'),
        span(1, 2.5, 13.5, 14, -0.5, 0.5, 'petalDark'),
        // Kernels: darker ones in a checker.
        ...kernels('cornDark'),
        // The face, on a cream plate: a cheeky grin, one corner up, a tooth.
        span(2.5, 3, 7.5, 12.5, -2.5, 2.5, CREAM),
        span(2.5, 3, 7.5, 8.5, -1.5, 1.5, MOUTH),
        span(2.5, 3, 8.5, 9, 1, 2, MOUTH),
        span(3, 3.5, 8, 8.5, -0.5, 0.5, TOOTH),
        // Brows, low in the middle: determined.
        ...bothSides([span(3, 3.5, 12, 12.5, 0.5, 1.5, BROW), span(3, 3.5, 12.5, 13, 1.5, 2.5, BROW)]),
        // Level 3 up: husk leaves standing up off both sides of the crown like ears, a new shape
        // the lawn camera sees beside the head.
        ...lv(3, 5, bothSides([span(0, 1.5, 10.5, 13.5, 3, 3.5, 'husk'), span(0.5, 1.5, 13.5, 15, 3, 3.5, 'huskDark')])),
        // Level 4: a ring of crystal kernels on the crown; level 5, a crown of gold ones.
        ...lv(4, 4, [...bothSides([span(-2, -1, 13, 14, 1, 2, 'levelCrystal'), span(0, 1, 13, 14.5, 1.5, 2.5, 'levelCrystal')])]),
        ...lv(5, 5, [
          ...bothSides([span(-2, -1, 13, 14, 1, 2, 'levelGold'), span(0, 1, 13, 14.5, 1.5, 2.5, 'levelGold')]),
          span(0, 1, 14.5, 15, 1.5, 2.5, 'fireLight', { emissive: 2 }),
        ]),
      ],
    },
    {
      name: 'eyes',
      parent: 'head',
      pivot: [3.25, 10.5, 0],
      shadedBy: ['head'],
      boxes: [
        // Black, two by three, half a voxel proud, a glint in the top corner nearest the sun.
        ...bothSides([span(3, 3.5, 9, 12, 0.5, 2.5, 'eye')]),
        span(3, 3.5, 11, 12, 0.5, 1.5, 'eyeGlint'),
        span(3, 3.5, 11, 12, -2.5, -1.5, 'eyeGlint'),
        ...lv(5, 5, bothSides([span(3, 3.5, 9.5, 10.5, 1.5, 2.5, 'fireLight', { emissive: 3 })])),
      ],
    },
    {
      // The catapult: a green stalk standing on the back of the cob, a leaf basket at its top.
      // Authored upright; it leans back 4 degrees at rest and whips over the top to throw.
      name: 'arm',
      parent: 'body',
      pivot: [-2.5, 6, 0],
      rot: [0, 0, 4],
      boxes: [
        span(-3, -2, 6, 13.25, -0.5, 0.5, 'stem', { maxLevel: 1 }),
        span(-3, -2, 6, 14.25, -0.5, 0.5, 'stem', { minLevel: 2 }),
        ...lv(1, 1, basket(13.25, -1.5, 1.5, 'corn', 'cornLight')),
        // Level 2 up: two baskets side by side, a voxel higher.
        ...lv(2, 3, [...basket(14.25, 0.25, 3.25, 'corn', 'cornLight'), ...basket(14.25, -3.25, -0.25, 'corn', 'cornLight')]),
        ...lv(4, 4, [
          ...basket(14.25, 0.25, 3.25, 'levelCrystal', 'levelCrystal'),
          ...basket(14.25, -3.25, -0.25, 'levelCrystal', 'levelCrystal'),
        ]),
        ...lv(5, 5, [...basket(14.25, 0.25, 3.25, 'corn', 'fireLight', {}), ...basket(14.25, -3.25, -0.25, 'corn', 'cornLight')]),
        // Level 3 up: a hub where the arm meets the cob, and two bands up the stalk.
        ...lv(3, 5, [
          span(-3.5, -1.5, 6, 8, -1.25, 1.25, 'leafLight'),
          span(-3.5, -1.5, 10, 10.5, -1, 1, 'leafLight'),
          span(-3.5, -1.5, 12.5, 13, -1, 1, 'leafLight'),
        ]),
      ],
    },
  ],
  clips: {
    idle: idleBob({ body: 'body', head: 'head', sway: ['arm'] }),
    shoot: pultFling({ arm: 'arm', body: 'body', duration: 0.4, release: 0.15, rest: 4 }),
    hit: hitRecoil('body', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'body', head: 'head' }),
    cheer: cheerJump('root'),
  },
};
