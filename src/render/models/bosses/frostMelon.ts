import { breathe, spawnRise } from '../../voxel/clips';
import type { Box, Clip, ModelDef, PartPose } from '../../voxel/types';
import { span } from '../plants/kit';

// The Frost Melon, the boss at the end of the zombies' Frozen Tundra: a huge watermelon gone
// frosty, sitting in a snow drift in front of the plant base across three lanes. Faces +X.
// Grumpy-cosy, never scary: a snow cap, an icicle crown, frosty eyebrows and a frosty moustache,
// big eyes whose pupils follow the nearest zombie, and on its back the Mango-pult's catapult, grown
// up: a wooden beam with a basket holding a frozen melon, high over its crown. Its frozen vines
// reach out into the lanes either side: that is where the zombies there bite it.
//
// Built coarse, like the Elder Oak: the battle view draws it at `BOSS_LOOK.frostMelon.scale` (4)
// times a unit's size, so a voxel here is a quarter of a tile. The melon is turned to the player;
// the catapult on its back is turned back square to the lanes it throws down.
//
// Parts the view drives:
//   pupils         shifted sideways towards the nearest zombie
//   iceL, iceR     built hidden: its shield, ice plates that slide in and clap shut over its front
//   crownGlow      built hidden: the icicle crown lit up, blinking with the freeze's warning tiles
//   frostCracks, frostSpikes, glowEyes
//                  built hidden: glowing cracks in its rind, big icicles bursting out of its top
//                  and its icy eyes alight, shown from phase 2 on (`fx.phaseParts`)
// Its clips tell the child what it is about to do:
//   shoot    the barrage: the basket cranks back, then whips up and over and lets the frozen melon
//            fly (the basket is empty until the next one grows)
//   cheer    the freeze (its strike), `MELON_FREEZE_SECONDS` as authored: it breathes in and swells,
//            the crown rising, shivers harder and harder through the wind-up, then stamps down as
//            the blue lanes freeze (and, once, when its side wins)
//   ability  the crown shakes and it hops: a summon, and its roar
//   die      it cracks: the crown tips off, the catapult drops, the melon sags (the view breaks it
//            into shards)

const DEG = Math.PI / 180;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeOutQuad = (u: number): number => 1 - (1 - u) * (1 - u);
const easeInQuad = (u: number): number => u * u;

/** The melon is turned this far to the player (art bible section 2: faces turn to the camera). */
const MELON_TURN = -30;
/** The freeze, as authored: the strike's wind-up (the view draws it out or squeezes it to fit). */
export const MELON_FREEZE_SECONDS = 2.5;
const FREEZE_IN = 0.4;
const FREEZE_STAMP = 0.25;
/** The barrage's fling, and how long the basket stays empty. */
export const MELON_FLING_SECONDS = 0.7;
const FLING_BACK = 0.06;
const FLING_RELEASE = 0.13;
const FLING_OVER = 0.28;
/** The beam's lean back from lying flat at rest: the basket stands high behind the crown. */
const ARM_REST = 25;
/** How long it takes to crack and sag when it is beaten. */
export const MELON_FALL_SECONDS = 1.2;

const RIND = '#3FA34D';
const RIND_DARK = '#27733A';
const RIND_PALE = '#BFEBB0';
const SNOW = '#F4FBFF';
const ICE = '#7FD3F5';
const ICE_LIGHT = '#B8ECFF';
const ICE_DARK = '#3F9AD0';
const FROST = '#E8FAFF';
/** The lit crown and the phase-2 glow: a cold bright cyan, past the bloom threshold. */
const GLOW = '#9FF0FF';

const drift: Box[] = [
  // A snow drift it sits in, and a lump of ice in front.
  span(-3, 3, 0, 0.5, -4.5, 4.5, SNOW),
  span(3, 4, 0, 1, 1, 2, ICE),
  // Frozen vines reaching into the lanes either side, a leaf on the near one (the camera's side).
  span(-1.5, -0.5, 0, 1, 4.25, 6.5, RIND_DARK),
  span(-1.5, -0.5, 0, 1, -6.5, -4.25, RIND_DARK),
  span(-2, 0.5, 1, 1.25, 4.75, 6.25, RIND),
];

