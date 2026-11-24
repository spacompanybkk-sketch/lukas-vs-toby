import { breathe, spawnRise } from '../../voxel/clips';
import type { Box, Clip, ModelDef, PartPose } from '../../voxel/types';
import { span } from '../plants/kit';

// The Glowcap, the boss at the end of the zombies' Moonlit Meadow: a giant glowing mushroom
// standing in front of the plant base across three lanes. Faces +X. A sleepy, bubbly giant, never
// scary: a violet cap freckled with glowing spots, a pale stalk with a round face (big eyes whose
// pupils follow the nearest zombie, a little round "o" of a mouth, teal blush) and threads of
// mycelium creeping out into the two outer lanes, with small mushrooms on them: that is where the
// zombies there bite it.
//
// Built coarse, like the Elder Oak: the battle view draws it at `BOSS_LOOK.glowcap.scale` (4) times
// a unit's size, so a voxel here is a quarter of a tile. The stalk is turned to the player.
//
// Parts the view drives:
//   pupils         shifted sideways towards the nearest zombie
//   capL, capR     built hidden: its shield, two big shells of cap that slide in from the sides and
//                  clap shut over its face (`fx.shield: 'cap'`)
//   spotsLit       built hidden: the cap's spots lit up, blinking with the spore cloud's warning tiles
// Clips: shoot (the cap tips back and squirts a spore bomb forward), ability (the cap shakes: a
// summon, and its roar), cheer (the cap swells and shudders, looped: the spore cloud's wind-up),
// die (it deflates: the cap sags, the spots go out).

const DEG = Math.PI / 180;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const easeOutQuad = (u: number): number => 1 - (1 - u) * (1 - u);
const easeInQuad = (u: number): number => u * u;

/** The stalk is turned this far to the player (art bible section 2: faces turn to the camera). */
const STALK_TURN = -55;
/** How long it takes to deflate when it is beaten. */
export const GLOWCAP_DEFLATE_SECONDS = 1.2;

const CAP = '#8E4BD8';
const CAP_LIGHT = '#B07CF0';
const CAP_DARK = '#5B2A9E';
const GILL = '#3E1D74';
const STALK = '#F1E6CC';
const STALK_DARK = '#C9B88F';
const SOIL = '#4A3320';
const SOIL_LIGHT = '#6B4A2B';
const THREAD = '#D9CBA6';
/** The glowing spots: a soft pale green-yellow, past the bloom threshold when lit. */
const SPOT = '#D8FF9A';
const SPOT_LIT = '#F2FFC4';
const TEAL = '#4FE3C1';
/** The shells of the shield: a deeper violet than the cap, so the big lit faces still read as violet. */
const SHELL = '#4B2490';
const SHELL_RIM = '#2C1260';

const roots: Box[] = [
  // A mound of dark soil with mycelium threads creeping out into the outer lanes, a small mushroom on each.
  span(-3, 2.5, 0, 0.5, -3.5, 3.5, SOIL),
  span(-1.5, -0.5, 0, 0.5, 3.5, 6, THREAD),
  span(-1.5, -0.5, 0, 0.5, -6, -3.5, THREAD),
  // Little glowing mushrooms: a stem, a cap, a spot.
  span(-1.25, -0.75, 0.5, 1.25, 4.75, 5.25, STALK),
  span(-1.75, -0.25, 1.25, 1.75, 4.5, 5.5, CAP),
  span(-1.25, -0.75, 1.75, 2, 4.75, 5.25, SPOT, { emissive: 1.2 }),
  span(-1.25, -0.75, 0.5, 1.25, -5.25, -4.75, STALK),
  span(-1.75, -0.25, 1.25, 1.75, -5.5, -4.5, CAP),
  span(-1.25, -0.75, 1.75, 2, -5.25, -4.75, SPOT, { emissive: 1.2 }),
  span(1.5, 2.25, 0.5, 1, 2.5, 3, STALK_DARK),
  span(1.5, 2.25, 0.5, 1, -3, -2.5, STALK_DARK),
];

const stalk: Box[] = [
  // A tall pale stalk with a flared foot and a darker ring (the skirt) under the cap.
  span(-2.25, 2.25, 0.5, 1.5, -2.25, 2.25, STALK_DARK),
  span(-1.75, 1.75, 1.5, 7, -1.75, 1.75, STALK),
  span(-1.75, 1.75, 1.5, 7, -0.25, 0.25, STALK_DARK),
  span(-2.25, 2.25, 7, 7.5, -2.25, 2.25, STALK_DARK),
];

// The face is on the cap's front, where the lawn camera sees it (the cap overhangs the stalk, which hid a face there):
// a pale patch, big eyes whose pupils follow the nearest zombie, a little mouth and a teal blush on each cheek.
const eyeWhites: Box[] = [span(4, 4.25, 9, 10, -2.25, -0.75, 'bone'), span(4, 4.25, 9, 10, 0.75, 2.25, 'bone')];

