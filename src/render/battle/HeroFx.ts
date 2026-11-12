import { Group, Vector3, type Mesh, type Object3D } from 'three';
import type { Effects } from '../fx/Effects';
import { MEGA_MOWER_LENGTH, makeBolt, makeBone, makeMegaMower } from '../models/props';
import { PALETTE } from '../palette';
import type { Faction } from '../types';
import type { Feel } from './types';

// The two hero powers as the lawn shows them (plan Task 6). The camera push-in and the
// portrait banner belong to the battle view and the HUD; this draws what happens on the lane:
//
//   Mega Mower (Lukas)  a giant yellow mower tears down the lane from the plants' end to the
//                       zombies' in 0.9 s, wheels spinning, throwing grass clippings
//   Bone Storm (Toby)   bones rain down the length of the lane from the zombies' end to the
//                       plants', with violet stepped lightning striking among them
//
// The simulation's damage is instant; the view only staggers how it is shown. `onHit(x)` is
// called as the power reaches each stretch of the lane, so the caller can flash and number
// the units there; it returns true if it hit something, and the first such stretch stops the
// world for 90 ms. Every object comes from a small pool built up front and goes back hidden,
// so a finished show leaves the scene as it found it.

/** Seconds the mower takes from one end of the lawn to the other. */
export const MOWER_SECONDS = 0.9;
/** Seconds from the first bone falling to the last landing. */
export const BONE_STORM_SECONDS = 1.3;

/** Where the mower starts and stops (its middle), just off each end of the lawn. */
const MOWER_FROM = -1.4;
const MOWER_TO = 11.4;
/** The mower reports each half tile its front passes. */
const MOWER_STEP = 0.5;
/** A bone every this many tiles along the lane. */
const BONE_SPACING = 0.55;
const BONE_DROP = 3.6;
const BONE_FALL_SECONDS = 0.32;
const BOLTS = 5;
const BOLT_SECONDS = 0.14;
const HIT_STOP = 0.09;
const LAWN_COLS = 10;

const hex = (c: string): number => parseInt(c.slice(1), 16);
const GRASS = [hex(PALETTE.grassLight), hex(PALETTE.grassDark), hex(PALETTE.leaf), hex(PALETTE.leafDark), hex(PALETTE.soil)];
const BONE_CHIPS = [hex(PALETTE.bone), hex(PALETTE.boneShadow), hex(PALETTE.bone)];

export interface HeroFxOptions {
  /** Screen feedback the show asks for: a shake, and the hit-stop at the first hit. */
  onFeel?: (feel: Feel) => void;
}

type OnHit = (x: number) => boolean | void;

interface Show {
  faction: Faction;
  lane: number;
  z: number;
  time: number;
  onHit: OnHit | null;
  resolve: () => void;
  stopped: boolean;
  /** Mower: the next x its front has to reach to report. */
  nextHit: number;
  mower: Object3D | null;
  wheels: Mesh[];
  clippings: number;
  /** Bone storm: per bone, its x, start time, and whether it has landed; per bolt, its x and time. */
  bones: { x: number; at: number; landed: boolean; object: Object3D | null; spin: number }[];
  bolts: { x: number; at: number; struck: boolean; object: Object3D | null }[];
}

const at = new Vector3();

export class HeroFx {
  readonly group = new Group();

  private readonly effects: Effects;
  private readonly onFeel: (feel: Feel) => void;
  private readonly mowers: Object3D[] = [];
  private readonly bonePool: Object3D[] = [];
  private readonly boltPool: Object3D[] = [];
  private readonly shows: Show[] = [];

  constructor(effects: Effects, options: HeroFxOptions = {}) {
    this.effects = effects;
    this.onFeel = options.onFeel ?? (() => {});
    this.group.name = 'hero-fx';
    const bones = Math.ceil(LAWN_COLS / BONE_SPACING) + 1;
    for (let i = 0; i < 2; i++) this.mowers.push(this.keep(makeMegaMower()));
    for (let i = 0; i < bones * 2; i++) {
      // Storm bones are bigger than the ones lying about the graveyard, so they read falling.
      const bone = makeBone();
      bone.scale.setScalar(1.4);
      this.bonePool.push(this.keep(bone));
    }
    for (let i = 0; i < BOLTS * 2; i++) this.boltPool.push(this.keep(makeBolt('zombies')));
  }

