import { hitRecoil, zombieBite, zombieCheer, zombieIdle, zombieRise, zombieWalk } from '../../voxel/clips';
import type { Box, Clip, PartPose } from '../../voxel/types';
import { bipedModel, facePlate, mirrorZ, zombieEyes } from '../zombies/biped';

// The Yeti, the boss at the end of the plants' Frozen Tundra: a big shaggy snow giant, built on the
// zombie biped like the Brain Titan and drawn at `BOSS_LOOK.yeti.scale` (3) times a unit's size by
// the battle view. Faces −X. Silly, never scary: white fur in blocks (bulky shoulders, a mantle and
// big furry feet, with darker blue-grey shading and a leather belt so it stands off the snow), a
// blue face with one big eye and one small, a round dark nose and two stubby fangs, two cream horns,
// and a great club of ice in its near fist.
//
// Its one look (it is never merged): `singleLevel`. Parts the view drives:
//   frostBreath  built hidden: a cloud of icy breath in front of its mouth; shown from its first
//                shield mark on (`fx.phaseParts`)
// Its clips tell the child what it is about to do:
//   ability  the club slam: the club rises overhead for 1.5 s (trembling at the top), then smashes down
//   shoot    the avalanche (its strike): both arms and the club thrown up, the head tipped back,
//            shaking, held through the wind-up, then a jolt as the snow comes down
//   cheer    the roar (arms up, a hop): its entrance, its summons and a win
//   die      it topples over backwards, arms flailing; the view breaks it into snow and ice chips

const DEG = Math.PI / 180;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
const easeInQuad = (u: number): number => u * u;

/** The slam's wind-up (the simulation's `windupSeconds`) and the whole clip. */
export const YETI_SLAM_WINDUP = 1.5;
const SLAM_STRIKE = 0.12;
const SLAM_SECONDS = 2;
/** The avalanche, as authored (the view draws it out over the strike's wind-up). */
export const AVALANCHE_SECONDS = 2;
const CALL_UP = 0.3;
const CALL_BURST = 0.25;
/** The topple, before the view breaks it. */
export const YETI_TOPPLE_SECONDS = 1.1;

/** Fur: white on top, blue-grey in the shade, deeper blue-grey in the creases; a leather belt; cream horns; ice. */
const FUR = '#F2F8FC';
const FUR_SHADE = '#B7CEDE';
const LEATHER = '#6A4429';
const LEATHER_DARK = '#432A18';
const FACE = '#5CB4E8';
const FACE_DARK = '#2F82BD';
const HORN = '#EADFC0';
const HORN_DARK = '#BDAE86';
const ICE = '#8FDCFF';
const ICE_LIGHT = '#D4F4FF';
/** The icy breath: a pale cloud, lit so it shows on the white snow. */
const BREATH = '#CFF3FF';

const head: Box[] = [
  // A big square head of fur.
  { at: [-5, 9, -3.5], size: [7, 5.5, 7], color: FUR },
  // The blue face, in a plate set into the front, with a heavy fur brow over it.
  facePlate(-5, 9.75, 13.5, -2.75, 2.75, FACE),
  { at: [-5.75, 13.5, -3.5], size: [0.75, 1, 7], color: FUR_SHADE },
  // A wide mouth with two stubby fangs.
  { at: [-5.5, 9.75, -2], size: [0.5, 0.5, 4], color: 'mouthDark' },
  { at: [-5.75, 10.25, -1.5], size: [0.5, 0.75, 1], color: 'tooth' },
  { at: [-5.75, 10.25, 0.5], size: [0.5, 0.75, 1], color: 'tooth' },
  // Two cream horns, curving up out of the fur on either side.
  { at: [-4, 14.5, 2.75], size: [1.5, 2, 1.5], color: HORN },
  { at: [-3.75, 16.5, 3], size: [1, 1, 1], color: HORN_DARK },
  { at: [-4, 14.5, -4.25], size: [1.5, 2, 1.5], color: HORN },
  { at: [-3.75, 16.5, -4], size: [1, 1, 1], color: HORN_DARK },
];

const torso: Box[] = [
  // A barrel of a chest in fur, a broad mantle over the shoulders.
  { at: [-2.75, 4.5, -4], size: [5.5, 4.5, 8], color: FUR },
  { at: [-3.25, 9, -5], size: [6, 1.25, 10], color: FUR_SHADE },
  // The belt, with a gold buckle.
  { at: [-3, 4.5, -4.25], size: [6, 0.75, 8.5], color: LEATHER },
  { at: [-3.5, 4.5, -0.75], size: [0.5, 0.75, 1.5], color: 'levelGold' },
];

