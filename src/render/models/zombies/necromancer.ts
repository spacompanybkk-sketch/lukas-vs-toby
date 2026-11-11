import { staffRaise, zombieBite, zombieIdle } from '../../voxel/clips';
import type { Box } from '../../voxel/types';
import { atLevels, bipedModel, facePlate, mirrorZ, zombieEyes } from './biped';

// Necromancer, the support. Faces −X. A short wizard in a dark purple robe down to its
// boots, a hood that rises to a crooked point, a long white beard and bushy brows, and a
// staff in its right hand, standing up over its head, topped with a glowing purple gem. It shuffles.
// Its trim is the pale purple edging of the robe and hood.
//
//   2  a bigger staff head: ram's horns curling round a bigger gem
//   3  a little skull floating by its shoulder, eyes aglow; iron edging
//   4  a big glowing crystal orb on the staff; crystal edging
//   5  gold edging and gold horns round the orb

const head: Box[] = [
  // The face, peeking out of the hood.
  { at: [-3.5, 8, -2], size: [4.5, 4, 4], color: 'skin' },
  { at: [-3.5, 8.5, -2], size: [0.5, 0.5, 4], color: 'skinDark' },
  // A pale plate behind the eyes, lit against the hood's shadow.
  facePlate(-3.5, 9, 11.5, -2, 2, 'skinLight'),
  // Bushy white brows, the near one raised.
  { at: [-4, 11.5, 0], size: [0.5, 0.5, 2], color: 'bone' },
  { at: [-4, 11, -2], size: [0.5, 0.5, 1.5], color: 'bone' },
  // The hood round it, its edging, and the crooked point.
  { at: [-3, 8, -3], size: [5, 5, 6], color: 'robePurple' },
  { at: [-3.5, 12, -3], size: [0.5, 1, 6], color: 'robeTrim' },
  { at: [-3.5, 8, 2], size: [0.5, 4, 1], color: 'robeTrim' },
  { at: [-3.5, 8, -3], size: [0.5, 4, 1], color: 'robeTrim' },
  { at: [-1.5, 13, -2], size: [3.5, 1, 4], color: 'robePurple' },
  { at: [-0.5, 14, -1.5], size: [2.5, 1, 3], color: 'robePurpleDark' },
  { at: [1, 15, -1], size: [1.5, 0.5, 2], color: 'robePurpleDark' },
];

const torso: Box[] = [
  { at: [-2, 4, -2.5], size: [4, 4, 5], color: 'robePurple' },
  { at: [-2, 4.5, -2.5], size: [4, 0.5, 5], color: 'sandDark' },
  { at: [-2, 4, -0.5], size: [0.5, 4, 1], color: 'robeTrim' },
];

// Wide sleeves with pale cuffs, a thin green hand poking out.
const armL: Box[] = [
  { at: [-2.5, 6, 2.5], size: [3, 2, 2], color: 'robePurple' },
  { at: [-3.5, 5.5, 2.5], size: [1, 2.5, 2], color: 'robeTrim' },
  { at: [-4.5, 6, 3], size: [1, 1.5, 1], color: 'skin' },
];

const legL: Box[] = [
  { at: [-0.5, 1, 0.5], size: [1, 1, 1.5], color: 'trouserDark' },
  { at: [-3.5, 0, 0.5], size: [3, 1.5, 1.5], color: 'trouserDark' },
];

