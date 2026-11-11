import { zombieBite, zombieIdle, zombieThrow } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, facePlate, mirrorZ, zombieEyes } from './biped';

// Brain Eater, the basic zombie. Faces −X. Green skin, a torn purple shirt, slate trousers
// and old brown shoes; one big eye and one small, a tooth and a tongue; a pink brain held
// up in its right hand, which is what it throws (the view hides `brain` when it leaves and
// shows it again on the next idle). Its trim is the shoulder pads.
//
//   2  rusty shoulder pads with a stud, standing up off both shoulders; an arrow through the head
//   3  an iron spiked helmet; iron pads
//   4  a crystal skull cap with shards and a brain floating above it; crystal pads
//   5  a gold crown with points, a brain still floating over it, gold pads, eyes alight

const head: Box[] = [
  // A rounded block, darker underneath.
  { at: [-4.5, 8.5, -2.5], size: [6, 5.5, 5], color: 'skin' },
  { at: [-4, 8.5, -3], size: [5, 5.5, 6], color: 'skin' },
  { at: [-4, 8, -2.5], size: [5, 0.5, 5], color: 'skinDark' },
  { at: [-4, 14, -2.5], size: [5, 0.5, 5], color: 'skin' },
  // A pale plate behind the eyes, so they read as two eyes and not one dark band.
  facePlate(-4.5, 10, 13.5, -2.5, 2.5, 'skinLight'),
  // A wide crooked mouth, a tooth hanging from it, and a tongue lolling out over the chin.
  { at: [-4.5, 9, -2], size: [0.5, 1, 3.5], color: 'mouthDark' },
  { at: [-5, 9, -0.5], size: [0.5, 1, 1], color: 'tooth' },
  { at: [-5, 8, -1.5], size: [0.5, 1.5, 1.5], color: 'brainPink' },
  // A raised brow over the small eye, like it is puzzled; an ear on the camera's side.
  { at: [-5, 13, -2.5], size: [0.5, 0.5, 2], color: 'trouserDark' },
  { at: [-1.5, 10.5, 3], size: [1.5, 2, 0.5], color: 'skinDark' },
  // Three tufts of hair.
  { at: [-3, 14, -2.5], size: [4.5, 0.5, 4.5], color: 'trouserDark', maxLevel: 2 },
  { at: [-1.5, 14.5, -1], size: [1.5, 1, 1.5], color: 'trouserDark', maxLevel: 2 },
  { at: [-3, 14.5, 0.5], size: [1, 1, 1], color: 'trouserDark', maxLevel: 2 },
  { at: [0, 14.5, 1.5], size: [1, 0.5, 1], color: 'trouserDark', maxLevel: 2 },
  { at: [1.5, 13.5, -1], size: [0.5, 1, 1.5], color: 'trouserDark', maxLevel: 2 },

  // Level 2 up: an arrow clean through the head, sticking out both sides (a joke that the
  // lawn camera sees from above): the head on the far side, the purple flights near.
  ...atLevels(2, 5, [
    { at: [-1.5, 12.5, -4.5], size: [1, 1, 8.5], color: 'hatBrown' },
    { at: [-2, 12, -5.5], size: [2, 2, 1], color: 'iron' },
    { at: [-2.5, 12, 4], size: [3, 2, 0.5], color: 'clothPurple' },
  ]),

  // Level 3: an iron helmet with a brim and a spike.
  ...atLevels(3, 3, [
    { at: [-5, 13.5, -3], size: [7, 1, 6], color: 'levelIronDark' },
    { at: [-4.5, 14.5, -2.5], size: [6, 1, 5], color: 'levelIron' },
    { at: [-3.5, 15.5, -1.5], size: [4, 0.5, 3], color: 'levelIron' },
    { at: [-2, 16, -0.5], size: [1, 2.5, 1], color: 'levelIronDark' },
  ]),

  // Level 4: a crystal skull cap with shards standing up off it.
  ...atLevels(4, 4, [
    { at: [-5, 13.5, -3], size: [7, 1, 6], color: 'levelCrystalDeep' },
    { at: [-4.5, 14.5, -2.5], size: [6, 1, 5], color: 'levelCrystal' },
    { at: [-3.5, 15.5, -1], size: [1, 2, 1], color: 'levelCrystal' },
    { at: [-1, 15.5, 1], size: [1, 1.5, 1], color: 'levelCrystal' },
    { at: [-0.5, 15.5, -2], size: [1, 1, 1], color: 'levelCrystal' },
  ]),

  // Level 5: a gold crown, a band with a point at each corner and a tall one in front.
  ...atLevels(5, 5, [
    { at: [-5, 14, -3], size: [7, 1, 1], color: 'levelGold' },
    { at: [-5, 14, 2], size: [7, 1, 1], color: 'levelGold' },
    { at: [-5, 14, -2], size: [1, 1, 4], color: 'levelGold' },
    { at: [1, 14, -2], size: [1, 1, 4], color: 'levelGold' },
    { at: [-5, 15, -3], size: [1, 1.5, 1], color: 'levelGold' },
    { at: [-5, 15, 2], size: [1, 1.5, 1], color: 'levelGold' },
    { at: [1, 15, -3], size: [1, 1.5, 1], color: 'levelGold' },
    { at: [1, 15, 2], size: [1, 1.5, 1], color: 'levelGold' },
    { at: [-5, 15, -0.5], size: [1, 2, 1], color: 'levelGold' },
    { at: [-5.5, 14.5, -0.5], size: [0.5, 1, 1], color: 'brainPink', emissive: 1.6 },
    { at: [-4, 14.5, -2], size: [5, 0.5, 4], color: 'clothPurple' },
  ]),
];

