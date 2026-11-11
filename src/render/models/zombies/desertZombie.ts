import { zombieBite, zombieIdle, zombieThrow } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, facePlate, mirrorZ, zombieEyes } from './biped';

// Desert Zombie, the control. Faces −X. A mummy wrapped in bandages, arms held out straight
// and stiff, green skin showing through a gap round the eyes (one big, one small), loose
// bandage ends trailing from its wrist and the back of its head, a little sand-coloured
// headdress with purple stripes, and a handful of sand to throw. Its trim is the stripes.
//
//   2  a full headdress: a taller cap and lappets flaring out past the shoulders
//   3  a pharaoh's: the headdress turns to iron striped with sand, a cobra rising off the brow
//   4  a glowing crystal headdress and cobra
//   5  a purple headdress striped in gold, a gold cobra, and a broad gold collar with warm gems

/** The pharaoh's headdress (nemes): a cap, lappets flaring past the shoulders, a tail behind. */
const nemes = (from: number, to: number, cloth: string, stripe: string): Box[] =>
  atLevels(from, to, [
    { at: [-5, 13.5, -3.5], size: [7.5, 1.5, 7], color: cloth },
    { at: [-4.5, 15, -3], size: [6.5, 1, 6], color: cloth },
    { at: [-4.5, 15.5, -1.5], size: [6.5, 0.5, 1], color: stripe },
    { at: [-4.5, 15.5, 1], size: [6.5, 0.5, 1], color: stripe },
    { at: [-5, 14, 3], size: [7.5, 0.5, 0.5], color: stripe },
    { at: [-3, 8.5, 3.5], size: [2.5, 5, 1], color: cloth },
    { at: [-3, 7.5, 4], size: [3, 1, 1], color: 'sandDark' },
    { at: [-3, 10, 4], size: [2.5, 0.5, 0.5], color: stripe },
    { at: [-3, 12, 4], size: [2.5, 0.5, 0.5], color: stripe },
    { at: [-3, 8.5, -4.5], size: [2.5, 5, 1], color: cloth },
    { at: [-3, 7.5, -5], size: [3, 1, 1], color: 'sandDark' },
    { at: [1.5, 10, -1.5], size: [1.5, 4, 3], color: 'sandDark' },
  ]);

const head: Box[] = [
  // Wrapped head, darker underneath, with bands of darker bandage round it.
  { at: [-4.5, 8.5, -2.5], size: [6, 5.5, 5], color: 'bandage' },
  { at: [-4, 8.5, -3], size: [5, 5.5, 6], color: 'bandage' },
  { at: [-4, 8, -2.5], size: [5, 0.5, 5], color: 'bandageDark' },
  { at: [-4.5, 9.5, -2.5], size: [0.5, 0.5, 5], color: 'bandageDark' },
  { at: [-4, 9.5, 2.5], size: [5, 0.5, 0.5], color: 'bandageDark' },
  // The gap the eyes look out of: green skin across the face and round to the camera's side.
  facePlate(-4.5, 10, 13.5, -2.5, 2.5, 'skinLight'),
  { at: [-3, 10.5, 2.5], size: [1.5, 2.5, 0.5], color: 'skin' },
  // A slit of a mouth with a tooth, under the wraps.
  { at: [-4.5, 8.5, -1.5], size: [0.5, 1, 3], color: 'mouthDark' },
  { at: [-5, 9, 0], size: [0.5, 0.5, 1], color: 'tooth' },

  // Level 1: a little sand-coloured headdress, a cap and two short lappets.
  ...atLevels(1, 1, [
    { at: [-4.5, 13.5, -3], size: [6, 1, 6], color: 'sand' },
    { at: [-4, 14.5, -2.5], size: [5, 0.5, 5], color: 'sand' },
    { at: [-4.5, 14, -3], size: [6, 0.5, 0.5], color: 'clothPurple' },
    { at: [-4.5, 14, 2.5], size: [6, 0.5, 0.5], color: 'clothPurple' },
    { at: [-2.5, 10, 3], size: [2, 3.5, 0.5], color: 'sand' },
    { at: [-2.5, 11, 3], size: [2, 0.5, 0.5], color: 'clothPurple' },
    { at: [-2.5, 10, -3.5], size: [2, 3.5, 0.5], color: 'sand' },
  ]),
  // Level 2: the full headdress, taller, striped over the top, the lappets flaring out. From
  // level 3 it is a pharaoh's: the cloth turns to metal and the stripes to sand.
  ...nemes(2, 2, 'sand', 'clothPurple'),
  ...nemes(3, 4, 'clothPurple', 'sand'),
  // Level 5: the headdress stays purple cloth, its stripes turn gold: a mummy in a royal
  // headdress, not a block of gold.
  ...nemes(5, 5, 'robePurple', 'levelGold'),
  // A cobra rising off the brow: iron at 3, crystal at 4, gold at 5.
  ...atLevels(3, 3, [
    { at: [-6, 13.5, -0.5], size: [1, 2.5, 1], color: 'levelIron' },
    { at: [-6.5, 16, -0.5], size: [1.5, 1, 1], color: 'levelIron' },
  ]),
  ...atLevels(4, 4, [
    { at: [-6, 13.5, -0.5], size: [1, 2.5, 1], color: 'levelCrystal' },
    { at: [-6.5, 16, -0.5], size: [1.5, 1, 1], color: 'levelCrystal' },
  ]),
  ...atLevels(5, 5, [
    { at: [-6, 13.5, -0.5], size: [1, 2.5, 1], color: 'levelGold' },
    { at: [-6.5, 16, -0.5], size: [1.5, 1, 1], color: 'levelGold' },
    { at: [-7, 16, -0.5], size: [0.5, 0.5, 1], color: 'fireLight', emissive: 2 },
  ]),
];

