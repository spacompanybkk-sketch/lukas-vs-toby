import { zombieBite, zombieIdle, zombieThrow } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, facePlate, mirrorZ, zombieEyes } from './biped';

// Brain Rot, the area denial. Faces −X. A slumped, sallow zombie in a stained purple-grey
// sweater, arms dangling, drooping eyes (one big, one small) and a drip of green drool. The
// top of its head is open on a lumpy toxic-green brain with glowing poison bubbles on it,
// and it holds a glob of the same goo in its right hand to lob. Its trim is the grey rims
// of its goggles and gas mask.
//
//   2  big round goggles with a strap, standing out in front of its eyes
//   3  a gas mask with a canister snout over its mouth; iron rims
//   4  a crystal jar over the brain; crystal rims
//   5  a tank of glowing goo on its back, gold bands and cap, a hose to the mask, bubbling; gold rims

const head: Box[] = [
  // The head, its top cut off level where the brain shows.
  { at: [-3.5, 8.5, -2.5], size: [6, 4.5, 5], color: 'sickSkin' },
  { at: [-3, 8.5, -3], size: [5, 4.5, 6], color: 'sickSkin' },
  { at: [-3, 8, -2.5], size: [5, 0.5, 5], color: 'sickSkinDark' },
  { at: [-3.5, 12.5, -2.5], size: [6, 0.5, 5], color: 'sickSkinDark' },
  // A pale plate behind the eyes.
  facePlate(-3.5, 10, 12.5, -2.5, 2.5, 'sickSkinLight'),
  // A sagging mouth with a drip of green drool, and dark bags under the eyes.
  { at: [-3.5, 9, -1.5], size: [0.5, 1, 3], color: 'mouthDark' },
  { at: [-4, 8, 0], size: [0.5, 1.5, 1], color: 'toxicGreen' },
  { at: [-3.5, 9.5, 1.5], size: [0.5, 0.5, 1.5], color: 'sickSkinDark' },
  // The brain: lumps of toxic green, grooves between them.
  { at: [-3, 13, -2.5], size: [5, 1.5, 5], color: 'toxicGreen' },
  { at: [-2.5, 14.5, -2], size: [2, 1, 2], color: 'toxicGreen' },
  { at: [0, 14.5, -2], size: [2, 0.5, 4], color: 'toxicGreen' },
  { at: [-2.5, 14.5, 0.5], size: [2, 0.5, 1.5], color: 'toxicGreen' },
  { at: [-0.5, 13.5, -2.5], size: [0.5, 1, 5], color: 'toxicGreenDark' },
  { at: [-3, 13.5, 0], size: [5, 1, 0.5], color: 'toxicGreenDark' },
  // Level 2 up: goggles, two big lenses on a strap round the head.
  ...atLevels(2, 5, [
    // Each lens magnifies the eye behind it: a pale glass with a big black pupil in it.
    { at: [-5, 10, 0], size: [1, 3, 3.5], color: 'iron' },
    { at: [-5, 10.5, 0.5], size: [0.5, 2, 2.5], color: 'tooth' },
    { at: [-5, 10.5, 1], size: [0.5, 1.5, 1.5], color: 'eye' },
    { at: [-5, 11.5, 1], size: [0.5, 0.5, 0.5], color: 'eyeGlint' },
    { at: [-5, 10.5, -3], size: [1, 2, 2.5], color: 'iron' },
    { at: [-5, 11, -2.5], size: [0.5, 1, 1.5], color: 'tooth' },
    { at: [-5, 11, -2], size: [0.5, 1, 1], color: 'eye' },
    { at: [-2, 11.5, 3], size: [4.5, 1, 0.5], color: 'hatBrownDark' },
    { at: [-3, 11.5, -3.5], size: [5.5, 1, 0.5], color: 'hatBrownDark' },
  ]),
  // Level 3 up: a gas mask over the mouth, with a canister snout.
  ...atLevels(3, 5, [
    { at: [-4.5, 8.5, -1.5], size: [1, 1.5, 3], color: 'iron' },
    { at: [-5.5, 8.5, -1], size: [1, 1.5, 2], color: 'armourDark' },
    { at: [-6, 9, -0.5], size: [0.5, 1, 1], color: 'iron' },
  ]),
  // Level 4 up: a crystal jar over the brain: corner posts and a lid.
  ...atLevels(4, 5, [
    { at: [-3.5, 13, -3], size: [1, 3.5, 1], color: 'levelCrystal' },
    { at: [1.5, 13, -3], size: [1, 3.5, 1], color: 'levelCrystal' },
    { at: [-3.5, 13, 2], size: [1, 3.5, 1], color: 'levelCrystal' },
    { at: [1.5, 13, 2], size: [1, 3.5, 1], color: 'levelCrystal' },
    { at: [-3.5, 16.5, -3], size: [6, 0.5, 6], color: 'levelCrystal' },
    { at: [-1.5, 17, -1], size: [2, 0.5, 2], color: 'levelCrystalDeep' },
  ]),
];