const torso: Box[] = [
  { at: [-2, 5, -3], size: [4, 3.5, 6], color: 'clothPurple' },
  // Rips showing skin, on the front and the camera's side; a ragged hem; a dark collar.
  { at: [-2, 6, -1.5], size: [0.5, 1, 2], color: 'skin' },
  { at: [-1, 6, 2.5], size: [1.5, 1, 0.5], color: 'skinDark' },
  { at: [-2, 4.5, -2.5], size: [1, 0.5, 2], color: 'clothPurple' },
  { at: [-2, 4.5, 1], size: [1.5, 0.5, 1.5], color: 'clothDark' },
  { at: [-2, 8, -2.5], size: [0.5, 0.5, 5], color: 'clothDark' },
];

const armL: Box[] = [
  { at: [-2, 6.5, 3], size: [2.5, 2, 2], color: 'clothPurple' },
  { at: [-2.5, 6.5, 3], size: [0.5, 2, 2], color: 'clothDark' },
  { at: [-3.5, 7, 3.5], size: [1, 1, 1], color: 'skin' },
  { at: [-5, 6.5, 3], size: [1.5, 2, 2], color: 'skin' },
  { at: [-5, 6.5, 3], size: [1.5, 0.5, 2], color: 'skinDark' },
  // Level 2 up: a rusty shoulder pad with a stud on top.
  ...atLevels(2, 5, [
    { at: [-2, 8.5, 2.5], size: [3, 1, 3.5], color: 'rust' },
    { at: [-1.5, 9.5, 3], size: [2, 0.5, 2.5], color: 'rust' },
    { at: [-1, 10, 3.75], size: [1, 1, 1], color: 'iron' },
  ]),
];

const legL: Box[] = [
  { at: [-1, 1.5, 0.5], size: [2, 2.5, 2], color: 'trouser' },
  { at: [-1, 1.5, 0.5], size: [2, 0.5, 2], color: 'trouserDark' },
  { at: [-2.5, 0, 0.5], size: [3.5, 1.5, 2], color: 'hatBrownDark' },
];

export const brainEater = bipedModel({
  key: 'brainEater',
  skin: 'skin',
  cloth: 'clothPurple',
  clothDark: 'trouser',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [
    { at: [-1.5, 4, -2.25], size: [3, 1, 4.5], color: 'trouser' },
    { at: [-1.5, 5, -2.25], size: [3, 0.5, 4.5], color: 'trouserDark' },
  ],
  joints: { torso: [0, 5, 0], head: [-1.5, 8.5, 0], armL: [-0.5, 7.5, 4], armR: [-0.5, 7.5, -4], legL: [0, 4, 1.5], legR: [0, 4, -1.5] },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-4.75, 11.5, 0],
      // The big eye on the camera's side and the small one beyond, apart, each with a glint
      // at the top, sunward; alight at level 5.
      boxes: zombieEyes({ face: -4.5, y: 10, near: [2.5, 3], far: [2, 2], light: { color: 'fireLight', emissive: 3, minLevel: 5 } }),
    },
    {
      // The brain it throws, held up in the right hand.
      name: 'brain',
      parent: 'armR',
      pivot: [-4, 8.5, -4],
      boxes: [
        { at: [-5, 8.5, -5], size: [2.5, 2, 2.5], color: 'brainPink' },
        { at: [-4.5, 10.5, -4.5], size: [1.5, 0.5, 1.5], color: 'brainPink' },
        { at: [-5, 9.5, -4], size: [2.5, 1, 0.5], color: 'brainDark' },
      ],
    },
    {
      // Levels 4 and 5: a brain floating over the head, bobbing on its own.
      name: 'floatBrain',
      parent: 'head',
      pivot: [-1, 18.5, 0],
      boxes: atLevels(4, 5, [
        { at: [-2.5, 17.5, -1.5], size: [3, 2, 3], color: 'brainPink' },
        { at: [-2, 19.5, -1], size: [2, 0.5, 2], color: 'brainPink' },
        { at: [-2.5, 18.5, -0.25], size: [3, 1, 0.5], color: 'brainDark' },
      ]),
    },
  ],
  trim: ['rust'],
  eyes: ['eyes'],
  stepSeconds: 0.8,
  muzzle: { part: 'brain', at: [-3.75, 9.5, -3.75] },
  clips: {
    idle: zombieIdle(['brain', 'floatBrain']),
    melee: zombieBite(),
    shoot: zombieThrow(),
  },
});