export const necromancer = bipedModel({
  key: 'necromancer',
  skin: 'skin',
  cloth: 'robePurple',
  clothDark: 'robePurpleDark',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  // The robe's skirt, down to just above the ground, edged at the hem.
  hips: [
    { at: [-3, 0.5, -3], size: [6, 2, 6], color: 'robePurple' },
    { at: [-3, 0.5, -3], size: [6, 0.5, 6], color: 'robeTrim' },
    { at: [-2.5, 2.5, -3], size: [5, 1.5, 6], color: 'robePurple' },
  ],
  joints: { torso: [0, 4, 0], head: [-1, 8, 0], armL: [-0.5, 7, 3.5], armR: [-0.5, 7, -3.5], legL: [0, 2, 1.25], legR: [0, 2, -1.25] },
  // A slow shuffle: short steps, little swing.
  walk: { legs: 14, arms: 10, bob: 1.5, roll: 6 },
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-3.75, 10.25, 0],
      boxes: zombieEyes({ face: -3.5, y: 9, near: [2, 2.5], far: [1.5, 2], farLift: 0, centre: -0.25 }),
    },
    {
      // A long white beard, swinging as it walks.
      name: 'beard',
      parent: 'head',
      pivot: [-3.5, 8.5, 0],
      boxes: [
        { at: [-4, 8, -2], size: [0.5, 1, 4], color: 'bone' },
        { at: [-4, 6, -1.5], size: [1.5, 2, 3], color: 'bone' },
        { at: [-4, 4.5, -1], size: [1, 1.5, 2], color: 'boneShadow' },
      ],
    },
    {
      // The staff, upright in the right hand outside the fist, where it does not hide the face (the slouch turned out of it).
      name: 'staff',
      parent: 'armR',
      pivot: [-4, 6.75, -4.5],
      rot: [0, 0, -10],
      boxes: [
        { at: [-4.5, 2, -5], size: [1, 11.5, 1], color: 'hatBrownDark' },
        // Level 1: a small claw holding the gem.
        ...atLevels(1, 1, [
          { at: [-5, 13.5, -5], size: [2, 0.5, 1], color: 'bone' },
          { at: [-5, 14, -5], size: [0.5, 1.5, 1], color: 'bone' },
          { at: [-3.5, 14, -5], size: [0.5, 1.5, 1], color: 'bone' },
          { at: [-4.5, 14, -5], size: [1, 2, 1], color: 'crystalGlow', emissive: 2.5 },
        ]),
        // Levels 2 and 3: ram's horns curling round a bigger gem.
        ...atLevels(2, 3, [
          { at: [-5.5, 13.5, -5], size: [3, 0.5, 1], color: 'boneShadow' },
          { at: [-5, 14, -5.25], size: [2, 2.5, 1.5], color: 'crystalGlow', emissive: 2.5 },
          { at: [-6.5, 13.5, -5], size: [1, 2.5, 1], color: 'bone' },
          { at: [-7, 16, -5], size: [1.5, 1, 1], color: 'bone' },
          { at: [-2.5, 13.5, -5], size: [1, 2.5, 1], color: 'bone' },
          { at: [-2.5, 16, -5], size: [1.5, 1, 1], color: 'bone' },
        ]),
        // Levels 4 and 5: a big crystal orb in the horns, gold horns at 5.
        ...atLevels(4, 5, [
          { at: [-5.5, 14, -5.5], size: [3, 3, 2], color: 'levelCrystal' },
          { at: [-6, 14.5, -5.25], size: [4, 2, 1.5], color: 'levelCrystal' },
          { at: [-5, 17, -5.25], size: [2, 0.5, 1.5], color: 'levelCrystal' },
        ]),
        ...atLevels(4, 4, [
          { at: [-7, 13.5, -5], size: [1, 3, 1], color: 'bone' },
          { at: [-2, 13.5, -5], size: [1, 3, 1], color: 'bone' },
        ]),
        ...atLevels(5, 5, [
          { at: [-7, 13.5, -5], size: [1, 3, 1], color: 'levelGold' },
          { at: [-7.5, 16.5, -5], size: [1.5, 1, 1], color: 'levelGold' },
          { at: [-2, 13.5, -5], size: [1, 3, 1], color: 'levelGold' },
          { at: [-2, 16.5, -5], size: [1.5, 1, 1], color: 'levelGold' },
          { at: [-5.5, 13, -5], size: [3, 1, 1], color: 'levelGold' },
        ]),
      ],
    },
    {
      // Level 3 up: a little skull floating by its left shoulder, on the camera's side, eyes aglow.
      name: 'skull',
      parent: 'head',
      pivot: [0, 14, 5],
      boxes: atLevels(3, 5, [
        { at: [-1, 13, 3.5], size: [2.5, 2, 2.5], color: 'bone' },
        { at: [-1, 12.5, 4], size: [2, 0.5, 1.5], color: 'boneShadow' },
        { at: [-1.5, 13.5, 5], size: [0.5, 1, 0.5], color: 'crystalGlow', emissive: 2.5 },
        { at: [-1.5, 13.5, 4], size: [0.5, 1, 0.5], color: 'crystalGlow', emissive: 2.5 },
      ]),
    },
  ],
  trim: ['robeTrim'],
  eyes: ['eyes'],
  stepSeconds: 1.0,
  muzzle: { part: 'staff', at: [-4, 15, -4.5] },
  clips: {
    idle: zombieIdle(['beard', 'skull']),
    // Raising the staff: the heal and summon pulse.
    shoot: staffRaise({ arm: 'armR' }),
    melee: zombieBite(),
  },
});
