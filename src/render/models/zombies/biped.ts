import { Euler, MathUtils, Quaternion } from 'three';
import { hitRecoil, zombieCheer, zombieCrumble, zombieIdle, zombieRise, zombieWalk } from '../../voxel/clips';
import type { Box, Clip, ClipName, ColorRef, ModelDef, Muzzle, PartDef } from '../../voxel/types';

// The zombie rig. Every zombie is a biped built from the same seven parts, so the same
// clips walk, bite, throw, rise and crumble all of them:
//
//   root    the hips; moves everything (bob, roll, rise, recoil). Pivot at the feet.
//   torso   on the hips, slouched forward (10° unless the spec says otherwise)
//   head    on the torso, turned HEAD_TURN (38°) to the camera and tipped back HEAD_TIP
//           (12°) overall, whatever the slouch; a spec may set its own (`headRot`)
//   armL    on the torso at the left shoulder (+Z, the side the lawn camera sees)
//   armR    on the torso at the right shoulder (−Z)
//   legL    on the hips at the left hip
//   legR    on the hips at the right hip
//
// Zombies face −X. Arms are modelled reaching forward (along −X) from the shoulder, legs
// hanging down from the hip. Hats, weapons, shields, eyes and floating things are `extra`
// parts with one of the seven (or another extra) as their parent.
//
// To add a zombie: write `zombies/<key>.ts` exporting `bipedModel({...})`, with the boxes
// for each of the six body parts (in the model's voxels, as if standing straight), the eyes
// as an extra part on the head, and `clips` for `melee` and/or `shoot`; then register it.

/**
 * How far the head turns to the camera, and how far back it tips overall, in degrees. The
 * lawn camera looks along −Z, so a zombie walking along −X shows it its left side; at the
 * art bible's 14° its face is edge-on and the head reads as a green box, and at 30° the two
 * eyes still crowd into one corner. At 38°, tipped back 12°, the front of the face shows
 * about as much as the side of the head, so both eyes and the mouth read from the lawn
 * while the body still faces down its lane. (Hats wider than 6 voxels lose their back
 * corner to stay in the envelope.)
 */
export const HEAD_TURN = 38;
export const HEAD_TIP = 12;

