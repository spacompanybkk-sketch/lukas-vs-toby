import {
  BackSide, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector2, Vector3,
  type Camera, type Object3D, type Scene,
} from 'three';
import { factionOf } from '../../data/units';
import type { Faction, ProjectileKind, SimEvent, SimState, UnitKey } from '../../sim/types';
import { BASE_STOP_X, ZOMBIE_SPAWN_X } from '../../sim/types';
import type { Effects } from '../fx/Effects';
import { BaseView } from '../models/bases';
import { PEA_COLORS, makeGravestone, makeProjectile, makeToken, spinToken, type TokenKind } from '../models/props';
import { getModelDef, modelKeys, prewarmModels } from '../models/registry';
import { PALETTE } from '../palette';
import { modelColors } from '../voxel/build';
import { ModelInstance } from '../voxel/rig';
import { PLANT_BASE_X, ZOMBIE_BASE_X, worldToClient } from '../coords';
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
/** Lift per place in a stack (art bible section 6: offset in height by a few voxels), at most three places. */
const STACK_Y = 0.045;
/** Queue step per place in a stack, back along the lane (+x, away from the plants). */
const STACK_X = 0.14;
/** A pea whose hit came before it left the mouth flies from the muzzle to the hit in this long. */
const LATE_FLIGHT = 0.08;
/** A finger may miss a unit by this many CSS pixels and still pick it. */
export const PICK_TOLERANCE_PX = 28;
/** The placement ghost draws after the lawn's highlight marks. */
export const GHOST_RENDER_ORDER = 10;
const GHOST_OPACITY = 0.85;
const GHOST_OUTLINE_SCALE = 1.09;
const GHOST_OUTLINE_OK = 0xffffff;
const GHOST_OUTLINE_BAD = 0xff3b3b;
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
const BITE_STEP_BACK = 0.2;
/** The fewest seconds between two shudders of one base. */
const BASE_HIT_GAP = 0.45;
/** Bars of a zombie and the plant it bites stand apart: each is moved this far towards its own side. */
const BAR_SHIFT = 0.11;
/** Lift of each further bar in a stack: a bar and its outline, plus a gap. */
const BAR_LIFT = 0.19;
/** The lowest a zombie's bar sits (tiles above its feet, before the 0.14 gap). */
const ZOMBIE_BAR_FLOOR = 1.1;
/** Projectiles are drawn this much larger than built, so a pea reads against the grass. */
const PROJECTILE_SCALE: Record<ProjectileKind, number> = {
  pea: 1.2, brain: 1.1, // the phase-2 kinds borrow the pea's (plants) or the brain's (zombies) until they get their own
  kernel: 1.2, butter: 1.2, mango: 1.2, sand: 1.1, arrow: 1.1, bullet: 1.1, trident: 1.1, rot: 1.1,
};
/** Sudden death warms the sun and sky towards this over two seconds. */
const SUDDEN_DEATH_TINT = new Color('#FF8A3D');
const SUDDEN_DEATH_SHARE = 0.4;

/** Seconds between the winners' confetti pops. */
const CONFETTI_EVERY = 0.14;
const LEVEL_COLOR = [0, hex('#FFFFFF'), hex('#FFFFFF'), hex(PALETTE.levelIron), hex(PALETTE.levelCrystal), hex(PALETTE.levelGold)];
const STONE = [hex(PALETTE.stone), hex(PALETTE.stoneDark), hex(PALETTE.graveRock), hex(PALETTE.graveSoil)];
const TRAIL: Record<ProjectileKind, number> = {
  pea: hex(PEA_COLORS.body), brain: hex(PALETTE.brainPink),
  kernel: hex(PEA_COLORS.body), butter: hex(PEA_COLORS.body), mango: hex(PEA_COLORS.body),
  sand: hex(PALETTE.brainPink), arrow: hex(PALETTE.brainPink), bullet: hex(PALETTE.brainPink),
  trident: hex(PALETTE.brainPink), rot: hex(PALETTE.brainPink),
};

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
  /** Hit before it was seen: it flies from `start` to `hit` once released, then lands. */
  doomed: boolean;
  start: Vector3;
  hit: Vector3;
  hitBlocked: boolean;
  hitTarget: number | null;
}

