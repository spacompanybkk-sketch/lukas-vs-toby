import { breathe, spawnRise } from '../../voxel/clips';
import type { Box, Clip, ModelDef, PartPose } from '../../voxel/types';
import { span } from '../plants/kit';

// The Cactus King, the boss at the end of the zombies' Desert Canyon: a big old saguaro standing
// in front of the plant base across three lanes, wearing a crown of flowers. Faces +X. A kindly
// bully, never scary: a paler patch of green for a face, big eyes whose pupils follow the nearest
// zombie (`pupils`, shifted by the view), a wide grin, a pink blush on each cheek, two arms bent
// up like a strongman's that reach into the two outer lanes, ribs down the whole trunk and tufts
// of cream spines. Its spines are what the zombies in lanes 0 and 4 bite.
//
// Built coarse, like the Elder Oak: the battle view draws it at `BOSS_LOOK.cactusKing.scale` (4)
// times a unit's size, so a voxel here is a quarter of a tile. The trunk is turned to the player;
// the flower crown sits on top, so the lawn camera sees the face under it.
//
// Parts the view drives:
//   pupils         shifted sideways towards the nearest zombie
//   barkL, barkR   built hidden: its shield, green armour plates bristling with spines that
//                  slide in from the sides and clap shut over its front (`fx.shield: 'bark'`)
// Clips: shoot (the arms whip forward and fling the needles), ability (the whole cactus shakes:
// a summon, and its roar), cheer (both arms thrown up and shaking, looped: the rockfall's wind-up),
// die (it wilts: the flowers drop, the arms sag, the trunk bows).

const DEG = Math.PI / 180;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeOutQuad = (u: number): number => 1 - (1 - u) * (1 - u);
const easeInQuad = (u: number): number => u * u;

/** The trunk is turned this far to the player (art bible section 2: faces turn to the camera). */
const TRUNK_TURN = -30;
/** How long the wilt takes when it is beaten. */
export const CACTUS_WILT_SECONDS = 1.2;

/** The greens of its skin, its spines and the pink and yellow of its flowers. */
const SKIN = '#4FA84A';
const SKIN_DARK = '#2F7D3A';
const SKIN_RIB = '#3E9442';
const SKIN_LIGHT = '#A6DB78';
/** The spine plates: a deeper green than the skin, so the big lit faces still read as green and not as mint. */
const PLATE = '#2F8A3F';
const PLATE_RIM = '#1B5A2A';
const SPINE = '#FFF3C4';
const PINK = '#FF6FA8';
const PINK_DARK = '#D94A86';
const YELLOW = '#FFD23D';

const roots: Box[] = [
  // A heap of sand with a few rocks, and the foot of the trunk.
  span(-3, 2.5, 0, 0.5, -3.5, 3.5, 'sand'),
  span(2.5, 3.5, 0, 0.5, -2, -1, 'stone'),
  span(2.5, 3.5, 0, 0.5, 1, 2, 'stoneDark'),
  span(-1.5, -0.5, 0, 1, 4, 5.5, 'stone'),
  span(-1.5, -0.5, 0, 0.5, -5.5, -4, 'stoneDark'),
];

const trunk: Box[] = [
  // A thick column with a flared foot: two lighter ribs down the front and a darker one down each side.
  span(-2.5, 2.5, 0.5, 1.5, -2.5, 2.5, SKIN_DARK),
  span(-2, 2, 1.5, 7.5, -2, 2, SKIN),
  span(-2.25, 2, 1.5, 7.5, -1.25, -0.75, SKIN_RIB),
  span(-2.25, 2, 1.5, 7.5, 0.75, 1.25, SKIN_RIB),
  span(-1.5, 1.5, 7.5, 8.25, -1.5, 1.5, SKIN),
  // The face, on a paler patch of skin in front.
  span(2, 2.5, 1.5, 7.25, -1.75, 1.75, SKIN_LIGHT),
  // A little nose (a bump), a wide kind grin, pink blush on both cheeks.
  span(2.5, 3, 3.5, 4, -0.25, 0.25, SKIN),
  span(2.5, 2.75, 2.25, 2.75, -1.25, 1.25, 'mouthDark'),
  span(2.5, 2.75, 3.25, 3.75, -1.75, -1, PINK),
  span(2.5, 2.75, 3.25, 3.75, 1, 1.75, PINK),
  // A few cream spines on the front of the ribs and the sides.
  span(2.5, 3, 6.5, 6.75, -1.5, -1, SPINE),
  span(2.5, 3, 6.5, 6.75, 1, 1.5, SPINE),
  span(2.5, 3, 1.75, 2, -1, -0.5, SPINE),
  span(2.5, 3, 1.75, 2, 0.5, 1, SPINE),
  span(-1, 0, 6, 6.25, 2, 2.75, SPINE),
  span(-1, 0, 6, 6.25, -2.75, -2, SPINE),
];

const eyeWhites: Box[] = [span(2.5, 2.75, 4.25, 5.75, -1.5, -0.25, 'bone'), span(2.5, 2.75, 4.25, 5.75, 0.25, 1.5, 'bone')];

