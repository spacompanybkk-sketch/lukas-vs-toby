import { Box3, Group, Mesh, Vector3, type Object3D } from 'three';
import type { Faction, UnitKey } from '../../sim/types';
import { getModelDef } from '../models/registry';
import { ModelInstance } from '../voxel/rig';
import type { ClipName, ModelDef } from '../voxel/types';

// One unit on the lawn: a wrapper group named `unit-<id>` (scale 1) that the battle view
// moves along the lane, holding the model, which plays clips and changes level inside it.
// Everything here is driven by `BattleView`; nothing allocates per frame.

/** Art bible section 5: the merge takes 0.6 s and swaps the level at its peak. */
export const MERGE_SECONDS = 0.6;
const MERGE_PEAK = 1.35;
/** A view is taken away this long after its unit died. */
export const DEATH_SECONDS = 0.5;
/** Art bible section 5, Hit: 60 ms white, then it fades as the recoil returns. */
const FLASH_HOLD = 0.06;
const FLASH_FADE = 0.08;
/** The thrower lets go of the brain this far into its throw and has a new one this long after. */
export const RELEASE_SECONDS = 0.12;
const BRAIN_BACK_SECONDS = 0.4;
/** How fast stacked zombies (and biters stepping back) slide to their place beside each other, per second. */
const STACK_FOLLOW = 8;
/**
 * A Pumpkin's leap (the simulation never moves it): it crouches, flies to its target in the
 * leap clip's air time, slams down at the clip's impact, sits there a moment and hops home.
 */
const LEAP_TAKE_OFF = 0.1;
const LEAP_IMPACT = 0.4;
const LEAP_HOME_AT = 0.75;
const LEAP_SECONDS = 1.1;
/** Height of the hop home, in tiles, and the step it is cut into (one voxel). */
const LEAP_HOP = 0.35;
const VOXEL = 1 / 16;
/** Hot Topic grows this much per stack (plan Task 5). */
export const GROW_PER_STACK = 0.06;

const easeInOutCubic = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;

/** What the view tells its owner about, so effects stay in one place. */
export interface UnitHooks {
  /** The merge has reached its peak and the new level is in. */
  mergePeak(view: UnitView): void;
  /** The dying unit breaks up now: debris, a blast, a puff. */
  burst(view: UnitView): void;
  /** A leaping unit has come down on its target (see `UnitView.leap`). */
  landed?(view: UnitView): void;
}

const box = new Box3();

/** Height of the top of a model above its feet, in tiles. Measured when a model is adopted. */
function measureHeight(instance: ModelInstance): number {
  // Measured at rest size and facing: a merge swaps the level while the root is spun and swollen.
  const root = instance.root;
  const scale = root.scale.x;
  const turn = root.rotation.y;
  root.scale.setScalar(1);
  root.rotation.y = 0;
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const height = Number.isFinite(box.max.y) ? box.max.y - root.getWorldPosition(scratch).y : 1;
  root.scale.setScalar(scale);
  root.rotation.y = turn;
  root.updateMatrixWorld(true);
  return height;
}
const scratch = new Vector3();
const leapAt = { x: 0, y: 0 };

/**
 * Below this size (tiles, the longest side of a mesh's own box) a mesh casts no shadow: eyes,
 * glints, small accents and held props add a shadow draw each and nothing a child can see.
 */
export const SHADOW_MIN_SIZE = 0.2;

/**
 * Parts whose shadow nobody sees under the body's own: the eyes (their box spans both eyes,
 * so size alone misses them), accents and held props. Glowing pieces cast none either.
 */
const NO_SHADOW_PARTS = new Set(['eyes', 'sprout', 'fuse', 'band', 'trail', 'brain', 'floatBrain', 'cracks', 'aura']);

/**
 * Turns shadows off for a model's small meshes, for the parts named in `NO_SHADOW_PARTS`, for
 * glowing pieces and for parts built hidden (damage cracks), keeping them on bodies, heads,
 * limbs and anything big. Done once per adopted instance.
 */
export function trimShadows(instance: ModelInstance): void {
  instance.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const b = geometry.boundingBox as Box3;
    const longest = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    let hidden = false;
    for (let o: Object3D | null = object; o && o !== instance.root; o = o.parent) if (!o.visible) hidden = true;
    const part = object.name.slice(0, object.name.indexOf(':'));
    const glow = object.name.includes(':glow');
    if (longest < SHADOW_MIN_SIZE || hidden || glow || NO_SHADOW_PARTS.has(part)) object.castShadow = false;
  });
}