interface TokenView { object: Object3D; kind: TokenKind; age: number; at: Vector3; active: boolean }
interface GraveView { object: Object3D; age: number; active: boolean }
interface PendingBlast { at: Vector3; radius: number; delay: number; active: boolean }

const v1 = new Vector3();
const v2 = new Vector3();
const ndc = new Vector2();
const client = { width: 1, height: 1 };

/** Options for a battle view. */
export interface BattleViewOptions {
  /** Model keys that can appear, built ahead so nothing hitches later (default: every model). */
  units?: readonly string[];
}

export class BattleView {
  /** Screen feedback for the session to pass on to the camera and the loop. */
  onFeel: (f: Feel) => void = () => {};
  /** Energy the player's side gained here: the HUD flies a token in from `from`. */
  onEnergyToken: (side: Faction, from: Vector3, amount: number) => void = () => {};

  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly lawn: Lawn;
  private readonly fx: Effects;
  private cheerSide: Faction | null = null;
  private cheerLeft = 0;
  private cheerClock = 0;
  private pops = 0;
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
  private readonly spare: Record<ProjectileKind, Object3D[]> = {
    pea: [], brain: [], kernel: [], butter: [], mango: [], sand: [], arrow: [], bullet: [], trident: [], rot: [],
  };
  private readonly tokens: TokenView[] = [];
  private readonly graves: GraveView[] = [];
  private readonly blasts: PendingBlast[] = [];
  private readonly colors = new Map<string, number[]>();
  private readonly hooks: UnitHooks;
  /** False until the first `applyEvents`, which also brings the bases up to the state. */
  private synced = false;
  private resolveCelebrate: (() => void) | null = null;
  private disposed = false;
  private time = 0;

  private readonly lights: { light: DirectionalLight | HemisphereLight; base: Color }[] = [];
  private tint = -1;

  private readonly ghosts = new Map<UnitKey, ModelInstance>();
  /** One see-through material for every ghost; only one ghost shows at a time. */
  private readonly ghostMaterial: MeshStandardMaterial;
  private ghost: ModelInstance | null = null;
  /** A slightly larger back-face copy of each ghost in one bright colour: its outline. */
  private readonly outlines = new Map<UnitKey, ModelInstance>();
  private readonly outlineMaterial = new MeshBasicMaterial({ color: GHOST_OUTLINE_OK, side: BackSide, transparent: true, opacity: 0.95, depthWrite: false });
  private outline: ModelInstance | null = null;
  private ghostClock = 0;
  private pulseTarget: UnitView | null = null;
  private readonly raycaster = new Raycaster();
  private readonly pickables: Object3D[] = [];