  /** Shows running now. */
  get playing(): number {
    return this.shows.length;
  }

  /**
   * Plays `faction`'s hero power down `lane`: the Mega Mower for the plants, the Bone Storm
   * for the zombies. Resolves once it has finished and everything it used is put away.
   */
  play(faction: Faction, lane: number, onHit?: OnHit): Promise<void> {
    return new Promise((resolve) => {
      const show: Show = {
        faction,
        lane,
        z: lane + 0.5,
        time: 0,
        onHit: onHit ?? null,
        resolve,
        stopped: false,
        nextHit: 0,
        mower: null,
        wheels: [],
        clippings: 0,
        bones: [],
        bolts: [],
      };
      if (faction === 'plants') {
        const mower = this.mowers.find((m) => !m.visible) ?? null;
        show.mower = mower;
        if (mower) {
          mower.visible = true;
          mower.position.set(MOWER_FROM, 0, show.z);
          show.wheels = mower.children.filter((c): c is Mesh => c.name === 'mower-wheel');
        }
      } else {
        // From the zombies' end towards the plants', a bone every BONE_SPACING tiles.
        const count = Math.ceil(LAWN_COLS / BONE_SPACING);
        const span = BONE_STORM_SECONDS - BONE_FALL_SECONDS;
        for (let i = 0; i < count; i++) {
          const x = LAWN_COLS - 0.3 - i * BONE_SPACING;
          show.bones.push({ x, at: (i / (count - 1)) * span, landed: false, object: null, spin: (i % 3) - 1 });
        }
        for (let i = 0; i < BOLTS; i++) {
          show.bolts.push({ x: LAWN_COLS - 1.2 - i * 1.9, at: 0.12 + (i / BOLTS) * (BONE_STORM_SECONDS - 0.2), struck: false, object: null });
        }
      }
      this.shows.push(show);
      this.step(show, 0);
    });
  }

  /** Moves every show on by `dtSeconds` of game time. */
  update(dtSeconds: number): void {
    const dt = Math.max(0, dtSeconds);
    for (let i = this.shows.length - 1; i >= 0; i--) {
      const show = this.shows[i] as Show;
      show.time += dt;
      this.step(show, dt);
    }
  }

  /** Ends every show at once and puts everything away (a scene being reset). */
  clear(): void {
    for (let i = this.shows.length - 1; i >= 0; i--) this.finish(this.shows[i] as Show);
  }

  /** The props' shapes belong to `props.ts`; nothing here needs freeing beyond leaving the scene. */
  dispose(): void {
    this.clear();
    this.group.clear();
  }

  private keep(object: Object3D): Object3D {
    object.visible = false;
    this.group.add(object);
    return object;
  }

  private hit(show: Show, x: number): void {
    const struck = show.onHit?.(x) === true;
    if (struck && !show.stopped) {
      show.stopped = true;
      this.onFeel({ hitStop: HIT_STOP, shake: 0.35 });
    }
  }

  private step(show: Show, dt: number): void {
    if (show.faction === 'plants') this.stepMower(show, dt);
    else this.stepStorm(show);
  }

