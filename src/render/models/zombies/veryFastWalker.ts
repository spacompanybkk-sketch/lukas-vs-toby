import { zombieBite, zombieWalk } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, facePlate, mirrorZ, zombieEyes } from './biped';

// Very Fast Walker, the rush. Faces −X. Skinny and long-legged, leaning 25° into a sprint
// with its arms bent and pumping, a red-flushed face, a red sweatband whose tails stream out
// behind, and its tongue flapping out of the side of its mouth. Purple running vest, red
// shorts, white trainers. Its trim is the grey cleats on its shoes.
//
//   2  spiked running shoes, a longer pair of sweatband tails and a racing number on its back
//   3  a chrome visor across its eyes; iron cleats
//   4  crystal lightning fins on its head and back
//   5  gold visor, cleats and fins, and a glowing gold speed trail streaming out behind it

// The head is modelled further back than it is drawn: the 25° lean carries it forward over
// the chest, and a little past it, so that it juts ahead of its feet. Its face is the −X
// side, at x = −3.
const head: Box[] = [
  { at: [-3, 9, -2.5], size: [6, 5, 5], color: 'skinFlush' },
  { at: [-2.5, 9, -3], size: [5, 5, 6], color: 'skinFlush' },
  { at: [-2.5, 8.5, -2.5], size: [5, 0.5, 5], color: 'skinFlushDark' },
  { at: [-2.5, 14, -2.5], size: [5, 0.5, 5], color: 'skinFlush' },
  // A pale plate behind the eyes, under the band.
  facePlate(-3, 10, 12.5, -2.5, 2.5, 'skinFlushLight'),
  // Red cheeks, a mouth open as it pants, and its tongue flapping out of the camera's side.
  { at: [-3.5, 9.5, -2.5], size: [0.5, 1, 1.5], color: 'speedRed' },
  { at: [-3, 9, -1.5], size: [0.5, 1.5, 2.5], color: 'mouthDark' },
  { at: [-3.5, 10, -1], size: [0.5, 0.5, 1], color: 'tooth' },
  { at: [-3.5, 9, 0.5], size: [1, 1, 3], color: 'brainPink' },
  { at: [-2.5, 8.5, 3], size: [1.5, 1, 1], color: 'brainPink' },
  // The sweatband round the forehead, a voxel proud.
  { at: [-3.5, 12.5, -3], size: [6.5, 1, 6.5], color: 'speedRed' },
  // A spiky quiff over the band.
  { at: [-2, 14.5, -1], size: [2, 0.5, 2], color: 'trouserDark' },
  { at: [-0.5, 14.5, -1.5], size: [1.5, 0.5, 1.5], color: 'trouserDark' },

  // Level 3 up: a chrome visor right across the eyes, sticking out in front.
  ...atLevels(3, 5, [
    { at: [-4.5, 11, -3], size: [1, 1.5, 7], color: 'iron' },
    { at: [-3.5, 11, 3.5], size: [2.5, 1.5, 0.5], color: 'iron' },
  ]),
  // Level 4 up: a crystal lightning bolt up the middle of the head, zigzagging back.
  ...atLevels(4, 5, [
    { at: [-1.5, 14.5, -0.5], size: [2, 1.5, 1], color: 'iron' },
    { at: [-0.5, 16, -0.5], size: [2.5, 1, 1], color: 'iron' },
    { at: [-1, 17, -0.5], size: [2, 1, 1], color: 'iron' },
    { at: [0, 18, -0.5], size: [1.5, 1, 1], color: 'iron' },
    { at: [1.5, 15, -0.5], size: [1.5, 1, 1], color: 'iron' },
    { at: [2.5, 16, -0.5], size: [1, 1, 1], color: 'iron' },
  ]),
];

const torso: Box[] = [
  { at: [-1.5, 6, -2.25], size: [3, 3.5, 4.5], color: 'clothPurple' },
  // A red stripe down the camera's side, and the neck.
  { at: [-0.5, 6, 1.75], size: [1, 3.5, 0.5], color: 'speedRed' },
  { at: [-0.5, 9.5, -1], size: [1.5, 0.5, 2], color: 'skinFlushDark' },
  // Level 2 up: a racing number on its back, which the lean shows to the sky.
  ...atLevels(2, 5, [
    { at: [1.5, 6.5, -1.5], size: [0.5, 2.5, 3], color: 'bone' },
    { at: [1.5, 7, -0.5], size: [0.5, 1.5, 0.5], color: 'clothDark' },
  ]),
  // Level 4 up: crystal fins jutting from its shoulder blades.
  ...atLevels(4, 5, [
    { at: [1.5, 8, 1], size: [1, 1, 1], color: 'iron' },
    { at: [2.5, 8.5, 1], size: [1, 1.5, 1], color: 'iron' },
    { at: [1.5, 8, -2], size: [1, 1, 1], color: 'iron' },
    { at: [2.5, 8.5, -2], size: [1, 1.5, 1], color: 'iron' },
  ]),
];

