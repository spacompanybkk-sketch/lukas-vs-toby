import { hitRecoil, zombieBite, zombieCheer, zombieIdle, zombieRise, zombieWalk } from '../../voxel/clips';
import type { Box, Clip, PartPose } from '../../voxel/types';
import { bipedModel, facePlate, mirrorZ, zombieEyes } from '../zombies/biped';

// The Brain Titan, the boss at the end of the plants' Backyard: a Brain Eater grown enormous and
// very pleased with itself. Built on the zombie biped and drawn at `BOSS_SCALE.brainTitan` (2.4)
// times a unit's size by the battle view. Faces −X. Silly, never scary: a crown of four pink
// brains on a gold band, a huge underbite jaw with two square teeth that flaps when it idles,
// one big eye and one small, a belly button showing through its torn shirt and two big fists.
//
// Its one look (it is never merged): `singleLevel`. Its clips tell the child what it is about to do:
//   ability  the slam: the near fist rises for 1.5 s (trembling at the top), then smashes down
//   cheer    the roar (arms up, jaw wide): its entrance and its summon
//   die      it topples over backwards, arms flailing; the view then bursts it into brain blocks

const DEG = Math.PI / 180;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
const easeInQuad = (u: number): number => u * u;

/** The slam's wind-up (the simulation's `windupSeconds`) and the whole clip. */
export const SLAM_WINDUP = 1.5;
const SLAM_STRIKE = 0.12;
const SLAM_SECONDS = 2;
/** The topple, before the view bursts it. */
export const TOPPLE_SECONDS = 1.1;

const head: Box[] = [
  // A big square head, darker underneath.
  { at: [-5, 9, -3.5], size: [7, 5.5, 7], color: 'skin' },
  { at: [-4.5, 14.5, -3], size: [6, 0.5, 6], color: 'skin' },
  { at: [-4.5, 8.5, -3], size: [6, 0.5, 6], color: 'skinDark' },
  facePlate(-5, 10.5, 14, -3, 3, 'skinLight'),
  // A goofy grin above the jaw and puffed cheeks.
  { at: [-5.5, 10, -2], size: [0.5, 0.5, 4], color: 'mouthDark' },
  { at: [-5.5, 10, 2], size: [0.5, 1, 1], color: 'skinFlush' },
  { at: [-5.5, 10, -3], size: [0.5, 1, 1], color: 'skinFlush' },
  // Ears.
  { at: [-2.5, 10.5, 3.5], size: [2, 2.5, 0.5], color: 'skinDark' },
  { at: [-2.5, 10.5, -4], size: [2, 2.5, 0.5], color: 'skinDark' },
  // The crown: a gold band all round, points front and back, four brains sitting in it.
  { at: [-5.5, 14.5, -3.5], size: [8, 1, 7], color: 'levelGold' },
  { at: [-5.5, 15.5, -0.5], size: [1, 1, 1], color: 'levelGold' },
  { at: [1.5, 15.5, -0.5], size: [1, 1, 1], color: 'levelGold' },
  { at: [-5.75, 14.75, -0.5], size: [0.5, 0.5, 1], color: 'speedRed', emissive: 1.6 },
  { at: [-4.5, 15.5, 0.5], size: [3, 1.5, 2.5], color: 'brainPink' },
  { at: [-4.5, 15.5, -3], size: [3, 1.5, 2.5], color: 'brainPink' },
  { at: [-1, 15.5, 0.5], size: [3, 1.5, 2.5], color: 'brainPink' },
  { at: [-1, 15.5, -3], size: [3, 1.5, 2.5], color: 'brainPink' },
  // Folds on the brains, where the lawn camera looks down on them.
  { at: [-4, 16.5, 1.5], size: [2, 0.5, 0.5], color: 'brainDark' },
  { at: [-4, 16.5, -2], size: [2, 0.5, 0.5], color: 'brainDark' },
  { at: [-0.5, 16.5, 1.5], size: [2, 0.5, 0.5], color: 'brainDark' },
  { at: [-0.5, 16.5, -2], size: [2, 0.5, 0.5], color: 'brainDark' },
];

/** The underbite: hinged at the back of the cheeks, jutting out past the face, two teeth pointing up. */
const jaw: Box[] = [
  { at: [-6.5, 8, -2.5], size: [6, 2, 5], color: 'skin' },
  { at: [-6.5, 7.5, -2], size: [5, 0.5, 4], color: 'skinDark' },
  { at: [-6.5, 10, -2.5], size: [1, 0.5, 5], color: 'mouthDark' },
  { at: [-7, 10, 0.5], size: [1, 1.5, 1.5], color: 'tooth' },
  { at: [-7, 10, -2], size: [1, 1.5, 1.5], color: 'tooth' },
  { at: [-6.5, 9.5, -1], size: [1, 0.5, 1.5], color: 'brainPink' },
];

const torso: Box[] = [
  { at: [-2.5, 5, -3.5], size: [5, 4, 7], color: 'clothPurple' },
  // A round belly poking out of the torn shirt, with a button.
  { at: [-3, 5.5, -2], size: [0.5, 2.5, 4], color: 'skin' },
  { at: [-3.5, 6.5, -0.5], size: [0.5, 0.5, 1], color: 'skinDark' },
  { at: [-2.5, 8.5, -3], size: [0.5, 0.5, 6], color: 'clothDark' },
];

