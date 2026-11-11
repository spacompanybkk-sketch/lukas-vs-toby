import { zombieBite, zombieIdle } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, facePlate, mirrorZ, zombieEyes } from './biped';

// Hot Topic, the snowball. Faces −X. A round, greedy zombie, mostly belly and mouth: the
// jaw hangs open on a hinge to show big square teeth top and bottom, a pink tongue and a
// dark gullet; little beady eyes (one bigger); a napkin tucked in under its chin, its knot
// sticking up behind like two ears; a too-small striped shirt; stubby arms and legs. It
// grows when it eats, so everything is chunky enough to hold up at 1.5 times the size. Its
// trim is its teeth.
//
//   2  a fork and a knife held up, ready to eat
//   3  a saucepan for a helmet, its handle sticking out behind; iron teeth, fork and knife
//   4  a tall crystal chef's hat; crystal teeth, fork and knife, glowing
//   5  a gold chef's hat with warm jewels; gold teeth, fork and knife; eyes alight

/** The cutlery in a level's material: grey plastic at 2, iron, crystal, gold. */
const cutlery = (boxes: Box[]): Box[] => [
  ...atLevels(2, 2, boxes),
  ...atLevels(3, 3, boxes.map((box) => ({ ...box, color: 'levelIron' }))),
  ...atLevels(4, 4, boxes.map((box) => ({ ...box, color: 'levelCrystal' }))),
  ...atLevels(5, 5, boxes.map((box) => ({ ...box, color: 'levelGold' }))),
];

const head: Box[] = [
  // A broad round head, the top of a ball the belly is the bottom of.
  { at: [-3.5, 8.5, -3], size: [6, 5.5, 6], color: 'skin' },
  { at: [-3, 8.5, -3.5], size: [5, 5.5, 7], color: 'skin' },
  { at: [-3, 14, -3], size: [5, 0.5, 6], color: 'skin' },
  // The upper half of the mouth: a dark roof and a row of big square teeth.
  { at: [-3.5, 8.5, -2.5], size: [0.5, 2, 5], color: 'mouthDark' },
  { at: [-4, 9.5, -2.5], size: [0.5, 1, 1.5], color: 'tooth' },
  { at: [-4, 9.5, -0.5], size: [0.5, 1, 1.5], color: 'tooth' },
  { at: [-4, 9.5, 1.5], size: [0.5, 1, 1.5], color: 'tooth' },
  // A pale plate behind the eyes.
  facePlate(-3.5, 10.5, 14, -3, 3, 'skinLight'),
  // Rosy cheeks.
  { at: [-3.5, 11, 2.5], size: [0.5, 1, 0.5], color: 'brainPink' },
  // Hot-headed: a tuft of flame-red hair, flickering higher from level 2 (hats from 3).
  ...atLevels(1, 2, [
    { at: [-2, 14.5, -1.5], size: [3, 1, 3], color: 'speedRed' },
    { at: [-1.5, 15.5, -1], size: [1, 0.5, 1], color: 'fire' },
    { at: [0, 15.5, 0], size: [1, 0.5, 1], color: 'fire' },
  ]),
  ...atLevels(2, 2, [
    { at: [-1.5, 16, -1], size: [1, 1.5, 1], color: 'fire' },
    { at: [0, 16, 0], size: [1, 2.5, 1], color: 'fire' },
    { at: [0, 18.5, 0], size: [1, 1, 1], color: 'fireLight' },
    { at: [1, 15.5, -1.5], size: [1, 1.5, 1], color: 'speedRed' },
  ]),
  // Level 3: a saucepan worn as a helmet, the handle out behind.
  ...atLevels(3, 3, [
    { at: [-4, 14, -3.5], size: [7, 0.5, 7], color: 'levelIronDark' },
    { at: [-3.5, 14.5, -3], size: [6, 2, 6], color: 'levelIron' },
    { at: [2.5, 15.5, -0.5], size: [3, 0.5, 1], color: 'levelIronDark' },
  ]),
  // Levels 4 and 5: a tall chef's hat, a band and a puffed top.
  ...atLevels(4, 4, [
    { at: [-3.5, 14, -3], size: [6, 1.5, 6], color: 'levelCrystalDeep' },
    { at: [-3, 15.5, -2.5], size: [5, 2, 5], color: 'levelCrystal' },
    { at: [-3.5, 17.5, -3], size: [6, 1.5, 6], color: 'levelCrystal' },
    { at: [-2.5, 19, -2], size: [4, 0.5, 4], color: 'levelCrystal' },
  ]),
  ...atLevels(5, 5, [
    { at: [-3.5, 14, -3], size: [6, 1.5, 6], color: 'levelGoldDark' },
    { at: [-3, 15.5, -2.5], size: [5, 2, 5], color: 'levelGold' },
    { at: [-3.5, 17.5, -3], size: [6, 1.5, 6], color: 'levelGold' },
    { at: [-2.5, 19, -2], size: [4, 0.5, 4], color: 'levelGold' },
    { at: [-4, 14.5, -0.5], size: [0.5, 1, 1], color: 'fireLight', emissive: 2 },
    { at: [-0.5, 14.5, 3], size: [1, 1, 0.5], color: 'fireLight', emissive: 2 },
  ]),
];

