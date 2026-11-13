import { breathe, spawnRise } from '../../voxel/clips';
import type { Box, Clip, ModelDef, PartPose } from '../../voxel/types';
import { span } from '../plants/kit';

// The Elder Oak, the boss at the end of the zombies' Backyard: an old walnut-brown tree standing
// in front of the plant base across three lanes. Faces +X. Grumpy-grandpa, never scary: bushy leaf
// eyebrows, a mossy moustache, a knot of a nose and big eyes whose pupils follow the nearest zombie
// (`pupils`, shifted by the view). Its roots reach out into the two outer lanes: that is where the
// zombies there bite it.
//
// Built coarse: the battle view draws it at `BOSS_SCALE.elderOak` (4) times a unit's size, so a
// voxel here is a quarter of a tile (a tree this big in a unit's voxels costs three times the
// triangles: faces are cut into voxel cells for their shading). The trunk is turned to the player;
// the leafy crown sits behind it and above, over the three lanes, so the lawn camera always sees
// the face in front of it.
//
// Parts the view drives:
//   pupils         shifted sideways towards the nearest zombie
//   barkL, barkR   built hidden: its shield, bark plates that drop and clap shut over its front
// Clips: shoot (the crown whips forward and flings the acorns), ability (the crown shakes: a
// summon, and its roar), die (the leaves drop off and the trunk sags; the view rolls its acorns away).

const DEG = Math.PI / 180;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeOutQuad = (u: number): number => 1 - (1 - u) * (1 - u);
const easeInQuad = (u: number): number => u * u;

/** The trunk is turned this far to the player (art bible section 2: faces turn to the camera). */
const TRUNK_TURN = -30;
/** How long the leaves take to fall when it is beaten. */
export const OAK_FALL_SECONDS = 1.2;

const roots: Box[] = [
  // A heap of soil, and roots spreading out into lanes 0 and 4 and forward.
  span(-3, 2.5, 0, 0.5, -3.5, 3.5, 'soil'),
  span(-2, -0.5, 0, 0.75, 3.5, 7.5, 'walnutDark'),
  span(-2, -0.5, 0, 0.75, -7.5, -3.5, 'walnutDark'),
  span(-1.5, 0, 0.75, 1, 4.5, 6, 'walnut'),
  span(-1.5, 0, 0.75, 1, -6, -4.5, 'walnut'),
  span(-1, 1, 0, 0.5, 7.5, 8, 'walnut'),
  span(-1, 1, 0, 0.5, -8, -7.5, 'walnut'),
  span(2.5, 3.5, 0, 0.5, -2, -1, 'walnutDark'),
  span(2.5, 3.5, 0, 0.5, 1, 2, 'walnutDark'),
];

const trunk: Box[] = [
  // A thick walnut-brown trunk, flaring at the foot, ridged with dark bark.
  span(-2.5, 2.5, 0.5, 1.5, -2.5, 2.5, 'walnutDark'),
  span(-2, 2, 1.5, 6.5, -2, 2, 'walnut'),
  span(-2.5, -2, 2, 6, -0.5, 0.5, 'walnutDark'),
  span(-1, 0, 2, 6, 2, 2.5, 'walnutDark'),
  span(-1, 0, 2, 6, -2.5, -2, 'walnutDark'),
  // The face, on a paler patch of bark in front.
  span(2, 2.5, 1.5, 6, -1.75, 1.75, 'walnutLight'),
  // A knot of a nose, a mossy moustache, a wide grumpy-kind mouth.
  span(2.5, 3, 3.25, 3.75, -0.25, 0.25, 'walnutDark'),
  span(2.5, 3, 2.75, 3.25, -1.25, 1.25, 'leafLight'),
  span(2.5, 2.75, 2.25, 2.75, -1, 1, 'mouthDark'),
  // Bushy leaf eyebrows.
  span(2.5, 3, 5.25, 5.75, -1.75, -0.25, 'leafDark'),
  span(2.5, 3, 5.25, 5.75, 0.25, 1.75, 'leafDark'),
];

