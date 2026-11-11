import { zombieBite, zombieIdle, zombieThrow } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, mirrorZ } from './biped';

// Trident Zombie, the siege. Faces −X. A big-shouldered, blue-grey zombie from the sea:
// a broad bare chest with a tattered purple sash, barnacles on its shoulders, fins for
// ears, pouting fish lips, strands of seaweed for hair and ragged purple shorts. It carries
// a trident upright in its right hand, the tines standing above its head. Its
// trim is the trident's head.
//
//   2  a crown of seaweed fronds and a shell
//   3  iron pauldrons on both shoulders; an iron trident
//   4  a glowing crystal trident
//   5  a gold trident and gold pauldrons

/** Pauldrons from level 3: iron at 3 and 4, gold at 5. */
const pauldron = (boxes: Box[]): Box[] => [
  ...atLevels(3, 4, boxes),
  ...atLevels(5, 5, boxes.map((box) => ({ ...box, color: box.color === 'levelIron' ? 'levelGold' : 'levelGoldDark' }))),
];

const head: Box[] = [
  { at: [-4, 9, -2.5], size: [5.5, 5, 5], color: 'seaBlue' },
  { at: [-3.5, 9, -3], size: [4.5, 5, 6], color: 'seaBlue' },
  { at: [-3.5, 8.5, -2.5], size: [4.5, 0.5, 5], color: 'seaBlueDark' },
  // Pouting fish lips, and a fin for an ear on the camera's side.
  { at: [-4.5, 9.5, -1.5], size: [0.5, 1, 2.5], color: 'brainPink' },
  { at: [-4, 9.5, -1], size: [0.5, 0.5, 1.5], color: 'mouthDark' },
  { at: [-1, 10.5, 3], size: [1.5, 2.5, 0.5], color: 'seaBlueDark' },
  { at: [0.5, 11.5, 3], size: [1, 2, 0.5], color: 'seaBlueDark' },
  // Seaweed hair, hanging down the back.
  { at: [-3, 14, -2], size: [4, 0.5, 4], color: 'seaweedDark' },
  { at: [-2.5, 14.5, -1], size: [1, 1, 1], color: 'seaweed' },
  { at: [-0.5, 14.5, 0.5], size: [1, 0.5, 1], color: 'seaweed' },
  { at: [1.5, 11, -1.5], size: [0.5, 3, 1], color: 'seaweed' },
  { at: [1.5, 10, 0.5], size: [0.5, 4, 1], color: 'seaweedDark' },
  // Level 2 up: a crown of seaweed fronds standing up, and a pink shell in front.
  ...atLevels(2, 5, [
    { at: [-3, 14.5, -2], size: [1, 2.5, 1], color: 'seaweed' },
    { at: [-3.5, 17, -2], size: [1, 1, 1], color: 'seaweedDark' },
    { at: [-1, 14.5, 1.5], size: [1, 3, 1], color: 'seaweed' },
    { at: [-1.5, 17.5, 1.5], size: [1, 1, 1], color: 'seaweedDark' },
    { at: [0, 14.5, -2.5], size: [1, 2, 1], color: 'seaweed' },
    { at: [0.5, 16.5, -2.5], size: [1, 1, 1], color: 'seaweedDark' },
    { at: [-4.5, 13.5, -1], size: [0.5, 1.5, 2], color: 'brainPink' },
    { at: [-4.5, 15, -0.5], size: [0.5, 0.5, 1], color: 'brainDark' },
  ]),
];

const torso: Box[] = [
  // A narrow waist under a broad chest, the shoulders standing out wide.
  { at: [-2, 5, -2.5], size: [4, 2, 5], color: 'seaBlue' },
  { at: [-2.5, 7, -3.5], size: [5, 2.5, 7], color: 'seaBlue' },
  { at: [-2, 9.5, -3], size: [4, 0.5, 6], color: 'seaBlueDark' },
  // A tattered purple sash over one shoulder and across the chest.
  { at: [-2.5, 7.5, -3.5], size: [0.5, 1, 7], color: 'clothPurple' },
  { at: [-2, 5.5, 2], size: [4, 1, 0.5], color: 'clothPurple' },
  { at: [-2, 5, -2.5], size: [0.5, 1, 5], color: 'clothDark' },
  // Barnacles.
  { at: [-1, 9.5, 2], size: [1, 0.5, 1], color: 'bone' },
  { at: [0.5, 9.5, -3], size: [1, 0.5, 1], color: 'boneShadow' },
];

