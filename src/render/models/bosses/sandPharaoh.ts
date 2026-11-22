import { hitRecoil, zombieBite, zombieCheer, zombieIdle, zombieRise, zombieWalk } from '../../voxel/clips';
import type { Box, Clip, PartPose } from '../../voxel/types';
import { bipedModel, facePlate, mirrorZ, zombieEyes } from '../zombies/biped';

// The Sand Pharaoh, the boss at the end of the plants' Desert Canyon: a Desert Zombie grown huge
// and royal, striding down the middle lane. Built on the zombie biped like the Brain Titan and
// drawn at `BOSS_LOOK.sandPharaoh.scale` (2.8) times a unit's size. Faces −X. Silly, never scary:
// bandages round the body, green skin showing through a gap round one big eye and one small, a
// tall gold-and-blue striped headdress (nemes) with a gold cobra on the brow and a little blue
// false beard, a broad gold collar, and a long gold staff topped with a blue-and-gold scarab.
//
// Its one look (it is never merged): `singleLevel`. Parts the view drives:
//   glowEyes   built hidden: its eyes glowing gold; shown from phase 2 on (`fx.phaseParts`)
// Its clips tell the child what it is about to do:
//   ability  the staff slam: the staff rises overhead for 1.5 s (the scarab trembling at the top),
//            then smashes down in front
//   shoot    the sandstorm (its strike): both arms and the staff thrown up, the head tipped back,
//            shaking, held through the wind-up, then a jolt as the sand flies
//   cheer    the roar (arms up): its entrance, its summons, and a win
//   die      it topples over backwards, arms flailing; the view crumbles it into sand and gold

const DEG = Math.PI / 180;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
const easeInQuad = (u: number): number => u * u;

/** The slam's wind-up (the simulation's `windupSeconds`) and the whole clip. */
export const PHARAOH_SLAM_WINDUP = 1.5;
const SLAM_STRIKE = 0.12;
const SLAM_SECONDS = 2;
/** The sandstorm, as authored (the view draws it out over the strike's wind-up). */
export const SANDSTORM_SECONDS = 2;
const STORM_UP = 0.3;
const STORM_BURST = 0.25;
/** The topple, before the view crumbles it. */
export const PHARAOH_TOPPLE_SECONDS = 1.1;

/** Pharaoh's blue (lapis) and its darker companion, with the gold the palette already has. */
export const LAPIS = '#2F6FD6';
export const LAPIS_DARK = '#1E4BA0';

const head: Box[] = [
  // A big square head wrapped in bandages, darker underneath.
  { at: [-5, 9, -3.5], size: [7, 5, 7], color: 'bandage' },
  { at: [-4.5, 8.5, -3], size: [6, 0.5, 6], color: 'bandageDark' },
  // The gap the eyes look out of, skin showing: a pale plate in front.
  facePlate(-5, 10.5, 13.5, -3, 3, 'skinLight'),
  { at: [-3.5, 10.5, 3.5], size: [2, 2.5, 0.5], color: 'skin' },
  // A broad slit of a grin with a tooth, under the wraps.
  { at: [-5.5, 10, -2], size: [0.5, 0.5, 4], color: 'mouthDark' },
  { at: [-5.5, 9.5, 0.5], size: [0.5, 0.5, 1], color: 'tooth' },
  // The headdress: a gold cap over the top, lappets flaring past the shoulders, striped in blue.
  { at: [-5.5, 13.5, -4], size: [8.5, 1.5, 8], color: 'levelGold' },
  { at: [-5, 15, -3.5], size: [7.5, 1.5, 7], color: 'levelGold' },
  { at: [-5, 15.5, -2.5], size: [7.5, 1, 1.5], color: LAPIS },
  { at: [-5, 15.5, 0], size: [7.5, 1, 1.5], color: LAPIS },
  { at: [-5, 15.5, 2], size: [7.5, 1, 1.5], color: LAPIS },
  // Lappets down both sides of the face, gold with a blue bar, and the tail of the headdress down its back.
  { at: [-4, 8.5, 3.5], size: [3, 5.5, 1.5], color: 'levelGold' },
  { at: [-4, 10, 5], size: [3, 1, 0.5], color: LAPIS },
  { at: [-4, 8.5, -5], size: [3, 5.5, 1.5], color: 'levelGoldDark' },
  { at: [-4, 10, -5.5], size: [3, 1, 0.5], color: LAPIS_DARK },
  { at: [0.5, 9, -1.5], size: [1.5, 5, 3], color: 'levelGoldDark' },
  // The cobra on the brow: gold, rising, with a red eye.
  { at: [-6.5, 13.5, -0.5], size: [1, 3, 1], color: 'levelGold' },
  { at: [-7.25, 16, -0.5], size: [1.75, 1.25, 1], color: 'levelGold' },
  { at: [-7.5, 16.25, -0.5], size: [0.25, 0.5, 1], color: 'speedRed', emissive: 1.4 },
];