const pupils: Box[] = [
  span(2.75, 3, 4.25, 5.25, -1.25, -0.5, 'eye'),
  span(2.75, 3, 5, 5.25, -1.25, -1, 'eyeGlint'),
  span(2.75, 3, 4.25, 5.25, 0.5, 1.25, 'eye'),
  span(2.75, 3, 5, 5.25, 0.5, 0.75, 'eyeGlint'),
];

/**
 * An arm: it comes out of the trunk at shoulder height and bends up like a strongman's, with a
 * flower on its tip. `sign` is +1 for the camera's side (lane 3), −1 for the far side.
 */
function arm(sign: 1 | -1): Box[] {
  const z = (a: number, b: number): [number, number] => (sign > 0 ? [a, b] : [-b, -a]);
  const [a0, a1] = z(2, 5.5);
  const [u0, u1] = z(4.5, 6);
  const [f0, f1] = z(4, 6.5);
  const [h0, h1] = z(4.75, 5.75);
  const [s0, s1] = z(5.75, 6.25);
  return [
    // Out from the trunk, then up to a flower.
    span(-1, 1.5, 3.75, 5.25, a0, a1, SKIN),
    span(-0.75, 1.25, 5.25, 9.25, u0, u1, SKIN),
    span(-0.5, 1, 9.25, 10, f0, f1, PINK),
    span(0, 0.5, 10, 10.25, h0, h1, YELLOW),
    // A few cream spines on its outside.
    span(0.5, 1, 7, 7.25, s0, s1, SPINE),
    span(-0.5, 0, 6, 6.25, s0, s1, SPINE),
  ];
}
const armL: Box[] = arm(1);
const armR: Box[] = arm(-1);

/** The flower crown: pink petals round a yellow heart on a green ring, a bud on a stalk either side. */
const crown: Box[] = [
  span(-1.75, 1.75, 8.25, 8.75, -1.75, 1.75, SKIN_DARK),
  span(-1.75, 1.75, 8.75, 9.5, -1.25, 1.25, PINK),
  span(-1.25, 1.25, 8.75, 9.5, -1.75, -1.25, PINK),
  span(-1.25, 1.25, 8.75, 9.5, 1.25, 1.75, PINK),
  span(-2, -1.75, 9.5, 10.25, -1, 1, PINK_DARK),
  span(-0.5, 1, 9.5, 10.25, -0.75, 0.75, YELLOW),
  span(-0.25, 0.25, 8.75, 9.75, -2.5, -2, SKIN),
  span(-0.5, 0.5, 9.75, 10.5, -2.75, -1.75, PINK),
  span(-0.25, 0.25, 8.75, 9.75, 2, 2.5, SKIN),
  span(-0.5, 0.5, 9.75, 10.5, 1.75, 2.75, PINK),
];

/**
 * Spine armour, two big green plates with a darker rim that slide in from the sides and clap shut
 * over the whole front of the trunk, the face included (the eyes peek through a slit between the
 * lower and the upper plate), bristling with rows of cream spines. Each half also wraps its side
 * of the trunk.
 */
function barkHalf(sign: 1 | -1): Box[] {
  const z = (a: number, b: number): [number, number] => (sign > 0 ? [a, b] : [-b, -a]);
  const plate = (y0: number, y1: number): Box[] => {
    const [z0, z1] = z(0, 2.75);
    const [r0, r1] = z(2.5, 2.75);
    const [s0, s1] = z(0, 0.25);
    const [c0, c1] = z(1.25, 1.5);
    const boxes: Box[] = [
      span(3, 3.75, y0, y1, z0, z1, PLATE),
      // The dark rim round its front, and the seam where the halves meet.
      span(3.75, 4, y0, y0 + 0.25, z0, z1, PLATE_RIM),
      span(3.75, 4, y1 - 0.25, y1, z0, z1, PLATE_RIM),
      span(3.75, 4, y0 + 0.25, y1 - 0.25, r0, r1, PLATE_RIM),
      span(3.75, 4, y0 + 0.25, y1 - 0.25, s0, s1, PLATE_RIM),
    ];
    // A column of spines up the middle of the plate, every three-quarters of a voxel.
    for (let y = y0 + 0.5; y < y1 - 0.4; y += 0.75) boxes.push(span(4, 4.75, y, y + 0.25, c0, c1, SPINE));
    return boxes;
  };
  const [w0, w1] = z(2.75, 3.25);
  return [...plate(0.75, 4), ...plate(5.5, 7.25), span(-2.5, 3.75, 0.75, 7.25, w0, w1, PLATE)];
}
const barkL: Box[] = barkHalf(-1);
const barkR: Box[] = barkHalf(1);

