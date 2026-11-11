import {
  Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, Raycaster, Vector2, Vector3,
  type Camera, type Object3D, type Scene,
} from 'three';
import { UNIT_INFO } from '../../data/units';
import type { Faction, ProjectileKind, SimEvent, SimState, UnitKey } from '../../sim/types';
import { BASE_STOP_X, ZOMBIE_SPAWN_X } from '../../sim/types';
import type { Effects } from '../fx/Effects';
import { BaseView } from '../models/bases';
import { makeGravestone, makeProjectile, makeToken, spinToken, type TokenKind } from '../models/props';
import { getModelDef, prewarmModels } from '../models/registry';
import { PALETTE } from '../palette';
import { modelColors } from '../voxel/build';
import { ModelInstance } from '../voxel/rig';
import type { Lawn } from '../world/Lawn';
import { HealthBars } from './HealthBars';
import type { Feel, PlacementPreview } from './types';
import { RELEASE_SECONDS, UnitView, type UnitHooks } from './UnitView';

export type { Feel, PlacementPreview } from './types';

// The battle on screen. `applyEvents` is called once per simulation step with that step's
// events and the state after it; `frame` once per animation frame with how far the picture is
// between the last two steps. Units, projectiles, tokens, gravestones and both bases belong to
// this view; the effects library and its particles belong to the scene owner, who adds them to
// the scene and moves them on once a frame.

const hex = (c: string): number => parseInt(c.slice(1), 16);

/** Zombies closer than this in one lane count as a stack and stand side by side. */
const STACK_DISTANCE = 0.4;
/** Depth nudge per place in a stack: the first stands on the lane's centre line. */
const STACK_Z = [0, 0.12, -0.12, 0.24, -0.24, 0.06, -0.06, 0.18, -0.18];
/** Flight height of a projectile once it has left the muzzle, and how long it takes to get there. */
const SETTLE_SECONDS = 0.14;
/** A brain is lobbed: up at this speed, pulled down at this rate, never below the floor. */
const LOB_UP = 1.1;
const LOB_GRAVITY = 2.6;
const LOB_FLOOR = 0.38;
/** Tokens rise and shrink away over this long. */
const TOKEN_SECONDS = 0.9;
/** A gravestone stands this long before it bursts. */
const GRAVE_SECONDS = 0.45;
/** Smoke puffs from each hurt base this often. */
const SMOKE_EVERY = 0.16;
/** How far back a zombie biting a plant is drawn from where the simulation has it. */
const BITE_STEP_BACK = 0.12;
/** The fewest seconds between two shudders of one base. */
const BASE_HIT_GAP = 0.45;
/** Bars of a zombie and the plant it bites stand apart: each is moved this far towards its own side. */
const BAR_SHIFT = 0.11;
/** Projectiles are drawn this much larger than built, so a pea reads against the grass. */
const PROJECTILE_SCALE: Record<ProjectileKind, number> = { pea: 1.2, brain: 1.1 };
/** Sudden death warms the sun and sky towards this over two seconds. */
const SUDDEN_DEATH_TINT = new Color('#FF8A3D');
const SUDDEN_DEATH_SHARE = 0.4;

const LEVEL_COLOR = [0, hex('#FFFFFF'), hex('#FFFFFF'), hex(PALETTE.levelIron), hex(PALETTE.levelCrystal), hex(PALETTE.levelGold)];
const STONE = [hex(PALETTE.stone), hex(PALETTE.stoneDark), hex(PALETTE.graveRock), hex(PALETTE.graveSoil)];
const TRAIL: Record<ProjectileKind, number> = { pea: hex(PALETTE.pea), brain: hex(PALETTE.brainPink) };

interface ProjectileView {
  id: number;
  kind: ProjectileKind;
  lane: number;
  object: Object3D;
  prevX: number;
  currX: number;
  /** Seconds since it was fired, and the moment it leaves the hand or mouth. */
  age: number;
  revealAt: number;
  shown: boolean;
  ownerId: number;
  /** Where it left the muzzle, as an offset from where the simulation has it. */
  fromX: number;
  fromY: number;
  fromZ: number;
  flightY: number;
}

