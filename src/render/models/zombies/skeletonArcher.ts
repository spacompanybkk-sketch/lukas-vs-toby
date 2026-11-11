import { bowDraw, zombieBite, zombieIdle } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, mirrorZ, zombieEyes } from './biped';

// Skeleton Archer, the sniper. Faces −X. A thin bone skeleton, no armour, in a peaked
// leather cap with a purple feather, a quiver of purple-fletched arrows on its back and a
// rust-red bow in its left hand, on the camera's side, upright with the string towards it.
// It stands tall to draw and loose. Its trim is the bow.
//
//   2  a bigger bow with a grip wrap, a long feather, more arrows, a leather shoulder guard
//   3  an iron bow with a crossbow stock, iron-tipped arrows
//   4  a crystal bow with a glowing string
//   5  a gold bow, a gold band on the cap and a gold-rimmed quiver

const head: Box[] = [
  // A narrow skull with a small jaw.
  { at: [-4, 10, -2.5], size: [5.5, 4, 5], color: 'bone' },
  { at: [-3.5, 10, -3], size: [4.5, 4, 6], color: 'bone' },
  { at: [-4, 9, -2], size: [4, 1, 4], color: 'boneShadow' },
  { at: [-4, 11, -0.5], size: [0.5, 1, 1], color: 'socket' },
  { at: [-4, 10, -1.5], size: [0.5, 0.5, 3], color: 'socket' },
  { at: [-4.5, 9.5, -1], size: [0.5, 1, 1], color: 'tooth' },
  // The peaked cap: a crown, a peak out over the face and a point at the back.
  { at: [-4.5, 13.5, -3], size: [6.5, 1, 6.5], color: 'hatBrown' },
  { at: [-3.5, 14.5, -2.5], size: [5, 1, 5.5], color: 'hatBrown' },
  { at: [-5.5, 13.5, -2], size: [1, 0.5, 4], color: 'hatBrownDark' },
  { at: [1.5, 14.5, -1], size: [1.5, 1, 2], color: 'hatBrownDark' },
  // Level 5: a gold band round the cap.
  { at: [-4.5, 13.5, -3], size: [6.5, 0.5, 6.5], color: 'levelGold', minLevel: 5 },
];

const torso: Box[] = [
  { at: [-0.5, 5.5, -0.5], size: [1, 1, 1], color: 'boneShadow' },
  { at: [-1.5, 6.5, -2], size: [3, 3, 4], color: 'bone' },
  // Ribs, on the camera's side and in front.
  { at: [-1, 7, 1.5], size: [2, 0.5, 0.5], color: 'socket' },
  { at: [-1, 8, 1.5], size: [2, 0.5, 0.5], color: 'socket' },
  { at: [-1.5, 7.5, -1.5], size: [0.5, 0.5, 3], color: 'socket' },
  { at: [-1, 9.5, -2], size: [2, 0.5, 4], color: 'bone' },
  // A strap across the chest to the quiver.
  { at: [-2, 6.5, -0.5], size: [0.5, 3, 1], color: 'hatBrownDark' },
];

const armL: Box[] = [
  { at: [-2.5, 8.5, 2.5], size: [3, 1, 1], color: 'bone' },
  { at: [-3, 8, 2.5], size: [1, 2, 1], color: 'boneShadow' },
  { at: [-4.5, 8.5, 2.5], size: [1.5, 1, 1], color: 'bone' },
  { at: [-5, 8, 2.5], size: [1, 2, 1], color: 'bone' },
  // Level 2 up: a leather guard on the bow shoulder, on the camera's side and seen from above.
  ...atLevels(2, 5, [
    { at: [-1.75, 9.5, 2], size: [2.5, 1, 2.25], color: 'hatBrown' },
    { at: [-1, 10.5, 2.5], size: [1, 0.5, 1.25], color: 'hatBrownDark' },
  ]),
];

const legL: Box[] = [
  { at: [-0.5, 2.5, 0.75], size: [1, 1.5, 1], color: 'bone' },
  { at: [-1, 1.5, 0.75], size: [1.5, 1, 1], color: 'boneShadow' },
  { at: [-0.5, 1, 0.75], size: [1, 0.5, 1], color: 'bone' },
  { at: [-2, 0, 0.5], size: [2.5, 1, 1.5], color: 'bone' },
];