export class UnitView {
  readonly id: number;
  readonly key: UnitKey;
  readonly faction: Faction;
  readonly lane: number;
  readonly def: ModelDef;
  readonly wrapper = new Group();
  model: ModelInstance;

  /** The unit's x at the last two simulation steps; drawn between them. */
  prevX: number;
  currX: number;
  hp = 1;
  maxHp = 1;
  level = 1;
  blocked = false;
  /** Sideways and upward nudge for a zombie in a stack: where it is and where it is going. */
  offsetZ = 0;
  targetZ = 0;
  /** Its place in a stack (0: first), which also lifts its health bar clear of the others'. */
  stackPlace = 0;
  /** Drawn this far back from where it stands: a biting zombie steps back off its plant. */
  offsetX = 0;
  targetX = 0;
  /** Lifted this far in a stack (art bible section 6: offset in depth and height). */
  offsetY = 0;
  targetY = 0;
  /** Height of the top of the model above its feet, in tiles, for the current level and growth. */
  height = 1;
  /** The height at rest size; `height` is this times `bulk`. */
  private restHeight = 1;
  /** How much bigger than its level makes it the unit has grown (Hot Topic's stacks). */
  bulk = 1;
  /** The statuses its marks show, one bit each (see `BattleView`), and the height they were set for. */
  statusBits = 0;
  marksHeight = -1;
  /** True when it went off rather than died (a mine, a cherry): it vanishes with no crumble. */
  spent = false;
  /** The last hero power show that flashed it (see `BattleView.heroHit`), or 0. */
  heroShow = 0;
  /** View time (seconds) it was last tied, or −1: see `BattleView`. */
  tiedAt = -1;
  /** A Potato Mine showing its armed light. */
  armed = false;
  /** While leaping: seconds in, and how far along the lane its target stands from it. */
  private leapFor = -1;
  private leapDX = 0;
  private leapLanded = false;
  /** Seconds since the unit died, or −1 while it stands. */
  dyingFor = -1;
  /** Seconds the dying unit takes to break up (its `die` clip). */
  private burstAt = 0.2;
  private burst = false;
  /** While merging: seconds in, and the level it becomes. */
  private mergeFor = -1;
  private mergeTo = 1;
  private flashFor = -1;
  /** A merge target being offered: it pulses. */
  pulsing = false;
  private brainOutIn = -1;
  private brainBackIn = -1;
  private loopName: ClipName;
  private readonly hooks: UnitHooks;
  private readonly hasCracks: boolean;
  private readonly hasBrain: boolean;
  /** A soil pad that is not the body's parent (the Pumpkin): it stays home through a leap. */
  private readonly hasPad: boolean;
  private cracked = false;
  private time = 0;

  constructor(id: number, key: UnitKey, faction: Faction, lane: number, x: number, level: number, hooks: UnitHooks) {
    this.id = id;
    this.key = key;
    this.faction = faction;
    this.lane = lane;
    this.prevX = this.currX = x;
    this.level = level;
    this.hooks = hooks;
    this.def = getModelDef(key);
    this.model = new ModelInstance(this.def, level);
    trimShadows(this.model);
    this.restHeight = this.height = measureHeight(this.model);
    this.wrapper.name = `unit-${id}`;
    this.wrapper.add(this.model.root);
    this.wrapper.position.set(x, 0, lane + 0.5);
    const parts = new Set(this.def.parts.map((p) => p.name));
    this.hasCracks = parts.has('cracks');
    this.hasBrain = parts.has('brain');
    this.hasPad = key === 'pumpkinSquash';
    this.loopName = faction === 'zombies' && this.def.clips.walk ? 'walk' : 'idle';
    this.model.play(this.loopName);
  }

  /** True while it is off on a leap (its health bar is not drawn). */
  get leaping(): boolean {
    return this.leapFor >= 0;
  }

  get dying(): boolean {
    return this.dyingFor >= 0;
  }

  /** Whether the model has `clip`; asking for one it lacks is harmless but says nothing. */
  has(clip: ClipName): boolean {
    return this.def.clips[clip] !== undefined;
  }

