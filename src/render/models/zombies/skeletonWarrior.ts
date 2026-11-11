import { shieldRaise, zombieThrow } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, mirrorZ } from './biped';

// Skeleton Warrior, the tank. Faces −X. A bone skeleton in a grey breastplate and a purple
// sash, red lights glowing in its sockets (one bigger than the other), a sword held upright
// in its right hand and a round purple shield on its left arm, facing the lawn camera. Its
// trim is the sword's blade and the shield's rim.
//
//   2  a bigger sword with a wide crossguard; bone horns curling up off the skull
//   3  full iron plate: a horned helmet, pauldrons, greaves; a tall tower shield; iron blade
//   4  a glowing crystal blade and shield rim
//   5  the armour turns gold, gold blade and rim, and the sword's tip is on fire

/** Plate armour from level 3: iron at 3 and 4, gold at 5. */
const plate = (boxes: Box[]): Box[] => [
  ...atLevels(3, 4, boxes),
  ...atLevels(5, 5, boxes.map((box) => ({ ...box, color: box.color === 'levelIron' ? 'levelGold' : 'levelGoldDark' }))),
];

const head: Box[] = [
  // The skull: a rounded cranium and a narrower jaw below it.
  { at: [-4, 10, -2.5], size: [6, 4.5, 5], color: 'bone' },
  { at: [-3.5, 10, -3], size: [5, 4.5, 6], color: 'bone' },
  { at: [-3.5, 14.5, -2.5], size: [5, 1, 5], color: 'bone' },
  { at: [-4, 9, -2], size: [4.5, 1, 4], color: 'boneShadow' },
  // A nose hole, and a grin: a dark line with the teeth standing in it.
  { at: [-4, 11, -0.5], size: [0.5, 1, 1], color: 'socket' },
  { at: [-4, 10, -2], size: [0.5, 0.5, 4], color: 'socket' },
  { at: [-4.5, 9.5, -1.5], size: [0.5, 1, 1], color: 'tooth' },
  { at: [-4.5, 9.5, 0.5], size: [0.5, 1, 1], color: 'tooth' },
  // Level 2 up: horns curling up and out off both sides of the skull.
  ...atLevels(2, 5, [
    { at: [-1.5, 13, 3], size: [1.5, 1, 1], color: 'boneShadow' },
    { at: [-1.5, 14, 3.5], size: [1.5, 1.5, 1], color: 'bone' },
    { at: [-2, 15.5, 3.5], size: [1, 1.5, 1], color: 'bone' },
    { at: [-1.5, 13, -4], size: [1.5, 1, 1], color: 'boneShadow' },
    { at: [-1.5, 14, -4.5], size: [1.5, 1.5, 1], color: 'bone' },
    { at: [-2, 15.5, -4.5], size: [1, 1.5, 1], color: 'bone' },
  ]),
  // Level 3 up: a helmet with a crest, between the horns, and a nose guard.
  ...plate([
    { at: [-4.5, 13.5, -3], size: [7, 1, 6], color: 'levelIronDark' },
    { at: [-4, 14.5, -2.5], size: [6, 1.5, 5], color: 'levelIron' },
    { at: [-3, 16, -0.5], size: [5, 1, 1], color: 'levelIronDark' },
    { at: [-5, 11.5, -0.5], size: [0.5, 2, 1], color: 'levelIron' },
  ]),
];

const torso: Box[] = [
  { at: [-0.5, 5.5, -0.5], size: [1, 1, 1], color: 'boneShadow' },
  { at: [-2, 6.5, -2.5], size: [3.5, 3, 5], color: 'bone' },
  // The ribs show behind the breastplate, on the camera's side.
  { at: [-0.5, 7, 2], size: [1.5, 0.5, 0.5], color: 'socket' },
  { at: [-0.5, 8, 2], size: [1.5, 0.5, 0.5], color: 'socket' },
  // A collarbone from shoulder to shoulder.
  { at: [-1, 9.5, -2.5], size: [2, 0.5, 5], color: 'bone' },
  // Levels 1 and 2: a plain grey breastplate.
  ...atLevels(1, 2, [{ at: [-2.5, 6.5, -2.75], size: [2, 3, 5.5], color: 'armour' }]),
  // Level 3 up: a full plate, higher and wider, with a ridge down the middle.
  ...plate([
    { at: [-2.5, 6, -3], size: [2.5, 3.5, 6], color: 'levelIron' },
    { at: [-3, 7, -0.5], size: [0.5, 2, 1], color: 'levelIronDark' },
  ]),
];

const armL: Box[] = [
  { at: [-1, 8, 3], size: [1.5, 2, 1.5], color: 'bone' },
  { at: [-2.5, 8.5, 3.5], size: [2, 1, 1], color: 'bone' },
  { at: [-3, 8, 3], size: [1, 2, 1.5], color: 'boneShadow' },
  { at: [-4.5, 8.5, 3.5], size: [1.5, 1, 1], color: 'bone' },
  { at: [-5, 8, 3], size: [1, 2, 1.5], color: 'bone' },
  // Level 3 up: a pauldron, two layers, standing up off the shoulder.
  ...plate([
    { at: [-1.5, 10, 2.5], size: [3, 1, 2.5], color: 'levelIron' },
    { at: [-1, 11, 3], size: [2, 0.5, 2], color: 'levelIronDark' },
  ]),
];