/** The barrage, 0.7 s: the arms lean back, then whip forward and let the needles fly. */
function armsFling(): Clip {
  return {
    duration: 0.7,
    loop: false,
    parts: ['crown', 'trunk', 'armL', 'armR'],
    sample(t, pose) {
      const crownPose = pose.crown as PartPose;
      const trunkPose = pose.trunk as PartPose;
      let lean: number; // 1 back, −1 forward
      if (t < 0.18) lean = easeOutQuad(t / 0.18);
      else if (t < 0.3) lean = 1 - 2 * easeInQuad((t - 0.18) / 0.12);
      else lean = -(1 - easeOutQuad(clamp01((t - 0.3) / 0.4)));
      crownPose.rz = DEG * 10 * lean;
      crownPose.py = 0.25 * Math.abs(lean);
      trunkPose.rz = DEG * 5 * lean;
      trunkPose.sy = 1 - 0.04 * Math.abs(lean);
      (pose.armL as PartPose).rx = DEG * 25 * lean;
      (pose.armR as PartPose).rx = -DEG * 25 * lean;
    },
  };
}

/** The summon (and its roar), 0.6 s: the crown and arms shake side to side in hard steps, the trunk bounces. */
function cactusShake(): Clip {
  return {
    duration: 0.6,
    loop: false,
    parts: ['crown', 'trunk', 'armL', 'armR'],
    sample(t, pose) {
      const u = clamp01(t / 0.6);
      const fade = 1 - u;
      const step = Math.floor(t * 16) % 2 === 0 ? 1 : -1;
      (pose.crown as PartPose).rx = DEG * 6 * step * fade;
      (pose.armL as PartPose).rx = -DEG * 14 * step * fade;
      (pose.armR as PartPose).rx = DEG * 14 * step * fade;
      (pose.trunk as PartPose).py = 0.25 * Math.sin(Math.PI * u);
    },
  };
}

/** Struck, 0.25 s: the trunk shudders a little (it is big; a unit's recoil would throw it half a tile). */
function cactusHit(): Clip {
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

/** The rockfall's call, a 0.8 s loop: both arms thrown up and shaking, the crown bouncing, a little hop. */
function callRocks(): Clip {
  return {
    duration: 0.8,
    loop: true,
    parts: ['root', 'crown', 'armL', 'armR'],
    sample(t, pose) {
      const u = (((t % 0.8) + 0.8) % 0.8) / 0.8;
      const beat = 2 * Math.PI * u;
      (pose.root as PartPose).py = 0.75 * Math.max(0, Math.sin(beat));
      (pose.crown as PartPose).sy = 1 + 0.06 * Math.sin(beat - 0.8);
      (pose.armL as PartPose).rx = -DEG * (25 + 12 * Math.sin(beat * 2));
      (pose.armR as PartPose).rx = DEG * (25 + 12 * Math.sin(beat * 2 + Math.PI));
    },
  };
}

/** Beaten, `CACTUS_WILT_SECONDS`: the flowers drop (the crown sinks, shrinks and tips), the arms sag, the trunk bows. */
function wilt(): Clip {
  return {
    duration: CACTUS_WILT_SECONDS,
    loop: false,
    parts: ['crown', 'trunk', 'armL', 'armR'],
    sample(t, pose) {
      const u = clamp01(t / CACTUS_WILT_SECONDS);
      const fall = easeInQuad(u);
      const crownPose = pose.crown as PartPose;
      crownPose.py = -4 * fall;
      crownPose.sy = 1 - 0.7 * fall;
      crownPose.sx = crownPose.sz = 1 + 0.08 * fall;
      crownPose.rx = DEG * 8 * Math.sin(u * 9) * (1 - u);
      const trunkPose = pose.trunk as PartPose;
      trunkPose.sy = 1 - 0.15 * fall;
      trunkPose.rz = -8 * DEG * fall;
      (pose.armL as PartPose).rx = DEG * 70 * fall;
      (pose.armR as PartPose).rx = -DEG * 70 * fall;
    },
  };
}

export const cactusKing: ModelDef = {
  key: 'cactusKing',
  singleLevel: true,
  trim: [],
  eyes: ['eyes'],
  envelope: [10, 11, 16],
  muzzle: { part: 'crown', at: [0, 9, 0] },
  parts: [
    { name: 'root', pivot: [0, 0, 0], boxes: roots },
    { name: 'trunk', parent: 'root', pivot: [0, 0.5, 0], rot: [0, TRUNK_TURN, 0], boxes: trunk, shadedBy: ['eyes'] },
    { name: 'armL', parent: 'trunk', pivot: [0, 4.5, 2], boxes: armL },
    { name: 'armR', parent: 'trunk', pivot: [0, 4.5, -2], boxes: armR },
    { name: 'eyes', parent: 'trunk', pivot: [2.6, 5, 0], boxes: eyeWhites },
    { name: 'pupils', parent: 'eyes', pivot: [2.9, 4.75, 0], boxes: pupils },
    { name: 'barkL', parent: 'trunk', pivot: [3.4, 0.75, -1], hidden: true, boxes: barkL },
    { name: 'barkR', parent: 'trunk', pivot: [3.4, 0.75, 1], hidden: true, boxes: barkR },
    { name: 'crown', parent: 'root', pivot: [0, 8.25, 0], boxes: crown },
  ],
  clips: {
    idle: breathe({ body: 'trunk', sway: ['crown'] }),
    shoot: armsFling(),
    ability: cactusShake(),
    cheer: callRocks(),
    spawn: spawnRise('root'),
    hit: cactusHit(),
    die: wilt(),
  },
};
