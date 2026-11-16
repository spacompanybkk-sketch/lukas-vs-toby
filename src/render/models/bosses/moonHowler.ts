import { hitRecoil, zombieBite, zombieCheer, zombieIdle, zombieRise, zombieWalk } from '../../voxel/clips';
import type { Box, Clip, PartPose } from '../../voxel/types';
import { bipedModel, facePlate, mirrorZ, zombieEyes } from '../zombies/biped';

// The Moon Howler, the boss at the end of the plants' Moonlit Meadow: a Brain Eater gone a bit
// wolf, walking down the middle lane under the moon. Built on the zombie biped like the Brain Titan
// and drawn at `BOSS_LOOK.moonHowler.scale` (2.6) times a unit's size. Faces −X. Goofy, never
// scary: tall pointed wolf ears with pink insides, a square snout with a black nose and two little
// fangs, a shaggy grey fur ruff round its neck, a bushy tail that wags, one big eye and one small,
// a torn purple shirt, a big clawed hand, and a moon pendant on a cord over its chest.
//
// Its one look (it is never merged): `singleLevel`. Parts the view drives:
//   glow, glowMoon, glowEyes
//              built hidden: the pendant lit up as a bright little moon, a glowing crescent moon
//              over its head and its eyes glowing yellow; shown from phase 2 on
//              (`BOSS_LOOK.moonHowler.fx.phaseParts`)
// Its clips tell the child what it is about to do:
//   ability  the claw slam: the near clawed hand rises for 1.5 s (trembling at the top), then smashes down
//   shoot    the howl (its strike): head thrown back, snout to the sky, arms spread, shaking, held
//            through the wind-up, then the howl bursts out as the lane goes dark
//   cheer    the roar (arms up, jaw wide): its entrance, its summon of pups, and a win
//   die      it topples over backwards, arms and tail flailing; the view breaks it into shards

const DEG = Math.PI / 180;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
const easeInQuad = (u: number): number => u * u;

/** The slam's arm rise (`BOSS_LOOK.moonHowler.fx.slamRise`) and the whole clip. */
export const HOWLER_SLAM_RISE = 1.5;
const SLAM_STRIKE = 0.12;
const SLAM_SECONDS = 2;
/** The howl, as authored (the view draws it out over the strike's wind-up). */
export const HOWL_SECONDS = 2;
const HOWL_BACK = 0.3;
const HOWL_BURST = 0.25;
/** The topple, before the view breaks it into shards. */
export const HOWLER_TOPPLE_SECONDS = 1.1;

/** Grey-violet fur that reads against the night meadow, and the moon's pale yellow. */
const FUR = '#9C98B8';
const FUR_DARK = '#66627F';
const FUR_LIGHT = '#CFCBE2';
const EAR_PINK = '#F2A0BE';
const NOSE = '#22202C';
const MOON = '#FFF2A8';
const MOON_DARK = '#D9C66A';

const head: Box[] = [
  // A big square head, darker underneath.
  { at: [-5, 9, -3.5], size: [7, 5, 7], color: 'skin' },
  facePlate(-5, 10.5, 13.5, -3, 3, 'skinLight'),
  // A shaggy fringe of fur on top, and grey cheek tufts on both sides.
  { at: [-4.5, 14, -3], size: [6, 0.5, 6], color: FUR },
  { at: [-5.5, 14, -1], size: [1, 1, 2.5], color: FUR },
  { at: [-3.5, 9.5, 3.5], size: [3, 2.5, 0.5], color: FUR },
  { at: [-3.5, 9.5, -4], size: [3, 2.5, 0.5], color: FUR_DARK },
  // Tall pointed wolf ears, stepped to a tip, pink inside, one flopping out a little.
  { at: [-2, 14.5, 1], size: [3, 1.5, 2], color: FUR },
  { at: [-1.5, 16, 1.5], size: [2, 1, 1.5], color: FUR },
  { at: [-2.5, 14.5, 1.5], size: [0.5, 1.5, 1], color: EAR_PINK },
  { at: [-2, 14.5, -3], size: [3, 1.5, 2], color: FUR_DARK },
  { at: [-1.5, 16, -3], size: [2, 1, 1.5], color: FUR_DARK },
  { at: [-2.5, 14.5, -2.5], size: [0.5, 1.5, 1], color: EAR_PINK },
  // The snout: a square muzzle jutting out of the lower face, a black nose on its tip, a grin.
  { at: [-7.5, 9.5, -2], size: [2.5, 1.5, 4], color: 'skin' },
  { at: [-7.5, 11, -1.5], size: [2, 0.5, 3], color: 'skinDark' },
  { at: [-8, 10, -1], size: [0.5, 1.5, 2], color: NOSE },
  { at: [-8, 11, 0.5], size: [0.5, 0.5, 0.5], color: 'eyeGlint' },
  { at: [-8, 9.5, -2], size: [0.5, 0.5, 4], color: 'mouthDark' },
];