const melon: Box[] = [
  // A fat melon lying across the lanes, stepped round: narrower at the foot, at the top and at both ends.
  // (The foot starts a fraction over the drift's top, so the two share no surface.)
  span(-2, 2, 0.75, 1.5, -3, 3, RIND_DARK),
  span(-2.5, 2.5, 1.5, 5, -3.5, 3.5, RIND),
  span(-2, 2, 2, 4.5, -4.25, 4.25, RIND),
  span(-2, 2, 5, 6, -3, 3, RIND),
  // Dark stripes down its front and round both ends.
  span(2, 2.5, 1.5, 5, 2.5, 3.25, RIND_DARK),
  span(2, 2.5, 1.5, 5, -3.25, -2.5, RIND_DARK),
  span(-0.5, 0.5, 2, 4.5, 3.75, 4.25, RIND_DARK),
  span(-0.5, 0.5, 2, 4.5, -4.25, -3.75, RIND_DARK),
  // A cap of snow, and a lump of it on the near end.
  span(-2, 2, 6, 6.5, -2.75, 2.75, SNOW),
  span(-1, 1, 4.5, 5, 3.5, 4.25, SNOW),
  // The face, on a pale patch of rind.
  span(2, 2.5, 1.75, 5, -2.25, 2.25, RIND_PALE),
  // Frosty eyebrows, lower in the middle (grumpy), a frosty moustache, a wide mouth with one tooth.
  span(2.5, 3, 4.75, 5.25, -2.25, -1.25, FROST),
  span(2.5, 3, 4.5, 5, -1.25, -0.25, FROST),
  span(2.5, 3, 4.75, 5.25, 1.25, 2.25, FROST),
  span(2.5, 3, 4.5, 5, 0.25, 1.25, FROST),
  span(2.5, 3, 2.75, 3.25, -1.5, 1.5, ICE_LIGHT),
  span(2.5, 2.75, 2, 2.75, -1, 1, 'mouthDark'),
  span(2.5, 2.75, 2.25, 2.75, 0, 1, 'tooth'),
];

const eyeWhites: Box[] = [span(2.5, 2.75, 3.25, 4.5, -1.75, -0.25, 'bone'), span(2.5, 2.75, 3.25, 4.5, 0.25, 1.75, 'bone')];

const pupils: Box[] = [
  span(2.75, 3, 3.25, 4.25, -1.25, -0.5, 'eye'),
  span(2.75, 3, 4, 4.25, -1.25, -1, 'eyeGlint'),
  span(2.75, 3, 3.25, 4.25, 0.5, 1.25, 'eye'),
  span(2.75, 3, 4, 4.25, 0.5, 0.75, 'eyeGlint'),
];

/** Phase 2: its pupils alight, icy and bright. */
const glowEyes: Box[] = [
  span(3, 3.25, 3.25, 4.25, -1.25, -0.5, GLOW, { emissive: 2.4 }),
  span(3, 3.25, 3.25, 4.25, 0.5, 1.25, GLOW, { emissive: 2.4 }),
];

/** One icicle of the crown standing on (x, z): a block and a point, `h` tall in all. */
function icicle(x: number, z: number, h: number, color: string, tip: string): Box[] {
  return [
    span(x - 0.5, x + 0.5, 6.5, 6.5 + h - 1, z - 0.5, z + 0.5, color),
    span(x - 0.25, x + 0.25, 6.5 + h - 1, 6.5 + h, z - 0.25, z + 0.25, tip),
  ];
}

/** Where the crown's icicles stand (x, z) and how tall each is: tallest in the middle, over the face. */
const CROWN: readonly (readonly [number, number, number])[] = [
  [1.5, 0, 3], [1.5, -1.5, 2.25], [1.5, 1.5, 2.25], [0.25, -2, 1.75], [0.25, 2, 1.75],
];

const crown: Box[] = [
  // A band of ice round the front of the snow cap, and the icicles standing on it.
  span(-0.25, 2, 6.5, 7, -2.5, 2.5, ICE_DARK),
  ...CROWN.slice(0, 3).flatMap(([x, z, h]) => icicle(x, z, h, ICE, ICE_LIGHT)),
  // The two behind are plain stubs.
  ...CROWN.slice(3).map(([x, z, h]) => span(x - 0.5, x + 0.5, 6.5, 6.5 + h, z - 0.5, z + 0.5, ICE)),
];

/** The crown lit (its strike's tell): the three front icicles fatter and taller, glowing. */
const crownGlow: Box[] = CROWN.slice(0, 3).map(([x, z, h]) => span(x - 0.75, x + 0.75, 7, 7 + h, z - 0.75, z + 0.75, GLOW, { emissive: 2.2 }));