const torso: Box[] = [
  { at: [-2, 5, -3], size: [4, 3.5, 6], color: 'bandage' },
  { at: [-2, 6, -3], size: [4, 0.5, 6], color: 'bandageDark' },
  { at: [-2, 7.5, -3], size: [4, 0.5, 6], color: 'bandageDark' },
  { at: [-1, 6.5, 2.5], size: [1.5, 1, 0.5], color: 'skinDark' },
  // Level 5: a broad gold collar over the shoulders, set with warm gems.
  ...atLevels(5, 5, [
    { at: [-2.5, 8, -3.5], size: [5, 1, 7], color: 'levelGold' },
    { at: [-3, 7, -2.5], size: [1, 1.5, 5], color: 'levelGold' },
    { at: [-3.5, 7.5, -0.5], size: [0.5, 1, 1], color: 'fireLight', emissive: 2 },
    { at: [-1, 8.5, 3.5], size: [1, 0.5, 0.5], color: 'fireLight', emissive: 2 },
  ]),
];

// Held out straight in front, stiff, the classic way.
const armL: Box[] = [
  { at: [-4.5, 6.5, 3], size: [5, 2, 2], color: 'bandage' },
  { at: [-3, 6.5, 3], size: [0.5, 2, 2], color: 'bandageDark' },
  { at: [-1, 6.5, 3], size: [0.5, 2, 2], color: 'bandageDark' },
  { at: [-5, 6.5, 3], size: [0.5, 2, 2], color: 'skin' },
];

const legL: Box[] = [
  { at: [-1, 1, 0.5], size: [2, 3, 2], color: 'bandage' },
  { at: [-1, 2.5, 0.5], size: [2, 0.5, 2], color: 'bandageDark' },
  { at: [-2, 0, 0.5], size: [3, 1, 2], color: 'bandageDark' },
];

export const desertZombie = bipedModel({
  key: 'desertZombie',
  skin: 'skin',
  cloth: 'bandage',
  clothDark: 'bandageDark',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [
    { at: [-1.5, 4, -2.25], size: [3, 1, 4.5], color: 'bandageDark' },
    { at: [-1.5, 5, -2.25], size: [3, 0.5, 4.5], color: 'bandage' },
  ],
  joints: { torso: [0, 5, 0], head: [-1.5, 8.5, 0], armL: [-0.5, 7.5, 4], armR: [-0.5, 7.5, -4], legL: [0, 4, 1.5], legR: [0, 4, -1.5] },
  walk: { legs: 20, arms: 10, bob: 1.5, roll: 6 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-4.75, 11.75, 0],
      boxes: zombieEyes({ face: -4.5, y: 10.5, near: [2.5, 2.5], far: [2, 2], farLift: 0.25 }),
    },
    {
      // A loose bandage end trailing from the back of the head, longer from level 2.
      name: 'tailHead',
      parent: 'head',
      pivot: [3, 12, 1],
      boxes: [
        { at: [1.5, 11.5, 0.5], size: [1.5, 1, 1], color: 'bandage', maxLevel: 1 },
        { at: [3, 11.5, 0.5], size: [1, 1, 1], color: 'bandage', minLevel: 2 },
        { at: [3, 10.5, 0.5], size: [1, 1, 1], color: 'bandageDark', maxLevel: 1 },
        { at: [4, 10, 0.5], size: [1, 1.5, 1], color: 'bandageDark', minLevel: 2 },
        { at: [4.5, 8.5, 0.5], size: [1, 1.5, 1], color: 'bandage', minLevel: 2 },
      ],
    },
    {
      // Another hanging from the left wrist.
      name: 'tailArm',
      parent: 'armL',
      pivot: [-3.5, 6.5, 4.5],
      boxes: [
        { at: [-4, 5, 4.5], size: [1, 1.5, 0.5], color: 'bandage' },
        { at: [-3.5, 4, 4.5], size: [1, 1, 0.5], color: 'bandageDark' },
        { at: [-3, 3, 4.5], size: [1, 1, 0.5], color: 'bandage', minLevel: 2 },
      ],
    },
    {
      // A handful of sand on the right palm: what it throws.
      name: 'sand',
      parent: 'armR',
      pivot: [-4, 8.5, -4],
      boxes: [
        { at: [-5, 8.5, -5], size: [2, 1, 2], color: 'sand' },
        { at: [-4.5, 9.5, -4.5], size: [1, 0.5, 1], color: 'sandDark' },
      ],
    },
  ],
  trim: ['clothPurple'],
  eyes: ['eyes'],
  stepSeconds: 0.75,
  muzzle: { part: 'sand', at: [-4, 9.5, -4] },
  sway: ['tailHead', 'tailArm'],
  clips: {
    idle: zombieIdle(['tailHead', 'tailArm', 'sand']),
    melee: zombieBite(),
    shoot: zombieThrow(),
  },
});
