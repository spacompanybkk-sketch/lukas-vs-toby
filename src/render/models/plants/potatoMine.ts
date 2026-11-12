import { breathe, cheerJump, hitRecoil, mineTrigger, spawnRise, wilt } from '../../voxel/clips';
import type { Box, ModelDef } from '../../voxel/types';
import { bothSides, lv, round, span } from './kit';

// Potato Mine. Faces +X. A lumpy potato half buried in a heap of soil, two big sleepy eyes
// peeking over the dirt, and an antenna with a red bulb on top. The smallest plant: about
// half a tile tall. The whole heap is turned 45 degrees to the player and the potato tips
// back 18 degrees in it, so its face shows from the lawn camera.
//
// The potato is authored straight, centred on x = CX: a stepped round of four layers, its
// front (the face) at x 3.5, from y 1 to 7.
//
// Armed: the part `armed` is built hidden; the game shows it once the mine is armed. It lights
// the bulb (a glowing red shell round the dull one) and brings two angry brows down over
// the sleepy eyes.
//
// Every level adds something the lawn camera can see, on top or out to the side:
//
//   2  a metal cap on the crown, and the antenna a voxel taller
//   3  twin antennae in a V and a detonator handle on the cap; the cap turns iron
//   4  glowing crystal casing on the near flank and a crystal crest on the cap
//   5  the cap and its crest gold (the casing stays iron), warm lights for rivets and in the eyes

/** The potato's centre line, as authored. */
const CX = -0.5;
/** The bulb unlit, and the red it glows when armed. */
const BULB = 'cherryDark';
const LIGHT = '#FF1206';
const STALK = '#4A3A2A';
const BROW = '#4A2A12';

/** One antenna: a stalk up from the crown and a bulb on top, at z offset `z`, the bulb from y `bulbY`. */
function antenna(z: number, bulbY: number): Box[] {
  return [span(-2, -1, 6.5, bulbY, z - 0.5, z + 0.5, STALK), span(-2.5, -0.5, bulbY, bulbY + 1.5, z - 1, z + 1, BULB)];
}
/** The glow round one bulb when armed: a shell a quarter voxel bigger all round. */
function glow(z: number, bulbY: number): Box {
  return span(-2.75, -0.25, bulbY - 0.25, bulbY + 1.75, z - 1.25, z + 1.25, LIGHT, { emissive: 3 });
}

/** The twin antennae from level 3: each steps out from the crown to a bulb over a flank. */
const TWIN: Box[] = bothSides([span(-2, -1, 6.5, 8, 0.5, 1.5, STALK), span(-2, -1, 8, 9, 1, 2, STALK), span(-2.5, -0.5, 9, 10.5, 1, 3, BULB)]);

/** Plates on the near flank, a voxel proud: crystal at level 4, gold at 5. */
function casing(face: string, rim: string, level: number): Box[] {
  return lv(level, level, [span(-3.5, 2, 2.5, 5, 3.5, 4, rim), span(-3, 1.5, 3, 4.5, 4, 4.5, face)]);
}