/** The near arm (camera side, the one that holds the club): a heavy fur sleeve, a leather bracer and a big fist. */
const armL: Box[] = [
  { at: [-2.25, 6, 4.25], size: [3.5, 3, 3], color: FUR },
  { at: [-9.5, 5.5, 4.25], size: [7.25, 3.25, 3.25], color: FUR_SHADE },
];

/** The club: a leather grip held upright in the fist, a great knob of ice on top bristling with ice spikes. */
const club: Box[] = [
  { at: [-10.5, 2.5, 5.25], size: [1.25, 6, 1.5], color: LEATHER },
  // The knob: a block of ice with a glowing tip.
  { at: [-12.25, 9, 3.5], size: [5, 3, 5], color: ICE },
  { at: [-11.25, 12, 4.5], size: [3, 2, 3], color: ICE_LIGHT, emissive: 0.6 },
];

const legL: Box[] = [
  { at: [-1.75, 1.5, 0.25], size: [3.5, 3.25, 2.5], color: FUR_SHADE },
  { at: [-4.25, 0, 0.25], size: [6, 1.75, 3.25], color: FUR },
];

/** The icy breath: a short trail of puffs in front of the mouth, lit softly so it shows on the white snow. */
const frostBreath: Box[] = [
  { at: [-8, 10.25, -1.25], size: [1.5, 1, 2.5], color: BREATH, emissive: 0.7 },
  { at: [-9.75, 10.5, -2], size: [1.75, 1.5, 3], color: BREATH, emissive: 0.7 },
  { at: [-11.75, 11, -1], size: [1.25, 1.25, 2], color: BREATH, emissive: 0.7 },
];

/**
 * The club slam, `SLAM_SECONDS`: the near arm rises over `YETI_SLAM_WINDUP` seconds to overhead
 * with the club held upright above it, the body leaning back; the club trembles at the top for the
 * last third; then in `SLAM_STRIKE` it smashes down in front, the body lunging, and it springs back.
 */
function clubSlam(): Clip {
  return {
    duration: SLAM_SECONDS,
    loop: false,
    parts: ['root', 'torso', 'head', 'armL', 'armR', 'club'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      let up: number; // 1 arm overhead, 0 rest, negative smashed down
      if (t <= YETI_SLAM_WINDUP) up = easeOutCubic(clamp01(t / YETI_SLAM_WINDUP));
      else if (t <= YETI_SLAM_WINDUP + SLAM_STRIKE) up = 1 - 1.4 * easeInQuad((t - YETI_SLAM_WINDUP) / SLAM_STRIKE);
      else {
        const u = clamp01((t - YETI_SLAM_WINDUP - SLAM_STRIKE) / (SLAM_SECONDS - YETI_SLAM_WINDUP - SLAM_STRIKE));
        up = -0.4 * (1 - u) * (1 - u);
      }
      const shiver = t > YETI_SLAM_WINDUP * 0.6 && t <= YETI_SLAM_WINDUP ? (Math.floor(t * 20) % 2 === 0 ? 1 : -1) : 0;
      const raise = Math.max(0, up);
      const smash = Math.max(0, -up);
      p('armL').rz = DEG * (-100 * raise + 70 * smash + 4 * shiver);
      // The club keeps upright while the arm rises (it turns back by what the arm turned), then follows the arm down.
      p('club').rz = DEG * (100 * raise - 4 * shiver);
      p('armR').rz = DEG * (-30 * raise + 20 * smash);
      p('torso').rz = DEG * (-12 * raise + 20 * smash);
      p('head').rz = DEG * (-8 * raise + 10 * smash + 2 * shiver);
      p('root').py = 1 * raise - 1.5 * smash;
      p('root').sy = 1 - 0.08 * smash;
    },
  };
}

/**
 * The avalanche, `AVALANCHE_SECONDS` as authored: in `CALL_UP` both arms fly up with the club held
 * high and the head tips back; it holds there shaking in hard steps; in the last `CALL_BURST` a
 * jolt forward as the snow comes down, and it settles back to rest.
 */