interface TokenView { object: Object3D; kind: TokenKind; age: number; at: Vector3; active: boolean }
interface GraveView { object: Object3D; age: number; active: boolean }
interface PendingBlast { at: Vector3; radius: number; delay: number; active: boolean }

const v1 = new Vector3();
const v2 = new Vector3();
const ndc = new Vector2();

export class BattleView {
  /** Screen feedback for the session to pass on to the camera and the loop. */
  onFeel: (f: Feel) => void = () => {};
  /** Energy the player's side gained here: the HUD flies a token in from `from`. */
  onEnergyToken: (side: Faction, from: Vector3, amount: number) => void = () => {};

  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly lawn: Lawn;
  private readonly fx: Effects;
  private readonly playerFaction: Faction;
  private readonly bases: Record<Faction, BaseView>;
  private readonly smokeAt: Record<Faction, Vector3[]> = { plants: [], zombies: [] };
  private smokeIn = 0;
  private readonly lastBaseHit: Record<Faction, number> = { plants: -1e9, zombies: -1e9 };
  private readonly bars = new HealthBars();
  private readonly views = new Map<number, UnitView>();
  private readonly list: UnitView[] = [];
  private readonly projectiles = new Map<number, ProjectileView>();
  private readonly flying: ProjectileView[] = [];
  private readonly spare: Record<ProjectileKind, Object3D[]> = { pea: [], brain: [] };
  private readonly tokens: TokenView[] = [];
  private readonly graves: GraveView[] = [];
  private readonly blasts: PendingBlast[] = [];
  private readonly colors = new Map<string, number[]>();
  private readonly hooks: UnitHooks;
  private prewarmed = false;
  private time = 0;

  private readonly lights: { light: DirectionalLight | HemisphereLight; base: Color }[] = [];
  private tint = -1;

  private readonly ghosts = new Map<UnitKey, ModelInstance>();
  private readonly ghostOk: MeshStandardMaterial;
  private readonly ghostBad: MeshStandardMaterial;
  private ghost: ModelInstance | null = null;
  private pulseTarget: UnitView | null = null;
  private readonly raycaster = new Raycaster();
  private readonly pickables: Object3D[] = [];