  /** Plays a one-shot or switches the loop. A model that lacks the clip carries on. */
  play(clip: ClipName): void {
    if (this.dying) return;
    this.model.play(clip);
  }

  /** The newest simulation numbers, once per step. */
  setSim(x: number, hp: number, maxHp: number, blocked: boolean): void {
    this.prevX = this.currX;
    this.currX = x;
    this.hp = hp;
    this.maxHp = maxHp;
    if (this.faction === 'zombies' && blocked !== this.blocked) {
      this.blocked = blocked;
      const loop: ClipName = blocked || !this.def.clips.walk ? 'idle' : 'walk';
      if (loop !== this.loopName) {
        this.loopName = loop;
        this.model.play(loop);
      }
    }
    const cracked = hp < maxHp / 2;
    if (this.hasCracks && cracked !== this.cracked) {
      this.cracked = cracked;
      this.model.showPart('cracks', cracked);
    }
  }

  /** Struck: a white flash, the recoil if it is not busy with something else. */
  hurt(): void {
    if (this.dying) return;
    this.flashFor = 0;
    // A hit does not cut a bite, a shot or a spawn short; it only flashes.
    if (this.model.clip === this.loopName && this.mergeFor < 0) this.model.play('hit');
  }

  /** A flash with no recoil: the base's swat, a shield taking the blow. */
  flash(): void {
    if (!this.dying) this.flashFor = 0;
  }

  /** The Brain Eater's throw: the held brain goes with the shot and a new one is in hand later. */
  throwBrain(): void {
    if (!this.hasBrain) return;
    this.brainOutIn = RELEASE_SECONDS;
    this.brainBackIn = -1;
  }

  startMerge(level: number): void {
    if (this.dying) return;
    if (this.mergeFor >= 0) this.swapLevel(); // a second merge finishes the first at once
    this.mergeFor = 0;
    this.mergeTo = level;
  }

  /**
   * Dies: the `die` clip, then it breaks up. `spent` (a mine or cherry that went off): it is gone
   * at once, with no crumble and no debris, for the blast is the show.
   */
  die(spent = false): void {
    if (this.dying) return;
    this.dyingFor = 0;
    this.mergeFor = -1;
    this.leapFor = -1;
    this.model.root.rotation.y = 0;
    this.model.root.scale.setScalar(this.bulk);
    this.model.setFlash(0);
    if (spent) {
      this.spent = true;
      this.burst = true;
      this.model.root.visible = false;
      return;
    }
    const clip = this.def.clips.die;
    this.burstAt = clip ? Math.min(clip.duration, 0.35) : 0;
    this.model.play('die');
  }

  /** Has a part of that name (`ModelInstance.showPart` throws on one it lacks). */
  hasPart(name: string): boolean {
    for (let i = 0; i < this.def.parts.length; i++) if ((this.def.parts[i] as { name: string }).name === name) return true;
    return false;
  }

  /** Shows or hides a part, if the model has it. It stays so through merges. */
  showPart(name: string, shown: boolean): void {
    if (this.hasPart(name)) this.model.showPart(name, shown);
  }

  /** Grows to `bulk` times its level's size (1 = as built), with its height and marks following. */
  setBulk(bulk: number): void {
    if (bulk === this.bulk) return;
    this.bulk = bulk;
    this.height = this.restHeight * bulk;
    if (this.mergeFor < 0 && !this.dying) this.model.root.scale.setScalar(bulk);
  }

  /**
   * Leaps to a target `dx` tiles along the lane and back (the simulation leaves the unit where it
   * is): with its ability clip, landing at the clip's impact (`hooks.landed`) and hopping home.
   */
  leap(dx: number): void {
    if (this.dying) return;
    this.leapFor = 0;
    this.leapDX = dx;
    this.leapLanded = false;
    this.play('ability');
  }

  /** The leap's offset along the lane and its hop, at `t` seconds into it. */
  private leapOffset(t: number, out: { x: number; y: number }): void {
    const dx = this.leapDX;
    if (t < LEAP_TAKE_OFF) {
      out.x = 0;
      out.y = 0;
    } else if (t < LEAP_IMPACT) {
      // Through the air with the clip's jump (the clip lifts the body itself).
      const u = (t - LEAP_TAKE_OFF) / (LEAP_IMPACT - LEAP_TAKE_OFF);
      out.x = dx * easeInOutCubic(u);
      out.y = 0;
    } else if (t < LEAP_HOME_AT) {
      out.x = dx;
      out.y = 0;
    } else {
      const u = Math.min(1, (t - LEAP_HOME_AT) / (LEAP_SECONDS - LEAP_HOME_AT));
      out.x = dx * (1 - easeInOutCubic(u));
      // A stepped hop, a voxel at a time.
      out.y = Math.round((LEAP_HOP * Math.sin(Math.PI * u)) / VOXEL) * VOXEL;
    }
  }