/** The lower jaw: hinged at the back of the snout, two little fangs pointing up, a pink tongue. */
const jaw: Box[] = [
  { at: [-7.5, 8.5, -2], size: [3, 1, 4], color: 'skin' },
  { at: [-7, 8, -1.5], size: [2.5, 0.5, 3], color: 'skinDark' },
  { at: [-8.5, 9.5, 0.75], size: [0.5, 1, 1], color: 'tooth' },
  { at: [-8.5, 9.5, -1.75], size: [0.5, 1, 1], color: 'tooth' },
  { at: [-8.5, 8.5, -0.5], size: [0.5, 1, 1.25], color: 'brainPink' },
];

const torso: Box[] = [
  { at: [-2.5, 5, -3.5], size: [5, 4, 7], color: 'clothPurple' },
  // Rips showing skin, a ragged hem.
  { at: [-3, 5.5, -2.5], size: [0.5, 1.5, 2], color: 'skin' },
  { at: [-3, 4.5, -2.5], size: [0.5, 1, 2], color: 'clothDark' },
  // The fur ruff round its neck: a shaggy collar, longer in front, tufts sticking out.
  { at: [-3.5, 8.5, -4], size: [6, 1.5, 8], color: FUR },
  { at: [-4, 7.5, -2.5], size: [1, 1.5, 5], color: FUR },
  { at: [1, 8, 3.75], size: [1.5, 1, 0.5], color: FUR_DARK },
  // The moon pendant, hanging over the front of the chest and round the near side.
  { at: [-3.5, 5.5, 0.5], size: [0.5, 2.5, 3], color: MOON_DARK },
  { at: [-4, 6, 1], size: [0.5, 1.5, 2], color: MOON },
];

/**
 * Lit from phase 2 (`glow`): the pendant swells into a bright little full moon standing proud of
 * the chest (past the bloom threshold), and a light comes on in each eye.
 */
const glowPendant: Box[] = [
  { at: [-4.5, 5, 0], size: [0.5, 4, 4], color: MOON, emissive: 2.2 },
];

/**
 * Also lit from phase 2 (`glowMoon`): a glowing crescent moon floating over its head between the
 * ears, where the lawn camera, looking down on it, always sees it.
 */
const glowMoon: Box[] = [
  { at: [-2.5, 15.5, -0.5], size: [1, 3, 1], color: MOON, emissive: 2.2 },
  { at: [-1.5, 18.5, -0.5], size: [2, 1, 1], color: MOON, emissive: 2.2 },
  { at: [-1.5, 14.5, -0.5], size: [2, 1, 1], color: MOON, emissive: 2.2 },
];

/** The near arm (camera side): a sleeve, a furry forearm and a big hand with three bone claws. The slam is this arm. */
const armL: Box[] = [
  { at: [-2, 6.5, 3.5], size: [3, 2.5, 2.5], color: 'clothPurple' },
  { at: [-2.5, 6.5, 3.5], size: [0.5, 2.5, 2.5], color: 'clothDark' },
  { at: [-5, 7, 4], size: [2.5, 2, 2], color: 'skin' },
  { at: [-4.5, 8.5, 4], size: [1.5, 0.5, 2], color: FUR },
  { at: [-7.5, 6, 3.5], size: [2.5, 3, 3], color: 'skin' },
  { at: [-7.5, 6, 3.5], size: [2.5, 0.5, 3], color: 'skinDark' },
  // Claws: three bone points sticking out in front of the fist.
  { at: [-9.5, 8, 3.5], size: [2, 1, 1], color: 'bone' },
  { at: [-9.5, 8, 5.5], size: [2, 1, 1], color: 'bone' },
  { at: [-9.5, 6.5, 4.5], size: [2, 1, 1], color: 'bone' },
];

/** The far arm: the same without the claws (the camera barely sees it). */
const armR: Box[] = mirrorZ(armL.slice(0, 6));