const torso: Box[] = [
  // A big round belly, wider than the head, in a striped shirt too small for it: the bottom
  // row is bare green skin.
  { at: [-3.5, 3, -4], size: [7, 5, 8], color: 'clothPurple' },
  { at: [-3, 3, -4.5], size: [6, 5, 9], color: 'clothPurple' },
  { at: [-3, 2.5, -3.5], size: [6, 0.5, 7], color: 'skinDark' },
  { at: [-3, 8, -3.5], size: [6, 0.5, 7], color: 'clothDark' },
  { at: [-3.5, 3, -4], size: [7, 0.5, 8], color: 'skin' },
  { at: [-3, 3, -4.5], size: [6, 0.5, 9], color: 'skin' },
  { at: [-3.5, 5, -4], size: [7, 0.5, 8], color: 'clothDark' },
  { at: [-3, 5, -4.5], size: [6, 0.5, 9], color: 'clothDark' },
  { at: [-3.5, 6.5, -4], size: [7, 0.5, 8], color: 'clothDark' },
  { at: [-3, 6.5, -4.5], size: [6, 0.5, 9], color: 'clothDark' },
  // The napkin tucked in under the chin, checked purple, and its knot sticking up behind.
  { at: [-4, 4.5, -2.5], size: [0.5, 3.5, 5], color: 'bone' },
  { at: [-4, 5.5, -1.5], size: [0.5, 1, 1], color: 'clothPurple' },
  { at: [-4, 5.5, 0.5], size: [0.5, 1, 1], color: 'clothPurple' },
  { at: [-4, 6.5, -0.5], size: [0.5, 1, 1], color: 'clothPurple' },
  { at: [2.5, 8, -0.5], size: [1, 1, 1], color: 'bone' },
  { at: [3, 9, 0.5], size: [1, 2, 1], color: 'bone' },
  { at: [3, 9, -1.5], size: [1, 2, 1], color: 'bone' },
];

// Stubby arms reaching out of the front of the belly.
const armL: Box[] = [
  { at: [-4.5, 5.5, 2.5], size: [1, 1, 1.5], color: 'skin' },
  { at: [-5.5, 5, 2.5], size: [1, 2, 1.5], color: 'skin' },
];

const legL: Box[] = [
  { at: [-1, 1, 1], size: [2, 1, 2], color: 'trouser' },
  { at: [-2, 0, 1], size: [3, 1, 2], color: 'hatBrownDark' },
];

export const hotTopic = bipedModel({
  key: 'hotTopic',
  skin: 'skin',
  cloth: 'clothPurple',
  clothDark: 'trouser',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [{ at: [-2, 2, -2.5], size: [4, 1, 5], color: 'trouser' }],
  joints: { torso: [0, 3, 0], head: [-0.5, 8.5, 0], armL: [-3.5, 6, 3.25], armR: [-3.5, 6, -3.25], legL: [0, 2, 2], legR: [0, 2, -2] },
  // A ball can only lean so far: half the usual slouch.
  slouch: 5,
  walk: { legs: 30, arms: 20, bob: 1.5, roll: 7 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-3.75, 12.5, 0],
      boxes: zombieEyes({ face: -3.5, y: 11, near: [2.5, 3], far: [2, 2], farLift: 0.75, light: { color: 'fireLight', emissive: 3, minLevel: 5 } }),
    },
    {
      // The lower jaw, hinged at the back of the mouth and hanging open at rest.
      name: 'jaw',
      parent: 'head',
      pivot: [1, 8.5, 0],
      rot: [0, 0, 18],
      boxes: [
        { at: [-4, 7, -2.5], size: [5.5, 1.5, 5], color: 'skin' },
        { at: [-4, 6.5, -2], size: [5, 0.5, 4], color: 'skinDark' },
        { at: [-3.5, 8.5, -2], size: [3.5, 0.5, 4], color: 'mouthDark' },
        { at: [-3, 8.5, -1.5], size: [2.5, 0.5, 2.5], color: 'brainPink' },
        { at: [-4.5, 8, -2], size: [0.5, 1.5, 1.5], color: 'tooth' },
        { at: [-4.5, 8, 0.5], size: [0.5, 1.5, 1.5], color: 'tooth' },
      ],
    },
    {
      // Level 2 up: a fork held up in the left hand.
      name: 'fork',
      parent: 'armL',
      pivot: [-4.25, 6, 4.75],
      rot: [0, 0, -10],
      boxes: cutlery([
        { at: [-5.5, 6.5, 4], size: [1, 5, 1], color: 'armour' },
        { at: [-6.5, 11.5, 4], size: [3, 1, 1], color: 'armour' },
        { at: [-6.5, 12.5, 4], size: [1, 2, 1], color: 'armour' },
        { at: [-4.5, 12.5, 4], size: [1, 2, 1], color: 'armour' },
      ]),
    },
    {
      // … and a knife in the right.
      name: 'knife',
      parent: 'armR',
      pivot: [-4.25, 6, -4.75],
      rot: [0, 0, -10],
      boxes: cutlery([
        { at: [-5.5, 6.5, -5], size: [1, 2, 1], color: 'armourDark' },
        { at: [-6, 8.5, -5], size: [1.5, 4, 1], color: 'armour' },
        { at: [-5.5, 12.5, -5], size: [1, 0.5, 1], color: 'armour' },
      ]),
    },
  ],
  trim: ['tooth'],
  eyes: ['eyes'],
  stepSeconds: 0.6,
  clips: {
    idle: zombieIdle(['jaw']),
    // Fast bites: the jaw snaps shut on the strike.
    melee: zombieBite({ jaw: 'jaw', duration: 0.3 }),
  },
});
