import { lassoThrow, pistolPop, zombieBite, zombieIdle } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, facePlate, mirrorZ, zombieEyes } from './biped';

// Cowboy Zombie, the disabler. Faces −X. A wide-brimmed cowboy hat, a red bandana, a brown
// vest over a purple shirt, a belt with a buckle, jeans and heeled boots; a coil of lasso
// on its left hip, on the camera's side, and a toy pistol with an orange tip held up in its
// right hand. Its trim is the buckle, the pistol's barrel, the sheriff's star and spurs.
//
//   2  a bigger hat with a taller crown, and a sheriff's star on the hat and the vest
//   3  iron star, buckle, barrel, studs round the hat band, and spurs
//   4  a glowing crystal lasso; crystal star and barrel
//   5  a gold lasso, star, buckle and barrel; a gold hat band and brim edge

/** The lasso's rope, by level: rope, then crystal at 4 and gold at 5. */
const rope = (boxes: Box[]): Box[] => [
  ...atLevels(1, 3, boxes),
  ...atLevels(4, 4, boxes.map((box) => ({ ...box, color: 'levelCrystal' }))),
  ...atLevels(5, 5, boxes.map((box) => ({ ...box, color: 'levelGold' }))),
];

const head: Box[] = [
  { at: [-4.5, 8.5, -2.5], size: [6, 5, 5], color: 'skin' },
  { at: [-4, 8.5, -3], size: [5, 5, 6], color: 'skin' },
  { at: [-4, 8, -2.5], size: [5, 0.5, 5], color: 'skinDark' },
  // A pale plate behind the eyes, in the brim's shade.
  facePlate(-4.5, 10, 13.5, -2.5, 2.5, 'skinLight'),
  // A lopsided grin with one tooth, and stubble.
  { at: [-4.5, 9, -2], size: [0.5, 1, 3], color: 'mouthDark' },
  { at: [-5, 9.5, -0.5], size: [0.5, 0.5, 1], color: 'tooth' },
  { at: [-4.5, 8.5, -2.5], size: [0.5, 0.5, 5], color: 'skinDark' },

  // Level 1: the hat, a brim curled up at the sides and a creased crown with a dark band.
  ...atLevels(1, 1, [
    { at: [-5, 13.5, -3], size: [6.5, 0.5, 6.5], color: 'hatBrown' },
    { at: [-5, 14, 3], size: [6.5, 0.5, 0.5], color: 'hatBrown' },
    { at: [-5, 14, -3], size: [6.5, 0.5, 0.5], color: 'hatBrown' },
    { at: [-3.5, 14, -2], size: [4, 1.5, 4.5], color: 'hatBrown' },
    { at: [-3.5, 14, -2], size: [4, 0.5, 4.5], color: 'hatBrownDark' },
  ]),
  // Level 2 up: a bigger hat, the brim wider and the crown taller, with a star in front.
  ...atLevels(2, 5, [
    { at: [-6, 13.5, -4.5], size: [9, 0.5, 9], color: 'hatBrown' },
    { at: [-6, 14, 4], size: [9, 1, 0.5], color: 'hatBrown' },
    { at: [-6, 14, -4.5], size: [9, 1, 0.5], color: 'hatBrown' },
    { at: [-3.5, 14, -3], size: [5, 3, 6], color: 'hatBrown' },
    { at: [-3.5, 14, -3], size: [5, 0.5, 6], color: 'hatBrownDark' },
    { at: [-2.5, 17, -1.5], size: [3, 0.5, 3], color: 'hatBrownDark' },
    { at: [-4, 15, -1], size: [0.5, 1.5, 2], color: 'iron' },
    { at: [-4, 15.5, -1.5], size: [0.5, 0.5, 3], color: 'iron' },
  ]),
  // Level 5: a gold band round the hat and a gold edge to the brim.
  ...atLevels(5, 5, [
    { at: [-3.5, 14, -3], size: [5, 0.5, 6], color: 'levelGold' },
    { at: [-6, 13.5, -4.5], size: [0.5, 0.5, 9], color: 'levelGold' },
    { at: [2.5, 13.5, -4.5], size: [0.5, 0.5, 9], color: 'levelGold' },
  ]),
  // Level 3 up: studs round the hat band.
  ...atLevels(3, 5, [
    { at: [-1.5, 14, 3], size: [1, 0.5, 0.5], color: 'iron' },
    { at: [0.5, 14, 3], size: [1, 0.5, 0.5], color: 'iron' },
    { at: [1.5, 14, -1.5], size: [0.5, 0.5, 1], color: 'iron' },
  ]),
];

const torso: Box[] = [
  { at: [-2, 5, -3], size: [4, 3.5, 6], color: 'clothPurple' },
  // The vest: the back and sides, and two front panels left open over the shirt.
  { at: [-1, 5, -3], size: [3, 3.5, 6], color: 'hatBrownDark' },
  { at: [-2, 5, -3], size: [0.5, 3.5, 1.5], color: 'hatBrownDark' },
  { at: [-2, 5, 1.5], size: [0.5, 3.5, 1.5], color: 'hatBrownDark' },
  // The bandana round the neck, its point hanging down the chest.
  { at: [-2.5, 7, -2], size: [0.5, 1.5, 4], color: 'speedRed' },
  { at: [-2.5, 6.5, -1], size: [0.5, 0.5, 2], color: 'speedRed' },
  { at: [-2, 8, -2.5], size: [3, 0.5, 5], color: 'speedRed' },
  // Level 2 up: a sheriff's star on the vest, on the camera's side.
  ...atLevels(2, 5, [
    { at: [-2.5, 6, 1.5], size: [0.5, 1.5, 1.5], color: 'iron' },
  ]),
];