const torso: Box[] = [
  { at: [-2.5, 5, -3.5], size: [5, 4, 7], color: 'bandage' },
  // A band of darker bandage round the chest, and a torn gap with green skin.
  { at: [-3, 6.5, -3.5], size: [0.5, 0.5, 7], color: 'bandageDark' },
  { at: [-3, 5.5, -1.5], size: [0.5, 1, 2.5], color: 'skin' },
  // A gold collar over the shoulders, a blue gem in front.
  { at: [-3.5, 8, -4], size: [6, 0.75, 8], color: 'levelGold' },
  { at: [-4, 6.5, -2], size: [0.5, 1.5, 4], color: 'levelGold' },
  { at: [-4.5, 7, -0.5], size: [0.5, 1, 1], color: LAPIS, emissive: 0.8 },
  // The false beard: a little blue block hanging under the chin (on the torso, so the head's own boxes stay the head).
  { at: [-5.5, 6.5, -0.75], size: [1, 2.5, 1.5], color: LAPIS },
  { at: [-5.5, 6.5, -0.25], size: [1.25, 0.5, 0.5], color: 'levelGold' },
];

/**
 * The near arm (camera side, the one that slams): a sleeve of bandage, a long forearm and a fist
 * wrapped in gold. The staff is its own part (`staff`) and rides on this arm.
 */
const armL: Box[] = [
  { at: [-2, 6.5, 3.5], size: [3, 2.5, 2.5], color: 'bandage' },
  { at: [-2.5, 6.5, 3.5], size: [0.5, 2.5, 2.5], color: 'bandageDark' },
  { at: [-5, 7, 4], size: [2.5, 2, 2], color: 'bandage' },
  { at: [-5, 7.25, 3.75], size: [0.5, 1.5, 2.5], color: 'bandageDark' },
  { at: [-7.5, 6, 3.5], size: [2.5, 3, 3], color: 'skin' },
  { at: [-7.5, 8.25, 3.5], size: [2.5, 0.75, 3], color: 'levelGold' },
  { at: [-7.5, 6, 3.5], size: [2.5, 0.5, 3], color: 'skinDark' },
];

/** The scarab staff: a gold shaft held upright in the fist, a blue-and-gold beetle on top. */
const staff: Box[] = [
  { at: [-9.5, 3, 4], size: [1, 11, 1], color: 'levelGold' },
  // The scarab: a blue shell, a gold bar of wings across it, a glint on top.
  { at: [-11, 14, 3], size: [3, 2.5, 3], color: LAPIS },
  { at: [-10.5, 16.5, 1.5], size: [2, 1, 6], color: 'levelGold' },
  { at: [-10, 17.5, 4], size: [1, 0.5, 1], color: 'levelGold', emissive: 1.4 },
];