/** Phase 2: glowing cracks across its face, round its near end and along its near shoulder. */
const frostCracks: Box[] = [
  span(2.5, 2.75, 3, 5, 2.25, 2.5, GLOW, { emissive: 2 }),
  span(2.5, 2.75, 2.5, 3, 2.5, 3.25, GLOW, { emissive: 2 }),
  span(2.5, 2.75, 1.75, 3.5, -2.75, -2.5, GLOW, { emissive: 2 }),
  span(2.5, 2.75, 3.5, 4, -3.5, -2.75, GLOW, { emissive: 2 }),
  span(-1.5, -1.25, 2, 4, 4.25, 4.5, GLOW, { emissive: 2 }),
  span(-1.25, 0, 3, 3.25, 4.25, 4.5, GLOW, { emissive: 2 }),
  span(-0.25, 1.75, 5, 5.25, 3, 3.25, GLOW, { emissive: 2 }),
];

/** Phase 2: big icicles bursting out of its top and out of its near end. */
const frostSpikes: Box[] = [
  span(-1.5, -0.5, 5.25, 8, 2.5, 3.25, ICE_LIGHT, { emissive: 0.5 }),
  span(-1.25, -0.75, 8, 9, 2.625, 3.125, FROST, { emissive: 0.5 }),
  span(0.75, 1.75, 3.25, 4.25, 3.5, 6, ICE_LIGHT, { emissive: 0.5 }),
];

/**
 * The catapult's saddle: a block strapped on the melon's back, behind the crown, and the post the
 * beam hinges on. It rides the melon but is turned back square to the lanes.
 */
const saddle: Box[] = [
  span(-2.5, -0.5, 5.75, 6.75, -1.25, 1.25, 'barkDark'),
  span(-2, -1, 6.75, 7.25, -1, 1, 'bark'),
];

/** The beam and its basket, authored lying flat along −X from the hinge (x −1.5, y 7.25). */
const arm: Box[] = [
  span(-5, -1, 7, 7.5, -0.5, 0.5, 'bark'),
  span(-2, -1, 6.75, 7.75, -0.75, 0.75, 'barkDark'),
  // The basket: a floor and four low walls.
  span(-6, -3, 7.5, 7.75, -1.5, 1.5, 'barkDark'),
  span(-6, -5.75, 7.75, 8.5, -1.5, 1.5, 'barkLight'),
  span(-3.25, -3, 7.75, 8.5, -1.5, 1.5, 'barkLight'),
  span(-5.75, -3.25, 7.75, 8.5, 1.25, 1.5, 'barkLight'),
  span(-5.75, -3.25, 7.75, 8.5, -1.5, -1.25, 'barkLight'),
];

/** The frozen melon in the basket: a block of pale ice with a darker stripe round it and a frosted top. */
const ammo: Box[] = [
  span(-5.5, -3.5, 7.75, 10, -1, 1, ICE_LIGHT),
  span(-5, -4, 7.75, 10, -1.25, 1.25, ICE_DARK),
  span(-5, -4, 10, 10.5, -0.5, 0.5, FROST),
];

/**
 * Ice armour, two big pale plates with a dark rim that slide in from the sides and clap shut over
 * the whole front of the melon, the face included; the eyes peek through a slit between the lower
 * and the upper plate. Each half also wraps its end of the melon.
 */
function iceHalf(sign: 1 | -1): Box[] {
  const z = (a: number, b: number): [number, number] => (sign > 0 ? [a, b] : [-b, -a]);
  const plate = (y0: number, y1: number): Box[] => {
    const [z0, z1] = z(0, 4);
    const [r0, r1] = z(3.75, 4);
    const [s0, s1] = z(0, 0.25);
    return [
      span(3, 3.5, y0, y1, z0, z1, ICE_LIGHT),
      // The dark rim round its front, and the seam where the halves meet.
      span(3.5, 3.75, y0, y0 + 0.25, z0, z1, ICE_DARK),
      span(3.5, 3.75, y1 - 0.25, y1, z0, z1, ICE_DARK),
      span(3.5, 3.75, y0 + 0.25, y1 - 0.25, r0, r1, ICE_DARK),
      span(3.5, 3.75, y0 + 0.25, y1 - 0.25, s0, s1, ICE_DARK),
    ];
  };
  const [w0, w1] = z(4.25, 4.75);
  return [
    // (From a fraction over the snow, so no plate face lies in the drift's or a leaf's plane.)
    ...plate(0.6, 3.25),
    ...plate(4.5, 6.25),
    // Round the front half of the melon's end.
    span(0, 3.5, 0.6, 6.25, w0, w1, ICE_LIGHT),
  ];
}
const iceL: Box[] = iceHalf(-1);
const iceR: Box[] = iceHalf(1);

