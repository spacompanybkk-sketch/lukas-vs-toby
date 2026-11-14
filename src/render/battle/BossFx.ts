import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import type { Balance, BossPattern, DeepReadonly } from '../../data/balance';
import { BOSS_LOOK } from '../../data/bossLooks';
import type { BossLook } from '../../data/bossLooks';
import { patternsOf, slamCol } from '../../sim/boss';
import { BOSS_HALF_WIDTH, COLS, LANES, TICKS_PER_SECOND } from '../../sim/types';
import type { BossKey, SimEvent, SimState, StatusKind, Unit, UnitKey } from '../../sim/types';
import type { Effects } from '../fx/Effects';
import { SLAM_WINDUP } from '../models/bosses/brainTitan';
import { makeProjectile } from '../models/props';
import { PALETTE } from '../palette';
import { BoxBatch } from '../world/boxes';
import type { Feel } from './types';
import type { UnitView } from './UnitView';

// The bosses' shows (phase 3 Task 3), for `BattleView`: the entrance, the slam's wind-up tiles and
// its blow, a strike's warning tiles and its blow, the shield (a dome, or bark), the summons, the
// eyes that follow the enemies, and the defeat (brain blocks; leaves and rolling acorns). Which show
// a boss gets is its row in `BOSS_LOOK` (data/bossLooks.ts); nothing here names a boss. Everything
// is made once and pooled (a strike's tiles on its first strike): nothing here allocates per frame.
// Read from events and the state only.

/** How much bigger than a unit each boss is drawn (from `BOSS_LOOK`). */
export const BOSS_SCALE: Readonly<Record<BossKey, number>> = Object.fromEntries(
  Object.entries(BOSS_LOOK).map(([key, look]) => [key, look.scale]),
) as Record<BossKey, number>;

/** A boss's look and shows. */
const lookOf = (key: UnitKey): BossLook => BOSS_LOOK[key as BossKey];

/** Whether a unit key is a boss's. */
export function isBossKey(key: UnitKey): key is BossKey {
  return Object.hasOwn(BOSS_HALF_WIDTH, key);
}

const hex = (c: string): number => parseInt(c.slice(1), 16);
const VOXEL = 1 / 16;
/** The entrance: how long it lasts and when the boss lands its roar. */
export const ENTRANCE_SECONDS = 1.5;
const ROAR_AT = 0.45;
/** The wind-up tiles blink in hard steps, this many times a second, faster in the last half second. */
const BLINK_PER_SECOND = 4;
const BLINK_FAST = 10;
const TILE_RED = '#FF3B3B';
const TILE_FILL_OPACITY = 0.32;
/** The wind-up arrow's tip floats this high over the target tile (tiles). */
const ARROW_HEIGHT = 0.75;
/** Where on its tile an arrow floats: towards the plants (x) and over the far edge (z). */
const ARROW_X = 0.3;
const ARROW_Z = 0.1;
/** The Titan's shield dome: pale blue glass, pulsing in two steps. */
const DOME_COLOR = '#9FE7FF';
const DOME_OPACITY = 0.14;
/** The Oak's bark clapping shut: the halves start this far apart (tiles) and meet in this long. */
const BARK_APART = 0.7;
const BARK_SECONDS = 0.22;
const BARK_SPARK_GAP = 0.15;
/** Landing marks: one per acorn in the air (three a barrage, room for two barrages). */
const MARKS = 6;
/** How far the Oak's pupils may look aside (tiles, in the model's own scale). */
const PUPIL_REACH = 0.25 * VOXEL;
/** The acorns that roll away when the Oak is beaten: how many, for how long. */
const ROLLERS = 6;
const ROLL_SECONDS = 2.2;
/** The Titan bursts into this many handfuls of brain blocks along its fallen body. */
const BRAIN_HANDFULS = 5;

const BRAIN = [hex(PALETTE.brainPink), hex(PALETTE.brainPink), hex('#D9658F'), hex('#FFB5CB'), hex(PALETTE.levelGold)];
const LEAVES = [hex(PALETTE.leaf), hex(PALETTE.leafDark), hex(PALETTE.leafLight)];
const SOIL = [hex(PALETTE.soil), hex(PALETTE.soilDark), hex(PALETTE.grassDark)];
const PURPLE = hex('#9B6BFF');
const LEAF = hex(PALETTE.leafLight);
const DOME_SPARK = hex(DOME_COLOR);
const BARK = [hex(PALETTE.walnut), hex(PALETTE.walnutDark), hex(PALETTE.walnutLight)];
/**
 * A strike's warning tiles and its blow are tinted by what it leaves: icy blue for a stun, grey for
 * blindness, orange for a burn, white for none (the others in their own shot colours).
 */