const legL: Box[] = [
  { at: [-1.5, 1.5, 0.5], size: [3, 3, 2], color: 'bandage' },
  { at: [-1.5, 2.5, 0.5], size: [3, 0.5, 2], color: 'bandageDark' },
  { at: [-1.5, 1.5, 0.5], size: [3, 0.5, 2], color: 'bandageDark' },
  { at: [-3.5, 0, 0], size: [5, 1.5, 3], color: 'sandDark' },
  { at: [-3.5, 1.5, 0], size: [5, 0.25, 3], color: 'levelGold' },
];

/**
 * The staff slam, `SLAM_SECONDS`: the near arm rises over `PHARAOH_SLAM_WINDUP` seconds to
 * overhead with the staff held upright above it, the body leaning back; the scarab trembles at the
 * top for the last third; then in `SLAM_STRIKE` the staff smashes down in front, the body lunging,
 * and it springs back.
 */
function staffSlam(): Clip {
  return {
    duration: SLAM_SECONDS,
    loop: false,
    parts: ['root', 'torso', 'head', 'armL', 'armR', 'staff'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      let up: number; // 1 arm overhead, 0 rest, negative smashed down
      if (t <= PHARAOH_SLAM_WINDUP) up = easeOutCubic(clamp01(t / PHARAOH_SLAM_WINDUP));
      else if (t <= PHARAOH_SLAM_WINDUP + SLAM_STRIKE) up = 1 - 1.4 * easeInQuad((t - PHARAOH_SLAM_WINDUP) / SLAM_STRIKE);
      else {
        const u = clamp01((t - PHARAOH_SLAM_WINDUP - SLAM_STRIKE) / (SLAM_SECONDS - PHARAOH_SLAM_WINDUP - SLAM_STRIKE));
        up = -0.4 * (1 - u) * (1 - u);
      }
      const shiver = t > PHARAOH_SLAM_WINDUP * 0.6 && t <= PHARAOH_SLAM_WINDUP ? (Math.floor(t * 20) % 2 === 0 ? 1 : -1) : 0;
      const raise = Math.max(0, up);
      const smash = Math.max(0, -up);
      p('armL').rz = DEG * (-100 * raise + 70 * smash + 4 * shiver);
      // The staff keeps upright while the arm rises (it turns back by what the arm turned), then follows the arm down.
      p('staff').rz = DEG * (100 * raise - 4 * shiver);
      p('armR').rz = DEG * (-30 * raise + 20 * smash);
      p('torso').rz = DEG * (-12 * raise + 20 * smash);
      p('head').rz = DEG * (-8 * raise + 10 * smash + 2 * shiver);
      p('root').py = 1 * raise - 1.5 * smash;
      p('root').sy = 1 - 0.08 * smash;
    },
  };
}

/**
 * The sandstorm, `SANDSTORM_SECONDS` as authored: in `STORM_UP` both arms fly up with the staff
 * held high and the head tips back; it holds there shaking in hard steps; in the last
 * `STORM_BURST` a jolt forward as the sand flies, and it settles back to rest.
 */
function sandstorm(): Clip {
  return {
    duration: SANDSTORM_SECONDS,
    loop: false,
    parts: ['root', 'torso', 'head', 'armL', 'armR', 'staff'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      const burstAt = SANDSTORM_SECONDS - STORM_BURST;
      let up: number; // 1 thrown up, 0 rest
      let jolt = 0;
      if (t < STORM_UP) up = easeOutCubic(t / STORM_UP);
      else if (t < burstAt) up = 1;
      else {
        const u = clamp01((t - burstAt) / STORM_BURST);
        up = 1 - easeOutCubic(u);
        jolt = Math.sin(Math.PI * u);
      }
      const shake = t >= STORM_UP && t < burstAt ? (Math.floor(t * 16) % 2 === 0 ? 1 : -1) : 0;
      p('armL').rz = DEG * (-100 * up + 40 * jolt + 3 * shake);
      p('staff').rz = DEG * (100 * up - 40 * jolt - 6 * shake);
      p('armR').rz = DEG * (-110 * up + 20 * jolt);
      p('head').rz = DEG * (-30 * up + 10 * jolt + 3 * shake);
      p('torso').rz = DEG * (-10 * up + 6 * jolt);
      p('root').py = 0.8 * up + 0.25 * shake * up;
      p('root').sy = 1 + 0.04 * up;
    },
  };
}