const eyeWhites: Box[] = [span(2.5, 2.75, 3.75, 5.25, -1.5, -0.25, 'bone'), span(2.5, 2.75, 3.75, 5.25, 0.25, 1.5, 'bone')];

const pupils: Box[] = [
  span(2.75, 3, 3.75, 4.75, -1.25, -0.5, 'eye'),
  span(2.75, 3, 4.5, 4.75, -1.25, -1, 'eyeGlint'),
  span(2.75, 3, 3.75, 4.75, 0.5, 1.25, 'eye'),
  span(2.75, 3, 4.5, 4.75, 0.5, 0.75, 'eyeGlint'),
];

/** An acorn hanging from the front of the crown at (z, y). */
function acorn(z: number, y: number): Box[] {
  return [span(0, 0.5, y - 0.75, y, z - 0.25, z + 0.25, 'walnutLight'), span(-0.25, 0.75, y, y + 0.5, z - 0.5, z + 0.5, 'walnutDark')];
}

const crown: Box[] = [
  // A lumpy canopy behind and over the trunk, across all three lanes: dark underneath, lighter on top.
  span(-4, 0.5, 5.5, 7, -6, 6, 'leafDark'),
  span(-3.5, 0, 7, 8.5, -5.5, 5.5, 'leaf'),
  span(-3, -0.5, 8.5, 9.5, -4, 4, 'leafLight'),
  // Lumps hanging down at both ends and bulging out on top, so the outline is not a slab.
  span(-3.5, 0, 4.5, 5.5, 4, 6.5, 'leafDark'),
  span(-3.5, 0, 4.5, 5.5, -6.5, -4, 'leafDark'),
  span(-3, 0, 7, 8, 5.5, 6.5, 'leaf'),
  span(-3, 0, 7, 8, -6.5, -5.5, 'leaf'),
  span(-2, -0.5, 9.5, 10, -2, 0.5, 'leafLight'),
  span(-2.5, -1, 8.5, 9, 4, 5, 'leaf'),
  span(-2.5, -1, 8.5, 9, -5, -4, 'leaf'),
  // Acorns hanging in front.
  ...acorn(-5, 5.25),
  ...acorn(-3.25, 5.5),
  ...acorn(3.25, 5.5),
  ...acorn(5, 5.25),
];

/** Bark armour, two halves that drop and clap together over the lower front of the trunk (the eyes peek over). */
const barkL: Box[] = [
  span(3, 3.75, 0.75, 4.25, -2.75, 0, 'barkDark'),
  span(3.75, 4, 1.25, 1.75, -2.25, -0.5, 'barkLight'),
  span(3.75, 4, 2.5, 3, -2.25, -0.5, 'barkLight'),
  span(-2.75, 3, 0.75, 4.25, -3, -2.75, 'barkDark'),
];
const barkR: Box[] = [
  span(3, 3.75, 0.75, 4.25, 0, 2.75, 'barkDark'),
  span(3.75, 4, 1.25, 1.75, 0.5, 2.25, 'barkLight'),
  span(3.75, 4, 2.5, 3, 0.5, 2.25, 'barkLight'),
  span(-2.75, 3, 0.75, 4.25, 2.75, 3, 'barkDark'),
];

/** The barrage, 0.7 s: the crown leans back, then whips forward and lets the acorns fly. */
function crownFling(): Clip {
  return {
    duration: 0.7,
    loop: false,
    parts: ['crown', 'trunk'],
    sample(t, pose) {
      const crownPose = pose.crown as PartPose;
      const trunkPose = pose.trunk as PartPose;
      let lean: number; // 1 back, −1 forward
      if (t < 0.18) lean = easeOutQuad(t / 0.18);
      else if (t < 0.3) lean = 1 - 2 * easeInQuad((t - 0.18) / 0.12);
      else lean = -(1 - easeOutQuad(clamp01((t - 0.3) / 0.4)));
      crownPose.rz = DEG * 10 * lean;
      crownPose.py = 0.25 * Math.abs(lean);
      trunkPose.sy = 1 - 0.04 * Math.abs(lean);
    },
  };
}