export const STRIKE_TINT: Readonly<Record<StatusKind | 'none', string>> = {
  stun: '#55CCFF', blind: '#8E8EA0', burn: '#FF6A00', none: '#FFFFFF',
  poison: '#8BE05A', tied: '#58C13B', haste: '#FFD23D',
};
/** Every tile of the lawn can be struck at once (five whole lanes). */
const STRIKE_TILES = LANES * COLS;
const STRIKE_FILL_OPACITY = 0.38;

interface Roller { object: Object3D; age: number; active: boolean; from: Vector3; dx: number; dz: number }
/** An acorn's landing mark: which acorn (−1: free), how far it had to fly, how far it has come (0..1). */
interface AcornMark { mesh: Mesh; id: number; from: number; progress: number }

/** The boss's pattern number `pattern` of its phase `phase` if it is a slam (the view's only use of the rules: the wind-up of a late-joined slam). */
function slamOf(b: DeepReadonly<Balance>, key: BossKey, phase: number, pattern: number): Extract<BossPattern, { kind: 'slam' }> | null {
  const p = patternsOf(b.bosses[key], phase)[pattern];
  return p !== undefined && p.kind === 'slam' ? (p as Extract<BossPattern, { kind: 'slam' }>) : null;
}

const v1 = new Vector3();