function avalanche(): Clip {
  return {
    duration: AVALANCHE_SECONDS,
    loop: false,
    parts: ['root', 'torso', 'head', 'armL', 'armR', 'club'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      const burstAt = AVALANCHE_SECONDS - CALL_BURST;
      let up: number; // 1 thrown up, 0 rest
      let jolt = 0;
      if (t < CALL_UP) up = easeOutCubic(t / CALL_UP);
      else if (t < burstAt) up = 1;
      else {
        const u = clamp01((t - burstAt) / CALL_BURST);
        up = 1 - easeOutCubic(u);
        jolt = Math.sin(Math.PI * u);
      }
      const shake = t >= CALL_UP && t < burstAt ? (Math.floor(t * 16) % 2 === 0 ? 1 : -1) : 0;
      p('armL').rz = DEG * (-100 * up + 40 * jolt + 3 * shake);
      p('club').rz = DEG * (100 * up - 40 * jolt - 6 * shake);
      p('armR').rz = DEG * (-110 * up + 20 * jolt);
      p('head').rz = DEG * (-30 * up + 10 * jolt + 3 * shake);
      p('torso').rz = DEG * (-10 * up + 6 * jolt);
      p('root').py = 0.8 * up + 0.25 * shake * up;
      p('root').sy = 1 + 0.04 * up;
    },
  };
}

/** The roar: the unit's cheer (arms up, a hop), the club turned back so it stays upright in the raised fist. */
function roar(): Clip {
  const cheer = zombieCheer();
  return {
    ...cheer,
    parts: [...(cheer.parts ?? []), 'club'],
    sample(t, pose) {
      cheer.sample(t, pose);
      (pose.club as PartPose).rz = -(pose.armL as PartPose).rz;
    },
  };
}

/** Toppling over backwards, `YETI_TOPPLE_SECONDS`: slowly, then all at once, arms flailing, the club flying. */
function topple(): Clip {
  return {
    duration: YETI_TOPPLE_SECONDS,
    loop: false,
    parts: ['root', 'head', 'armL', 'armR', 'club', 'legL', 'legR'],
    sample(t, pose) {
      const p = (name: string): PartPose => pose[name] as PartPose;
      const u = clamp01(t / YETI_TOPPLE_SECONDS);
      const fall = easeInQuad(u);
      p('root').rz = -82 * DEG * fall;
      p('root').px = 3 * fall;
      p('armL').rz = DEG * (-110 * Math.min(1, u * 3) + 10 * Math.sin(u * 20));
      p('club').rz = DEG * (60 * Math.min(1, u * 3));
      p('armR').rz = DEG * (-95 * Math.min(1, u * 3) - 10 * Math.sin(u * 20));
      p('head').rz = DEG * 10 * Math.sin(u * 12);
      p('legL').rz = -20 * DEG * fall;
      p('legR').rz = 15 * DEG * fall;
    },
  };
}

export const yeti = bipedModel({
  key: 'yeti',
  skin: FUR,
  cloth: FUR,
  clothDark: FUR_SHADE,
  head,
  torso,
  armL,
  armR: mirrorZ(armL),
  legL,
  legR: mirrorZ(legL),
  hips: [{ at: [-2, 3.75, -3], size: [4, 0.75, 6], color: LEATHER_DARK }],
  joints: { torso: [0, 5, 0], head: [-1.5, 9, 0], armL: [-0.5, 8, 4.5], armR: [-0.5, 8, -4.5], legL: [0, 4, 1.75], legR: [0, 4, -1.75] },
  // As the Titan's: at three times the size the camera sees plenty of the face.
  headRot: [0, 40, -14],
  extra: [
    {
      name: 'eyes',
      parent: 'head',
      pivot: [-5.25, 12.5, 0],
      boxes: zombieEyes({ face: -5, y: 11.25, near: [2.75, 2.25], far: [2, 1.75], gap: 1 }),
    },
    { name: 'club', parent: 'armL', pivot: [-9.5, 7.5, 5.25], boxes: club },
    { name: 'frostBreath', parent: 'head', pivot: [-8, 10.5, 0], hidden: true, boxes: frostBreath },
  ],
  trim: [],
  eyes: ['eyes'],
  stepSeconds: 1.3,
  walk: { legs: 18, arms: 10, bob: 1, roll: 4 },
  envelope: [30, 22, 18],
  clips: {
    idle: zombieIdle([]),
    walk: zombieWalk(1.3, { legs: 18, arms: 10, bob: 1, roll: 4 }),
    melee: zombieBite({ duration: 0.7 }),
    ability: clubSlam(),
    shoot: avalanche(),
    cheer: roar(),
    spawn: zombieRise(),
    hit: hitRecoil('root', 1),
    die: topple(),
  },
});
yeti.singleLevel = true;
