import { zombieBite } from '../../voxel/clips';
import type { Box, ModelDef } from '../../voxel/types';
import { bipedModel, mirrorZ } from './biped';

// Bone Minion. Faces −X. The little skeleton a Necromancer raises: half the size of a
// zombie, a big skull with the Necromancer's purple glow in its sockets, a scrap of purple
// rag round its neck, thin bones. It is never placed or merged, so it has one look, the
// same at all five levels: `singleLevel`, which exempts it from "every level adds
// something". Built on the half voxel.

const head: Box[] = [
  { at: [-1.5, 4.5, -1.5], size: [3, 3, 3], color: 'bone' },
  { at: [-1.5, 4, -1], size: [2, 0.5, 2], color: 'boneShadow' },
  // A grin of three teeth.
  { at: [-1.5, 4.5, -1], size: [0.5, 0.5, 2], color: 'socket' },
  { at: [-2, 4.5, -0.5], size: [0.5, 0.5, 0.5], color: 'tooth' },
  { at: [-2, 4.5, 0.5], size: [0.5, 0.5, 0.5], color: 'tooth' },
];

const torso: Box[] = [
  { at: [-0.5, 2.5, -0.5], size: [0.5, 0.5, 1], color: 'boneShadow' },
  { at: [-1, 3, -1], size: [1.5, 1.5, 2], color: 'bone' },
  { at: [-0.5, 3.5, 0.5], size: [1, 0.5, 0.5], color: 'socket' },
  // A scrap of purple rag round the neck.
  { at: [-1.5, 4, -1.5], size: [2, 0.5, 3], color: 'clothPurple' },
];

const armL: Box[] = [
  { at: [-2, 3.5, 1.5], size: [2, 0.5, 0.5], color: 'bone' },
  { at: [-2.5, 3, 1.5], size: [0.5, 1, 0.5], color: 'bone' },
];

const legL: Box[] = [
  { at: [-0.5, 0.5, 0.5], size: [0.5, 1.5, 0.5], color: 'bone' },
  { at: [-1, 0, 0.5], size: [1.5, 0.5, 0.5], color: 'boneShadow' },
];

export const boneMinion: ModelDef = {
  ...bipedModel({
    key: 'boneMinion',
    skin: 'bone',
    cloth: 'clothPurple',
    clothDark: 'clothDark',
    head,
    torso,
    armL,
    armR: mirrorZ(armL),
    legL,
    legR: mirrorZ(legL),
    hips: [{ at: [-0.5, 2, -1], size: [1, 0.5, 2], color: 'bone' }],
    joints: { torso: [0, 2.5, 0], head: [0, 4.5, 0], armL: [-0.25, 3.75, 1.75], armR: [-0.25, 3.75, -1.75], legL: [0, 2, 0.75], legR: [0, 2, -0.75] },
    // Half a zombie: 6 wide, 8 tall, 5 deep.
    envelope: [6, 8, 5],
    walk: { legs: 30, arms: 20, bob: 0.5, roll: 6 },
    extra: [
      {
        name: 'eyes',
        parent: 'head',
        pivot: [-1.75, 6.25, 0],
        boxes: [
          // The Necromancer's purple light in the sockets, the near one bigger.
          { at: [-2, 5.5, 0], size: [0.5, 1.5, 1.5], color: 'socket' },
          { at: [-1.5, 5.5, 1.5], size: [1, 1.5, 0.5], color: 'socket' },
          { at: [-2, 6, 0.5], size: [0.5, 0.5, 0.5], color: 'crystalGlow', emissive: 2.5 },
          { at: [-2, 5.5, -1.5], size: [0.5, 1, 1], color: 'socket' },
          { at: [-2, 6, -1], size: [0.5, 0.5, 0.5], color: 'crystalGlow', emissive: 2.5 },
        ],
      },
    ],
    trim: [],
    eyes: ['eyes'],
    stepSeconds: 0.5,
    clips: {
      melee: zombieBite(),
    },
  }),
  singleLevel: true,
};