const pupils: Box[] = [
  span(4.25, 4.5, 9, 9.9, -1.9, -1.1, 'eye'),
  span(4.25, 4.5, 9.6, 9.9, -1.9, -1.5, 'eyeGlint'),
  span(4.25, 4.5, 9, 9.9, 1.1, 1.9, 'eye'),
  span(4.25, 4.5, 9.6, 9.9, 1.1, 1.5, 'eyeGlint'),
];

/**
 * Where the cap's spots sit (x0, x1, y0, y1, z0, z1): standing a quarter voxel proud of the cap's top, the shoulder in front,
 * its flanks and its back. The first four (the top and the three on the front shoulder) are the ones that light up for the spore cloud.
 */
const SPOTS: readonly (readonly [number, number, number, number, number, number])[] = [
  [-0.75, 0.75, 12, 12.5, -0.75, 0.75],
  [3, 3.5, 10.5, 11, -0.5, 0.5],
  [3, 3.5, 10.5, 11, 1.5, 2.25],
  [3, 3.5, 10.5, 11, -2.25, -1.5],
  [-0.5, 0.5, 8.75, 9.75, 3.75, 4.25],
  [-0.5, 0.5, 8.75, 9.75, -4.25, -3.75],
  [-4.25, -3.75, 8.75, 9.75, -0.5, 0.5],
  [-2.5, -1.75, 11.5, 12, 0.75, 1.5],
];

const cap: Box[] = [
  // The cap, stepped like a dome: a dark gill rim, a tall lower body with the face on its flat front, then narrower layers to the top.
  span(-4, 4, 7.5, 8, -4, 4, GILL),
  span(-3.75, 3.75, 8, 10.5, -3.75, 3.75, CAP),
  span(-2.75, 2.75, 10.5, 11.5, -2.75, 2.75, CAP),
  span(-1.75, 1.75, 11.5, 12, -1.75, 1.75, CAP_LIGHT),
  // The face: a pale patch, a little round mouth, a teal blush on each cheek.
  span(3.75, 4, 8.25, 10.25, -3, 3, '#FFF8E6'),
  span(4, 4.25, 8.4, 8.9, -0.75, 0.75, 'mouthDark'),
  span(4, 4.25, 8.4, 8.9, -2.75, -1.75, TEAL),
  span(4, 4.25, 8.4, 8.9, 1.75, 2.75, TEAL),
  // The spots: pale and glowing.
  ...SPOTS.map(([x0, x1, y0, y1, z0, z1]) => span(x0, x1, y0, y1, z0, z1, SPOT, { emissive: 0.9 })),
];

/** The spore cloud's tell: the four spots on top and on the front shoulder swell and glow brighter. */
const spotsLit: Box[] = SPOTS.slice(0, 4).map(([x0, x1, y0, y1, z0, z1]) => span(x0 - 0.2, x1 + 0.2, y0 - 0.125, y1 + 0.25, z0 - 0.2, z1 + 0.2, SPOT_LIT, { emissive: 2.2 }));

/**
 * The cap closing: two big violet shells with a darker rim that slide in from the sides and clap
 * shut over the whole front, the stalk and the mouth (the eyes look out over the lower shell, under the
 * upper one), the lower one freckled with a glowing spot.
 */
function shellHalf(sign: 1 | -1): Box[] {
  const z = (a: number, b: number): [number, number] => (sign > 0 ? [a, b] : [-b, -a]);
  const plate = (y0: number, y1: number, x0: number): Box[] => {
    const [z0, z1] = z(0, 3);
    return [
      span(x0, x0 + 0.75, y0, y1, z0, z1, SHELL),
      // The dark rim along its top and bottom edges.
      span(x0 + 0.75, x0 + 1, y0, y0 + 0.25, z0, z1, SHELL_RIM),
      span(x0 + 0.75, x0 + 1, y1 - 0.25, y1, z0, z1, SHELL_RIM),
    ];
  };
  // A glowing spot on the big lower plate.
  const [c0, c1] = z(1, 1.75);
  return [...plate(0.75, 8.5, 4.5), span(5.5, 5.75, 3, 3.75, c0, c1, SPOT, { emissive: 1.2 }), ...plate(10.25, 11.5, 4.25)];
}
const capL: Box[] = shellHalf(-1);
const capR: Box[] = shellHalf(1);

/** The barrage, 0.7 s: the cap tips back, then snaps forward and squirts a spore bomb. */
function capSquirt(): Clip {
  return {
    duration: 0.7,
    loop: false,
    parts: ['cap', 'stalk'],
    sample(t, pose) {
      const capPose = pose.cap as PartPose;
      const stalkPose = pose.stalk as PartPose;
      let lean: number; // 1 back, −1 forward
      if (t < 0.18) lean = easeOutQuad(t / 0.18);
      else if (t < 0.3) lean = 1 - 2 * easeInQuad((t - 0.18) / 0.12);
      else lean = -(1 - easeOutQuad(clamp01((t - 0.3) / 0.4)));
      capPose.rz = DEG * 12 * lean;
      capPose.py = 0.3 * Math.abs(lean);
      capPose.sy = 1 + 0.08 * Math.max(0, lean);
      stalkPose.rz = DEG * 4 * lean;
      stalkPose.sy = 1 - 0.05 * Math.abs(lean);
    },
  };
}

