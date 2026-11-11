import { cheerJump, hitRecoil, idleBob, pultFling, spawnRise, wilt } from '../../voxel/clips';
import type { Box, ModelDef } from '../../voxel/types';
import { bothSides, lv, round, span } from './kit';

// Mango-pult. Faces +X. A stout, round, leafy bush with a smug face, and lying across the top
// of it a heavy wooden catapult beam with a cup at its back end holding a big orange mango.
// The bush's upper half (its head) is turned to the player and tipped back.
//
// The bush is authored on x = 0, z = 0: a dark leafy skirt from y 1 to 4.5 and the head, a
// stepped round 8 across, from 4.5 to 11, its front (the face) at x 4. The beam is authored
// lying flat along -X from its hub at the front of the crown (x 1.5, y 10.5), tilted 6
// degrees up at the back; it whips up and over the front to throw.
//
// Every level adds something the lawn camera can see, on top or out to the side:
//
//   2  a bigger mango with a bigger leaf, more leaves on the bush
//   3  iron bands on the beam, an iron cap on the hub and an iron rim on the cup
//   4  the mango glows from inside under a crystal shell; a crystal cup
//   5  a gold beam, hub and cup; gold leaf on the mango; warm lights in the eyes

const MOUTH = '#1F4A14';
const TOOTH = '#F4FBE6';
/** The arm's lean back from upright at rest: it lies nearly flat, 6 degrees up at the back. */
const REST = 84;
/** The floor of the cup, and so the bottom of the mango (from FLOOR + 0.5). */
const FLOOR = 11;

/**
 * A mango in the cup, centred at x = -3.5: a stepped oval `2 rx` long, `2 rz` wide and `h`
 * tall from the cup's floor, blushed on the side the camera sees, with a stem and a leaf.
 */
function mango(rx: number, rz: number, h: number, body: string, leaf: string, extra: Partial<Box> = {}): Box[] {
  const base = FLOOR + 0.5;
  const top = base + h;
  return [
    ...round(-3.5, 0, [[rx - 0.5, rz - 1], [rx - 1, rz - 0.5]], base, base + 0.5, 'mangoDark', extra),
    ...round(-3.5, 0, [[rx, rz - 0.5], [rx - 0.5, rz]], base + 0.5, top - 0.5, body, extra),
    ...round(-3.5, 0, [[rx - 0.5, rz - 1], [rx - 1, rz - 0.5]], top - 0.5, top, body, extra),
    // A red-orange blush on the near shoulder.
    span(-4.5, -2.5, top - 1.5, top - 0.5, rz - 0.5, rz, 'mangoDark', extra),
    span(-5, -3, top - 0.5, top, rz - 1.5, rz - 1, 'mangoDark', extra),
    // Stem and leaf.
    span(-4, -3.5, top, top + 0.5, -0.25, 0.25, 'barkDark'),
    span(-3.5, -1.5, top, top + 0.5, -0.5, 0.5, leaf),
  ];
}

/** The cup at the back of the beam: a floor and four walls. */
function cup(floor: string, wall: string): Box[] {
  return [
    span(-5.5, -1.5, FLOOR, FLOOR + 0.5, -2, 2, floor),
    span(-5.5, -5, FLOOR + 0.5, FLOOR + 1.5, -2, 2, wall),
    span(-2, -1.5, FLOOR + 0.5, FLOOR + 1.5, -2, 2, wall),
    ...bothSides([span(-5, -2, FLOOR + 0.5, FLOOR + 1.5, 1.5, 2, wall)]),
  ];
}

/** The beam and its hub. */
function beam(wood: string, hub: string): Box[] {
  return [span(-5, 1.5, 10, 11, -1, 1, wood), span(0.5, 2.5, 9.5, 11.5, -1.25, 1.25, hub)];
}

