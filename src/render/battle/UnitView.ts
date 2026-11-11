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

const easeInOutCubic = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;

/** What the view tells its owner about, so effects stay in one place. */
export interface UnitHooks {
  /** The merge has reached its peak and the new level is in. */
  mergePeak(view: UnitView): void;
  /** The dying unit breaks up now: debris, a blast, a puff. */
  burst(view: UnitView): void;
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
  /** Height of the top of the model above its feet, in tiles, for the current level. */
  height = 1;
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
    this.height = measureHeight(this.model);
    this.wrapper.name = `unit-${id}`;
    this.wrapper.add(this.model.root);
    this.wrapper.position.set(x, 0, lane + 0.5);
    const parts = new Set(this.def.parts.map((p) => p.name));
    this.hasCracks = parts.has('cracks');
    this.hasBrain = parts.has('brain');
    this.loopName = faction === 'zombies' && this.def.clips.walk ? 'walk' : 'idle';
    this.model.play(this.loopName);
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

  die(): void {
    if (this.dying) return;
    this.dyingFor = 0;
    this.mergeFor = -1;
    this.model.root.rotation.y = 0;
    this.model.root.scale.setScalar(1);
    this.model.setFlash(0);
    const clip = this.def.clips.die;
    this.burstAt = clip ? Math.min(clip.duration, 0.35) : 0;
    this.model.play('die');
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
    this.wrapper.position.set(x + this.offsetX, this.offsetY, this.lane + 0.5 + this.offsetZ);

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
    root.scale.setScalar(1 + (MERGE_PEAK - 1) * grow);
    if (u >= 1) {
      this.mergeFor = -1;
      root.rotation.y = 0;
      root.scale.setScalar(1);
    }
  }

  private swapLevel(): void {
    if (this.mergeTo === this.level) return;
    this.level = this.mergeTo;
    this.model = this.model.setLevel(this.mergeTo);
    trimShadows(this.model);
    this.height = measureHeight(this.model);
    this.flashFor = 0;
    this.hooks.mergePeak(this);
  }
}