/** The summon (and its roar), 0.6 s: the cap shakes side to side in hard steps and puffs up, the stalk bounces. */
function capShake(): Clip {
  return {
    duration: 0.6,
    loop: false,
    parts: ['cap', 'stalk'],
    sample(t, pose) {
      const u = clamp01(t / 0.6);
      const fade = 1 - u;
      const step = Math.floor(t * 16) % 2 === 0 ? 1 : -1;
      (pose.cap as PartPose).rx = DEG * 7 * step * fade;
      (pose.cap as PartPose).s = 1 + 0.08 * Math.sin(Math.PI * u);
      (pose.stalk as PartPose).py = 0.25 * Math.sin(Math.PI * u);
    },
  };
}

/** Struck, 0.25 s: the stalk shudders a little (it is big; a unit's recoil would throw it half a tile). */
function capHit(): Clip {
  return {
    duration: 0.25,
    loop: false,
    parts: ['stalk', 'cap'],
    sample(t, pose) {
      const u = clamp01(t / 0.25);
      const k = (1 - u) * (Math.floor(t * 24) % 2 === 0 ? 1 : -1);
      (pose.stalk as PartPose).rz = DEG * 2 * k;
      (pose.cap as PartPose).rx = DEG * 3 * k;
    },
  };
}

/**
 * The spore cloud's call, a 0.8 s loop: the cap swells and shrinks in hard steps like a big breath
 * about to be let out, shuddering, the stalk hopping.
 */
function swell(): Clip {
  return {
    duration: 0.8,
    loop: true,
    parts: ['stalk', 'cap'],
    sample(t, pose) {
      const u = (((t % 0.8) + 0.8) % 0.8) / 0.8;
      const beat = 2 * Math.PI * u;
      const big = Math.floor(u * 4) % 2 === 0 ? 1 : 0;
      (pose.stalk as PartPose).py = 0.5 * Math.max(0, Math.sin(beat));
      (pose.cap as PartPose).sx = (pose.cap as PartPose).sz = 1 + 0.1 * big;
      (pose.cap as PartPose).sy = 1 + 0.06 * Math.sin(beat - 0.8);
      (pose.cap as PartPose).rz = DEG * 3 * Math.sin(beat * 2);
    },
  };
}

/** Beaten, `GLOWCAP_DEFLATE_SECONDS`: the cap sags and spreads, the stalk bows and shrinks, like a mushroom letting out its air. */
function deflate(): Clip {
  return {
    duration: GLOWCAP_DEFLATE_SECONDS,
    loop: false,
    parts: ['cap', 'stalk'],
    sample(t, pose) {
      const u = clamp01(t / GLOWCAP_DEFLATE_SECONDS);
      const fall = easeInQuad(u);
      const capPose = pose.cap as PartPose;
      capPose.py = -4.5 * fall;
      capPose.sy = 1 - 0.55 * fall;
      capPose.sx = capPose.sz = 1 + 0.15 * fall;
      capPose.rz = DEG * -10 * fall;
      capPose.rx = DEG * 6 * Math.sin(u * 9) * (1 - u);
      const stalkPose = pose.stalk as PartPose;
      stalkPose.sy = 1 - 0.2 * fall;
      stalkPose.rz = -6 * DEG * fall;
    },
  };
}

export const glowcap: ModelDef = {
  key: 'glowcap',
  singleLevel: true,
  trim: [],
  eyes: ['eyes'],
  envelope: [13, 13, 16],
  muzzle: { part: 'cap', at: [0, 10, 0] },
  parts: [
    { name: 'root', pivot: [0, 0, 0], boxes: roots },
    { name: 'stalk', parent: 'root', pivot: [0, 0.5, 0], rot: [0, STALK_TURN, 0], boxes: stalk },
    { name: 'eyes', parent: 'cap', pivot: [4.1, 9.5, 0], boxes: eyeWhites },
    { name: 'pupils', parent: 'eyes', pivot: [4.35, 9.4, 0], boxes: pupils },
    { name: 'capL', parent: 'stalk', pivot: [4.4, 0.75, -1], hidden: true, boxes: capL },
    { name: 'capR', parent: 'stalk', pivot: [4.4, 0.75, 1], hidden: true, boxes: capR },
    { name: 'cap', parent: 'stalk', pivot: [0, 7.5, 0], boxes: cap, shadedBy: ['eyes'] },
    { name: 'spotsLit', parent: 'cap', pivot: [0, 7.5, 0], hidden: true, boxes: spotsLit },
  ],
  clips: {
    idle: breathe({ body: 'stalk', sway: ['cap'] }),
    shoot: capSquirt(),
    ability: capShake(),
    cheer: swell(),
    spawn: spawnRise('root'),
    hit: capHit(),
    die: deflate(),
  },
};