const torso: Box[] = [
  { at: [-2, 5, -3], size: [4, 3.5, 6], color: 'trouser' },
  { at: [-2, 5, -3], size: [4, 0.5, 6], color: 'trouserDark' },
  { at: [-2, 8, -2.5], size: [0.5, 0.5, 5], color: 'trouserDark' },
  // Toxic stains down the front and the camera's side.
  { at: [-2, 6, -1], size: [0.5, 1, 1.5], color: 'toxicGreenDark' },
  { at: [-1, 6.5, 2.5], size: [1.5, 1, 0.5], color: 'toxicGreenDark' },
  // Level 5: a tank of glowing goo on its back, banded and capped in gold, and a hose over
  // the shoulder. The goo is the tank's colour, so the gold is its bands and cap.
  ...atLevels(5, 5, [
    { at: [2, 5, -2], size: [2.5, 7, 3], color: 'toxicGreen', emissive: 1.5 },
    { at: [2.5, 5, -2.5], size: [1.5, 7, 4], color: 'toxicGreen', emissive: 1.5 },
    { at: [2, 5, -2.5], size: [2.5, 1, 4], color: 'levelGold' },
    { at: [2, 8.5, -2.5], size: [2.5, 0.5, 4], color: 'levelGoldDark' },
    { at: [2.5, 12, -1.5], size: [1.5, 1, 2], color: 'levelGold' },
    { at: [3, 13, -1], size: [1, 1, 1], color: 'poison', emissive: 2 },
    { at: [0, 8.5, -2.5], size: [2, 0.5, 0.5], color: 'levelGoldDark' },
    { at: [-2, 8.5, -2.5], size: [2, 0.5, 0.5], color: 'levelGoldDark' },
  ]),
];

// Hanging forward and down, limp.
const armL: Box[] = [
  { at: [-1, 6.5, 3], size: [2.5, 2, 2], color: 'trouser' },
  { at: [-2.5, 7, 3.5], size: [1.5, 1, 1], color: 'sickSkin' },
  { at: [-4, 6.5, 3], size: [1.5, 2, 2], color: 'sickSkin' },
];

const legL: Box[] = [
  { at: [-1, 1.5, 0.5], size: [2, 2.5, 2], color: 'trouserDark' },
  { at: [-2.5, 0, 0.5], size: [3.5, 1.5, 2], color: 'hatBrownDark' },
];

export const brainRot = bipedModel({
  key: 'brainRot',
  skin: 'sickSkin',
  cloth: 'trouser',
  clothDark: 'trouserDark',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [
    { at: [-1.5, 4, -2.25], size: [3, 1, 4.5], color: 'trouserDark' },
    { at: [-1.5, 5, -2.25], size: [3, 0.5, 4.5], color: 'trouser' },
  ],
  joints: { torso: [0, 5, 0], head: [-0.5, 8.5, 0], armL: [-0.5, 7.5, 4], armR: [-0.5, 7.5, -4], legL: [0, 4, 1.5], legR: [0, 4, -1.5] },
  // Slumped: twice the usual slouch, the arms drooping.
  slouch: 20,
  rots: { armL: [0, 0, 15], armR: [0, 0, 15] },
  walk: { legs: 16, arms: 12, bob: 1.5, roll: 6 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-3.75, 11, 0],
      boxes: [
        // Dopey: a big eye and a smaller one (no heavy lid: from above it hid the
        // eye's glint and the two eyes ran together).
        ...zombieEyes({ face: -3.5, y: 10, near: [2, 2.5], far: [2, 2], farLift: 0, gap: 1.5 }),
      ],
    },
    {
      // Poison bubbles on the brain, glowing, bobbing as they bubble.
      name: 'bubbles',
      parent: 'head',
      pivot: [-0.5, 14.5, 0],
      boxes: [
        { at: [-2, 15, -1.5], size: [1, 1, 1], color: 'poison', emissive: 2 },
        { at: [1, 15, 1], size: [1, 1, 1], color: 'poison', emissive: 2 },
        { at: [0.5, 15, -2], size: [1, 0.5, 1], color: 'poison', emissive: 2, minLevel: 2 },
      ],
    },
    {
      // The glob of goo it lobs, in its right hand.
      name: 'glob',
      parent: 'armR',
      pivot: [-3, 9, -4],
      boxes: [
        { at: [-4, 8.5, -5], size: [2, 1.5, 2], color: 'toxicGreen' },
        { at: [-3.5, 10, -4.5], size: [1, 0.5, 1], color: 'toxicGreen' },
        { at: [-3.5, 9, -3], size: [1, 1, 0.5], color: 'poison', emissive: 2 },
      ],
    },
  ],
  trim: ['iron'],
  eyes: ['eyes'],
  stepSeconds: 1.0,
  muzzle: { part: 'glob', at: [-3, 9.5, -4] },
  clips: {
    idle: zombieIdle(['glob', 'bubbles']),
    // An underarm lob.
    shoot: zombieThrow({ underarm: true }),
    melee: zombieBite(),
  },
});
