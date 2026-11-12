import { Color, Euler, Group, Mesh, Quaternion, type MeshStandardMaterial, type Object3D, type Vector3 } from 'three';
import { VOXEL, buildParts, muzzleOf } from './build';
import { ownCopy } from './materials';
import type { Clip, ClipName, ModelDef, PartPose, Pose } from './types';

/** Seconds over which one clip gives way to the next. */
const FADE_SECONDS = 0.1;
/** Art bible section 2: the eyes close to a tenth of their height for 100 ms every 2 to 5 s. */
const BLINK_SECONDS = 0.1;
const BLINK_HEIGHT = 0.1;
const BLINK_GAP_MIN = 2;
const BLINK_GAP_SPREAD = 3;
/** Scene brightness a full white flash adds: enough to read as white through the tone mapper. */
const FLASH_PEAK = 1;

function atRest(): PartPose {
  return { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, s: 1, sx: 1, sy: 1, sz: 1 };
}

function copyPose(to: PartPose, from: PartPose): void {
  to.rx = from.rx;
  to.ry = from.ry;
  to.rz = from.rz;
  to.px = from.px;
  to.py = from.py;
  to.pz = from.pz;
  to.s = from.s;
  to.sx = from.sx;
  to.sy = from.sy;
  to.sz = from.sz;
}

function resetPose(pose: PartPose): void {
  pose.rx = pose.ry = pose.rz = 0;
  pose.px = pose.py = pose.pz = 0;
  pose.s = pose.sx = pose.sy = pose.sz = 1;
}

/** One part of one instance: its object, where it rests, and its pose buffers. */
interface Joint {
  object: Object3D;
  restX: number;
  restY: number;
  restZ: number;
  /** How the part is turned at rest. A clip's turn is applied in the frame this leaves. */
  rest: Quaternion;
  /** What the playing clip asks for. */
  target: PartPose;
  /** The pose when the last cross-fade began. */
  from: PartPose;
  /** What is on screen: `target`, or a blend from `from` while fading. */
  shown: PartPose;
  blinks: boolean;
}

/** A material of this instance's own, standing in for a shared one while it flashes. */
interface FlashCopy {
  shared: MeshStandardMaterial;
  own: MeshStandardMaterial;
  /** The shared material's own glow (emissive × intensity), which the flash builds on. */
  glow: Color;
}

const turn = new Euler();
const offset = new Quaternion();

let made = 0;

/**
 * One unit on screen: a model at a level, playing clips.
 *
 * `root` is the game's to move, turn and scale; the level's size is applied one step
 * inside it. Geometry and materials are shared with every other instance of the same model
 * and level, so an instance is cheap; only a flash gives it materials of its own.
 */
export class ModelInstance {
  readonly root = new Group();
  readonly def: ModelDef;
  readonly level: number;

  private readonly model: Group;
  private readonly joints: Joint[] = [];
  /** The view of `joints[].target` that clips write into. */
  private readonly pose: Pose = {};
  private readonly meshes: Mesh[] = [];
  private readonly sharedMaterials: MeshStandardMaterial[] = [];
  private flashCopies: FlashCopy[] | null = null;
  private flash = 0;
  /** The object the muzzle rides on, and the muzzle in that object's own space (tiles). */
  private readonly muzzleOn: Object3D;
  private readonly muzzleX: number;
  private readonly muzzleY: number;
  private readonly muzzleZ: number;

  /** What is playing, and how far in. */
  private current: ClipName | null = null;
  private time = 0;
  private speed = 1;
  /** True while a one-shot is under way: from `play` until it ends or another replaces it. */
  private busy = false;
  private onDone: (() => void) | null = null;
  /** The looping clip a one-shot returns to. It keeps time while the one-shot plays. */
  private loop: ClipName | null = null;
  private loopTime = 0;
  private loopSpeed = 1;
  private fadeLeft = 0;
  /** Set when `die` starts. Nothing plays after that. */
  private dead = false;

  private seed: number;
  private blinkIn: number;
  private blinkLeft = 0;
  private disposed = false;