/** The roar: the unit's cheer (arms up, a hop), the staff turned back so it stays upright in the raised fist. */
function royalCheer(): Clip {
  const cheer = zombieCheer();
  return {
    ...cheer,
    parts: [...(cheer.parts ?? []), 'staff'],
    sample(t, pose) {
      cheer.sample(t, pose);
      (pose.staff as PartPose).rz = -(pose.armL as PartPose).rz;
    },
  };
}

/** Toppling over backwards, `PHARAOH_TOPPLE_SECONDS`: slowly, then all at once, arms flung up, the staff flying. */
function topple(): Clip {
  return {
    duration: PHARAOH_TOPPLE_SECONDS,
    loop: false,
    parts: ['root', 'head', 'armL', 'armR', 'staff', 'legL', 'legR'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      const u = clamp01(t / PHARAOH_TOPPLE_SECONDS);
      const fall = easeInQuad(u);
      p('root').rz = -82 * DEG * fall;
      p('root').px = 3 * fall;
      p('armL').rz = DEG * (-110 * Math.min(1, u * 3) + 10 * Math.sin(u * 20));
      p('staff').rz = DEG * (60 * Math.min(1, u * 3));
      p('armR').rz = DEG * (-95 * Math.min(1, u * 3) - 10 * Math.sin(u * 20));
      p('head').rz = DEG * 10 * Math.sin(u * 12);
      p('legL').rz = -20 * DEG * fall;
      p('legR').rz = 15 * DEG * fall;
    },
  };
}

export const sandPharaoh = bipedModel({
  key: 'sandPharaoh',
  skin: 'skin',
  cloth: 'bandage',
  clothDark: 'bandageDark',
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [
    { at: [-2, 4, -3], size: [4, 1, 6], color: 'bandageDark' },
    { at: [-2, 5, -3], size: [4, 0.5, 6], color: 'levelGold' },
  ],
  joints: { torso: [0, 5, 0], head: [-1.5, 9, 0], armL: [-0.5, 8, 4.5], armR: [-0.5, 8, -4.5], legL: [0, 4, 1.75], legR: [0, 4, -1.75] },
  // As the Titan's: at 2.8 times the size the camera sees plenty of the face.
  headRot: [0, 40, -14],
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-5.25, 12.5, 0],
      boxes: zombieEyes({ face: -5, y: 10.5, near: [3, 3], far: [2, 2], gap: 1 }),
    },
    { name: 'staff', parent: 'armL', pivot: [-9, 7.5, 4.5], boxes: staff },
    {
      // Phase 2: a light in each eye.
      name: 'glowEyes',
      parent: 'eyes',
      pivot: [-5.75, 12, 0],
      hidden: true,
      boxes: [
        { at: [-5.75, 11, 1], size: [0.5, 1.5, 1.5], color: 'levelGold', emissive: 2.4 },
        { at: [-5.75, 11.5, -2.25], size: [0.5, 1, 1], color: 'levelGold', emissive: 2.4 },
      ],
    },
  ],
  trim: [],
  eyes: ['eyes'],
  stepSeconds: 1.3,
  walk: { legs: 18, arms: 10, bob: 1, roll: 4 },
  envelope: [26, 22, 16],
  clips: {
    idle: zombieIdle([]),
    walk: zombieWalk(1.3, { legs: 18, arms: 10, bob: 1, roll: 4 }),
    melee: zombieBite({ duration: 0.7 }),
    ability: staffSlam(),
    shoot: sandstorm(),
    cheer: royalCheer(),
    spawn: zombieRise(),
    hit: hitRecoil('root', 1),
    die: topple(),
  },
});
sandPharaoh.singleLevel = true;