const legL: Box[] = [
  { at: [-0.5, 2.5, 1], size: [1, 1.5, 1], color: 'bone' },
  { at: [-1, 1.5, 0.5], size: [2, 1, 2], color: 'boneShadow' },
  { at: [-0.5, 1, 1], size: [1, 0.5, 1], color: 'bone' },
  { at: [-2, 0, 0.5], size: [3, 1, 2], color: 'bone' },
  // Level 3 up: a greave over the shin and knee.
  ...plate([{ at: [-1.5, 0.5, 0.25], size: [1, 2.5, 2.5], color: 'levelIron' }]),
];

export const skeletonWarrior = bipedModel({
  key: 'skeletonWarrior',
  skin: 'bone',
  cloth: 'clothPurple',
  clothDark: 'clothDark',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [
    { at: [-1.5, 4, -2], size: [3, 1, 4], color: 'bone' },
    // A purple sash, and a flap hanging in front.
    { at: [-2, 5, -2.5], size: [4, 0.5, 5], color: 'clothPurple' },
    { at: [-2.5, 3, -1], size: [0.5, 2.5, 2], color: 'clothDark' },
  ],
  joints: { torso: [0, 5.5, 0], head: [-1, 9.5, 0], armL: [-0.5, 9, 3.75], armR: [-0.5, 9, -3.75], legL: [0, 4, 1.5], legR: [0, 4, -1.5] },
  walk: { legs: 20, arms: 10, bob: 1.2, roll: 5 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-4.25, 12, 0],
      boxes: [
        // Dark sockets, the big one wrapping round to the camera's side, each with a red light.
        { at: [-4.5, 10.5, 0.5], size: [0.5, 3, 2.5], color: 'socket' },
        { at: [-4, 10.5, 2.5], size: [1.5, 3, 1], color: 'socket' },
        { at: [-4.5, 11.5, 1], size: [0.5, 1, 1], color: 'eyeRed', emissive: 2.5 },
        { at: [-3.5, 11.5, 3], size: [1, 1, 0.5], color: 'eyeRed', emissive: 2.5 },
        { at: [-4.5, 11, -2.5], size: [0.5, 2, 2], color: 'socket' },
        { at: [-4.5, 11.5, -2], size: [0.5, 1, 1], color: 'eyeRed', emissive: 2.5 },
      ],
    },
    {
      // The shield on the left forearm, its face to the camera. Round at levels 1 and 2 (a
      // stepped disc with a rim), a tall tower shield from 3. A bone skull on its face.
      name: 'shield',
      parent: 'armL',
      pivot: [-2.5, 8.5, 4.5],
      boxes: [
        ...atLevels(1, 2, [
          { at: [-4.5, 6, 4.5], size: [4, 5, 0.5], color: 'iron' },
          { at: [-5, 6.5, 4.5], size: [5, 4, 0.5], color: 'iron' },
          { at: [-4.5, 6.5, 4.5], size: [4, 4, 0.5], color: 'clothPurple' },
          { at: [-3.5, 7.5, 4.5], size: [2, 2, 0.5], color: 'bone' },
          { at: [-3.5, 8.5, 4.5], size: [0.5, 0.5, 0.5], color: 'socket' },
          { at: [-2, 8.5, 4.5], size: [0.5, 0.5, 0.5], color: 'socket' },
        ]),
        ...atLevels(3, 5, [
          { at: [-5.5, 4, 4.5], size: [6, 9, 1], color: 'iron' },
          { at: [-5, 4.5, 5], size: [5, 8, 0.5], color: 'clothPurple' },
          { at: [-3.5, 8, 5], size: [2, 2, 0.5], color: 'bone' },
          { at: [-3.5, 9, 5], size: [0.5, 0.5, 0.5], color: 'socket' },
          { at: [-2, 9, 5], size: [0.5, 0.5, 0.5], color: 'socket' },
          { at: [-3, 5.5, 5], size: [1, 1.5, 0.5], color: 'clothDark' },
        ]),
      ],
    },
    {
      // The sword in the right fist, held upright: the slouch is turned back out of it.
      name: 'sword',
      parent: 'armR',
      pivot: [-4, 9, -3.75],
      rot: [0, 0, -10],
      boxes: [
        { at: [-4.5, 7, -4], size: [1, 1, 0.5], color: 'armourDark' },
        ...atLevels(1, 1, [
          { at: [-5, 10, -5], size: [2, 0.5, 1.5], color: 'armour' },
          { at: [-4.5, 10.5, -4], size: [1, 5, 0.5], color: 'iron' },
        ]),
        ...atLevels(2, 5, [
          { at: [-5.5, 10, -5], size: [3, 1, 2.5], color: 'armour' },
          { at: [-5, 11, -4], size: [2, 7, 0.5], color: 'iron' },
          { at: [-4.5, 18, -4], size: [1, 1, 0.5], color: 'iron' },
        ]),
        // Level 5: flames at the tip.
        ...atLevels(5, 5, [
          { at: [-5, 18.5, -4.5], size: [2, 1, 1], color: 'fire', emissive: 2 },
          { at: [-4.5, 19.5, -4.5], size: [1, 1.5, 1], color: 'fireLight', emissive: 2.5 },
          { at: [-3.5, 19, -4.5], size: [0.5, 1, 1], color: 'fire', emissive: 2 },
        ]),
      ],
    },
  ],
  trim: ['iron'],
  eyes: ['eyes'],
  stepSeconds: 0.9,
  clips: {
    // A chop with the sword, to the art bible's melee timing.
    melee: zombieThrow({ arm: 'armR', windUp: 0.15, snap: 0.08, settle: 0.25 }),
    // Raising the shield to block a shot.
    shoot: shieldRaise(),
  },
});