const armL: Box[] = [
  { at: [-2, 6.5, 3], size: [2.5, 2, 2], color: 'clothPurple' },
  { at: [-3.5, 7, 3.5], size: [1.5, 1, 1], color: 'skin' },
  { at: [-5, 6.5, 3], size: [1.5, 2, 2], color: 'skin' },
];

const legL: Box[] = [
  { at: [-1, 2, 0.5], size: [2, 2, 2], color: 'trouser' },
  { at: [-1, 1.5, 0.5], size: [2, 0.5, 2], color: 'hatBrownDark' },
  // A heeled boot with a pointed toe.
  { at: [-2, 0.5, 0.5], size: [3, 1, 2], color: 'hatBrownDark' },
  { at: [-3, 0.5, 1], size: [1, 0.5, 1], color: 'hatBrownDark' },
  { at: [0, 0, 0.75], size: [1, 0.5, 1.5], color: 'hatBrownDark' },
  { at: [-2, 0, 0.75], size: [1.5, 0.5, 1.5], color: 'hatBrownDark' },
  // Level 3 up: a spur.
  { at: [1, 0.5, 1.25], size: [1, 0.5, 0.5], color: 'iron', minLevel: 3 },
];

export const cowboyZombie = bipedModel({
  key: 'cowboyZombie',
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
    { at: [-1.5, 4.5, -2.25], size: [3, 0.5, 4.5], color: 'hatBrownDark' },
    { at: [-2, 4, -0.75], size: [0.5, 1, 1.5], color: 'iron' },
  ],
  joints: { torso: [0, 5, 0], head: [-1.5, 8.5, 0], armL: [-0.5, 7.5, 4], armR: [-0.5, 7.5, -4], legL: [0, 4, 1.5], legR: [0, 4, -1.5] },
  walk: { legs: 24, arms: 12, bob: 1, roll: 5 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-4.75, 11.25, 0],
      // A big wide eye and a squinting one, under the brim.
      boxes: zombieEyes({ face: -4.5, y: 10, near: [2.5, 3], far: [2, 1.5], farLift: 1 }),
    },
    {
      // A coil of rope on the left hip, facing the camera: two loops.
      name: 'lasso',
      parent: 'root',
      pivot: [0, 4.5, 3],
      boxes: rope([
        // The outer loop, its corners stepped off so it reads round …
        { at: [-1, 5, 2.5], size: [2, 0.5, 1], color: 'sandDark' },
        { at: [-1, 1.5, 2.5], size: [2, 0.5, 1], color: 'sandDark' },
        { at: [-2, 2.5, 2.5], size: [0.5, 2, 1], color: 'sandDark' },
        { at: [1.5, 2.5, 2.5], size: [0.5, 2, 1], color: 'sandDark' },
        { at: [-1.5, 4.5, 2.5], size: [0.5, 0.5, 1], color: 'sandDark' },
        { at: [1, 4.5, 2.5], size: [0.5, 0.5, 1], color: 'sandDark' },
        { at: [-1.5, 2, 2.5], size: [0.5, 0.5, 1], color: 'sandDark' },
        { at: [1, 2, 2.5], size: [0.5, 0.5, 1], color: 'sandDark' },
        // … a second loop inside it, and the loose end hanging down.
        { at: [-0.5, 4, 3], size: [1.5, 0.5, 0.5], color: 'sand' },
        { at: [-0.5, 2, 3], size: [1.5, 0.5, 0.5], color: 'sand' },
        { at: [-1, 2.5, 3], size: [0.5, 1.5, 0.5], color: 'sand' },
        { at: [1, 2.5, 3], size: [0.5, 1.5, 0.5], color: 'sand' },
        { at: [1.5, 0.5, 2.5], size: [0.5, 1.5, 1], color: 'sandDark' },
      ]),
    },
    {
      // A toy pistol held up in the right hand, its barrel to the sky and an orange tip on it.
      name: 'pistol',
      parent: 'armR',
      pivot: [-4.25, 8.5, -4],
      rot: [0, 0, -10],
      boxes: [
        { at: [-5, 8.5, -4.5], size: [2, 1.5, 1], color: 'armour' },
        { at: [-5, 10, -4.5], size: [1, 2.5, 1], color: 'iron' },
        { at: [-5, 12.5, -4.5], size: [1, 0.5, 1], color: 'fire' },
        { at: [-3.5, 9, -4.5], size: [0.5, 1, 1], color: 'armourDark' },
      ],
    },
  ],
  trim: ['iron'],
  eyes: ['eyes'],
  stepSeconds: 0.65,
  muzzle: { part: 'pistol', at: [-4.5, 13, -4] },
  sway: [],
  clips: {
    idle: zombieIdle(['pistol']),
    shoot: pistolPop(),
    melee: zombieBite(),
    // The lasso throw, with the left arm.
    ability: lassoThrow({ arm: 'armL' }),
  },
});