/**
 * The barrage, `MELON_FLING_SECONDS`: the basket cranks back and down (`FLING_BACK`), whips up and
 * over the crown and lets go (`FLING_RELEASE`), swings on and comes back; the basket is empty from
 * the release until a new frozen melon pops into it near the end.
 */
function basketFling(): Clip {
  return {
    duration: MELON_FLING_SECONDS,
    loop: false,
    parts: ['arm', 'ammo', 'melon'],
    sample(t, pose) {
      const armPose = pose.arm as PartPose;
      const ammoPose = pose.ammo as PartPose;
      const body = pose.melon as PartPose;
      let turn: number; // degrees from rest: positive cranked back, negative over the top
      if (t < FLING_BACK) turn = 14 * easeOutQuad(t / FLING_BACK);
      else if (t < FLING_RELEASE) turn = 14 - 84 * easeInQuad((t - FLING_BACK) / (FLING_RELEASE - FLING_BACK));
      else if (t < FLING_OVER) turn = -70 - 20 * easeOutQuad((t - FLING_RELEASE) / (FLING_OVER - FLING_RELEASE));
      else turn = -90 * (1 - easeOutQuad(clamp01((t - FLING_OVER) / (MELON_FLING_SECONDS - FLING_OVER))));
      armPose.rz = DEG * turn;
      // Squashed as it cranks, stretched as it throws.
      body.sy = 1 + (turn > 0 ? -0.004 * turn : -0.0006 * turn);
      // The basket is empty once it has let go; the next melon grows back in three steps.
      const back = (t - 0.5) / (MELON_FLING_SECONDS - 0.5);
      ammoPose.s = t < FLING_RELEASE ? 1 : back < 0 ? 0.001 : Math.min(1, (1 + Math.floor(clamp01(back) * 3)) / 3);
    },
  };
}

/**
 * The freeze, `MELON_FREEZE_SECONDS` as authored: in `FREEZE_IN` it breathes in and swells, the
 * crown rising off its head and the basket dipping; it holds there shivering in hard steps, harder
 * as the blow nears; in the last `FREEZE_STAMP` it stamps down flat and springs back.
 */
function freeze(): Clip {
  return {
    duration: MELON_FREEZE_SECONDS,
    loop: false,
    parts: ['root', 'melon', 'crown', 'arm'],
    sample(t, pose) {
      const root = pose.root as PartPose;
      const body = pose.melon as PartPose;
      const crownPose = pose.crown as PartPose;
      const armPose = pose.arm as PartPose;
      const stampAt = MELON_FREEZE_SECONDS - FREEZE_STAMP;
      let puff: number; // 1 swollen, 0 rest
      let stamp = 0;
      if (t < FREEZE_IN) puff = easeOutQuad(t / FREEZE_IN);
      else if (t < stampAt) puff = 1;
      else {
        const u = clamp01((t - stampAt) / FREEZE_STAMP);
        puff = 1 - easeOutQuad(Math.min(1, u * 2));
        stamp = Math.sin(Math.PI * u);
      }
      const held = t >= FREEZE_IN && t < stampAt;
      const near = held ? (t - FREEZE_IN) / (stampAt - FREEZE_IN) : 0;
      const shiver = held ? (Math.floor(t * (10 + 10 * near)) % 2 === 0 ? 1 : -1) : 0;
      body.sy = 1 + 0.1 * puff - 0.14 * stamp;
      body.sx = body.sz = 1 + 0.05 * puff + 0.06 * stamp;
      body.rx = DEG * 1.5 * shiver * (0.4 + 0.6 * near);
      crownPose.py = 1.25 * puff + 0.2 * shiver * near;
      crownPose.rx = DEG * 5 * shiver * (0.3 + 0.7 * near);
      armPose.rz = DEG * (10 * puff + 2 * shiver - 12 * stamp);
      root.py = 0.4 * puff * (0.5 + 0.5 * near) - 0.4 * stamp;
    },
  };
}

/** The summon (and its roar), 0.6 s: the crown shakes side to side in hard steps, the melon hops. */
function crownShake(): Clip {
  return {
    duration: 0.6,
    loop: false,
    parts: ['crown', 'melon', 'arm'],
    sample(t, pose) {
      const u = clamp01(t / 0.6);
      const fade = 1 - u;
      const step = Math.floor(t * 16) % 2 === 0 ? 1 : -1;
      (pose.crown as PartPose).rx = DEG * 7 * step * fade;
      (pose.melon as PartPose).py = 0.4 * Math.sin(Math.PI * u);
      (pose.arm as PartPose).rz = DEG * 5 * step * fade;
    },
  };
}