/** The seven parts every biped has, in the order they are listed. */
export const BIPED_PARTS = ['root', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'] as const;
export type BipedPart = (typeof BIPED_PARTS)[number];

type Vec3 = [number, number, number];

/** Where each part turns, in voxels. */
export type BipedJoints = Record<Exclude<BipedPart, 'root'>, Vec3>;

/** A standard zombie, 16 voxels tall: hips at 4.5, shoulders at 9, neck at 10. */
export const DEFAULT_JOINTS: BipedJoints = {
  torso: [0, 5.5, 0],
  head: [-1, 10, 0],
  armL: [-0.5, 9, 4],
  armR: [-0.5, 9, -4],
  legL: [0, 4.5, 1.5],
  legR: [0, 4.5, -1.5],
};

export interface BipedSpec {
  key: string;
  /** The zombie's main colours, used for the hips the rig adds when `hips` is left out. */
  skin: ColorRef;
  cloth: ColorRef;
  clothDark: ColorRef;
  head: Box[];
  torso: Box[];
  armL: Box[];
  armR: Box[];
  legL: Box[];
  legR: Box[];
  /** The root's own boxes: the hips. Left out, a belt-and-hips block in `clothDark` and `cloth`. */
  hips?: Box[];
  /** Hats, weapons, shields, eyes; each names one of the parts above (or another extra) as its parent. */
  extra?: PartDef[];
  trim: ColorRef[];
  /** The extra parts that blink. */
  eyes: string[];
  /** One walk cycle (two steps), in seconds: 0.45 for the runner, 1 for a shuffle. */
  stepSeconds: number;
  muzzle?: Muzzle;
  /** Pivots, for a body that is not the standard size. */
  joints?: Partial<BipedJoints>;
  /** Degrees the torso pitches forward. Default 10 (art bible section 2). */
  slouch?: number;
  /**
   * The head's rest turn relative to the torso, in degrees. Default: whatever the slouch, the
   * head ends up turned `HEAD_TURN` to the camera and tipped back `HEAD_TIP`.
   */
  headRot?: Vec3;
  /** Rest turns of the limbs, for a pose other than arms-out (a runner's bent arms, a raised bow). */
  rots?: Partial<Record<'armL' | 'armR' | 'legL' | 'legR', Vec3>>;
  /** How hard it walks: stride and arm swing in degrees, bob in voxels. */
  walk?: { legs?: number; arms?: number; bob?: number; roll?: number };
  /** Parts that flutter in the idle: loose bandages, a feather, a floating skull. */
  sway?: string[];
  /** `shadedBy` for the body parts, as in `PartDef`. Default: the head is shaded by its eyes. */
  shadedBy?: Partial<Record<BipedPart, string[]>>;
  envelope?: [number, number, number];
  /** `melee`, `shoot`, and any of the defaults to replace. */
  clips?: Partial<Record<ClipName, Clip>>;
}

/** A zombie from the spec: the seven parts, the extras, and the clips every zombie plays. */
export function bipedModel(spec: BipedSpec): ModelDef {
  const joints = { ...DEFAULT_JOINTS, ...spec.joints };
  const slouch = spec.slouch ?? 10;
  const headRot: Vec3 = spec.headRot ?? headTurn(slouch);
  const hips: Box[] = spec.hips ?? [
    { at: [-1.5, 4.5, -2.25], size: [3, 1.5, 4.5], color: spec.clothDark },
    { at: [-1.5, 5.5, -2.25], size: [3, 0.5, 4.5], color: spec.cloth },
  ];
  const shaded = (name: BipedPart): string[] | undefined => spec.shadedBy?.[name] ?? (name === 'head' ? spec.eyes : undefined);
  const part = (name: BipedPart, parent: BipedPart | undefined, pivot: Vec3, boxes: Box[], rot?: Vec3): PartDef => {
    const def: PartDef = { name, pivot, boxes };
    if (parent) def.parent = parent;
    if (rot) def.rot = rot;
    const by = shaded(name);
    if (by && by.length > 0) def.shadedBy = by;
    return def;
  };
  const parts: PartDef[] = [
    part('root', undefined, [0, 0, 0], hips),
    part('torso', 'root', joints.torso, spec.torso, [0, 0, slouch]),
    part('head', 'torso', joints.head, spec.head, headRot),
    part('armL', 'torso', joints.armL, spec.armL, spec.rots?.armL),
    part('armR', 'torso', joints.armR, spec.armR, spec.rots?.armR),
    part('legL', 'root', joints.legL, spec.legL, spec.rots?.legL),
    part('legR', 'root', joints.legR, spec.legR, spec.rots?.legR),
    ...(spec.extra ?? []),
  ];
  const clips: Partial<Record<ClipName, Clip>> = {
    idle: zombieIdle(spec.sway ?? []),
    walk: zombieWalk(spec.stepSeconds, { ...walkFor(spec.stepSeconds), ...spec.walk }),
    hit: hitRecoil('root', 1),
    spawn: zombieRise(),
    die: zombieCrumble(),
    cheer: zombieCheer(),
    ...spec.clips,
  };
  const def: ModelDef = { key: spec.key, parts, trim: spec.trim, eyes: spec.eyes, clips };
  if (spec.muzzle) def.muzzle = spec.muzzle;
  if (spec.envelope) def.envelope = spec.envelope;
  return def;
}

/**
 * Zombies slower than this (seconds per walk cycle) bob and roll harder: from above the
 * legs are hidden under the body, so the bob and the roll carry the walk.
 */
export const SLOW_STEP = 0.75;

/** The bob (voxels) and roll (degrees) of a walk at this pace. */
export function walkFor(stepSeconds: number): { bob: number; roll: number } {
  return stepSeconds >= SLOW_STEP ? { bob: 1.5, roll: 6 } : { bob: 1, roll: 4 };
}

/**
 * The head's turn relative to a torso slouched `slouch` degrees, such that the head itself
 * is turned `turnDeg` (default `HEAD_TURN`) about the vertical and then tipped back `HEAD_TIP`: undoing the
 * slouch, then turning, then tipping.
 */
export function headTurn(slouch: number, turnDeg: number = HEAD_TURN): Vec3 {
  const rad = MathUtils.degToRad;
  const undo = new Quaternion().setFromEuler(new Euler(0, 0, rad(-slouch)));
  const turn = new Quaternion().setFromEuler(new Euler(0, rad(turnDeg), 0));
  const tip = new Quaternion().setFromEuler(new Euler(0, 0, rad(-HEAD_TIP)));
  const euler = new Euler().setFromQuaternion(undo.multiply(turn).multiply(tip), 'XYZ');
  const round = (value: number): number => Math.round(MathUtils.radToDeg(value) * 100) / 100;
  return [round(euler.x), round(euler.y), round(euler.z)];
}

/** How a zombie's two eyes sit on its face: see `zombieEyes`. */
export interface EyesSpec {
  /** The x of the face the eyes stand on; they stand half a voxel proud of it, towards −X. */
  face: number;
  /** The bottom of the near (+Z, camera-side) eye. */
  y: number;
  /** The near eye, wide (along Z) by tall. Default 2.5 × 3: the bigger one. */
  near?: [number, number];
  /** The far eye, wide by tall. Default 2 × 2.5. */
  far?: [number, number];
  /** How far the far eye's bottom sits above the near one's. Default 0.5. */
  farLift?: number;
  /** Face showing between the two eyes. Default 1 voxel. */
  gap?: number;
  /** The z of the middle of the gap. Default 0. */
  centre?: number;
  /** The eye's colour (`'socket'` for a skull). Default `'eye'`. */
  color?: ColorRef;
  /** A light in the middle of each eye, from `minLevel` (default 1): a skull's red light, or level 5's warm one. */
  light?: { color: ColorRef; emissive: number; minLevel?: number };
}

/**
 * A zombie's two eyes as boxes for its `eyes` part: two separate eyes on the front of the
 * face with face showing between them (one wrapped round the corner of the head read, from
 * the lawn camera, as one black visor), the near one bigger, each with a white glint in its
 * top corner on the sun's side (−Z).
 */
export function zombieEyes(spec: EyesSpec): Box[] {
  const [nearWide, nearTall] = spec.near ?? [2.5, 3];
  const [farWide, farTall] = spec.far ?? [2, 2.5];
  const gap = spec.gap ?? 1;
  const centre = spec.centre ?? 0;
  const x = spec.face - 0.5;
  const color = spec.color ?? 'eye';
  const nearZ = centre + gap / 2;
  const farZ = centre - gap / 2 - farWide;
  const farY = spec.y + (spec.farLift ?? 0.5);
  const boxes: Box[] = [
    { at: [x, spec.y, nearZ], size: [0.5, nearTall, nearWide], color },
    { at: [x, spec.y + nearTall - 1, nearZ], size: [0.5, 1, 1], color: 'eyeGlint' },
    { at: [x, farY, farZ], size: [0.5, farTall, farWide], color },
    { at: [x, farY + farTall - 1, farZ], size: [0.5, 1, 1], color: 'eyeGlint' },
  ];
  if (spec.light) {
    const { color: lit, emissive, minLevel } = spec.light;
    const gate = minLevel && minLevel > 1 ? { minLevel } : {};
    boxes.push(
      { at: [x, spec.y + 0.5, nearZ + nearWide - 1.5], size: [0.5, 1, 1], color: lit, emissive, ...gate },
      { at: [x, farY + 0.5, farZ + farWide - 1], size: [0.5, 1, 1], color: lit, emissive, ...gate },
    );
  }
  return boxes;
}

/**
 * A pale plate set flush into the front of the face (x = `face`), behind the eyes and
 * between them, so that black eyes on a shaded or dark face still read: a box for the head.
 */
export function facePlate(face: number, y0: number, y1: number, z0: number, z1: number, color: ColorRef, extra: Partial<Box> = {}): Box {
  return { at: [face, y0, z0], size: [0.5, y1 - y0, z1 - z0], color, ...extra };
}

/** Boxes from `boxes` with each one's level gate set, for a run of boxes that come in together. */
export function atLevels(minLevel: number, maxLevel: number, boxes: Box[]): Box[] {
  return boxes.map((box) => ({ ...box, minLevel, maxLevel }));
}

/**
 * The same boxes mirrored to the other side of the body (z → −z), for the right arm or leg
 * built from the left one.
 */
export function mirrorZ(boxes: Box[]): Box[] {
  return boxes.map((box) => ({ ...box, at: [box.at[0], box.at[1], -(box.at[2] + box.size[2])] as Vec3 }));
}