export class BossFx {
  readonly group = new Group();
  private readonly fx: Effects;
  private readonly onFeel: (f: Feel) => void;
  private readonly tileMaterial = new MeshBasicMaterial({ color: TILE_RED, depthWrite: false });
  private readonly fillMaterial = new MeshBasicMaterial({ color: TILE_RED, transparent: true, opacity: TILE_FILL_OPACITY, depthWrite: false });
  private readonly frameGeometry = tileFrame();
  private readonly fillGeometry = tileFill();
  private readonly tiles: { frame: Mesh; fill: Mesh }[] = [];
  /** A red arrow bouncing over each target tile while the slam winds up: "it lands here". */
  private readonly arrowGeometry = downArrow();
  /** Drawn over everything: the boss stands right behind its target tiles and would hide them. */
  private readonly arrowMaterial = new MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false });
  private readonly arrows: Mesh[] = [];
  /** Seconds left of the wind-up the tiles show, or −1. */
  private windupLeft = -1;
  private readonly domeMaterial = new MeshStandardMaterial({
    color: DOME_COLOR, emissive: DOME_COLOR, emissiveIntensity: 0.15, transparent: true, opacity: DOME_OPACITY,
    roughness: 0.2, depthWrite: false,
  });
  private readonly domeGeometry = stepDome();
  private readonly dome = new Mesh(this.domeGeometry, this.domeMaterial);
  /** The dome's glowing edges, so the glass reads without washing out the boss inside. */
  private readonly edgeMaterial = new MeshBasicMaterial({ color: DOME_COLOR, transparent: true, opacity: 0.85, depthWrite: false });
  private readonly edgeGeometry = domeEdges();
  private readonly edges = new Mesh(this.edgeGeometry, this.edgeMaterial);
  /** Seconds until a hit on the shut bark may throw sparks again (a crowd biting it would flood them). */
  private barkSparkIn = 0;
  /** A stepped red ring on the tile each acorn will land on, shrinking as it comes down. */
  private readonly markGeometry = landingMark();
  private readonly markMaterial = new MeshBasicMaterial({ color: TILE_RED, transparent: true, opacity: 0.9, depthWrite: false });
  private readonly marks: AcornMark[] = [];
  /** A strike's warning tiles (made on the first strike), tinted together (one strike at a time). */
  private readonly strikeFrameMaterial = new MeshBasicMaterial({ color: '#FFFFFF', depthWrite: false });
  private readonly strikeFillMaterial = new MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: STRIKE_FILL_OPACITY, depthWrite: false });
  private readonly strikeTiles: { frame: Mesh; fill: Mesh }[] = [];
  /** How many of `strikeTiles` the strike being wound up uses. */
  private strikeUsed = 0;
  /** Seconds left of the strike's wind-up, or −1 (from the simulation each step, like the slam's). */
  private strikeLeft = -1;
  /** The tint of the strike being wound up (its blow is drawn in it too). */
  private strikeTint = 0xffffff;
  private domeOn = false;
  private barkOn = false;
  private barkFor = -1;
  /** The boss's view (one boss a match), while it stands. */
  private boss: UnitView | null = null;
  private entranceLeft = -1;
  private roared = false;
  private readonly rollers: Roller[] = [];
  private time = 0;
  /** The match ended (`clear`): no warning shows again. */
  private ended = false;

  private readonly balance: DeepReadonly<Balance>;

  constructor(fx: Effects, onFeel: (f: Feel) => void, balance: DeepReadonly<Balance>) {
    this.balance = balance;
    this.fx = fx;
    this.onFeel = onFeel;
    this.group.name = 'boss-fx';
    for (let i = 0; i < 3; i++) {
      const frame = new Mesh(this.frameGeometry, this.tileMaterial);
      const fill = new Mesh(this.fillGeometry, this.fillMaterial);
      frame.name = 'boss-windup-tile';
      fill.name = 'boss-windup-fill';
      frame.renderOrder = fill.renderOrder = 9;
      frame.visible = fill.visible = false;
      this.group.add(frame, fill);
      this.tiles.push({ frame, fill });
    }
    for (let i = 0; i < 3; i++) {
      const arrow = new Mesh(this.arrowGeometry, this.arrowMaterial);
      arrow.name = 'boss-windup-arrow';
      arrow.renderOrder = 20;
      arrow.visible = false;
      this.group.add(arrow);
      this.arrows.push(arrow);
    }
    this.edges.name = 'boss-shield-edges';
    this.dome.add(this.edges);
    this.dome.name = 'boss-shield-dome';
    this.dome.visible = false;
    this.dome.renderOrder = 8;
    for (let i = 0; i < MARKS; i++) {
      const mesh = new Mesh(this.markGeometry, this.markMaterial);
      mesh.name = 'boss-acorn-mark';
      mesh.renderOrder = 9;
      mesh.visible = false;
      this.group.add(mesh);
      this.marks.push({ mesh, id: -1, from: 0, progress: 0 });
    }
    for (let i = 0; i < ROLLERS; i++) {
      const object = makeProjectile('acorn');
      object.name = 'boss-rolling-acorn';
      object.scale.setScalar(1.3);
      object.visible = false;
      this.group.add(object);
      this.rollers.push({ object, age: 0, active: false, from: new Vector3(), dx: 0, dz: 0 });
    }
  }

  /** True while the entrance show runs (for tests and the HUD's intro). */
  get entering(): boolean {
    return this.entranceLeft > 0;
  }

  /** True while the wind-up tiles are showing. */
  get windingUp(): boolean {
    return this.windupLeft > 0;
  }

  /** True while a strike's warning tiles are showing. */
  get striking(): boolean {
    return this.strikeLeft > 0;
  }

  /** How many tiles the strike being wound up warns of (0 when none). */
  get strikeTileCount(): number {
    return this.strikeLeft > 0 ? this.strikeUsed : 0;
  }

  /** True while the shield shows (a dome or bark). */
  get shielded(): boolean {
    return this.domeOn || this.barkOn;
  }

  /** A boss came on. `late`: the view joined a match already under way, so no entrance. */
  enter(view: UnitView, late: boolean): void {
    this.boss = view;
    view.setBulk(lookOf(view.key).scale);
    view.wrapper.add(this.dome);
    if (late) return;
    this.entranceLeft = ENTRANCE_SECONDS;
    this.roared = false;
    this.onFeel({ punch: 0.1, punchSeconds: ENTRANCE_SECONDS, focusZ: view.lane + 0.5 });
    this.ground(view.currX, view.lane, 1.2);
  }

  /** Ends the entrance at once (a tap). */
  skipEntrance(): void {
    if (this.entranceLeft <= 0) return;
    this.entranceLeft = 0;
    if (!this.roared) this.roar();
  }

  /** The step's state for the boss: shield, wind-up tiles for a view that joined late, the eyes. */
  sync(view: UnitView, u: Unit, state: SimState): void {
    if (view.dying || this.ended) return;
    const shows = lookOf(view.key).fx;
    const shield = u.shieldLeft > 0;
    if (shows.shield === 'dome') {
      if (shield !== this.domeOn) this.setDome(view, shield);
    } else if (shield !== this.barkOn) {
      this.setBark(view, shield);
    }
    // The tiles follow the simulation's wind-up timer, so a stun (which stops it) holds them steady.
    const slam = slamOf(this.balance, view.key as BossKey, u.phase, u.pattern);
    const windup = slam === null ? 0 : slam.windupSeconds * TICKS_PER_SECOND;
    if (slam !== null && u.patternTimer > 0 && u.patternTimer <= windup) {
      const left = u.patternTimer / TICKS_PER_SECOND;
      if (this.windupLeft <= 0) {
        // Joined during a wind-up: the tiles, and the arm on its way up, timed to land with the blow.
        this.showTiles(u.lane, slamCol(u, slam), left);
        view.model.play('ability', { speed: SLAM_WINDUP / left });
      }
      this.windupLeft = left;
    } else if (this.windupLeft > 0) {
      this.hideTiles();
    }
    this.syncStrike(view.key as BossKey, u);
    if (shows.eyes === 'follow') this.lookAt(view, u, state);
  }

  /**
   * A boss's strike: its wind-up (`windup` true) puts a blinking warning on every tile it announced,
   * tinted by the status it leaves; its blow (`windup` false) lands on those tiles in that tint.
   */
  strike(e: Extract<SimEvent, { type: 'bossStrike' }>, state: SimState): void {
    if (this.ended) return;
    const u = state.units.find((v) => v.id === e.unitId);
    if (e.windup) {
      if (u === undefined || !Object.hasOwn(BOSS_HALF_WIDTH, u.key)) return;
      const p = patternsOf(this.balance.bosses[u.key as BossKey], u.phase)[u.pattern];
      const strike = p !== undefined && p.kind === 'strike' ? p : null;
      const windup = strike === null ? 0 : strike.windupSeconds;
      this.showStrike(e.tiles, strikeTintOf(strike), windup);
      return;
    }
    // The blow: the tint it was announced in (or, for a view that missed the wind-up, its list's).
    if (this.strikeLeft <= 0 && u !== undefined && Object.hasOwn(BOSS_HALF_WIDTH, u.key)) {
      this.strikeTint = hex(STRIKE_TINT[firstStrikeStatus(patternsOf(this.balance.bosses[u.key as BossKey], u.phase))]);
    }
    this.hideStrike();
    const tint = this.strikeTint;
    for (let i = 0; i < e.tiles.length; i++) {
      const t = e.tiles[i] as { lane: number; col: number };
      v1.set(t.col + 0.5, 0, t.lane + 0.5);
      this.fx.ring(v1, tint, 0.6, true);
      // A lane-wide blow throws sparkles on every other tile only: the rings carry it.
      if (e.tiles.length <= 8 || i % 2 === 0) this.fx.burst(v1, [tint, tint, 0xffffff], 6, 1.8);
    }
    this.onFeel({ shake: 0.6, hitStop: 0.05 });
  }

  /** A boss's pattern event. */
  pattern(e: Extract<SimEvent, { type: 'bossPattern' }>, view: UnitView | undefined): void {
    if (!view || view.dying) return;
    switch (e.kind) {
      case 'slam':
        if (e.windup) {
          view.play('ability');
          if (e.col !== null) this.showTiles(e.lane, e.col, SLAM_WINDUP);
        } else {
          this.hideTiles();
          this.slamDown(e.lane, e.col ?? 0);
        }
        break;
      case 'summon':
        if (lookOf(view.key).fx.summon === 'ring') {
          view.playFor('cheer', 0.9);
          v1.set(view.currX, 0, view.lane + 0.5);
          this.fx.ring(v1, PURPLE, 1.4, true);
          this.onFeel({ shake: 0.35 });
        } else {
          view.play('ability');
          v1.set(view.currX + 0.4, 2.2, view.lane + 0.5);
          this.fx.sparkles(v1, LEAF);
        }
        break;
      case 'barrage':
        view.play('shoot');
        break;
      case 'shield':
        // The look itself comes from the state (`sync`); here the moment it goes up.
        view.flash();
        v1.set(view.currX, 0, view.lane + 0.5);
        this.fx.ring(v1, lookOf(view.key).fx.shield === 'bark' ? BARK[1] as number : DOME_SPARK, 1.6, true);
        this.onFeel({ shake: 0.3 });
        break;
      default: {
        const unhandled: never = e.kind;
        void unhandled;
      }
    }
  }

  /** A shot bounced off the dome: a ping of sparks where it hit. */
  ping(at: Vector3): void {
    this.fx.sparkles(at, DOME_SPARK);
  }

  /** True while the Oak's bark is shut (hits on it then throw sparks: it takes half). */
  get barkShut(): boolean {
    return this.barkOn;
  }

  /** The Oak was hit while its bark is shut: chips of bark and a spark off the plates (at most every 0.15 s). */
  barkHit(view: UnitView): void {
    if (!this.barkOn || this.barkSparkIn > 0) return;
    this.barkSparkIn = BARK_SPARK_GAP;
    v1.set(view.currX + 0.75, 0.9, view.lane + 0.5 + 0.35);
    this.fx.spark(v1);
    this.fx.burst(v1, BARK, 6, 1.2);
  }

  /**
   * An acorn in the air (each step, from the state): its landing mark sits on the tile under where it
   * will come down (`targetX`, which follows its target) and shrinks in steps as it falls.
   */
  aimAcorn(id: number, lane: number, x: number, targetX: number | null): void {
    if (targetX === null) return;
    let mark: AcornMark | undefined;
    let free: AcornMark | undefined;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i] as AcornMark;
      if (m.id === id) mark = m;
      else if (free === undefined && m.id === -1) free = m;
    }
    if (mark === undefined) {
      if (free === undefined) return;
      mark = free;
      mark.id = id;
      mark.from = Math.max(0.01, Math.abs(targetX - x));
      mark.mesh.visible = true;
    }
    mark.progress = Math.min(1, Math.max(0, 1 - Math.abs(targetX - x) / mark.from));
    mark.mesh.position.set(Math.floor(targetX) + 0.5, 0.03, lane + 0.5);
  }

  /** The acorn landed (or is gone): its mark goes. */
  landAcorn(id: number): void {
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i] as AcornMark;
      if (m.id !== id) continue;
      m.id = -1;
      m.mesh.visible = false;
    }
  }

  /** The boss fell (its `unitDied`): it now plays its fall; `burst` follows when that is over. */
  fell(view: UnitView): void {
    this.hideTiles();
    this.hideStrike();
    this.setDome(view, false);
    this.barkOn = false;
    if (lookOf(view.key).fx.defeat === 'leaves') {
      // The leaves start to drop at once.
      for (let i = -1; i <= 1; i++) {
        v1.set(view.currX, 2.2, view.lane + 0.5 + i);
        this.fx.burst(v1, LEAVES, 16, 1.2);
      }
    }
    this.onFeel({ shake: 0.5 });
  }

  /** The fall is over: the Titan bursts into brain blocks, the Oak's acorns roll away. */
  burst(view: UnitView): void {
    const x = view.wrapper.position.x;
    const z = view.lane + 0.5;
    if (lookOf(view.key).fx.defeat === 'brains') {
      // Toppled backwards: the body lies along +X from its feet.
      for (let i = 0; i < BRAIN_HANDFULS; i++) {
        v1.set(x + 0.3 + i * 0.45, 0.4, z + (i % 2 === 0 ? 0.3 : -0.3));
        this.fx.debris(v1, BRAIN, 5);
        this.fx.debris(v1, BRAIN, 5);
        this.fx.burst(v1, BRAIN, 14, 3.2);
      }
      v1.set(x + 1, 0, z);
      this.fx.ring(v1, BRAIN[0] as number, 1.1);
      this.onFeel({ shake: 1, hitStop: 0.1 });
    } else {
      for (let i = -1; i <= 1; i++) {
        v1.set(x, 0.6, z + i);
        this.fx.debris(v1, BARK, 4);
        this.fx.burst(v1, LEAVES, 12, 1.6);
      }
      for (let i = 0; i < ROLLERS; i++) {
        const r = this.rollers[i] as Roller;
        r.active = true;
        r.age = -0.08 * i;
        r.from.set(x + 0.2, 1.6, z - 1.25 + (2.5 * i) / (ROLLERS - 1));
        r.dx = 2.2 + 0.5 * (i % 3);
        r.dz = 0.3 * ((i % 2) * 2 - 1);
        r.object.visible = false;
      }
      this.onFeel({ shake: 0.8, hitStop: 0.08 });
    }
    this.boss = null;
  }

  /**
   * The match is over: every warning goes (the slam's tiles and arrows, a strike's tiles, the acorn
   * landing marks) and none comes back, even when the state still holds a wind-up it ended in.
   */
  clear(): void {
    this.ended = true;
    this.hideTiles();
    this.hideStrike();
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i] as AcornMark;
      m.id = -1;
      m.mesh.visible = false;
    }
  }

  /** Moves the shows on by `dt`. Allocates nothing. */
  update(dt: number): void {
    this.time += dt;
    const boss = this.boss;
    if (this.entranceLeft > 0) {
      this.entranceLeft -= dt;
      if (!this.roared && ENTRANCE_SECONDS - this.entranceLeft >= ROAR_AT) this.roar();
    }
    if (this.windupLeft > 0) {
      // `windupLeft` comes from the simulation each step (`sync`); here only the blinking.
      const rate = this.windupLeft < 0.5 ? BLINK_FAST : BLINK_PER_SECOND;
      const on = Math.floor(this.time * rate * 2) % 2 === 0;
      for (let i = 0; i < this.tiles.length; i++) {
        const t = this.tiles[i] as { frame: Mesh; fill: Mesh };
        if (t.frame.userData.used !== true) continue;
        t.frame.visible = this.windupLeft > 0;
        t.fill.visible = on;
      }
      // The arrows bob two voxels at a time, two steps a beat.
      const bob = Math.floor(this.time * rate) % 2 === 0 ? 0 : 2 * VOXEL;
      for (let i = 0; i < this.arrows.length; i++) {
        const arrow = this.arrows[i] as Mesh;
        arrow.visible = (this.tiles[i] as { frame: Mesh }).frame.userData.used === true;
        arrow.position.y = ARROW_HEIGHT + bob;
      }
    }
    if (this.strikeLeft > 0) {
      // As the slam's: the frames stay, the fills blink in hard steps, faster in the last half second.
      const rate = this.strikeLeft < 0.5 ? BLINK_FAST : BLINK_PER_SECOND;
      const on = Math.floor(this.time * rate * 2) % 2 === 0;
      for (let i = 0; i < this.strikeUsed; i++) (this.strikeTiles[i] as { fill: Mesh }).fill.visible = on;
    }
    if (this.barkSparkIn > 0) this.barkSparkIn -= dt;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i] as AcornMark;
      if (m.id === -1) continue;
      // From a full tile down to a small square, in four hard steps; blinking in the last.
      const step = Math.min(3, Math.floor(m.progress * 4));
      m.mesh.scale.setScalar(1 - 0.18 * step);
      m.mesh.visible = step < 3 || Math.floor(this.time * 12) % 2 === 0;
    }
    if (this.domeOn) {
      const step = Math.floor(this.time * 4) % 2 === 0 ? 1 : 1.04;
      this.dome.scale.setScalar(step);
    }
    if (boss && this.barkFor >= 0) {
      // The two halves slide in from the sides, faster and faster, and clap shut.
      this.barkFor += dt;
      const u = Math.min(1, this.barkFor / BARK_SECONDS);
      const apart = (BARK_APART * (1 - u * u)) / lookOf(boss.key).scale;
      boss.shiftPart('barkL', 0, 0, -apart);
      boss.shiftPart('barkR', 0, 0, apart);
      if (u >= 1) {
        this.barkFor = -1;
        v1.set(boss.currX + 0.75, 0.8, boss.lane + 0.5 + 0.35);
        this.fx.burst(v1, BARK, 18, 1.8);
        this.fx.spark(v1);
        v1.set(boss.currX + 0.5, 0, boss.lane + 0.5);
        this.fx.ring(v1, BARK[0] as number, 1.2, true);
        this.onFeel({ shake: 0.5, hitStop: 0.06 });
      }
    }
    for (let i = 0; i < this.rollers.length; i++) {
      const r = this.rollers[i] as Roller;
      if (!r.active) continue;
      r.age += dt;
      if (r.age < 0) continue;
      if (r.age >= ROLL_SECONDS) {
        r.active = false;
        r.object.visible = false;
        continue;
      }
      r.object.visible = true;
      const drop = Math.min(1, r.age / 0.35);
      const roll = Math.max(0, r.age - 0.35) / (ROLL_SECONDS - 0.35);
      const ease = 1 - (1 - roll) * (1 - roll);
      // Falls from the crown with one bounce, then rolls off along the lawn, slowing.
      const bounce = drop < 1 ? r.from.y * (1 - drop * drop) : Math.max(0, 0.25 * Math.sin(Math.PI * Math.min(1, roll * 4)));
      r.object.position.set(r.from.x + r.dx * ease, Math.round((0.12 + bounce) / VOXEL) * VOXEL, r.from.z + r.dz * ease);
      r.object.rotation.set(0, 0, -ease * 14);
      const fade = roll > 0.85 ? Math.max(0.01, 1 - (roll - 0.85) / 0.15) : 1;
      r.object.scale.setScalar(1.3 * fade);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.dome.removeFromParent();
    this.frameGeometry.dispose();
    this.arrowGeometry.dispose();
    this.fillGeometry.dispose();
    this.domeGeometry.dispose();
    this.edgeGeometry.dispose();
    this.edgeMaterial.dispose();
    this.tileMaterial.dispose();
    this.arrowMaterial.dispose();
    this.fillMaterial.dispose();
    this.domeMaterial.dispose();
    this.markGeometry.dispose();
    this.markMaterial.dispose();
    this.strikeFrameMaterial.dispose();
    this.strikeFillMaterial.dispose();
    this.boss = null;
  }

  // ---- The pieces ------------------------------------------------------------------------------

  /** The roar in the middle of the entrance: a cheer (arms up, jaw wide), a shake, the ground thrown up. */
  private roar(): void {
    this.roared = true;
    const boss = this.boss;
    if (!boss || boss.dying) return;
    boss.playFor(lookOf(boss.key).fx.roar, 0.9);
    this.onFeel({ shake: 0.7 });
    this.ground(boss.currX, boss.lane, 1.6);
  }

  /** Soil and a ring thrown up round a boss's feet. */
  private ground(x: number, lane: number, radius: number): void {
    v1.set(x, 0, lane + 0.5);
    this.fx.ring(v1, SOIL[0] as number, radius, true);
    for (let i = -1; i <= 1; i++) {
      v1.set(x + 0.3 * i, 0, lane + 0.5 + 0.6 * i);
      this.fx.dirt(v1);
    }
  }

  private showTiles(lane: number, col: number, seconds: number): void {
    let n = 0;
    for (let l = lane - 1; l <= lane + 1; l++) {
      const t = this.tiles[n++] as { frame: Mesh; fill: Mesh };
      const on = l >= 0 && l < LANES;
      t.frame.userData.used = on;
      t.frame.visible = on;
      t.fill.visible = on;
      t.frame.position.set(col + 0.5, 0, l + 0.5);
      t.fill.position.set(col + 0.5, 0, l + 0.5);
    }
    this.windupLeft = seconds;
    for (let i = 0; i < 3; i++) {
      const arrow = this.arrows[i] as Mesh;
      const l = lane - 1 + i;
      // Over the tile's far edge and a little towards the plants: clear of the Titan's body.
      arrow.position.set(col + ARROW_X, ARROW_HEIGHT, l + ARROW_Z);
      // The middle one (the heavy blow) is the biggest.
      arrow.scale.setScalar(l === lane ? 1.25 : 0.85);
      arrow.visible = l >= 0 && l < LANES;
    }
  }

  private hideTiles(): void {
    this.windupLeft = -1;
    for (let i = 0; i < this.arrows.length; i++) (this.arrows[i] as Mesh).visible = false;
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i] as { frame: Mesh; fill: Mesh };
      t.frame.userData.used = false;
      t.frame.visible = false;
      t.fill.visible = false;
    }
  }

  /**
   * The strike's wind-up from the state: the timer of the boss's strike (held by a stun), its tiles
   * for a view that joined during the wind-up, and none once the simulation dropped them (a new phase).
   */
  private syncStrike(key: BossKey, u: Unit): void {
    if (u.strikeTiles.length === 0) {
      if (this.strikeLeft > 0) this.hideStrike();
      return;
    }
    const p = patternsOf(this.balance.bosses[key], u.phase)[u.pattern];
    if (p === undefined || p.kind !== 'strike' || u.patternTimer <= 0) return;
    const left = u.patternTimer / TICKS_PER_SECOND;
    if (this.strikeLeft <= 0) {
      const tiles: { lane: number; col: number }[] = [];
      for (const t of u.strikeTiles) tiles.push({ lane: Math.floor(t / COLS), col: t % COLS });
      this.showStrike(tiles, strikeTintOf(p), left);
    }
    this.strikeLeft = left;
  }

  /** Puts the warning on `tiles` in `tint` for `seconds` (the frames steady, the fills blinking). */
  private showStrike(tiles: readonly { lane: number; col: number }[], tint: string, seconds: number): void {
    while (this.strikeTiles.length < Math.min(tiles.length, STRIKE_TILES)) {
      const frame = new Mesh(this.frameGeometry, this.strikeFrameMaterial);
      const fill = new Mesh(this.fillGeometry, this.strikeFillMaterial);
      frame.name = 'boss-strike-tile';
      fill.name = 'boss-strike-fill';
      frame.renderOrder = fill.renderOrder = 9;
      frame.visible = fill.visible = false;
      this.group.add(frame, fill);
      this.strikeTiles.push({ frame, fill });
    }
    this.strikeTint = hex(tint);
    this.strikeFrameMaterial.color.set(tint);
    this.strikeFillMaterial.color.set(tint);
    const n = Math.min(tiles.length, this.strikeTiles.length);
    for (let i = 0; i < this.strikeTiles.length; i++) {
      const s = this.strikeTiles[i] as { frame: Mesh; fill: Mesh };
      const t = tiles[i];
      const on = i < n && t !== undefined;
      s.frame.visible = s.fill.visible = on;
      if (on) {
        s.frame.position.set(t.col + 0.5, 0, t.lane + 0.5);
        s.fill.position.set(t.col + 0.5, 0, t.lane + 0.5);
      }
    }
    this.strikeUsed = n;
    this.strikeLeft = seconds > 0 ? seconds : 0.01;
  }

  private hideStrike(): void {
    this.strikeLeft = -1;
    this.strikeUsed = 0;
    for (let i = 0; i < this.strikeTiles.length; i++) {
      const s = this.strikeTiles[i] as { frame: Mesh; fill: Mesh };
      s.frame.visible = s.fill.visible = false;
    }
  }

  /** The blow lands: soil and a ring on each of the three tiles, the camera shakes hard. */
  private slamDown(lane: number, col: number): void {
    for (let l = lane - 1; l <= lane + 1; l++) {
      if (l < 0 || l >= LANES) continue;
      v1.set(col + 0.5, 0, l + 0.5);
      this.fx.dirt(v1);
      this.fx.ring(v1, SOIL[1] as number, l === lane ? 0.9 : 0.6, true);
      this.fx.burst(v1, SOIL, 10, 2.2);
    }
    this.onFeel({ shake: 1, hitStop: 0.09, punch: 0.06 });
  }

  private setDome(view: UnitView, on: boolean): void {
    this.domeOn = on;
    this.dome.visible = on;
    if (on && this.dome.parent !== view.wrapper) view.wrapper.add(this.dome);
  }

  private setBark(view: UnitView, on: boolean): void {
    this.barkOn = on;
    view.showPart('barkL', on);
    view.showPart('barkR', on);
    this.barkFor = on ? 0 : -1;
    const apart = on ? BARK_APART / lookOf(view.key).scale : 0;
    view.shiftPart('barkL', 0, 0, -apart);
    view.shiftPart('barkR', 0, 0, apart);
  }

  /** The Oak's pupils turn towards the nearest standing zombie (across the lanes). */
  private lookAt(view: UnitView, oak: Unit, state: SimState): void {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < state.units.length; i++) {
      const z = state.units[i] as Unit;
      if (z.faction !== 'zombies' || !(z.hp > 0)) continue;
      const d = (z.x - oak.x) ** 2 + (z.lane - oak.lane) ** 2;
      if (d < bestD) {
        bestD = d;
        best = z.lane - oak.lane;
      }
    }
    const aside = Math.max(-1, Math.min(1, best / 2));
    view.shiftPart('pupils', 0, 0, aside * PUPIL_REACH);
  }
}