/** The summon (and its roar), 0.6 s: the crown shakes side to side in hard steps, the trunk bounces. */
function crownShake(): Clip {
  return {
    duration: 0.6,
    loop: false,
    parts: ['crown', 'trunk'],
    sample(t, pose) {
      const u = clamp01(t / 0.6);
      const fade = 1 - u;
      const step = Math.floor(t * 16) % 2 === 0 ? 1 : -1;
      (pose.crown as PartPose).rx = DEG * 6 * step * fade;
      (pose.trunk as PartPose).py = 0.25 * Math.sin(Math.PI * u);
    },
  };
}

/** Struck, 0.25 s: the trunk shudders a little (it is big; a unit's recoil would throw it half a tile). */
function oakHit(): Clip {
  return {
    duration: 0.25,
    loop: false,
    parts: ['trunk', 'crown'],
    sample(t, pose) {
      const u = clamp01(t / 0.25);
      const k = (1 - u) * (Math.floor(t * 24) % 2 === 0 ? 1 : -1);
      (pose.trunk as PartPose).rz = DEG * 2 * k;
      (pose.crown as PartPose).rx = DEG * 2 * k;
    },
  };
}

/** Cheering, a 0.8 s loop: a little hop of its whole self, the crown bouncing after. */
function oakCheer(): Clip {
  return {
    duration: 0.8,
    loop: true,
    parts: ['root', 'crown'],
    sample(t, pose) {
      const u = (((t % 0.8) + 0.8) % 0.8) / 0.8;
      (pose.root as PartPose).py = 1 * Math.max(0, Math.sin(2 * Math.PI * u));
      (pose.crown as PartPose).sy = 1 + 0.06 * Math.sin(2 * Math.PI * u - 0.8);
    },
  };
}

/** Beaten, `OAK_FALL_SECONDS`: the leaves drop off (the crown sinks, shrinks and tips), the trunk sags. */
function leavesFall(): Clip {
  return {
    duration: OAK_FALL_SECONDS,
    loop: false,
    parts: ['crown', 'trunk'],
    sample(t, pose) {
      const u = clamp01(t / OAK_FALL_SECONDS);
      const fall = easeInQuad(u);
      const crownPose = pose.crown as PartPose;
      crownPose.py = -4 * fall;
      crownPose.sy = 1 - 0.7 * fall;
      crownPose.sx = crownPose.sz = 1 + 0.08 * fall;
      crownPose.rx = DEG * 8 * Math.sin(u * 9) * (1 - u);
      const trunkPose = pose.trunk as PartPose;
      trunkPose.sy = 1 - 0.15 * fall;
      trunkPose.rz = -6 * DEG * fall;
    },
  };
}

export const elderOak: ModelDef = {
  key: 'elderOak',
  singleLevel: true,
  trim: [],
  eyes: ['eyes'],
  envelope: [10, 10, 16],
  muzzle: { part: 'crown', at: [0, 8, 0] },
  parts: [
    { name: 'root', pivot: [0, 0, 0], boxes: roots },
    { name: 'trunk', parent: 'root', pivot: [0, 0.5, 0], rot: [0, TRUNK_TURN, 0], boxes: trunk, shadedBy: ['eyes'] },
    { name: 'eyes', parent: 'trunk', pivot: [2.6, 4.5, 0], boxes: eyeWhites },
    { name: 'pupils', parent: 'eyes', pivot: [2.9, 4.25, 0], boxes: pupils },
    { name: 'barkL', parent: 'trunk', pivot: [3.4, 0.75, -1], hidden: true, boxes: barkL },
    { name: 'barkR', parent: 'trunk', pivot: [3.4, 0.75, 1], hidden: true, boxes: barkR },
    { name: 'crown', parent: 'root', pivot: [-1.5, 6, 0], boxes: crown },
  ],
  clips: {
    idle: breathe({ body: 'trunk', sway: ['crown'] }),
    shoot: crownFling(),
    ability: crownShake(),
    cheer: oakCheer(),
    spawn: spawnRise('root'),
    hit: oakHit(),
    die: leavesFall(),
  },
};