  private stepMower(show: Show, dt: number): void {
    const t = Math.min(1, show.time / MOWER_SECONDS);
    // Pulling away: it gathers speed as it goes.
    const u = 0.55 * t + 0.45 * t * t;
    const x = MOWER_FROM + (MOWER_TO - MOWER_FROM) * u;
    const front = x + MEGA_MOWER_LENGTH / 2;
    while (show.nextHit <= LAWN_COLS && front >= show.nextHit) {
      this.hit(show, show.nextHit);
      show.nextHit += MOWER_STEP;
    }
    const mower = show.mower;
    if (mower) {
      // A stepped judder as it bounces over the lawn: whole voxels up and down.
      const bounce = Math.round(Math.abs(Math.sin(show.time * 38)) * 1.5) / 16;
      mower.position.set(x, bounce, show.z);
      mower.rotation.z = Math.sin(show.time * 31) * 0.03;
      const speed = (MOWER_TO - MOWER_FROM) / MOWER_SECONDS;
      for (const wheel of show.wheels) wheel.rotation.z -= (speed / 0.15) * dt;
      // Clippings out of the chute on the camera side and from under the deck, while on the lawn.
      if (front > 0 && x < LAWN_COLS + 0.5) {
        show.clippings += dt * 60;
        while (show.clippings >= 1) {
          show.clippings -= 1;
          this.effects.burst(at.set(x - 0.1, 0.25, show.z + 0.45), GRASS, 3, 2.8);
          this.effects.burst(at.set(x - 0.6, 0.05, show.z), GRASS, 2, 2.2);
        }
      }
    }
    if (show.time >= MOWER_SECONDS) this.finish(show);
  }

  private stepStorm(show: Show): void {
    for (const bone of show.bones) {
      const t = (show.time - bone.at) / BONE_FALL_SECONDS;
      if (t < 0 || bone.landed) continue;
      if (!bone.object) {
        bone.object = this.bonePool.find((b) => !b.visible) ?? null;
        if (bone.object) bone.object.visible = true;
      }
      if (t >= 1) {
        bone.landed = true;
        if (bone.object) bone.object.visible = false;
        bone.object = null;
        at.set(bone.x, 0.08, show.z);
        this.effects.burst(at, BONE_CHIPS, 6, 2.2);
        this.effects.spark(at);
        this.hit(show, bone.x);
        continue;
      }
      const o = bone.object;
      if (o) {
        // Falling faster and faster, tumbling end over end, a little scatter across the lane.
        o.position.set(bone.x + bone.spin * 0.08 * (1 - t), BONE_DROP * (1 - t * t) + 0.06, show.z + bone.spin * 0.18);
        o.rotation.set(t * 5 * bone.spin, 0.4 * bone.spin, t * 7 + bone.spin);
      }
    }
    for (const bolt of show.bolts) {
      const t = (show.time - bolt.at) / BOLT_SECONDS;
      if (t < 0) continue;
      if (!bolt.struck) {
        bolt.struck = true;
        bolt.object = this.boltPool.find((b) => !b.visible) ?? null;
        if (bolt.object) {
          bolt.object.visible = true;
          bolt.object.position.set(bolt.x, 0, show.z);
          bolt.object.rotation.y = bolt.x * 1.7;
        }
        at.set(bolt.x, 0.1, show.z);
        this.effects.spark(at);
        this.effects.ring(at, hex(PALETTE.crystalGlow), 0.6);
        this.onFeel({ shake: 0.25 });
      }
      if (bolt.object) {
        if (t >= 1) {
          bolt.object.visible = false;
          bolt.object = null;
        } else {
          // A flicker: the bolt blinks off for a frame in the middle of its strike.
          bolt.object.scale.set(1, t > 0.45 && t < 0.6 ? 0.001 : 1, 1);
        }
      }
    }
    if (show.time >= BONE_STORM_SECONDS) this.finish(show);
  }

  private finish(show: Show): void {
    const i = this.shows.indexOf(show);
    if (i < 0) return;
    this.shows.splice(i, 1);
    if (show.mower) {
      show.mower.visible = false;
      show.mower.position.set(0, 0, 0);
      show.mower.rotation.set(0, 0, 0);
    }
    for (const bone of show.bones) if (bone.object) bone.object.visible = false;
    for (const bolt of show.bolts) {
      if (!bolt.object) continue;
      bolt.object.visible = false;
      bolt.object.scale.set(1, 1, 1);
    }
    show.resolve();
  }
}