/** A strike's tint: that of the status it leaves, or white for none. */
function strikeTintOf(p: Extract<BossPattern, { kind: 'strike' }> | null): string {
  return STRIKE_TINT[p?.status?.kind ?? 'none'];
}

/** The status of the first strike in a pattern list ('none' when it has no strike or that leaves none). */
function firstStrikeStatus(list: readonly BossPattern[]): StatusKind | 'none' {
  for (const p of list) if (p.kind === 'strike') return p.status?.kind ?? 'none';
  return 'none';
}

/** A tile's red frame: four bars round its edge, a little above the grass. */
function tileFrame(): ReturnType<BoxBatch['build']> {
  const b = new BoxBatch();
  const t = 0.08;
  const h = 0.04;
  const y = 0.03;
  b.box(-0.5, y, -0.5, 1, h, t, TILE_RED);
  b.box(-0.5, y, 0.5 - t, 1, h, t, TILE_RED);
  b.box(-0.5, y, -0.5 + t, t, h, 1 - 2 * t, TILE_RED);
  b.box(0.5 - t, y, -0.5 + t, t, h, 1 - 2 * t, TILE_RED);
  return b.build();
}

/** An acorn's landing mark: a stepped square ring a tile wide, flat on the grass. */
function landingMark(): ReturnType<BoxBatch['build']> {
  const b = new BoxBatch();
  const r = 0.42;
  const t = 0.09;
  const h = 0.03;
  b.box(-r, 0, -r, 2 * r, h, t, TILE_RED);
  b.box(-r, 0, r - t, 2 * r, h, t, TILE_RED);
  b.box(-r, 0, -r + t, t, h, 2 * r - 2 * t, TILE_RED);
  b.box(r - t, 0, -r + t, t, h, 2 * r - 2 * t, TILE_RED);
  // A dot in the middle: the spot.
  b.box(-0.07, 0, -0.07, 0.14, h, 0.14, TILE_RED);
  return b.build();
}