export const skeletonArcher = bipedModel({
  key: 'skeletonArcher',
  skin: 'bone',
  cloth: 'hatBrown',
  clothDark: 'hatBrownDark',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [
    { at: [-1.25, 4, -1.75], size: [2.5, 1, 3.5], color: 'bone' },
    { at: [-1.5, 5, -2], size: [3, 0.5, 4], color: 'hatBrownDark' },
  ],
  joints: { torso: [0, 5.5, 0], head: [-1, 9.5, 0], armL: [-0.5, 9, 3], armR: [-0.5, 9, -3], legL: [0, 4, 1.25], legR: [0, 4, -1.25] },
  walk: { legs: 22, arms: 12, bob: 1.5, roll: 6 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-4.25, 12, 0],
      // Two sockets with bone between, the near one bigger, each with a red light and a glint.
      boxes: zombieEyes({ face: -4, y: 10.5, near: [2.5, 3], far: [2, 2.5], color: 'socket', light: { color: 'eyeRed', emissive: 2.5 } }),
    },
    {
      // A purple feather in the cap, sweeping back; much longer from level 2.
      name: 'feather',
      parent: 'head',
      pivot: [0, 15, 3],
      boxes: [
        { at: [-0.5, 14.5, 3], size: [1.5, 1, 0.5], color: 'clothDark' },
        { at: [1, 15, 3], size: [2, 1, 0.5], color: 'clothPurple' },
        { at: [3, 15.5, 3], size: [1, 0.5, 0.5], color: 'clothPurple', maxLevel: 1 },
        { at: [3, 15.5, 3], size: [2, 1, 0.5], color: 'clothPurple', minLevel: 2 },
        { at: [5, 16, 3], size: [1.5, 1, 0.5], color: 'robeTrim', minLevel: 2 },
      ],
    },
    {
      // The quiver on its back, arrows standing up out of it.
      name: 'quiver',
      parent: 'torso',
      pivot: [2, 7, 0],
      boxes: [
        { at: [1.5, 5.5, -1.5], size: [1.5, 4.5, 2], color: 'hatBrown' },
        { at: [1.5, 9.5, -1.5], size: [1.5, 0.5, 2], color: 'hatBrownDark', maxLevel: 4 },
        { at: [1.5, 9.5, -1.5], size: [1.5, 0.5, 2], color: 'levelGold', minLevel: 5 },
        { at: [1.5, 7, -1.5], size: [1.5, 0.5, 2], color: 'levelIron', minLevel: 3 },
        { at: [1.5, 10, -1.5], size: [0.5, 2, 0.5], color: 'hatBrownDark' },
        { at: [1.5, 12, -1.5], size: [1, 1, 1], color: 'clothPurple' },
        { at: [2.5, 10, -0.5], size: [0.5, 1.5, 0.5], color: 'hatBrownDark' },
        { at: [2, 11.5, -0.5], size: [1, 1, 1], color: 'clothPurple' },
        { at: [2, 10, 0], size: [0.5, 2.5, 0.5], color: 'hatBrownDark', minLevel: 2 },
        { at: [1.5, 12.5, -0.5], size: [1, 1, 1], color: 'robeTrim', minLevel: 2 },
      ],
    },
    {
      // The bow, on the outside of the left fist, upright (the slouch is turned out of it),
      // the belly forward and the string straight behind. Bigger from level 2, with a
      // crossbow stock from 3, a glowing string at 4 and 5.
      name: 'bow',
      parent: 'armL',
      pivot: [-4.5, 9, 3.75],
      rot: [0, 0, -10],
      boxes: [
        ...atLevels(1, 1, [
          { at: [-5, 8, 3.5], size: [1, 2, 0.5], color: 'rust' },
          { at: [-5, 10, 3.5], size: [1, 1.5, 0.5], color: 'rust' },
          { at: [-4.5, 11.5, 3.5], size: [1, 1, 0.5], color: 'rust' },
          { at: [-4, 12.5, 3.5], size: [1, 1, 0.5], color: 'rust' },
          { at: [-5, 6.5, 3.5], size: [1, 1.5, 0.5], color: 'rust' },
          { at: [-4.5, 5.5, 3.5], size: [1, 1, 0.5], color: 'rust' },
          { at: [-4, 4.5, 3.5], size: [1, 1, 0.5], color: 'rust' },
          { at: [-3.5, 5, 3.5], size: [0.5, 8, 0.5], color: 'bone' },
        ]),
        ...atLevels(2, 5, [
          { at: [-6, 8, 3.5], size: [1.5, 2, 0.5], color: 'hatBrownDark' },
          { at: [-6, 10, 3.5], size: [1, 2, 0.5], color: 'rust' },
          { at: [-5.5, 12, 3.5], size: [1, 1.5, 0.5], color: 'rust' },
          { at: [-5, 13.5, 3.5], size: [1, 1, 0.5], color: 'rust' },
          { at: [-4.5, 14.5, 3.5], size: [1, 1, 0.5], color: 'rust' },
          { at: [-6, 6, 3.5], size: [1, 2, 0.5], color: 'rust' },
          { at: [-5.5, 4.5, 3.5], size: [1, 1.5, 0.5], color: 'rust' },
          { at: [-5, 3.5, 3.5], size: [1, 1, 0.5], color: 'rust' },
          { at: [-4.5, 2.5, 3.5], size: [1, 1, 0.5], color: 'rust' },
        ]),
        { at: [-4, 3, 3.5], size: [0.5, 12, 0.5], color: 'bone', minLevel: 2, maxLevel: 3 },
        { at: [-4, 3, 3.5], size: [0.5, 12, 0.5], color: 'levelCrystal', emissive: 2.5, minLevel: 4, maxLevel: 4 },
        { at: [-4, 3, 3.5], size: [0.5, 12, 0.5], color: 'fireLight', emissive: 1.6, minLevel: 5 },
        // Level 3 up: a crossbow stock along the arrow's line, an arrow lying on it.
        ...atLevels(3, 5, [
          { at: [-7, 8.5, 3.5], size: [3, 1, 0.5], color: 'rust' },
          { at: [-8, 9, 3.5], size: [1, 0.5, 0.5], color: 'levelIron' },
          { at: [-7, 9.5, 3.5], size: [3, 0.5, 0.5], color: 'hatBrownDark' },
        ]),
      ],
    },
  ],
  trim: ['rust'],
  eyes: ['eyes'],
  stepSeconds: 0.85,
  muzzle: { part: 'bow', at: [-5, 9, 3.75], atLevel: { 3: [-8, 9.25, 3.75] } },
  clips: {
    idle: zombieIdle(['feather']),
    shoot: bowDraw(),
    melee: zombieBite(),
  },
});