/** Struck, 0.25 s: the melon shudders a little (it is big; a unit's recoil would throw it half a tile). */
function melonHit(): Clip {
  return {
    duration: 0.25,
    loop: false,
    parts: ['melon', 'crown'],
    sample(t, pose) {
      const u = clamp01(t / 0.25);
      const k = (1 - u) * (Math.floor(t * 24) % 2 === 0 ? 1 : -1);
      (pose.melon as PartPose).rz = DEG * 2 * k;
      (pose.crown as PartPose).rx = DEG * 3 * k;
    },
  };
}

/**
 * Beaten, `MELON_FALL_SECONDS`: it shudders, the crown tips forward off its head, the catapult
 * drops back, and the melon sags flat and wide.
 */
function crackAndSag(): Clip {
  return {
    duration: MELON_FALL_SECONDS,
    loop: false,
    parts: ['melon', 'crown', 'arm', 'ammo'],
    sample(t, pose) {
      const u = clamp01(t / MELON_FALL_SECONDS);
      const fall = easeInQuad(u);
      const shudder = (1 - u) * (Math.floor(t * 20) % 2 === 0 ? 1 : -1);
      const body = pose.melon as PartPose;
      body.sy = 1 - 0.4 * fall;
      body.sx = body.sz = 1 + 0.12 * fall;
      body.rz = DEG * (2 * shudder - 5 * fall);
      const crownPose = pose.crown as PartPose;
      crownPose.rz = DEG * -50 * fall;
      crownPose.px = 1.5 * fall;
      crownPose.py = -2 * fall;
      const armPose = pose.arm as PartPose;
      armPose.rz = DEG * 35 * easeOutQuad(clamp01(u * 2));
      armPose.py = -2.5 * fall;
      (pose.ammo as PartPose).py = -1.5 * fall;
    },
  };
}

export const frostMelon: ModelDef = {
  key: 'frostMelon',
  singleLevel: true,
  trim: [],
  eyes: ['eyes'],
  envelope: [12, 12, 16],
  // Where a frozen melon leaves: over the crown, as the basket comes past upright.
  muzzle: [0.5, 11, 0],
  parts: [
    { name: 'root', pivot: [0, 0, 0], boxes: drift },
    { name: 'melon', parent: 'root', pivot: [0, 0.5, 0], rot: [0, MELON_TURN, 0], boxes: melon, shadedBy: ['eyes'] },
    { name: 'eyes', parent: 'melon', pivot: [2.6, 3.9, 0], boxes: eyeWhites },
    { name: 'pupils', parent: 'eyes', pivot: [2.9, 3.75, 0], boxes: pupils },
    { name: 'glowEyes', parent: 'pupils', pivot: [3.1, 3.75, 0], hidden: true, boxes: glowEyes },
    { name: 'iceL', parent: 'melon', pivot: [3.25, 0.75, -1], hidden: true, boxes: iceL },
    { name: 'iceR', parent: 'melon', pivot: [3.25, 0.75, 1], hidden: true, boxes: iceR },
    { name: 'frostCracks', parent: 'melon', pivot: [0, 3.5, 0], hidden: true, boxes: frostCracks },
    { name: 'frostSpikes', parent: 'melon', pivot: [0, 6, 0], hidden: true, boxes: frostSpikes },
    { name: 'crown', parent: 'melon', pivot: [1, 6.5, 0], boxes: crown },
    { name: 'crownGlow', parent: 'crown', pivot: [1, 6.5, 0], hidden: true, boxes: crownGlow },
    { name: 'saddle', parent: 'melon', pivot: [0, 6, 0], rot: [0, -MELON_TURN, 0], boxes: saddle },
    { name: 'arm', parent: 'saddle', pivot: [-1.5, 7.25, 0], rot: [0, 0, -ARM_REST], boxes: arm },
    { name: 'ammo', parent: 'arm', pivot: [-4.5, 9, 0], boxes: ammo },
  ],
  clips: {
    idle: breathe({ body: 'melon' }),
    shoot: basketFling(),
    ability: crownShake(),
    cheer: freeze(),
    spawn: spawnRise('root'),
    hit: melonHit(),
    die: crackAndSag(),
  },
};