/** A tile's see-through red fill, flat on the grass. */
function tileFill(): ReturnType<BoxBatch['build']> {
  const b = new BoxBatch();
  b.box(-0.46, 0.02, -0.46, 0.92, 0.01, 0.92, TILE_RED);
  return b.build();
}

/**
 * A pixel arrow pointing down, its tip at the origin, in the plane facing the camera (tiles): red
 * steps on an ink outline a little larger behind them, drawn first.
 */
function downArrow(): ReturnType<BoxBatch['build']> {
  const b = new BoxBatch();
  const d = 0.06;
  const step = 0.09;
  const ink = 0.045;
  const widths = [0.12, 0.3, 0.48, 0.66];
  const shape = (grow: number, z: number, color: string): void => {
    widths.forEach((w, i) => b.box(-w / 2 - grow, i * step - (i === 0 ? grow : 0), z, w + 2 * grow, step + (i === 0 ? grow : 0), d, color));
    b.box(-0.12 - grow, widths.length * step, z, 0.24 + 2 * grow, 0.42 + grow, d, color);
  };
  shape(ink, -d, '#2A1B0E');
  shape(0, 0, TILE_RED);
  return b.build();
}

/** The Titan's shield: a glass box round it, in tiles about its feet (half-widths and height). */
const DOME_HX = 1.25;
const DOME_HZ = 0.95;
const DOME_H = 3;
function stepDome(): ReturnType<BoxBatch['build']> {
  const b = new BoxBatch();
  b.box(-DOME_HX, 0, -DOME_HZ, 2 * DOME_HX, DOME_H, 2 * DOME_HZ, DOME_COLOR);
  return b.build();
}

/** The glass box's twelve edges, as thin bars. */
function domeEdges(): ReturnType<BoxBatch['build']> {
  const b = new BoxBatch();
  const t = 0.07;
  for (const x of [-DOME_HX, DOME_HX - t]) for (const z of [-DOME_HZ, DOME_HZ - t]) b.box(x, 0, z, t, DOME_H, t, DOME_COLOR);
  for (const y of [0, DOME_H - t]) {
    for (const z of [-DOME_HZ, DOME_HZ - t]) b.box(-DOME_HX, y, z, 2 * DOME_HX, t, t, DOME_COLOR);
    for (const x of [-DOME_HX, DOME_HX - t]) b.box(x, y, -DOME_HZ, t, t, 2 * DOME_HZ, DOME_COLOR);
  }
  return b.build();
}
