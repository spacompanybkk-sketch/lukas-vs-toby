import { cheerJump, hitRecoil, idleBob, shootSnap, spawnRise, wilt } from '../../voxel/clips';
import type { ModelDef } from '../../voxel/types';

// Peashooter. Faces +X. A soil mound and a rosette of leaves, a stem that steps forward as
// it rises, and a big round head, chin up and turned a little to the player, with a tube
// mouth, an eye on each flank and a leaf sprout behind. `pea` is its trim colour: the lip
// of the mouth and the collar on the stem.
//
// Levels: 2 adds a second leaf pair, a thicker lip, a collar and a bow of leaves behind the
// head; 3 an iron helmet with a peak; 4 crystal shards on the helmet, spikes down the back
// and a glowing mouth; 5 swaps the helmet for a gold crown, tips the leaves with gold and
// lights the eyes.

const MOUTH_DARK = '#173F1D';

export const peashooter: ModelDef = {
  key: 'peashooter',
  trim: ['pea'],
  eyes: ['eyes'],
  muzzle: [5, 12, 1.5],
  parts: [
    {
      name: 'root',
      pivot: [0, 0, 0],
      boxes: [
        { at: [-4, 0, -2], size: [4, 1, 4], color: 'soil' },
        { at: [-3, 1, -1], size: [2, 1, 2], color: 'leafDark' },
      ],
    },
    {
      // The first pair of leaves, one part so they rock about the stem like a see-saw. Each
      // has dark wings and a raised rib. The forward one runs on past its wings and droops
      // at the tip; the backward one is shorter and lies flat. Gold tips at level 5.
      name: 'leaves',
      parent: 'root',
      pivot: [-2, 1.5, 0],
      boxes: [
        { at: [-1, 1, -2], size: [3, 1, 4], color: 'leafDark' },
        { at: [-1, 1.5, -1], size: [4, 1, 2], color: 'leaf' },
        { at: [3, 1, -1], size: [1, 1, 2], color: 'leaf' },
        { at: [-6, 1, -2], size: [3, 1, 4], color: 'leafDark' },
        { at: [-6, 1.5, -1], size: [3, 1, 2], color: 'leaf' },
        { at: [3.5, 0.75, -1.25], size: [0.75, 1.5, 2.5], color: 'levelGold', minLevel: 5 },
        { at: [-6.25, 1.25, -1.25], size: [0.75, 1.5, 2.5], color: 'levelGold', minLevel: 5 },
      ],
    },
    {
      // Level 2: a second pair, towards the camera and away from it, a little above the
      // first so they overlap like a real rosette. The far one curls up at the tip.
      name: 'leaves2',
      parent: 'root',
      pivot: [-2, 1.75, 0],
      boxes: [
        { at: [-4, 1.25, 1], size: [4, 1, 3], color: 'leafDark', minLevel: 2 },
        { at: [-3, 1.75, 1], size: [2, 1, 3], color: 'leaf', minLevel: 2 },
        { at: [-3, 1.25, 4], size: [2, 1, 1], color: 'leaf', minLevel: 2 },
        { at: [-4, 1.25, -4], size: [4, 1, 3], color: 'leafDark', minLevel: 2 },
        { at: [-3, 1.75, -4], size: [2, 1, 3], color: 'leaf', minLevel: 2 },
        { at: [-3, 2.25, -5], size: [2, 1, 1], color: 'leaf', minLevel: 2 },
        { at: [-3.25, 1, 4.5], size: [2.5, 1.5, 0.75], color: 'levelGold', minLevel: 5 },
        { at: [-3.25, 2, -5.25], size: [2.5, 1.5, 0.75], color: 'levelGold', minLevel: 5 },
      ],
    },
    {
      name: 'stem',
      parent: 'root',
      pivot: [-2, 2, 0],
      boxes: [
        { at: [-3, 2, -1], size: [2, 2, 2], color: 'stem' },
        { at: [-2, 4, -1], size: [2, 2, 2], color: 'stem' },
        { at: [-1, 6, -1], size: [2, 2, 2], color: 'stem' },
        // Collar.
        { at: [-3.5, 2.5, -1.5], size: [3, 1, 3], color: 'pea', minLevel: 2 },
        // Crystal spike low on the back.
        { at: [-4, 3.5, -0.5], size: [1, 1, 1], color: 'levelCrystal', minLevel: 4 },
        { at: [-4.75, 4.25, -0.5], size: [0.75, 0.75, 1], color: 'levelCrystal', minLevel: 4 },
      ],
    },
    {
      name: 'head',
      parent: 'stem',
      pivot: [-0.5, 8, 0],
      // Chin up, and turned a little towards the player, so the mouth and the near eye both
      // show from the lawn camera.
      rot: [0, -14, 6],
      boxes: [
        // A rounded block: three crossing boxes, darker underneath and lighter on top.
        { at: [-3, 8, -3], size: [5, 1, 6], color: 'leafDark' },
        { at: [-4, 9, -3], size: [7, 1, 6], color: 'leafDark' },
        { at: [-3, 9, -4], size: [5, 1, 8], color: 'leafDark' },
        { at: [-4, 10, -3], size: [7, 4, 6], color: 'leaf' },
        { at: [-3, 10, -4], size: [5, 4, 8], color: 'leaf' },
        { at: [-3, 14, -3], size: [5, 1, 6], color: 'leaf' },
        { at: [-2, 15, -2], size: [3, 0.5, 4], color: 'leafLight' },

        // Mouth: a short neck, then the dark inside of the tube (glowing from level 4).
        { at: [3, 10, -2], size: [1.5, 3, 4], color: 'leaf' },
        { at: [4.5, 10.5, -1.5], size: [0.5, 2, 3], color: MOUTH_DARK, maxLevel: 3 },
        { at: [4.5, 10.5, -1.5], size: [0.5, 2, 3], color: 'levelCrystal', emissive: 2.2, minLevel: 4, maxLevel: 4 },
        { at: [4.5, 10.5, -1.5], size: [0.5, 2, 3], color: 'fireLight', emissive: 2, minLevel: 5 },
        // Lip, level 1: four bars round the opening, corners left off so it reads round.
        { at: [4.5, 12.5, -1.5], size: [1, 1, 3], color: 'pea', maxLevel: 1 },
        { at: [4.5, 9.5, -1.5], size: [1, 1, 3], color: 'pea', maxLevel: 1 },
        { at: [4.5, 10.5, 1.5], size: [1, 2, 1], color: 'pea', maxLevel: 1 },
        { at: [4.5, 10.5, -2.5], size: [1, 2, 1], color: 'pea', maxLevel: 1 },
        // Lip, level 2 up: longer and thicker.
        { at: [4, 12.5, -1.75], size: [1.5, 1.25, 3.5], color: 'pea', minLevel: 2 },
        { at: [4, 9.25, -1.75], size: [1.5, 1.25, 3.5], color: 'pea', minLevel: 2 },
        { at: [4, 10.25, 1.5], size: [1.5, 2.5, 1.25], color: 'pea', minLevel: 2 },
        { at: [4, 10.25, -2.75], size: [1.5, 2.5, 1.25], color: 'pea', minLevel: 2 },

        // Levels 3 and 4: an iron helmet on a leather band, stepped to a dome, with a peak
        // over the mouth.
        { at: [-3, 14, -3.5], size: [5.5, 1.5, 7], color: 'levelIronDark', minLevel: 3, maxLevel: 4 },
        { at: [-3, 14, -3.5], size: [5.5, 0.5, 7], color: 'walnutDark', minLevel: 3, maxLevel: 4 },
        { at: [-2.5, 15.5, -2.5], size: [4.5, 0.75, 5], color: 'levelIron', minLevel: 3, maxLevel: 4 },
        // Rivets.
        { at: [-2, 15.5, 2.75], size: [0.5, 0.25, 0.5], color: 'levelIron', minLevel: 3, maxLevel: 4 },
        { at: [1, 15.5, 2.75], size: [0.5, 0.25, 0.5], color: 'levelIron', minLevel: 3, maxLevel: 4 },
        { at: [-2, 15.5, -3.25], size: [0.5, 0.25, 0.5], color: 'levelIron', minLevel: 3, maxLevel: 4 },
        { at: [1, 15.5, -3.25], size: [0.5, 0.25, 0.5], color: 'levelIron', minLevel: 3, maxLevel: 4 },
        { at: [2.5, 14.5, -2.5], size: [1.5, 0.5, 5], color: 'levelIronDark', minLevel: 3, maxLevel: 4 },
        // Level 3: a ridge along it. Level 4: crystal shards instead, leaning back.
        { at: [-2.5, 16.25, -0.5], size: [4.5, 0.5, 1], color: 'levelIronDark', minLevel: 3, maxLevel: 3 },
        { at: [-2.5, 16.25, -1], size: [1.5, 1, 2], color: 'levelCrystal', minLevel: 4, maxLevel: 4 },
        { at: [-2.75, 17.25, -0.5], size: [1.25, 1, 1], color: 'levelCrystal', minLevel: 4, maxLevel: 4 },
        { at: [-3, 18.25, -0.5], size: [0.75, 0.75, 1], color: 'levelCrystal', minLevel: 4, maxLevel: 4 },
        { at: [0, 16.25, -0.5], size: [1, 1, 1], color: 'levelCrystal', minLevel: 4, maxLevel: 4 },
        { at: [-0.25, 17.25, -0.5], size: [0.75, 0.5, 1], color: 'levelCrystal', minLevel: 4, maxLevel: 4 },

        // Level 4 up: crystal spikes down the back, each stepping up and away.
        { at: [-5, 11, -1], size: [1, 1.5, 2], color: 'levelCrystal', minLevel: 4 },
        { at: [-6, 12, -0.5], size: [1, 1.5, 1], color: 'levelCrystal', minLevel: 4 },
        { at: [-6.75, 13.25, -0.5], size: [0.75, 1, 1], color: 'levelCrystal', minLevel: 4 },
        { at: [-5, 9, -0.5], size: [1, 1, 1], color: 'levelCrystal', minLevel: 4 },
        { at: [-5.75, 9.75, -0.5], size: [0.75, 1, 1], color: 'levelCrystal', minLevel: 4 },

        // Level 5: a gold crown: a band, a point at each corner, a tall leaf at the front, a jewel.
        { at: [1, 15, -3], size: [1, 1, 6], color: 'levelGold', minLevel: 5 },
        { at: [-3, 15, -3], size: [1, 1, 6], color: 'levelGold', minLevel: 5 },
        { at: [-2, 15, 2], size: [3, 1, 1], color: 'levelGold', minLevel: 5 },
        { at: [-2, 15, -3], size: [3, 1, 1], color: 'levelGold', minLevel: 5 },
        { at: [1, 16, 2], size: [1, 1, 1], color: 'levelGold', minLevel: 5 },
        { at: [1, 16, -3], size: [1, 1, 1], color: 'levelGold', minLevel: 5 },
        { at: [-3, 16, 2], size: [1, 1, 1], color: 'levelGold', minLevel: 5 },
        { at: [-3, 16, -3], size: [1, 1, 1], color: 'levelGold', minLevel: 5 },
        { at: [1, 16, -1], size: [1, 1.5, 2], color: 'levelGold', minLevel: 5 },
        { at: [1, 17.5, -0.5], size: [1, 0.75, 1], color: 'levelGold', minLevel: 5 },
        { at: [2, 15.25, -0.5], size: [0.4, 0.75, 1], color: 'levelCrystal', minLevel: 5 },
      ],
    },
    {
      name: 'eyes',
      parent: 'head',
      pivot: [1, 12, 0],
      boxes: [
        // Near eye and far eye: black, standing half a voxel proud of the flank, with the
        // glint in the top corner nearest the sun. Taller than wide, so that seen from the
        // lawn camera they come out square.
        { at: [0, 10.5, 4], size: [2, 3, 0.5], color: 'eye' },
        { at: [0, 12.5, 4], size: [1, 1, 0.5], color: 'eyeGlint' },
        { at: [0, 10.5, -4.5], size: [2, 3, 0.5], color: 'eye' },
        { at: [0, 12.5, -4.5], size: [1, 1, 0.5], color: 'eyeGlint' },
        // Level 5: a pupil of light.
        { at: [1, 11, 4], size: [1, 2, 0.5], color: 'hitSpark', emissive: 2, minLevel: 5 },
        { at: [1, 11, -4.5], size: [1, 2, 0.5], color: 'hitSpark', emissive: 2, minLevel: 5 },
      ],
    },
    {
      // A leaf growing from the back of the head: a short flag at level 1; from level 2 it
      // runs on to a drooping tip, with two more leaves spread like a bow.
      name: 'sprout',
      parent: 'head',
      pivot: [-3.5, 14, 0],
      boxes: [
        { at: [-4, 14, -1], size: [1, 2, 2], color: 'stem' },
        { at: [-5, 15, -1], size: [1, 1, 2], color: 'leafDark' },
        { at: [-6, 15, -0.5], size: [1, 1, 1], color: 'leaf', minLevel: 2 },
        { at: [-6, 14, -0.5], size: [1, 1, 1], color: 'leaf', minLevel: 2 },
        { at: [-4.5, 15.5, 1], size: [1.5, 1, 2], color: 'leaf', minLevel: 2 },
        { at: [-4.5, 15.5, -3], size: [1.5, 1, 2], color: 'leaf', minLevel: 2 },
      ],
    },
  ],
  clips: {
    idle: idleBob({ body: 'stem', head: 'head', sway: ['leaves', 'leaves2', 'sprout'] }),
    shoot: shootSnap({ body: 'stem', head: 'head' }),
    hit: hitRecoil('root', -1),
    spawn: spawnRise('root'),
    die: wilt({ body: 'stem', head: 'head' }),
    cheer: cheerJump('root'),
  },
};