  constructor(scene: Scene, camera: Camera, lawn: Lawn, fx: Effects, playerFaction: Faction) {
    this.scene = scene;
    this.camera = camera;
    this.lawn = lawn;
    this.fx = fx;
    this.playerFaction = playerFaction;
    this.bases = { plants: new BaseView('plants'), zombies: new BaseView('zombies') };
    scene.add(this.bases.plants.group, this.bases.zombies.group, this.bars.mesh);
    this.hooks = {
      mergePeak: (view) => this.mergePeak(view),
      burst: (view) => this.burst(view),
    };
    this.ghostOk = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, transparent: true, opacity: 0.5, depthWrite: false });
    this.ghostBad = new MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, transparent: true, opacity: 0.45, depthWrite: false, color: '#FF7070',
    });
    for (let i = 0; i < 8; i++) this.graves.push({ object: makeGravestone(), age: 0, active: false });
    for (let i = 0; i < 10; i++) {
      const kind: TokenKind = i % 2 === 0 ? 'sun' : 'brain';
      this.tokens.push({ object: makeToken(kind), kind, age: 0, at: new Vector3(), active: false });
    }
    for (let i = 0; i < 6; i++) this.blasts.push({ at: new Vector3(), radius: 1, delay: 0, active: false });
  }

  /** Units on the lawn, those still falling apart included. */
  get unitCount(): number {
    return this.list.length;
  }

  /** The view of a unit, for tools and tests. */
  unit(id: number): UnitView | undefined {
    return this.views.get(id);
  }

  /** Call once per simulation step, with its events and the state after it. */
  applyEvents(events: readonly SimEvent[], state: SimState): void {
    if (!this.prewarmed) {
      this.prewarmed = true;
      prewarmModels([...state.config.cards.plants, ...state.config.cards.zombies]);
    }
    for (const e of events) this.apply(e, state);

    // Positions and health from the state, then where each zombie stands in its stack.
    const units = state.units;
    for (const u of units) {
      let view = this.views.get(u.id);
      if (!view) view = this.addUnit(u.id, u.key, u.faction, u.lane, u.x, u.level); // joined mid-match
      view.setSim(u.x, u.hp, u.maxHp, u.blocked);
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u || u.faction !== 'zombies') continue;
      let place = 0;
      for (let j = 0; j < i; j++) {
        const o = units[j];
        if (o && o.faction === 'zombies' && o.lane === u.lane && Math.abs(o.x - u.x) < STACK_DISTANCE) place++;
      }
      const view = this.views.get(u.id);
      if (!view) continue;
      view.stackPlace = place;
      view.targetZ = STACK_Z[Math.min(place, STACK_Z.length - 1)] as number;
      // Halted by a plant (not at the base): the simulation's reach is shorter than the two
      // models are deep, so it is drawn a little back and lunges in to bite.
      view.targetX = u.blocked && u.x > BASE_STOP_X + 0.01 ? BITE_STEP_BACK : 0;
    }
    for (const p of state.projectiles) {
      const view = this.projectiles.get(p.id);
      if (!view) continue;
      view.prevX = view.currX;
      view.currX = p.x;
    }
  }

  /** Call once per animation frame. `dtSeconds` is game time (0 while paused). */
  frame(_state: SimState, alpha: number, dtSeconds: number, timeSeconds: number): void {
    const dt = dtSeconds > 0 ? dtSeconds : 0;
    const a = Math.min(1, Math.max(0, alpha));
    this.time = timeSeconds;

    // Units: move, animate, and take away the ones that have finished dying.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const view = this.list[i] as UnitView;
      if (view.update(dt, a)) {
        this.views.delete(view.id);
        this.list[i] = this.list[this.list.length - 1] as UnitView;
        this.list.pop();
        if (this.pulseTarget === view) this.pulseTarget = null;
        view.dispose();
      } else if (view.level === 5 && !view.dying) {
        view.model.root.updateMatrixWorld();
        this.fx.aura(view.model.root, LEVEL_COLOR[5] as number);
      }
    }

    // Health bars, back lane first so nearer bars are drawn over farther ones.
    this.bars.begin(this.camera);
    for (let lane = 0; lane < 5; lane++) {
      for (const view of this.list) {
        if (view.lane !== lane || view.dying || !(view.hp < view.maxHp)) continue;
        v1.copy(view.wrapper.position);
        v1.x += view.faction === 'plants' ? -BAR_SHIFT : BAR_SHIFT;
        v1.y += view.height + 0.14 + 0.13 * Math.min(view.stackPlace, 4);
        this.bars.add(v1, view.hp / view.maxHp, view.level);
      }
    }
    this.bars.end();

    this.moveProjectiles(dt, a);
    this.moveTokens(dt);
    this.moveGraves(dt);
    for (const blast of this.blasts) {
      if (!blast.active) continue;
      blast.delay -= dt;
      if (blast.delay <= 0) {
        blast.active = false;
        this.boom(blast.at, blast.radius);
      }
    }

    // Bases: their own motion, and smoke from a hurt one.
    this.bases.plants.update(dt, timeSeconds);
    this.bases.zombies.update(dt, timeSeconds);
    this.smokeIn -= dt;
    if (this.smokeIn <= 0) {
      this.smokeIn += SMOKE_EVERY;
      if (this.smokeIn < 0) this.smokeIn = SMOKE_EVERY;
      for (const p of this.smokeAt.plants) this.fx.smoke(p);
      for (const p of this.smokeAt.zombies) this.fx.smoke(p);
    }

    if (this.tint >= 0 && this.tint < 1) {
      this.tint = Math.min(1, this.tint + dt / 2);
      for (const { light, base } of this.lights) {
        light.color.copy(base).lerp(SUDDEN_DEATH_TINT, SUDDEN_DEATH_SHARE * this.tint);
      }
    }

    if (this.ghost) this.ghost.update(dt);
  }

  /** Shows where a card would go, or clears it with null. */
  setPreview(p: PlacementPreview | null): void {
    if (this.pulseTarget) this.pulseTarget.pulsing = false;
    this.pulseTarget = null;
    if (this.ghost) this.ghost.root.visible = false;
    this.ghost = null;
    this.lawn.highlightTile(0, 0, null);
    this.lawn.highlightLane(null, 'ok');
    if (!p) return;

    const isPlant = UNIT_INFO[p.unit].faction === 'plants';
    if (p.mergeTargetId !== null) {
      const target = this.views.get(p.mergeTargetId);
      if (target && !target.dying) {
        target.pulsing = true;
        this.pulseTarget = target;
        if (target.faction === 'plants') this.lawn.highlightTile(target.lane, Math.floor(target.currX), p.ok ? 'ok' : 'bad', 'plants');
        else this.lawn.highlightLane(target.lane, p.ok ? 'ok' : 'bad', 'zombies');
        return;
      }
    }
    const side: Faction = isPlant ? 'plants' : 'zombies';
    if (isPlant) this.lawn.highlightTile(p.lane, p.col, p.ok ? 'ok' : 'bad', side);
    else this.lawn.highlightLane(p.lane, p.ok ? 'ok' : 'bad', side);

    let ghost = this.ghosts.get(p.unit);
    if (!ghost) {
      ghost = new ModelInstance(getModelDef(p.unit), 1);
      ghost.root.name = `ghost-${p.unit}`;
      this.ghosts.set(p.unit, ghost);
      this.scene.add(ghost.root);
    }
    const material = p.ok ? this.ghostOk : this.ghostBad;
    ghost.root.traverse((o) => {
      if (o instanceof Mesh) {
        o.material = material;
        o.castShadow = false;
      }
    });
    ghost.root.position.set(isPlant ? p.col + 0.5 : ZOMBIE_SPAWN_X, 0, p.lane + 0.5);
    ghost.root.visible = true;
    this.ghost = ghost;
  }

  /** The unit under a pointer at normalised device coordinates, or null. */
  unitAtRay(ndcX: number, ndcY: number): number | null {
    this.pickables.length = 0;
    for (const view of this.list) if (!view.dying) this.pickables.push(view.wrapper);
    if (this.pickables.length === 0) return null;
    this.raycaster.setFromCamera(ndc.set(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const hit of hits) {
      for (let o: Object3D | null = hit.object; o; o = o.parent) {
        if (o.name.startsWith('unit-')) return Number(o.name.slice(5));
      }
    }
    return null;
  }

  /** The end of the match: the loser's base falls and the winners cheer. Resolves when it has fallen. */
  celebrate(winner: Faction | 'draw'): Promise<void> {
    const falls: Promise<void>[] = [];
    if (winner !== 'zombies') falls.push(this.bases.zombies.collapse());
    if (winner !== 'plants') falls.push(this.bases.plants.collapse());
    for (const view of this.list) if (winner !== 'draw' && view.faction === winner) view.play('cheer');
    return Promise.all(falls).then(() => undefined);
  }

  dispose(): void {
    for (const view of this.list) view.dispose();
    this.list.length = 0;
    this.views.clear();
    for (const p of this.flying) p.object.removeFromParent();
    this.flying.length = 0;
    this.projectiles.clear();
    for (const t of this.tokens) t.object.removeFromParent();
    for (const g of this.graves) g.object.removeFromParent();
    for (const ghost of this.ghosts.values()) ghost.dispose();
    this.ghosts.clear();
    this.ghostOk.dispose();
    this.ghostBad.dispose();
    for (const side of ['plants', 'zombies'] as const) {
      this.scene.remove(this.bases[side].group);
      this.bases[side].dispose();
    }
    this.bars.dispose();
    for (const { light, base } of this.lights) light.color.copy(base);
    this.lawn.highlightTile(0, 0, null);
    this.lawn.highlightLane(null, 'ok');
  }

  // ---- Events ----------------------------------------------------------------------------

  private apply(e: SimEvent, state: SimState): void {
    switch (e.type) {
      case 'unitSpawned': {
        const view = this.addUnit(e.unitId, e.key, e.faction, e.lane, e.x, 1);
        view.play('spawn');
        v1.set(e.x, 0, e.lane + 0.5);
        this.fx.dirt(v1);
        if (e.faction === 'zombies') this.raiseGrave(e.x, e.lane);
        break;
      }
      case 'unitMerged':
        this.views.get(e.unitId)?.startMerge(e.level);
        break;
      case 'unitAttacked': {
        const view = this.views.get(e.unitId);
        if (!view) break;
        if (e.attack === 'melee') view.play('melee');
        else {
          view.play('shoot');
          if (view.faction === 'zombies') view.throwBrain();
        }
        break;
      }
      case 'projectileSpawned':
        this.addProjectile(e.projectileId, e.kind, e.lane, e.x, e.ownerId);
        break;
      case 'projectileHit':
        this.hitProjectile(e.projectileId, e.lane, e.x, e.targetId, e.targetBase, e.blocked);
        break;
      case 'unitDamaged':
        this.views.get(e.unitId)?.hurt();
        break;
      case 'unitDied': {
        const view = this.views.get(e.unitId);
        if (!view) break;
        if (e.cause === 'shovel') {
          v1.set(view.currX, 0.2, view.lane + 0.5);
          this.fx.puff(v1);
        }
        view.die();
        break;
      }
      case 'explosion': {
        // A Walnut Bomb swells first; its blast waits for the swell.
        let delay = 0;
        for (const view of this.list) {
          if (view.dying && view.key === e.sourceKey && view.lane === e.lane && Math.abs(view.currX - e.x) < 0.01) {
            const swell = view.def.clips.die?.duration ?? 0;
            delay = Math.max(0, Math.min(swell, 0.35) - view.dyingFor);
          }
        }
        v1.set(e.x, 0, e.lane + 0.5);
        if (delay <= 0) this.boom(v1, e.radius);
        else {
          const slot = this.blasts.find((b) => !b.active);
          if (slot) {
            slot.active = true;
            slot.at.copy(v1);
            slot.radius = e.radius;
            slot.delay = delay;
          } else this.boom(v1, e.radius);
        }
        break;
      }
      case 'energyGained': {
        v1.set(e.x, 0.95, e.lane + 0.5);
        this.popToken(e.faction === 'plants' ? 'sun' : 'brain', v1);
        v2.set(e.x, 1.25, e.lane + 0.5);
        this.fx.floatText(v2, `+${e.amount}`, e.faction === 'plants' ? PALETTE.sun : PALETTE.brains);
        if (e.faction === this.playerFaction) this.onEnergyToken(e.faction, v1.clone(), e.amount);
        if (e.unitId !== null) this.views.get(e.unitId)?.play('shoot');
        break;
      }
      case 'baseDamaged': {
        const base = this.bases[e.faction];
        const max = state.baseMaxHp[e.faction];
        base.setHealth(max > 0 ? e.hp / max : 0);
        this.smokeAt[e.faction] = base.smokeAnchors();
        // Sudden death wears both bases down every step (no lane): that shows as damage, not
        // as blows. Blows shudder the base, but no more often than BASE_HIT_GAP, or several
        // biters at once would keep it flashing white.
        if (e.lane !== null && this.time - this.lastBaseHit[e.faction] >= BASE_HIT_GAP) {
          this.lastBaseHit[e.faction] = this.time;
          base.hit(e.lane);
        }
        break;
      }
      case 'baseStruck': {
        this.bases.plants.strike(e.lane);
        const view = this.views.get(e.targetId);
        if (view) {
          view.flash();
          v1.set(view.currX - 0.15, 0.55, view.lane + 0.5 + view.offsetZ);
          this.fx.spark(v1);
        }
        break;
      }
      case 'suddenDeath':
        this.startTint();
        break;
      case 'matchEnded':
        this.onFeel({ slowMo: 1.5 });
        break;
      case 'commandRejected':
        break;
      default: {
        const unhandled: never = e;
        void unhandled;
      }
    }
  }

  private addUnit(id: number, key: UnitKey, faction: Faction, lane: number, x: number, level: number): UnitView {
    const existing = this.views.get(id);
    if (existing) return existing;
    const view = new UnitView(id, key, faction, lane, x, level, this.hooks);
    this.views.set(id, view);
    this.list.push(view);
    this.scene.add(view.wrapper);
    return view;
  }

  private mergePeak(view: UnitView): void {
    const color = LEVEL_COLOR[Math.min(5, view.level)] as number;
    v1.set(view.currX, 0, view.lane + 0.5);
    this.fx.ring(v1, color, 0.75);
    this.fx.sparkles(v1, color);
  }

  private burst(view: UnitView): void {
    const key = `${view.key}@${view.level}`;
    let colors = this.colors.get(key);
    if (!colors) {
      colors = modelColors(view.def, view.level);
      this.colors.set(key, colors);
    }
    v1.copy(view.wrapper.position);
    v1.y = 0.3;
    this.fx.debris(v1, colors, view.level);
  }

  private boom(at: Vector3, radius: number): void {
    this.fx.explosion(at, radius);
    this.onFeel({ shake: 0.5, hitStop: 0.08, punch: 0.04 });
  }

  private startTint(): void {
    if (this.tint >= 0) return;
    this.tint = 0;
    this.scene.traverse((o) => {
      if ((o instanceof DirectionalLight && o.castShadow) || o instanceof HemisphereLight) {
        this.lights.push({ light: o, base: o.color.clone() });
      }
    });
  }

  // ---- Projectiles -----------------------------------------------------------------------

  private addProjectile(id: number, kind: ProjectileKind, lane: number, x: number, ownerId: number): void {
    const object = this.spare[kind].pop() ?? makeProjectile(kind);
    object.visible = false;
    object.scale.setScalar(PROJECTILE_SCALE[kind]);
    this.scene.add(object);
    const owner = this.views.get(ownerId);
    const view: ProjectileView = {
      id, kind, lane, object, prevX: x, currX: x, age: 0,
      // Leaves at the snap of the shot, if the shooter has one to show.
      revealAt: owner && owner.has('shoot') ? RELEASE_SECONDS : 0,
      shown: false, ownerId, fromX: 0, fromY: 0.6, fromZ: 0, flightY: 0.6,
    };
    this.projectiles.set(id, view);
    this.flying.push(view);
  }

  private release(view: ProjectileView): void {
    this.projectiles.delete(view.id);
    const i = this.flying.indexOf(view);
    if (i >= 0) {
      this.flying[i] = this.flying[this.flying.length - 1] as ProjectileView;
      this.flying.pop();
    }
    view.object.removeFromParent();
    this.spare[view.kind].push(view.object);
  }

  private hitProjectile(id: number, lane: number, x: number, targetId: number | null, targetBase: Faction | null, blocked: boolean): void {
    const view = this.projectiles.get(id);
    const target = targetId === null ? undefined : this.views.get(targetId);
    if (view && view.shown) v1.copy(view.object.position);
    else v1.set(x, 0.55, lane + 0.5);
    if (target) {
      // At the front of the unit it hit.
      v1.x = target.wrapper.position.x + (target.faction === 'zombies' ? -0.2 : 0.2);
      v1.z = target.wrapper.position.z;
    } else if (targetBase === 'zombies') v1.x = Math.min(v1.x, 10.1);
    else if (targetBase === 'plants') v1.x = Math.max(v1.x, -0.1);
    if (blocked) {
      v1.y = Math.max(v1.y, 0.5);
      this.fx.blockFlash(v1);
      target?.play('shoot'); // the shield goes up
    } else {
      this.fx.spark(v1);
    }
    if (view) this.release(view);
  }

  private moveProjectiles(dt: number, alpha: number): void {
    for (const p of this.flying) {
      p.age += dt;
      if (!p.shown) {
        if (p.age < p.revealAt) continue;
        p.shown = true;
        p.object.visible = true;
        const owner = this.views.get(p.ownerId);
        const simX = p.prevX + (p.currX - p.prevX) * alpha;
        if (owner && !owner.dying) {
          owner.model.muzzleWorld(v2);
          p.fromX = v2.x - simX;
          p.fromY = v2.y;
          p.fromZ = v2.z - (p.lane + 0.5);
        } else {
          p.fromX = 0;
          p.fromY = 0.6;
          p.fromZ = 0;
        }
        p.flightY = p.kind === 'pea' ? Math.max(0.45, p.fromY) : p.fromY;
        p.age = 0;
      }
      const x = p.prevX + (p.currX - p.prevX) * alpha;
      // Out of the muzzle, then onto the lane's centre line.
      const k = Math.max(0, 1 - p.age / SETTLE_SECONDS);
      const settle = k * k;
      let y: number;
      if (p.kind === 'brain') {
        y = Math.max(LOB_FLOOR, p.fromY + LOB_UP * p.age - LOB_GRAVITY * p.age * p.age);
        p.object.rotation.set(this.time * 7, this.time * 5, 0);
      } else {
        y = p.flightY + (p.fromY - p.flightY) * settle;
      }
      p.object.position.set(x + p.fromX * settle, y, p.lane + 0.5 + p.fromZ * settle);
      p.object.updateMatrixWorld();
      this.fx.trail(p.object, TRAIL[p.kind]);
    }
  }

  // ---- Tokens and gravestones ------------------------------------------------------------

  private popToken(kind: TokenKind, at: Vector3): void {
    let slot: TokenView | undefined;
    let oldest: TokenView | undefined;
    for (const t of this.tokens) {
      if (t.kind !== kind) continue;
      if (!t.active) {
        slot = t;
        break;
      }
      if (!oldest || t.age > oldest.age) oldest = t;
    }
    slot ??= oldest;
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.at.copy(at);
    this.scene.add(slot.object);
    this.placeToken(slot);
  }

  private placeToken(t: TokenView): void {
    const u = Math.min(1, t.age / TOKEN_SECONDS);
    // Pops up with an overshoot, hangs, then shrinks away as it rises.
    const pop = u < 0.25 ? 1.25 * Math.sin((u / 0.25) * Math.PI * 0.5) : u < 0.4 ? 1.25 - 0.25 * ((u - 0.25) / 0.15) : 1;
    const out = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
    t.object.position.set(t.at.x, t.at.y + 0.45 * (1 - (1 - u) ** 3), t.at.z);
    t.object.scale.setScalar(Math.max(0.001, pop * out * 1.1));
    spinToken(t.object, this.time + t.age);
  }

  private moveTokens(dt: number): void {
    for (const t of this.tokens) {
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= TOKEN_SECONDS) {
        t.active = false;
        t.object.removeFromParent();
        continue;
      }
      this.placeToken(t);
    }
  }

  private raiseGrave(x: number, lane: number): void {
    const slot = this.graves.find((g) => !g.active) ?? this.graves.reduce((a, b) => (a.age > b.age ? a : b));
    slot.active = true;
    slot.age = 0;
    // Just behind the zombie, a little towards the back of the lane, so it does not hide it.
    slot.object.position.set(Math.min(9.85, x + 0.32), 0, lane + 0.32);
    slot.object.scale.set(1, 0.01, 1);
    this.scene.add(slot.object);
  }

  private moveGraves(dt: number): void {
    for (const g of this.graves) {
      if (!g.active) continue;
      g.age += dt;
      if (g.age >= GRAVE_SECONDS) {
        g.active = false;
        g.object.removeFromParent();
        v1.copy(g.object.position);
        v1.y = 0.25;
        this.fx.burst(v1, STONE, 12, 2);
        continue;
      }
      // Shoots up out of the ground, wobbles as the zombie claws past it.
      const u = Math.min(1, g.age / 0.12);
      g.object.scale.set(1, Math.max(0.01, 1.1 * u - 0.1 * u * u), 1);
      g.object.rotation.z = Math.sin(g.age * 40) * 0.06 * Math.min(1, g.age / 0.2);
    }
  }
}