const legL: Box[] = [
  { at: [-1.5, 1.5, 0.5], size: [3, 3, 2], color: 'trouser' },
  { at: [-1.5, 1.5, 0.5], size: [3, 0.5, 2], color: 'trouserDark' },
  // Bare feet with two bone claws.
  { at: [-3.5, 0, 0], size: [5, 1.5, 3], color: 'skinDark' },
  { at: [-4, 0, 0.5], size: [0.5, 1, 1], color: 'bone' },
  { at: [-4, 0, 2], size: [0.5, 1, 1], color: 'bone' },
];

/** A bushy tail sticking up and out behind, grey with a pale tip. */
const tail: Box[] = [
  { at: [2, 4, -1], size: [2, 2, 2], color: FUR_DARK },
  { at: [3.5, 5, -1.25], size: [2, 2.5, 2.5], color: FUR },
  { at: [5, 6.5, -1.25], size: [1.5, 2.5, 2.5], color: FUR_LIGHT },
];

/**
 * The claw slam, `SLAM_SECONDS`: the near arm rises over `HOWLER_SLAM_RISE` seconds to overhead,
 * the body leaning back and the jaw dropping open; it trembles at the top for the last third; then
 * in `SLAM_STRIKE` the claws smash down in front, the body lunging, and it springs back.
 */
function clawSlam(): Clip {
  return {
    duration: SLAM_SECONDS,
    loop: false,
    parts: ['root', 'torso', 'head', 'armL', 'armR', 'jaw', 'tail'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      let up: number; // 1 arm overhead, 0 rest, negative smashed down
      if (t <= HOWLER_SLAM_RISE) up = easeOutCubic(clamp01(t / HOWLER_SLAM_RISE));
      else if (t <= HOWLER_SLAM_RISE + SLAM_STRIKE) up = 1 - 1.4 * easeInQuad((t - HOWLER_SLAM_RISE) / SLAM_STRIKE);
      else {
        const u = clamp01((t - HOWLER_SLAM_RISE - SLAM_STRIKE) / (SLAM_SECONDS - HOWLER_SLAM_RISE - SLAM_STRIKE));
        up = -0.4 * (1 - u) * (1 - u);
      }
      const shiver = t > HOWLER_SLAM_RISE * 0.6 && t <= HOWLER_SLAM_RISE ? (Math.floor(t * 20) % 2 === 0 ? 1 : -1) : 0;
      const raise = Math.max(0, up);
      const smash = Math.max(0, -up);
      p('armL').rz = DEG * (-105 * raise + 70 * smash + 4 * shiver);
      p('armL').s = 1 + 0.25 * raise;
      p('armR').rz = DEG * (-30 * raise + 20 * smash);
      p('torso').rz = DEG * (-12 * raise + 20 * smash);
      p('head').rz = DEG * (-8 * raise + 10 * smash + 2 * shiver);
      p('jaw').rz = DEG * (28 * raise - 6 * smash);
      p('tail').rz = DEG * (-20 * raise + 15 * smash);
      p('root').py = 1 * raise - 1.5 * smash;
      p('root').sy = 1 - 0.08 * smash;
    },
  };
}

/**
 * The howl, `HOWL_SECONDS` as authored: in `HOWL_BACK` the head is thrown right back (snout to the
 * sky), the chest puffed, the arms flung out and the tail up; it holds there, shaking in hard steps
 * and rising on its toes; in the last `HOWL_BURST` the howl bursts out (a jolt forward) and it
 * settles back to rest.
 */
function howl(): Clip {
  return {
    duration: HOWL_SECONDS,
    loop: false,
    parts: ['root', 'torso', 'head', 'armL', 'armR', 'jaw', 'tail'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      const burstAt = HOWL_SECONDS - HOWL_BURST;
      let back: number; // 1 thrown back, 0 rest
      let jolt = 0;
      if (t < HOWL_BACK) back = easeOutCubic(t / HOWL_BACK);
      else if (t < burstAt) back = 1;
      else {
        const u = clamp01((t - burstAt) / HOWL_BURST);
        back = 1 - easeOutCubic(u);
        jolt = Math.sin(Math.PI * u);
      }
      const shake = t >= HOWL_BACK && t < burstAt ? (Math.floor(t * 16) % 2 === 0 ? 1 : -1) : 0;
      p('head').rz = DEG * (-48 * back + 14 * jolt + 3 * shake);
      p('jaw').rz = DEG * (32 * back + 10 * jolt);
      p('torso').rz = DEG * (-16 * back + 8 * jolt);
      p('armL').rz = DEG * (-60 * back);
      p('armL').rx = DEG * (-25 * back);
      p('armR').rz = DEG * (-60 * back);
      p('armR').rx = DEG * (25 * back);
      p('tail').rz = DEG * (-30 * back + 4 * shake);
      p('root').py = 0.8 * back + 0.25 * shake * back;
      p('root').sy = 1 + 0.04 * back;
    },
  };
}