  constructor(def: ModelDef, level: number) {
    this.def = def;
    this.level = level;
    this.model = buildParts(def, level);
    this.root.name = `${def.key}@${level}`;
    this.root.add(this.model);

    const eyes = new Set(def.eyes ?? []);
    for (const part of def.parts) {
      const object = this.model.getObjectByName(part.name) as Object3D;
      const joint: Joint = {
        object,
        restX: object.position.x,
        restY: object.position.y,
        restZ: object.position.z,
        rest: object.quaternion.clone(),
        target: atRest(),
        from: atRest(),
        shown: atRest(),
        blinks: eyes.has(part.name),
      };
      this.joints.push(joint);
      this.pose[part.name] = joint.target;
    }
    this.model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      this.meshes.push(object);
      this.sharedMaterials.push(object.material as MeshStandardMaterial);
    });

    // A muzzle on a part is kept relative to that part's pivot; a bare point, or none (the
    // model's feet), is kept relative to the model.
    const muzzle = muzzleOf(def, level);
    const rides = muzzle.part === undefined ? undefined : def.parts.find((part) => part.name === muzzle.part);
    const at = muzzle.at;
    const pivot = rides ? rides.pivot : [0, 0, 0];
    this.muzzleOn = rides ? (this.model.getObjectByName(rides.name) as Object3D) : this.model;
    this.muzzleX = ((at[0] as number) - (pivot[0] as number)) * VOXEL;
    this.muzzleY = ((at[1] as number) - (pivot[1] as number)) * VOXEL;
    this.muzzleZ = ((at[2] as number) - (pivot[2] as number)) * VOXEL;

    // Each unit gets its own timing, so a row of them does not move as one.
    this.seed = Math.imul(++made, 0x9e3779b1) >>> 0;
    this.blinkIn = this.nextBlinkGap();
    if (def.clips.idle?.loop) {
      this.loop = this.current = 'idle';
      this.loopTime = this.time = this.random() * def.clips.idle.duration;
    }
    this.apply();
  }

  /** The clip that is playing, or null for a model with nothing to play. */
  get clip(): ClipName | null {
    return this.current;
  }

  /**
   * Plays a clip, cross-fading from whatever is on screen.
   *
   * A looping clip is what the unit does between one-shots. It plays until another looping
   * clip replaces it, and asking for the one already playing does not restart it. Asked for
   * while a one-shot is under way, it does not cut the one-shot short: it only changes what
   * the one-shot returns to.
   *
   * Any other clip is a one-shot: it plays once and gives way to the looping clip. `onDone`
   * is called exactly once, when the one-shot ends or when another one-shot replaces it,
   * whichever comes first.
   *
   * `die` is the last clip a unit plays. It stays on its final frame, and once it has
   * started every later `play` is ignored, callback and all.
   *
   * A model without the clip carries on as it was and `onDone` is called at once.
   */
  play(clip: ClipName, opts?: { speed?: number; onDone?: () => void }): void {
    if (this.dead) return;
    const next = this.def.clips[clip];
    if (!next) {
      opts?.onDone?.();
      return;
    }
    const speed = opts?.speed !== undefined && opts.speed > 0 ? opts.speed : 1;

    if (next.loop) {
      if (this.loop !== clip) {
        this.loop = clip;
        this.loopTime = 0;
      }
      this.loopSpeed = speed;
      if (this.busy) return;
      if (this.current !== clip) {
        this.startFade();
        this.current = clip;
        this.time = this.loopTime;
      }
      this.speed = speed;
      return;
    }

    const interrupted = this.onDone;
    this.startFade();
    this.current = clip;
    this.time = 0;
    this.speed = speed;
    this.busy = true;
    this.onDone = opts?.onDone ?? null;
    if (clip === 'die') this.dead = true;
    // Last, so that a callback which plays something finds the instance settled.
    interrupted?.();
  }

  /**
   * Jumps the playing clip to `seconds`, with no cross-fade and the eyes open, and poses the
   * model there. For stills: the gallery and card portraits. Follow it with `update(0)` to
   * hold the pose; a one-shot sought to its very end holds its last pose until time moves.
   */
  seek(seconds: number): void {
    const clip = this.current ? this.def.clips[this.current] : undefined;
    if (clip) {
      const t = Number.isFinite(seconds) ? seconds : 0;
      this.time = clip.loop ? ((t % clip.duration) + clip.duration) % clip.duration : Math.min(Math.max(t, 0), clip.duration);
      if (clip.loop) this.loopTime = this.time;
    }
    this.fadeLeft = 0;
    this.blinkLeft = 0;
    this.apply();
  }

  /** Moves the animation on by `dtSeconds` of game time and poses the parts. Allocates nothing. */
  update(dtSeconds: number): void {
    const dt = dtSeconds > 0 ? dtSeconds : 0;

    const loop = this.loop ? this.def.clips[this.loop] : undefined;
    if (loop) this.loopTime = (this.loopTime + dt * this.loopSpeed) % loop.duration;

    const clip = this.current ? this.def.clips[this.current] : undefined;
    if (clip?.loop) {
      this.time = this.loopTime;
    } else if (clip && this.busy && dt > 0) {
      this.time += dt * this.speed;
      if (this.time >= clip.duration) this.finish(clip);
    }

    this.fadeLeft = Math.max(0, this.fadeLeft - dt);

    if (this.blinkLeft > 0) {
      this.blinkLeft = Math.max(0, this.blinkLeft - dt);
    } else {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) {
        this.blinkLeft = BLINK_SECONDS;
        this.blinkIn = this.nextBlinkGap();
      }
    }

    this.apply();
  }

  /** Tints the whole model towards white: 0 is none, 1 is full. The caller fades it out. */
  setFlash(amount: number): void {
    const flash = amount > 0 ? Math.min(amount, 1) : 0;
    if (flash === this.flash || this.disposed) return;
    this.flash = flash;
    const { meshes, sharedMaterials } = this;

    if (flash === 0) {
      for (let i = 0; i < meshes.length; i++) (meshes[i] as Mesh).material = sharedMaterials[i] as MeshStandardMaterial;
      return;
    }

    if (!this.flashCopies) {
      const copies: FlashCopy[] = [];
      for (const shared of new Set(sharedMaterials)) {
        const glow = new Color().copy(shared.emissive).multiplyScalar(shared.emissiveIntensity);
        const own = ownCopy(shared);
        own.name = `${shared.name} (flash)`;
        own.emissiveIntensity = 1;
        copies.push({ shared, own, glow });
      }
      this.flashCopies = copies;
    }
    const copies = this.flashCopies;
    for (let c = 0; c < copies.length; c++) {
      const { glow, own } = copies[c] as FlashCopy;
      own.emissive.setRGB(
        glow.r + (Math.max(glow.r, FLASH_PEAK) - glow.r) * flash,
        glow.g + (Math.max(glow.g, FLASH_PEAK) - glow.g) * flash,
        glow.b + (Math.max(glow.b, FLASH_PEAK) - glow.b) * flash,
      );
    }
    for (let i = 0; i < meshes.length; i++) {
      const shared = sharedMaterials[i];
      for (let c = 0; c < copies.length; c++) {
        const copy = copies[c] as FlashCopy;
        if (copy.shared === shared) {
          (meshes[i] as Mesh).material = copy.own;
          break;
        }
      }
    }
  }

  /**
   * Shows or hides a part and everything on it: damage cracks below half health, say. A
   * part the model builds hidden (`PartDef.hidden`) starts hidden. Survives `setLevel`.
   */
  showPart(name: string, shown: boolean): void {
    const joint = this.joints.find((j) => j.object.name === name);
    if (!joint) throw new Error(`Model "${this.def.key}" has no part "${name}" to show or hide`);
    joint.object.visible = shown;
  }

  /**
   * The same unit at another level: a new instance that takes this one's place under the
   * same parent, with the same transform, clip, clip time and flash. This instance is
   * disposed, and anything else that was hung on its `root` goes with it: hang health bars
   * and the like on a wrapper of your own. Asking for the level it already has returns the
   * instance itself.
   */
  setLevel(level: number): ModelInstance {
    if (level === this.level) return this;
    const next = new ModelInstance(this.def, level);
    next.root.position.copy(this.root.position);
    next.root.quaternion.copy(this.root.quaternion);
    next.root.scale.copy(this.root.scale);
    next.root.visible = this.root.visible;

    next.current = this.current;
    next.time = this.time;
    next.speed = this.speed;
    next.busy = this.busy;
    next.onDone = this.onDone;
    next.loop = this.loop;
    next.loopTime = this.loopTime;
    next.loopSpeed = this.loopSpeed;
    next.fadeLeft = this.fadeLeft;
    next.dead = this.dead;
    next.seed = this.seed;
    next.blinkIn = this.blinkIn;
    next.blinkLeft = this.blinkLeft;
    // Both were built from the same definition, so their parts line up one to one.
    for (let i = 0; i < this.joints.length; i++) {
      copyPose((next.joints[i] as Joint).from, (this.joints[i] as Joint).from);
      (next.joints[i] as Joint).object.visible = (this.joints[i] as Joint).object.visible;
    }
    next.apply();
    next.setFlash(this.flash);

    this.onDone = null;
    this.root.parent?.add(next.root);
    this.dispose();
    return next;
  }

  /**
   * World position of the muzzle. A muzzle given on a part follows that part as it is posed
   * right now: the turn of the head, the lean of the shot. A muzzle given as a bare point
   * stays put on the model; a model with none answers with its feet.
   */
  muzzleWorld(out: Vector3): Vector3 {
    this.muzzleOn.updateWorldMatrix(true, false);
    return out.set(this.muzzleX, this.muzzleY, this.muzzleZ).applyMatrix4(this.muzzleOn.matrixWorld);
  }

  /**
   * Takes the instance out of the scene and frees the materials it made for flashing. The
   * geometry and the shared materials belong to every instance of the model and stay.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    if (this.flashCopies) {
      for (const copy of this.flashCopies) copy.own.dispose();
      this.flashCopies = null;
    }
  }

  /** A one-shot clip has reached its end. */
  private finish(clip: Clip): void {
    const done = this.onDone;
    this.onDone = null;
    this.busy = false;
    if (this.dead || !this.loop) {
      // Nothing to go back to: stay on the last frame.
      this.time = clip.duration;
    } else {
      this.startFade();
      this.current = this.loop;
      this.time = this.loopTime;
      this.speed = this.loopSpeed;
    }
    done?.();
  }

  /** Remembers what is on screen, to blend from. */
  private startFade(): void {
    for (let i = 0; i < this.joints.length; i++) {
      const joint = this.joints[i] as Joint;
      copyPose(joint.from, joint.shown);
    }
    this.fadeLeft = FADE_SECONDS;
  }

  /** Samples the playing clip, blends it in if a fade is running, and writes the parts' transforms. */
  private apply(): void {
    const { joints } = this;
    // Indexed loops: this runs for every unit on every frame and must allocate nothing.
    for (let i = 0; i < joints.length; i++) resetPose((joints[i] as Joint).target);
    const clip = this.current ? this.def.clips[this.current] : undefined;
    clip?.sample(this.time, this.pose);

    // 0 at the start of a fade, 1 when it is over; eased so it neither starts nor stops abruptly.
    const u = 1 - this.fadeLeft / FADE_SECONDS;
    const k = u * u * (3 - 2 * u);
    const lid = this.blinkLeft > 0 ? BLINK_HEIGHT : 1;

    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i] as Joint;
      const { target, from, shown, object } = joint;
      if (this.fadeLeft > 0) {
        shown.rx = from.rx + (target.rx - from.rx) * k;
        shown.ry = from.ry + (target.ry - from.ry) * k;
        shown.rz = from.rz + (target.rz - from.rz) * k;
        shown.px = from.px + (target.px - from.px) * k;
        shown.py = from.py + (target.py - from.py) * k;
        shown.pz = from.pz + (target.pz - from.pz) * k;
        shown.s = from.s + (target.s - from.s) * k;
        shown.sx = from.sx + (target.sx - from.sx) * k;
        shown.sy = from.sy + (target.sy - from.sy) * k;
        shown.sz = from.sz + (target.sz - from.sz) * k;
      } else {
        copyPose(shown, target);
      }
      object.position.set(
        joint.restX + shown.px * VOXEL,
        joint.restY + shown.py * VOXEL,
        joint.restZ + shown.pz * VOXEL,
      );
      // The clip's turn happens in the part's own rest frame: a torso that rests leaning
      // forward rolls about its own leaning axis, not about its parent's.
      if (shown.rx === 0 && shown.ry === 0 && shown.rz === 0) object.quaternion.copy(joint.rest);
      else object.quaternion.multiplyQuaternions(joint.rest, offset.setFromEuler(turn.set(shown.rx, shown.ry, shown.rz)));
      object.scale.set(shown.s * shown.sx, shown.s * shown.sy * (joint.blinks ? lid : 1), shown.s * shown.sz);
    }
  }

  /** A repeatable random number in [0, 1), from this instance's own sequence. */
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private nextBlinkGap(): number {
    return BLINK_GAP_MIN + BLINK_GAP_SPREAD * this.random();
  }
}