  /** Moves the view on by `dt` and places it between its last two steps. True once it should go. */
  update(dt: number, alpha: number): boolean {
    this.time += dt;
    if (this.dying) {
      this.dyingFor += dt;
      if (!this.burst && this.dyingFor >= this.burstAt) {
        this.burst = true;
        this.hooks.burst(this);
        this.model.root.visible = false;
      }
      this.model.update(dt);
      return this.dyingFor >= DEATH_SECONDS;
    }

    const x = this.prevX + (this.currX - this.prevX) * alpha;
    const follow = Math.min(1, dt * STACK_FOLLOW);
    this.offsetZ += (this.targetZ - this.offsetZ) * follow;
    this.offsetX += (this.targetX - this.offsetX) * follow;
    this.offsetY += (this.targetY - this.offsetY) * follow;
    let leapX = 0;
    let leapY = 0;
    if (this.leapFor >= 0) {
      this.leapFor += dt;
      if (this.leapFor >= LEAP_SECONDS) this.leapFor = -1;
      else {
        this.leapOffset(this.leapFor, leapAt);
        leapX = leapAt.x;
        leapY = leapAt.y;
        if (!this.leapLanded && this.leapFor >= LEAP_IMPACT) {
          this.leapLanded = true;
          this.hooks.landed?.(this);
        }
      }
    }
    this.wrapper.position.set(x + this.offsetX + leapX, this.offsetY + leapY, this.lane + 0.5 + this.offsetZ);
    // The soil pad stays on its own tile: only the pumpkin leaps.
    if (this.hasPad) this.model.shiftPart('root', -leapX, -leapY);

    if (this.mergeFor >= 0) this.stepMerge(dt);

    if (this.brainOutIn >= 0) {
      this.brainOutIn -= dt;
      if (this.brainOutIn < 0) {
        this.model.showPart('brain', false);
        this.brainBackIn = BRAIN_BACK_SECONDS;
      }
    } else if (this.brainBackIn >= 0) {
      this.brainBackIn -= dt;
      if (this.brainBackIn < 0) this.model.showPart('brain', true);
    }

    let flash = 0;
    if (this.flashFor >= 0) {
      this.flashFor += dt;
      flash = this.flashFor <= FLASH_HOLD ? 1 : Math.max(0, 1 - (this.flashFor - FLASH_HOLD) / FLASH_FADE);
      if (flash === 0) this.flashFor = -1;
    }
    if (this.pulsing) flash = Math.max(flash, 0.22 + 0.18 * Math.sin(this.time * 9));
    this.model.setFlash(flash);

    this.model.update(dt);
    return false;
  }

  dispose(): void {
    this.model.dispose();
    this.wrapper.removeFromParent();
  }

  private stepMerge(dt: number): void {
    const before = this.mergeFor;
    this.mergeFor += dt;
    const u = Math.min(1, this.mergeFor / MERGE_SECONDS);
    if (before < MERGE_SECONDS / 2 && this.mergeFor >= MERGE_SECONDS / 2) this.swapLevel();
    const root = this.model.root;
    root.rotation.y = Math.PI * 2 * easeInOutCubic(u);
    const grow = u < 0.5 ? easeOutCubic(u / 0.5) : 1 - easeInOutCubic((u - 0.5) / 0.5);
    root.scale.setScalar((1 + (MERGE_PEAK - 1) * grow) * this.bulk);
    if (u >= 1) {
      this.mergeFor = -1;
      root.rotation.y = 0;
      root.scale.setScalar(this.bulk);
    }
  }

  private swapLevel(): void {
    if (this.mergeTo === this.level) return;
    this.level = this.mergeTo;
    this.model = this.model.setLevel(this.mergeTo);
    trimShadows(this.model);
    this.restHeight = measureHeight(this.model);
    this.height = this.restHeight * this.bulk;
    this.flashFor = 0;
    this.hooks.mergePeak(this);
  }
}