/** Toppling over backwards, `HOWLER_TOPPLE_SECONDS`: slowly, then all at once, arms and tail flung up. */
function topple(): Clip {
  return {
    duration: HOWLER_TOPPLE_SECONDS,
    loop: false,
    parts: ['root', 'head', 'armL', 'armR', 'jaw', 'legL', 'legR', 'tail'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      const u = clamp01(t / HOWLER_TOPPLE_SECONDS);
      const fall = easeInQuad(u);
      p('root').rz = -82 * DEG * fall;
      p('root').px = 3 * fall;
      p('armL').rz = DEG * (-110 * Math.min(1, u * 3) + 10 * Math.sin(u * 20));
      p('armR').rz = DEG * (-95 * Math.min(1, u * 3) - 10 * Math.sin(u * 20));
      p('jaw').rz = 30 * DEG * Math.min(1, u * 4);
      p('head').rz = DEG * 10 * Math.sin(u * 12);
      p('tail').rz = DEG * 25 * Math.sin(u * 16);
      p('legL').rz = -20 * DEG * fall;
      p('legR').rz = 15 * DEG * fall;
    },
  };
}

export const moonHowler = bipedModel({
  key: 'moonHowler',
  skin: 'skin',
  cloth: 'clothPurple',
  clothDark: 'trouser',
  head,
  torso,
  armL,
  armR,
  legL,
  legR: mirrorZ(legL.slice(0, 3)),
  hips: [
    { at: [-2, 4, -3], size: [4, 1, 6], color: 'trouser' },
    { at: [-2, 5, -3], size: [4, 0.5, 6], color: 'trouserDark' },
  ],
  joints: { torso: [0, 5, 0], head: [-1.5, 9.5, 0], armL: [-0.5, 8, 4.5], armR: [-0.5, 8, -4.5], legL: [0, 4, 1.75], legR: [0, 4, -1.75] },
  // As the Titan's: at 2.6 times the size the camera sees plenty of the face.
  headRot: [0, 40, -14],
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-5.25, 12.5, 0],
      boxes: zombieEyes({ face: -5, y: 11.5, near: [3, 2.5], far: [2, 2], gap: 1 }),
    },
    { name: 'jaw', parent: 'head', pivot: [-5, 9.5, 0], boxes: jaw },
    { name: 'tail', parent: 'root', pivot: [2, 5, 0], boxes: tail },
    { name: 'glow', parent: 'torso', pivot: [-4.5, 7, 2], hidden: true, boxes: glowPendant },
    { name: 'glowMoon', parent: 'head', pivot: [-1.5, 16.5, 0], hidden: true, boxes: glowMoon },
    {
      name: 'glowEyes',
      parent: 'eyes',
      pivot: [-5.75, 12, 0],
      hidden: true,
      boxes: [
        { at: [-5.75, 12, 1], size: [0.5, 1.5, 1.5], color: MOON, emissive: 2.4 },
        { at: [-5.75, 12.25, -2.25], size: [0.5, 1, 1], color: MOON, emissive: 2.4 },
      ],
    },
  ],
  trim: [],
  eyes: ['eyes'],
  stepSeconds: 1.3,
  walk: { legs: 18, arms: 10, bob: 1, roll: 4 },
  sway: ['tail'],
  envelope: [22, 20, 16],
  clips: {
    idle: zombieIdle(['jaw', 'tail']),
    walk: zombieWalk(1.3, { legs: 18, arms: 10, bob: 1, roll: 4 }),
    melee: zombieBite({ jaw: 'jaw', duration: 0.7 }),
    ability: clawSlam(),
    shoot: howl(),
    cheer: zombieCheer(),
    spawn: zombieRise(),
    hit: hitRecoil('root', 1),
    die: topple(),
  },
});
moonHowler.singleLevel = true;
