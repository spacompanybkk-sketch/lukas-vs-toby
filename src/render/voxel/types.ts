// The model format. A character is a handful of named parts; each part is a list of boxes
// measured in voxels (1/16 tile), authored standing upright and facing its way down the lane
// (plants +X, zombies −X), with its feet centred on the origin. See docs/art-bible.md.

/** A palette name such as `'leaf'`, or a `'#RRGGBB'` literal for a one-off. */
export type ColorRef = string;

export interface Box {
  /** Minimum corner, in voxels, relative to the model origin (the centre of its feet). */
  at: [number, number, number];
  /** Size in voxels. Whole and half voxels keep the look chunky. */
  size: [number, number, number];
  /**
   * A colour in a model's `trim` list turns into the level material at levels 3 to 5. The
   * palette's own level colours (`levelIron`, `levelGold`, …) always use that material.
   */
  color: ColorRef;
  /**
   * How strongly the box glows in its own colour: the emissive intensity. 0 or absent is
   * no glow; 1.5 or more is bright enough to bloom (art bible section 3).
   */
  emissive?: number;
  /** The box exists from this level (default 1) … */
  minLevel?: number;
  /** … up to and including this level (default 5). */
  maxLevel?: number;
}

export interface PartDef {
  name: string;
  /** The part this one is attached to and moves with. Without one it hangs from the model itself. */
  parent?: string;
  /** The point the part turns and scales about, in voxels, in the same space as its boxes. */
  pivot: [number, number, number];
  /**
   * How the part is turned at rest, in degrees about X, Y and Z, around its pivot. Author
   * the model straight and upright, then bend it here: a slouching torso, a curling leaf.
   * Children turn with it.
   */
  rot?: [number, number, number];
  /** Later boxes paint over earlier ones where their faces lie in the same plane. */
  boxes: Box[];
}

export type ClipName = 'idle' | 'walk' | 'shoot' | 'melee' | 'hit' | 'spawn' | 'die' | 'cheer';

/**
 * Where a clip moves one part, as offsets from its rest pose: turns in radians, shifts in
 * voxels (in the parent's space), a scale `s`, and a further scale per axis (`sx`, `sy`,
 * `sz`) for squash and stretch. All about the part's pivot. At rest the turns and shifts
 * are 0 and the scales 1.
 */
export interface PartPose {
  rx: number;
  ry: number;
  rz: number;
  px: number;
  py: number;
  pz: number;
  s: number;
  sx: number;
  sy: number;
  sz: number;
}

/** One `PartPose` per part, by part name. */
export type Pose = Record<string, PartPose>;

export interface Clip {
  /** Seconds. */
  duration: number;
  /** A looping clip plays until another replaces it; any other plays once. */
  loop: boolean;
  /**
   * Writes the pose at `t` seconds into `pose`, which arrives at rest. A clip touches only
   * the parts it moves and skips any the model does not have. It must not keep or create
   * objects: it runs for every unit on every frame.
   */
  sample(t: number, pose: Pose): void;
}

export interface ModelDef {
  /** The unit's name in the registry and in `?scene=gallery&model=<key>`. */
  key: string;
  /** Parents may be listed before or after their children. */
  parts: PartDef[];
  /**
   * Colours that stand for "trim": at level 3 they become iron, at 4 crystal, at 5 gold.
   * The first entry takes the material's main tone and the second its shadow tone. Use a
   * trim colour only where the upgrade should show.
   */
  trim: ColorRef[];
  /** Parts that blink. Give each its pivot at the middle of the eye. */
  eyes?: string[];
  /** Where projectiles leave, in voxels. */
  muzzle?: [number, number, number];
  clips: Partial<Record<ClipName, Clip>>;
}