export const potatoMine: ModelDef = {
  key: 'potatoMine',
  // The cap, from level 2.
  trim: ['iron'],
  eyes: ['eyes'],
  // Half a tile tall (with room for the armed bulb's glow), the width of a unit.
  envelope: [12, 9.5, 10],
  // Where the blast goes off: the front of the potato, under its face.
  muzzle: { part: 'body', at: [2, 4, 0] },
  parts: [
    {
      // The heap of soil, turned to the player with everything in it. It comes up round the
      // back and the near flank, so the potato sits down in it.
      name: 'root',
      pivot: [0, 0, 0],
      rot: [0, -45, 0],
      boxes: [
        ...round(0, 0, [[4.5, 1.5], [3.5, 3.25], [2, 4.5]], 0, 1, 'soilDark'),
        ...round(0, 0, [[4, 1.5], [3, 3], [1.5, 4]], 1, 2, 'soil'),
        span(-4, -1.5, 2, 3, -2.75, 2.75, 'soil'),
        span(-3.5, -2, 3, 3.5, -2.25, 2.25, 'soil'),
        // Clods heaped in front of the face and along the near flank: the eyes peek over them.
        span(2.5, 4.5, 2, 2.5, -1.5, 1.5, 'soilDark'),
        span(-2, 1.5, 2, 3, 3.75, 4.25, 'soil'),
        span(-1, 0.5, 3, 3.5, 3.75, 4.25, 'soilDark'),
      ],
    },
    {
      // The potato, tipped back in the soil. It breathes while it sleeps and jumps when it blows.
      name: 'body',
      parent: 'root',
      // Tipped about its middle, so the top leans back no further than the tile allows.
      pivot: [CX, 4, 0],
      rot: [0, 0, 18],
      shadedBy: ['eyes'],
      boxes: [
        ...round(CX, 0, [[3, 2], [2, 2.5]], 1, 2, 'potatoDark'),
        // The main layer, a little shorter behind than in front.
        span(CX - 3.5, CX + 4, 2, 5.5, -2.5, 2.5, 'potato'),
        span(CX - 2.5, CX + 3, 2, 5.5, -3.5, 3.5, 'potato'),
        ...round(CX, 0, [[3, 2], [2, 3]], 5.5, 6.5, 'potato'),
        // A lumpy crown, off centre.
        span(-3, 0.5, 6.5, 7, -1.5, 2, 'potatoLight'),
        // Lumps and dark potato eyes, flush with the skin, on the sides the camera sees.
        span(-3, -1, 3, 4.5, 3, 3.5, 'potatoLight'),
        span(0.5, 1.5, 5, 5.5, 2.5, 3.5, 'potatoLight'),
        span(0.5, 1, 4, 4.5, 3, 3.5, 'potatoDark'),
        span(-3.5, -3, 3, 3.5, 2.5, 3, 'potatoDark'),
        span(-1, -0.5, 6, 6.5, 2.5, 3, 'potatoDark'),
        span(1, 1.5, 6, 6.5, -1, -0.5, 'potatoDark'),

        // The antenna: short at level 1, a voxel taller from 2, two of them from 3.
        ...lv(1, 1, antenna(0, 7.5)),
        ...lv(2, 2, antenna(0, 8.5)),
        ...lv(3, 5, TWIN),

        // Level 3 up: a detonator handle, a T standing up off the back of the cap, a new shape
        // on top where the lawn camera sees it.
        ...lv(3, 5, [span(-4, -3, 8, 9.5, -0.5, 0.5, 'levelIronDark'), span(-4, -3, 9.5, 10, -1.5, 1.5, 'levelIronDark')]),
        // Level 2 up: a cap on the crown, stepped to a dome, rivets round it.
        ...lv(2, 5, [span(-4, 1, 6.5, 7.5, -2.5, 2.5, 'iron'), span(-3.5, 0.5, 7.5, 8, -2, 2, 'iron')]),
        ...lv(2, 4, [span(0.5, 1, 7, 7.5, 2.5, 3, 'levelIronDark'), span(-3.5, -3, 7, 7.5, 2.5, 3, 'levelIronDark')]),
        ...lv(5, 5, [span(0.5, 1, 7, 7.5, 2.5, 3, 'fireLight', { emissive: 2 }), span(-3.5, -3, 7, 7.5, 2.5, 3, 'fireLight', { emissive: 2 })]),

        // Level 4 up: casing on the near flank; a crest along the cap.
        ...casing('levelCrystal', 'levelCrystalDeep', 4),
        // Level 5: the casing stays iron; the gold is the cap and its crest.
        ...casing('levelIron', 'levelIronDark', 5),
        ...lv(4, 4, [span(-3, 0, 8, 9, -0.5, 0.5, 'levelCrystal'), span(-2.5, -1, 9, 10, -0.5, 0.5, 'levelCrystal')]),
        ...lv(5, 5, [span(-3, 0, 8, 8.5, -0.5, 0.5, 'levelGold'), span(0.5, 1, 3.5, 4, 4.5, 5, 'fireLight', { emissive: 2 })]),
      ],
    },
    {
      name: 'eyes',
      parent: 'body',
      pivot: [3.75, 4, 0],
      shadedBy: ['body'],
      boxes: [
        // Big and black, half a voxel proud of the face, a glint in the top corner nearest the
        // sun; the top third under a heavy sleepy lid.
        ...bothSides([span(3.5, 4, 2.5, 5.5, 0.5, 2.5, 'eye')]),
        span(3.5, 4, 3.5, 4.5, 0.5, 1.5, 'eyeGlint'),
        span(3.5, 4, 3.5, 4.5, -2.5, -1.5, 'eyeGlint'),
        ...bothSides([span(3.5, 4, 4.5, 5.5, 0.5, 2.5, 'potatoDark')]),
        // Level 5: a small warm light in each.
        ...lv(5, 5, bothSides([span(3.5, 4, 2.5, 3.5, 1.5, 2.5, 'fireLight', { emissive: 3 })])),
      ],
    },
    {
      // Shown by the game once the mine is armed: the bulbs alight and two angry brows.
      name: 'armed',
      parent: 'body',
      pivot: [CX, 6.5, 0],
      hidden: true,
      boxes: [
        ...lv(1, 1, [glow(0, 7.5)]),
        ...lv(2, 2, [glow(0, 8.5)]),
        ...lv(3, 5, [glow(2, 9), glow(-2, 9)]),
        // Low at the middle, high at the ends: a scowl, standing just over the lids.
        ...bothSides([span(2.5, 4.25, 5.25, 5.75, 0.25, 1.25, BROW), span(2.5, 4.25, 5.75, 6.25, 1.25, 2.25, BROW)]),
      ],
    },
  ],
  clips: {
    idle: breathe({ body: 'body' }),
    shoot: mineTrigger('body'),
    hit: hitRecoil('body', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'body' }),
    cheer: cheerJump('body'),
  },
};