/** The near arm (camera side): a sleeve, a long forearm and a big fist. The slam is this arm. */
const armL: Box[] = [
  { at: [-2, 6.5, 3.5], size: [3, 2.5, 2.5], color: 'clothPurple' },
  { at: [-2.5, 6.5, 3.5], size: [0.5, 2.5, 2.5], color: 'clothDark' },
  { at: [-5, 7, 4], size: [2.5, 2, 2], color: 'skin' },
  { at: [-7.5, 6, 3.5], size: [2.5, 3, 3], color: 'skin' },
  { at: [-7.5, 6, 3.5], size: [2.5, 0.5, 3], color: 'skinDark' },
  { at: [-8, 7.5, 3.5], size: [0.5, 1, 2.5], color: 'skinDark' },
];

const legL: Box[] = [
  { at: [-1.5, 1.5, 0.5], size: [3, 3, 2], color: 'trouser' },
  { at: [-1.5, 1.5, 0.5], size: [3, 0.5, 2], color: 'trouserDark' },
  { at: [-3.5, 0, 0], size: [5, 1.5, 3], color: 'hatBrownDark' },
];

/**
 * The slam, `SLAM_SECONDS`: the near arm rises over `SLAM_WINDUP` seconds to overhead, the body
 * leaning back and the jaw dropping open; it trembles at the top for the last third; then in
 * `SLAM_STRIKE` the fist smashes down in front, the body lunging, and it springs back.
 */
function titanSlam(): Clip {
  return {
    duration: SLAM_SECONDS,
    loop: false,
    parts: ['root', 'torso', 'head', 'armL', 'armR', 'jaw'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      let up: number; // 1 arm overhead, 0 rest, negative smashed down
      if (t <= SLAM_WINDUP) up = easeOutCubic(clamp01(t / SLAM_WINDUP));
      else if (t <= SLAM_WINDUP + SLAM_STRIKE) up = 1 - 1.4 * easeInQuad((t - SLAM_WINDUP) / SLAM_STRIKE);
      else {
        const u = clamp01((t - SLAM_WINDUP - SLAM_STRIKE) / (SLAM_SECONDS - SLAM_WINDUP - SLAM_STRIKE));
        up = -0.4 * (1 - u) * (1 - u);
      }
      // A stepped shiver at the top of the wind-up: "here it comes".
      const shiver = t > SLAM_WINDUP * 0.6 && t <= SLAM_WINDUP ? (Math.floor(t * 20) % 2 === 0 ? 1 : -1) : 0;
      const raise = Math.max(0, up);
      const smash = Math.max(0, -up);
      // The near fist goes straight up beside the head, swelling as it climbs.
      p('armL').rz = DEG * (-100 * raise + 70 * smash + 4 * shiver);
      p('armL').s = 1 + 0.2 * raise;
      p('armR').rz = DEG * (-30 * raise + 20 * smash);
      p('torso').rz = DEG * (-12 * raise + 20 * smash);
      p('head').rz = DEG * (-8 * raise + 10 * smash + 2 * shiver);
      p('jaw').rz = DEG * (28 * raise - 6 * smash);
      p('root').py = 1 * raise - 1.5 * smash;
      p('root').sy = 1 - 0.08 * smash;
    },
  };
}

/** Toppling over backwards, `TOPPLE_SECONDS`: slowly, then all at once, arms flung up, jaw wide. */
function titanTopple(): Clip {
  return {
    duration: TOPPLE_SECONDS,
    loop: false,
    parts: ['root', 'head', 'armL', 'armR', 'jaw', 'legL', 'legR'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      const u = clamp01(t / TOPPLE_SECONDS);
      const fall = easeInQuad(u);
      p('root').rz = -82 * DEG * fall;
      p('root').px = 3 * fall;
      p('armL').rz = DEG * (-110 * Math.min(1, u * 3) + 10 * Math.sin(u * 20));
      p('armR').rz = DEG * (-95 * Math.min(1, u * 3) - 10 * Math.sin(u * 20));
      p('jaw').rz = 30 * DEG * Math.min(1, u * 4);
      p('head').rz = DEG * 10 * Math.sin(u * 12);
      p('legL').rz = -20 * DEG * fall;
      p('legR').rz = 15 * DEG * fall;
    },
  };
}

export const brainTitan = bipedModel({
  key: 'brainTitan',
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
    { at: [-2, 4, -3], size: [4, 1, 6], color: 'trouser' },
    { at: [-2, 5, -3], size: [4, 0.5, 6], color: 'trouserDark' },
  ],
  joints: { torso: [0, 5, 0], head: [-1.5, 9, 0], armL: [-0.5, 8, 4.5], armR: [-0.5, 8, -4.5], legL: [0, 4, 1.75], legR: [0, 4, -1.75] },
  // A smaller turn than a unit's: at 2.4 times the size the camera sees plenty of the face.
  headRot: [0, 40, -14],
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-5.25, 12.5, 0],
      boxes: zombieEyes({ face: -5, y: 11, near: [3, 3], far: [2, 2], gap: 1 }),
    },
    { name: 'jaw', parent: 'head', pivot: [-1, 9, 0], boxes: jaw },
  ],
  trim: [],
  eyes: ['eyes'],
  stepSeconds: 1.3,
  walk: { legs: 18, arms: 10, bob: 1, roll: 4 },
  envelope: [18, 18, 16],
  clips: {
    idle: zombieIdle(['jaw']),
    walk: zombieWalk(1.3, { legs: 18, arms: 10, bob: 1, roll: 4 }),
    melee: zombieBite({ jaw: 'jaw', duration: 0.7 }),
    ability: titanSlam(),
    cheer: zombieCheer(),
    spawn: zombieRise(),
    hit: hitRecoil('root', 1),
    die: titanTopple(),
  },
});
brainTitan.singleLevel = true;