// Bent at the elbow: an upper arm hanging from the shoulder, a forearm reaching forward, a fist.
const armL: Box[] = [
  { at: [-0.5, 7, 2.5], size: [1.5, 2.5, 1.5], color: 'skinFlush' },
  { at: [-2.5, 7, 2.5], size: [2, 1.5, 1.5], color: 'skinFlush' },
  { at: [-3.5, 6.5, 2.5], size: [1.5, 2, 1.5], color: 'skinFlushDark' },
  { at: [-2.5, 7, 2.5], size: [1, 1.5, 1.5], color: 'speedRed' },
];

const legL: Box[] = [
  { at: [-1, 4, 0.25], size: [2, 1.5, 1.75], color: 'speedRed' },
  { at: [-0.5, 1.5, 0.5], size: [1, 2.5, 1.5], color: 'skinFlush' },
  // A white trainer with a red flash.
  { at: [-2, 0, 0.25], size: [3, 1.5, 2], color: 'bone' },
  { at: [-1.5, 0.5, 1.75], size: [2, 0.5, 0.5], color: 'speedRed' },
  // Level 2 up: a bigger running shoe with cleats under the toe and a spike at the heel.
  ...atLevels(2, 5, [
    { at: [-2.5, 0.5, 0.25], size: [1, 1, 2], color: 'bone' },
    { at: [-2.5, 0, 0.5], size: [0.5, 0.5, 1.5], color: 'iron' },
    { at: [-1.5, 0, 0.5], size: [0.5, 0.5, 1.5], color: 'iron' },
    { at: [1, 0, 0.75], size: [1, 0.5, 1], color: 'iron' },
  ]),
];

export const veryFastWalker = bipedModel({
  key: 'veryFastWalker',
  skin: 'skinFlush',
  cloth: 'speedRed',
  clothDark: 'speedRed',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [{ at: [-1.25, 5, -1.75], size: [2.5, 1.5, 3.5], color: 'speedRed' }],
  slouch: 25,
  joints: {
    torso: [0, 6, 0],
    head: [0, 8.5, 0],
    armL: [0.25, 9, 3.25],
    armR: [0.25, 9, -3.25],
    legL: [0, 5.5, 1.25],
    legR: [0, 5.5, -1.25],
  },
  // The arms hang straight down in spite of the lean, then pump.
  rots: { armL: [0, 0, -25], armR: [0, 0, -25] },
  walk: { legs: 40, arms: 45, bob: 1.5 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-3.25, 11, 0],
      // The near eye big and goggling, the far one squinting small.
      boxes: zombieEyes({ face: -3, y: 10, near: [2.5, 2.5], far: [2, 1.5], farLift: 0.5 }),
    },
    {
      // The sweatband's tails, streaming back off the knot behind the head.
      name: 'band',
      parent: 'head',
      pivot: [3, 13, 0],
      boxes: [
        { at: [3, 12.5, -1], size: [1, 1.5, 2], color: 'speedRed' },
        { at: [4, 12, 0.5], size: [1, 1, 1], color: 'speedRed', maxLevel: 1 },
        { at: [4, 12.5, -1.5], size: [1, 1, 1], color: 'speedRed', maxLevel: 1 },
        { at: [4, 12, 0.5], size: [4, 1, 1], color: 'speedRed', minLevel: 2 },
        { at: [4, 12.5, -1.5], size: [3.5, 1, 1], color: 'speedRed', minLevel: 2 },
        { at: [8, 11.5, 0.5], size: [1, 1, 1], color: 'speedRed', minLevel: 2 },
      ],
    },
    {
      // Level 5: a glowing gold trail streaming out behind it, in three ribbons.
      name: 'trail',
      parent: 'root',
      pivot: [3, 9, 0],
      boxes: atLevels(5, 5, [
        { at: [3, 12, -0.5], size: [4, 1, 1], color: 'levelGold', emissive: 1.6 },
        { at: [7, 12, -0.5], size: [2, 1, 1], color: 'fireLight', emissive: 1.6 },
        { at: [2.5, 9.5, 1.5], size: [3.5, 1, 1], color: 'levelGold', emissive: 1.6 },
        { at: [6, 9.5, 1.5], size: [2, 1, 1], color: 'fireLight', emissive: 1.6 },
        { at: [2.5, 7, -2.5], size: [3, 1, 1], color: 'levelGold', emissive: 1.6 },
        { at: [5.5, 7, -2.5], size: [2, 1, 1], color: 'fireLight', emissive: 1.6 },
        { at: [2, 4.5, 0.5], size: [2.5, 1, 1], color: 'levelGold', emissive: 1.6 },
        { at: [4.5, 4.5, 0.5], size: [1.5, 1, 1], color: 'fireLight', emissive: 1.6 },
      ]),
    },
  ],
  trim: ['iron'],
  eyes: ['eyes'],
  stepSeconds: 0.45,
  clips: {
    // Even standing still it jogs on the spot, three steps to the idle's 1.6 s.
    idle: zombieWalk(1.6, { cycles: 3, legs: 18, arms: 35, bob: 1, roll: 2 }),
    melee: zombieBite(),
  },
});
