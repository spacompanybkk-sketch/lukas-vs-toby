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
  /** … up to and including this level (default 5). Both are whole levels from 1 to 5. */
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
  /**
   * Other parts whose boxes also darken this part's creases, where the two rest against each
   * other. The shading is baked at rest, so name only parts that never move away from this
   * one (eyes on a head, armour on a chest). A limb that swings would leave its shadow
   * behind. By default a part is shaded against itself alone.
   */
  shadedBy?: string[];
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
   * The names of the parts the clip moves. A model whose clip names a part it does not have
   * is refused when it is built, so a misspelt name cannot pass as a model that stands
   * still. The shared builders fill this in; a hand-written clip should too.
   */
  parts?: string[];
  /**
   * Writes the pose at `t` seconds into `pose`, which arrives at rest. A clip touches only
   * the parts it moves. One that lists them in `parts` can rely on every one being there;
   * one without `parts` is not checked, so it must skip any part the model does not have.
   * It must not keep or create objects: it runs for every unit on every frame.
   */
  sample(t: number, pose: Pose): void;
}

/**
 * Where projectiles leave, in voxels, in the same space as the boxes. Given with a part,
 * the point rides on that part: it follows a turned head and moves with the shot. Given as
 * a bare point it stays where it is on the model, whatever the parts do.
 *
 * A mouth that grows with the levels moves its muzzle with `atLevel`: from each level
 * listed there up, that point replaces `at` (`{ 2: [7, 11.5, 0] }`: level 1 fires from
 * `at`, levels 2 to 5 from x 7).
 */
export type Muzzle =
  | [number, number, number]
  | { part: string; at: [number, number, number]; atLevel?: Partial<Record<2 | 3 | 4 | 5, [number, number, number]>> };

export interface ModelDef {
  /** The unit's name in the registry and in `?scene=gallery&model=<key>`. */
  key: string;
  /** Parents may be listed before or after their children. */
  parts: PartDef[];
  /**
   * Colours that stand for "trim": at level 3 they become iron, at 4 crystal, at 5 gold.
   * One or two entries: the first takes the material's main tone, the second its shadow
   * tone. Use a trim colour only where the upgrade should show.
   */
  trim: ColorRef[];
  /** Parts that blink. Give each its pivot at the middle of the eye. */
  eyes?: string[];
  /** Where projectiles leave. */
  muzzle?: Muzzle;
  /**
   * The size a level-1 model must fit, in voxels: wide (X), tall (Y), deep (Z). Leave it out
   * for a unit, which gets the art bible's 12 × 16 × 10; a base or a boss names its own.
   */
  envelope?: [number, number, number];
  clips: Partial<Record<ClipName, Clip>>;
}