export const mangoPult: ModelDef = {
  key: 'mangoPult',
  trim: [],
  eyes: ['eyes'],
  // Where a mango leaves: the cup at the moment the beam lets go, 15 degrees past upright.
  muzzle: [5.5, 14, 0],
  parts: [
    {
      name: 'root',
      pivot: [0, 0, 0],
      boxes: round(0, 0, [[4, 3], [3, 4]], 0, 1, 'soil'),
    },
    {
      // The bush's skirt: dark leaves, a few tips poking out.
      name: 'body',
      parent: 'root',
      pivot: [0, 1, 0],
      boxes: [
        ...round(0, 0, [[5, 3], [4, 4]], 1, 4.5, 'leafDark'),
        span(-1, 1, 1, 2, 4, 5, 'leaf'),
        span(4, 5.5, 1, 2, -1, 1, 'leaf'),
        span(-4.5, -3.5, 1, 2, 3, 4.5, 'leaf'),
        ...lv(2, 5, [span(1.5, 2.5, 1, 2.5, 4, 5, 'leafLight'), span(-3, -2, 1, 2.5, 4, 5, 'leafLight')]),
      ],
    },
    {
      // The head: the bush's round top, with the face. Turned to the player and tipped back.
      name: 'head',
      parent: 'body',
      pivot: [0, 4.5, 0],
      rot: [0, -18, 6],
      shadedBy: ['eyes'],
      boxes: [
        ...round(0, 0, [[4, 3], [3, 4]], 4.5, 9, 'leaf'),
        ...round(0, 0, [[3, 2], [2, 3]], 9, 10, 'leaf'),
        // Leafy texture, flush, on the sides the camera sees: dark creases and pale tips.
        span(-2, -1, 5, 7, 3.5, 4, 'leafDark'),
        span(0, 1, 7, 8.5, 3.5, 4, 'leafDark'),
        span(-1, 0, 8, 9, 3.5, 4, 'leafLight'),
        span(1, 2, 5.5, 6.5, 3.5, 4, 'leafLight'),
        span(-2, -1, 9.5, 10, 1, 2, 'leafLight'),
        span(0, 1, 9.5, 10, -2, -1, 'leafDark'),
        // Tufts sticking up from the crown round the beam, more of them from level 2.
        span(0, 2, 10, 11, 1.5, 3, 'leafLight'),
        span(-2.5, -1, 10, 11, 1.5, 2.5, 'leaf'),
        span(-1, 1, 10, 10.5, -2.5, -1.5, 'leaf'),
        ...lv(2, 5, [span(2.5, 3.5, 10, 11.5, 1, 2, 'leafLight'), span(-3, -2, 10, 11.5, -3, -1.5, 'leafLight'), span(-0.5, 0.5, 10, 12, 2.5, 3.5, 'leafLight')]),
        // The face, on a paler plate: a smug half-smile with a tooth.
        span(3.5, 4, 5, 9, -2.5, 2.5, 'leafLight'),
        span(3.5, 4, 5.5, 6.5, -1.5, 1.5, MOUTH),
        span(3.5, 4, 6.5, 7, 1, 2, MOUTH),
        span(3.75, 4, 6, 6.5, 0, 1, TOOTH),
        // Heavy brows, low in the middle.
        ...bothSides([span(3, 4.5, 9, 9.5, 0.5, 1.5, 'leafDark'), span(3, 4.5, 9.5, 10, 1.5, 2.5, 'leafDark')]),
      ],
    },
    {
      name: 'eyes',
      parent: 'head',
      pivot: [4.25, 7.5, 0],
      shadedBy: ['head'],
      boxes: [
        ...bothSides([span(4, 4.5, 6, 9, 0.5, 2.5, 'eye')]),
        span(4, 4.5, 8, 9, 0.5, 1.5, 'eyeGlint'),
        span(4, 4.5, 8, 9, -2.5, -1.5, 'eyeGlint'),
        ...lv(5, 5, bothSides([span(4, 4.5, 6.5, 7.5, 1.5, 2.5, 'fireLight', { emissive: 3 })])),
      ],
    },
    {
      // The catapult beam, the cup and the mango. Authored lying along -X from the hub; tilted
      // 6 degrees up at the back at rest.
      name: 'arm',
      parent: 'body',
      pivot: [1.5, 10.5, 0],
      rot: [0, 0, -(90 - REST)],
      boxes: [
        ...lv(1, 4, beam('bark', 'barkDark')),
        ...lv(5, 5, beam('levelGold', 'levelGoldDark')),
        ...lv(1, 2, cup('barkDark', 'bark')),
        ...lv(3, 3, cup('barkDark', 'levelIron')),
        ...lv(4, 4, cup('barkDark', 'levelCrystal')),
        ...lv(5, 5, cup('levelGoldDark', 'levelGold')),
        ...lv(1, 1, mango(2, 1.5, 3, 'mango', 'leaf')),
        ...lv(2, 3, mango(2.5, 2, 4, 'mango', 'leaf')),
        ...lv(4, 4, mango(2.5, 2, 4, 'mango', 'leaf', { emissive: 1.6 })),
        ...lv(5, 5, mango(2.5, 2, 4, 'mango', 'levelGold')),
        // Level 2 up: a second, bigger leaf on the mango.
        ...lv(2, 5, [span(-5.5, -4, 16, 16.5, -1.5, -0.5, 'leafLight')]),
        // Level 3: iron bands round the beam and a cap on the hub.
        ...lv(3, 4, [span(-1, 0, 9.75, 11.25, -1.25, 1.25, 'levelIron'), span(-3.5, -2.5, 9.75, 11, -1.25, 1.25, 'levelIron'), span(0.25, 2.75, 11.5, 12, -1, 1, 'levelIronDark')]),
        // Level 4: a crystal shell over the top of the mango.
        ...lv(4, 4, [span(-5, -2, 16, 16.5, -1.5, 1.5, 'levelCrystal'), span(-4.5, -2.5, 16.5, 17, -1, 1, 'levelCrystal')]),
        // Level 5: a gold cap on the hub.
        ...lv(5, 5, [span(0.25, 2.75, 11.5, 12, -1, 1, 'levelGold'), span(-1, 0, 9.75, 11.25, -1.25, 1.25, 'levelGoldDark'), span(-3.5, -2.5, 9.75, 11, -1.25, 1.25, 'levelGoldDark')]),
      ],
    },
  ],
  clips: {
    idle: idleBob({ body: 'body', head: 'head', sway: ['arm'] }),
    shoot: pultFling({ arm: 'arm', body: 'body', duration: 0.6, release: 0.25, rest: REST, windUp: 10, lead: 15, forward: 30 }),
    hit: hitRecoil('body', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'body', head: 'head' }),
    cheer: cheerJump('root'),
  },
};