const armL: Box[] = [
  { at: [-2, 7, 3.5], size: [2.5, 2.5, 1.5], color: 'seaBlue' },
  { at: [-4, 7.5, 3.5], size: [2, 1.5, 1.5], color: 'seaBlue' },
  { at: [-5, 6.5, 3.5], size: [1.5, 2.5, 1.5], color: 'seaBlueDark' },
  { at: [-1, 9.5, 4], size: [1, 0.5, 1], color: 'bone', maxLevel: 2 },
  // Level 3 up: a pauldron, rimmed, standing up off the shoulder.
  ...pauldron([
    { at: [-2.5, 9.5, 3], size: [3.5, 1, 2.5], color: 'levelIron' },
    { at: [-2, 10.5, 3], size: [2.5, 0.5, 2], color: 'levelIronDark' },
    { at: [-2.5, 8.5, 5], size: [3.5, 1, 0.5], color: 'levelIronDark' },
  ]),
];

const legL: Box[] = [
  { at: [-1, 2.5, 0.5], size: [2, 2, 2], color: 'trouser' },
  { at: [-1, 2, 0.5], size: [2, 0.5, 2], color: 'clothPurple' },
  { at: [-0.5, 1, 1], size: [1, 1, 1], color: 'seaBlue' },
  // A big bare webbed foot.
  { at: [-2.5, 0, 0.5], size: [3.5, 1, 2], color: 'seaBlueDark' },
];

export const tridentZombie = bipedModel({
  key: 'tridentZombie',
  skin: 'seaBlue',
  cloth: 'trouser',
  clothDark: 'trouserDark',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [
    { at: [-1.5, 4, -2.25], size: [3, 1, 4.5], color: 'trouser' },
    { at: [-1.5, 4.5, -2.25], size: [3, 0.5, 4.5], color: 'trouserDark' },
  ],
  joints: { torso: [0, 5, 0], head: [-1.5, 9, 0], armL: [-0.5, 8, 4.25], armR: [-0.5, 8, -4.25], legL: [0, 4, 1.5], legR: [0, 4, -1.5] },
  // Heavy: a long, rolling stride.
  walk: { legs: 22, arms: 10, bob: 1.2, roll: 6 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-4.25, 12, 0],
      boxes: [
        { at: [-4.5, 10.5, 0.5], size: [0.5, 3, 2.5], color: 'eye' },
        { at: [-4, 10.5, 2.5], size: [1.5, 3, 1], color: 'eye' },
        { at: [-4.5, 12.5, 0.5], size: [0.5, 1, 1], color: 'eyeGlint' },
        { at: [-4.5, 11, -2.5], size: [0.5, 2, 1.5], color: 'eye' },
        { at: [-4.5, 12, -2.5], size: [0.5, 1, 0.5], color: 'eyeGlint' },
      ],
    },
    {
      // The trident, upright through the right fist (where it leaves the face clear) (the slouch turned out of it).
      name: 'trident',
      parent: 'armR',
      pivot: [-4.25, 7.75, -4.25],
      rot: [0, 0, -10],
      boxes: [
        { at: [-4.25, 1.5, -4.75], size: [1, 10.5, 1], color: 'hatBrownDark' },
        { at: [-5.5, 12, -4.75], size: [3.5, 1, 1], color: 'iron' },
        { at: [-4.25, 13, -4.75], size: [1, 2.5, 1], color: 'iron' },
        { at: [-5.5, 13, -4.75], size: [1, 1.5, 1], color: 'iron' },
        { at: [-3, 13, -4.75], size: [1, 1.5, 1], color: 'iron' },
        { at: [-4, 15.5, -4.75], size: [0.5, 0.5, 1], color: 'iron' },
        // From level 2 the tines are longer and barbed.
        ...atLevels(2, 5, [
          { at: [-4.25, 15.5, -4.75], size: [1, 1.5, 1], color: 'iron' },
          { at: [-5.5, 14.5, -4.75], size: [1, 1, 1], color: 'iron' },
          { at: [-3, 14.5, -4.75], size: [1, 1, 1], color: 'iron' },
          { at: [-6, 13.5, -4.75], size: [0.5, 1, 1], color: 'iron' },
          { at: [-2, 13.5, -4.75], size: [0.5, 1, 1], color: 'iron' },
        ]),
      ],
    },
  ],
  trim: ['iron'],
  eyes: ['eyes'],
  stepSeconds: 0.9,
  muzzle: { part: 'trident', at: [-3.75, 14, -4.25] },
  clips: {
    idle: zombieIdle([]),
    // The whole-lane throw: overarm, with the trident hand.
    shoot: zombieThrow({ arm: 'armR' }),
    melee: zombieBite(),
  },
});