  constructor(scene: Scene, camera: Camera, lawn: Lawn, fx: Effects, playerFaction: Faction, options: BattleViewOptions = {}) {
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
    // The ghost writes depth, so its outline (drawn after it) shows only round its silhouette.
    this.ghostMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, transparent: true, opacity: 0.5, depthWrite: true });
    // Every model that can appear is built now, so a first spawn or a merge mid-match has nothing left to build.
    prewarmModels([...(options.units ?? modelKeys())]);
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
    if (!this.synced) {
      // A view attached to a match already under way (or restored) starts from its state.
      this.synced = true;
      for (const side of ['plants', 'zombies'] as const) this.setBaseHealth(side, state.baseHp[side], state.baseMaxHp[side]);
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
      view.targetY = STACK_Y * Math.min(place, 3);
      // Halted by a plant (not at the base): the simulation's reach is shorter than the two
      // models are deep, so it is drawn a little back and lunges in to bite.
      // Behind the first, the rest of a stack queue back a little along the lane as well, so
      // five at one spot read as five.
      view.targetX = (u.blocked && u.x > BASE_STOP_X + 0.01 ? BITE_STEP_BACK : 0) + STACK_X * Math.min(place, 4);
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

    // The winners' confetti, on real frames even while the game clock is slowed for the finale.
    if (this.cheerLeft > 0 && this.cheerSide !== null) {
      const step = Math.min(0.25, Math.max(dt, 1 / 60));
      this.cheerLeft -= step;
      this.cheerClock += step;
      while (this.cheerClock >= CONFETTI_EVERY) {
        this.cheerClock -= CONFETTI_EVERY;
        this.popConfetti(this.cheerSide);
      }
    }

    // Health bars, back lane first so nearer bars are drawn over farther ones.
    this.bars.begin(this.camera);
    for (let lane = 0; lane < 5; lane++) {
      for (const view of this.list) {
        if (view.lane !== lane || view.dying || !(view.hp < view.maxHp)) continue;
        v1.copy(view.wrapper.position);
        v1.x += view.faction === 'plants' ? -BAR_SHIFT : BAR_SHIFT;
        // A stack's bars stand in a column over the lane's centre line, one bar height apart, so
        // the depth nudge of the zombies under them cannot jumble them.
        v1.z = view.lane + 0.5;
        // Zombies' bars share one floor whatever their height, so a column of them is even.
        const top = view.faction === 'zombies' ? Math.max(view.height, ZOMBIE_BAR_FLOOR) : view.height;
        v1.y = top + 0.14 + BAR_LIFT * Math.min(view.stackPlace, 4);
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

    if (this.ghost) {
      this.ghost.update(dt);
      this.outline?.update(dt);
      // A slow glow pulse, so the ghost reads as "this is where it goes", not as a unit.
      this.ghostClock += dt;
      this.ghostMaterial.emissiveIntensity = 0.1 + 0.07 * Math.sin(this.ghostClock * 5);
    }
  }

  /** Shows where a card would go, or clears it with null. */
  setPreview(p: PlacementPreview | null): void {
    if (this.pulseTarget) this.pulseTarget.pulsing = false;
    this.pulseTarget = null;
    if (this.ghost) this.ghost.root.visible = false;
    if (this.outline) this.outline.root.visible = false;
    this.ghost = null;
    this.outline = null;
    this.lawn.highlightTile(0, 0, null);
    this.lawn.highlightLane(null, 'ok');
    if (!p) return;

    const state = p.ok ? 'ok' : 'bad';
    if (p.mergeTargetId !== null) {
      const target = this.views.get(p.mergeTargetId);
      if (target && !target.dying) {
        target.pulsing = true;
        this.pulseTarget = target;
        if (target.faction === 'plants') this.lawn.highlightTile(target.lane, Math.floor(target.currX), state, 'plants');
        else this.lawn.highlightLane(target.lane, state, 'zombies');
        return;
      }
    }
    const isPlant = factionOf(p.unit) === 'plants';
    if (isPlant) this.lawn.highlightTile(p.lane, p.col, state, 'plants');
    else this.lawn.highlightLane(p.lane, state, 'zombies');

    const ghost = this.ghostFor(p.unit);
    const outline = this.outlines.get(p.unit) as ModelInstance;
    // Only one ghost shows at a time, so they all share one material, tinted red on a bad spot:
    // nearly solid, lit from within, with a bright outline (white, or red when not allowed).
    this.ghostMaterial.color.setHex(p.ok ? 0xffffff : 0xff7070);
    this.ghostMaterial.emissive.setHex(p.ok ? 0xffffff : 0xff3030);
    this.ghostMaterial.opacity = GHOST_OPACITY;
    this.outlineMaterial.color.setHex(p.ok ? GHOST_OUTLINE_OK : GHOST_OUTLINE_BAD);
    const x = isPlant ? p.col + 0.5 : ZOMBIE_SPAWN_X;
    ghost.root.position.set(x, 0, p.lane + 0.5);
    outline.root.position.set(x, 0, p.lane + 0.5);
    ghost.root.visible = true;
    outline.root.visible = true;
    this.ghost = ghost;
    this.outline = outline;
  }

  /**
   * The unit under a pointer at normalised device coordinates, or null. Hidden parts and dying
   * units never pick. With `viewport` (CSS pixels) a near miss still picks: the unit whose
   * middle is nearest the pointer, within `PICK_TOLERANCE_PX`.
   */
  unitAtRay(ndcX: number, ndcY: number, viewport?: { width: number; height: number }): number | null {
    this.pickables.length = 0;
    for (const view of this.list) {
      if (view.dying || !view.wrapper.visible) continue;
      view.wrapper.updateMatrixWorld(true); // as drawn this frame, even before a render
      this.pickables.push(view.wrapper);
    }
    if (this.pickables.length === 0) return null;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc.set(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const hit of hits) {
      let id: number | null = null;
      let shown = true;
      for (let o: Object3D | null = hit.object; o; o = o.parent) {
        if (!o.visible) shown = false;
        if (id === null && o.name.startsWith('unit-')) id = Number(o.name.slice(5));
      }
      if (shown && id !== null) return id;
    }
    if (!viewport) return null;

    // A finger is wider than a ray: the nearest unit middle on screen, if close enough.
    client.width = viewport.width;
    client.height = viewport.height;
    const px = (ndcX * 0.5 + 0.5) * viewport.width;
    const py = (0.5 - ndcY * 0.5) * viewport.height;
    let best: number | null = null;
    let bestD = PICK_TOLERANCE_PX * PICK_TOLERANCE_PX;
    for (const view of this.list) {
      if (view.dying || !view.wrapper.visible) continue;
      v1.copy(view.wrapper.position);
      v1.y += view.height / 2;
      const at = worldToClient(v1, this.camera, client);
      const d = (at.x - px) ** 2 + (at.y - py) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = view.id;
      }
    }
    return best;
  }

  /**
   * Confetti over the winners for `seconds`: a pop over a cheering winner (or the winners' base)
   * every `CONFETTI_EVERY` seconds. Nothing for a draw.
   */
  cheer(winner: Faction | 'draw', seconds: number): void {
    if (winner === 'draw' || this.disposed) return;
    this.cheerSide = winner;
    this.cheerLeft = seconds;
    this.cheerClock = 0;
  }

  /** True while the winners' confetti is still going. */
  get cheering(): boolean {
    return this.cheerLeft > 0;
  }

  /** One confetti pop: over a random standing winner, every third pop over the winners' base. */
  private popConfetti(side: Faction): void {
    const winners = this.list.filter((v) => v.faction === side && !v.dying);
    this.pops += 1;
    const view = this.pops % 3 === 0 ? undefined : winners[Math.floor(Math.random() * winners.length)];
    if (view !== undefined) {
      v1.copy(view.wrapper.position);
      v1.y += 0.9;
    } else {
      const range = side === 'plants' ? PLANT_BASE_X : ZOMBIE_BASE_X;
      v1.set(range[0] + Math.random() * (range[1] - range[0]), 1.4, 0.5 + Math.random() * 4);
    }
    this.fx.confetti(v1);
  }

  /** The end of the match: the loser's base falls and the winners cheer. Resolves when it has fallen (or the view is disposed). */
  celebrate(winner: Faction | 'draw'): Promise<void> {
    const falls: Promise<void>[] = [];
    if (winner !== 'zombies') falls.push(this.bases.zombies.collapse());
    if (winner !== 'plants') falls.push(this.bases.plants.collapse());
    for (const view of this.list) if (winner !== 'draw' && view.faction === winner) view.play('cheer');
    const cut = new Promise<void>((resolve) => (this.resolveCelebrate = resolve));
    if (this.disposed) this.resolveCelebrate?.();
    return Promise.race([Promise.all(falls).then(() => undefined), cut]);
  }

  /** Takes everything the view added out of the scene and frees it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const view of this.list) view.dispose();
    this.list.length = 0;
    this.views.clear();
    for (const p of this.flying) p.object.removeFromParent();
    this.flying.length = 0;
    this.projectiles.clear();
    for (const t of this.tokens) (t.active = false), t.object.removeFromParent();
    for (const g of this.graves) (g.active = false), g.object.removeFromParent();
    for (const b of this.blasts) b.active = false;
    for (const ghost of this.ghosts.values()) ghost.dispose();
    for (const outline of this.outlines.values()) outline.dispose();
    this.ghosts.clear();
    this.outlines.clear();
    this.ghost = null;
    this.outline = null;
    this.outlineMaterial.dispose();
    this.pulseTarget = null;
    this.ghostMaterial.dispose();
    for (const side of ['plants', 'zombies'] as const) {
      this.scene.remove(this.bases[side].group);
      this.bases[side].dispose();
    }
    this.bars.dispose();
    for (const { light, base } of this.lights) light.color.copy(base);
    this.lawn.highlightTile(0, 0, null);
    this.lawn.highlightLane(null, 'ok');
    this.resolveCelebrate?.();
    this.resolveCelebrate = null;
  }

  /** The ghost of a unit type, made once with the see-through material and kept. */
  private ghostFor(key: UnitKey): ModelInstance {
    let ghost = this.ghosts.get(key);
    if (!ghost) {
      ghost = new ModelInstance(getModelDef(key), 1);
      ghost.root.name = `ghost-${key}`;
      ghost.root.traverse((o) => {
        if (o instanceof Mesh) {
          o.material = this.ghostMaterial;
          o.castShadow = false;
          o.receiveShadow = false;
          // After the see-through tile and lane marks, which would otherwise wash out its lower half.
          o.renderOrder = GHOST_RENDER_ORDER;
        }
      });
      ghost.root.visible = false;
      this.ghosts.set(key, ghost);
      this.scene.add(ghost.root);

      const outline = new ModelInstance(getModelDef(key), 1);
      outline.root.name = `ghost-outline-${key}`;
      outline.root.scale.multiplyScalar(GHOST_OUTLINE_SCALE);
      outline.root.traverse((o) => {
        if (o instanceof Mesh) {
          o.material = this.outlineMaterial;
          o.castShadow = false;
          o.receiveShadow = false;
          o.renderOrder = GHOST_RENDER_ORDER + 1; // after the ghost, whose depth hides all but the rim
        }
      });
      outline.root.visible = false;
      this.outlines.set(key, outline);
      this.scene.add(outline.root);
    }
    return ghost;
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
        this.setBaseHealth(e.faction, e.hp, state.baseMaxHp[e.faction]);
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
      case 'statusApplied': // the phase-2 events are drawn from Task 5 on
      case 'statusEnded':
      case 'attackMissed':
      case 'unitHealed':
      case 'hazardSpawned':
      case 'hazardEnded':
      case 'abilityUsed':
      case 'heroUsed':
      case 'heroReady':
      case 'spellCast':
      case 'spellReady':
        break;
      default: {
        const unhandled: never = e;
        void unhandled;
      }
    }
  }

  private setBaseHealth(side: Faction, hp: number, max: number): void {
    const base = this.bases[side];
    base.setHealth(max > 0 ? hp / max : 0);
    this.smokeAt[side] = base.smokeAnchors();
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
      doomed: false, start: new Vector3(), hit: new Vector3(), hitBlocked: false, hitTarget: null,
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
    if (view && view.shown && !view.doomed) v1.copy(view.object.position);
    else v1.set(x, 0.55, lane + 0.5);
    if (target) {
      // At the front of the unit it hit.
      v1.x = target.wrapper.position.x + (target.faction === 'zombies' ? -0.2 : 0.2);
      v1.z = target.wrapper.position.z;
    } else if (targetBase === 'zombies') v1.x = Math.min(v1.x, 10.1);
    else if (targetBase === 'plants') v1.x = Math.max(v1.x, -0.1);
    if (blocked) v1.y = Math.max(v1.y, 0.5);
    if (view && !view.shown) {
      // It struck before the shooter's snap let it go: it is still seen, leaving the mouth
      // at the snap and flying straight to the hit, which lands then.
      view.doomed = true;
      view.hit.copy(v1);
      view.hitBlocked = blocked;
      view.hitTarget = targetId;
      return;
    }
    this.impact(v1, blocked, target);
    if (view) this.release(view);
  }

  /** A projectile lands at `at`: a spark, or a block flash and the shield going up. */
  private impact(at: Vector3, blocked: boolean, target: UnitView | undefined): void {
    if (blocked) {
      this.fx.blockFlash(at);
      target?.play('shoot'); // the shield goes up
    } else {
      this.fx.spark(at);
    }
  }

  private moveProjectiles(dt: number, alpha: number): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const p = this.flying[i] as ProjectileView;
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
        p.start.set(simX + p.fromX, p.fromY, p.lane + 0.5 + p.fromZ);
        p.age = 0;
      }
      if (p.doomed) {
        // Out of the mouth and straight into what it already hit.
        const u = Math.min(1, p.age / LATE_FLIGHT);
        p.object.position.lerpVectors(p.start, p.hit, u);
        p.object.updateMatrixWorld();
        if (u >= 1) {
          this.impact(p.hit, p.hitBlocked, p.hitTarget === null ? undefined : this.views.get(p.hitTarget));
          this.release(p);
        }
        continue;
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
