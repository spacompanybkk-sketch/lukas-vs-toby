import { Box3, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import type { Balance, BossPattern, DeepReadonly } from '../../data/balance';
import { BOSS_LOOK } from '../../data/bossLooks';
import type { BossLook, StrikeWarning } from '../../data/bossLooks';
import { patternsOf, slamCol } from '../../sim/boss';
import { BOSS_HALF_WIDTH, COLS, LANES, TICKS_PER_SECOND } from '../../sim/types';
import type { BossKey, SimEvent, SimState, StatusKind, Unit, UnitKey } from '../../sim/types';
import type { Effects } from '../fx/Effects';
import { makeProjectile } from '../models/props';
import { PALETTE } from '../palette';
import { BoxBatch } from '../world/boxes';
import type { Feel } from './types';
import type { UnitView } from './UnitView';

// The bosses' shows (phase 3 Task 3), for `BattleView`: the entrance, the slam's wind-up tiles and
// its blow, a strike's warning tiles, its move and its blow, the shield (a dome, a moon dome, bark or
// ice plates), the summons, the eyes that follow the enemies, the parts that light up from phase 2,
// and the defeat (brain blocks; leaves and rolling acorns; shards). Which show a boss gets is its row
// in `BOSS_LOOK` (data/bossLooks.ts); nothing here names a boss. Everything is made once and pooled
// (a strike's tiles on its first strike): nothing here allocates per frame. Read from events and the
// state only.

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
/** The moon dome (`shield: 'moon'`): the same glass in pale moonlight, glowing, its edges past the bloom threshold. */
const MOON_COLOR = '#FFF2A8';
const MOON_GLOW = 0.6;
const MOON_EDGE_GLOW = 1.4;
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
/** The ice plates' chips (`shield: 'ice'`): frost white and two blues. */
const ICE = [hex('#E8FAFF'), hex('#7FD3F5'), hex('#B8ECFF')];
const MOON_SPARK = hex(MOON_COLOR);
/** The shield plates each plate show slides in: bark (`barkL`, `barkR`) or ice (`iceL`, `iceR`). */
const PLATES = { bark: ['barkL', 'barkR'], ice: ['iceL', 'iceR'] } as const;
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
  /** Shield plates shut (bark or ice), and seconds since they began to close (−1: still). */
  private barkOn = false;
  private barkFor = -1;
  /** The boss's shield plates (none for a dome) and the colours their chips fly in. */
  private plateL = 'barkL';
  private plateR = 'barkR';
  private plateChips: number[] = BARK;
  /** The dome's spark colour (blue glass or moonlight). */
  private domeSpark = DOME_SPARK;
  /** The boss's parts that blink through a strike's wind-up (`fx.strikeParts`), found once on `enter`. */
  private readonly strikeParts: Object3D[] = [];
  /** Its parts shown from phase 2 on (`fx.phaseParts`), and whether they show. */
  private readonly phaseParts: Object3D[] = [];
  private phaseShown = false;
  /** A `shards` defeat's colours (`fx.shards`). */
  private readonly shardColors: number[] = [];
  /** Wolf ears for the units a boss with `fx.pups` summons (made on its first summon), and who wears each. */
  private earGeometry: ReturnType<BoxBatch['build']> | null = null;
  private readonly earMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  private readonly ears: { mesh: Mesh; owner: UnitView | null }[] = [];
  /** How many units spawned this step still get ears (set by a summon, cleared by the boss's `sync`). */
  private pupsDue = 0;
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
    const look = lookOf(view.key);
    view.setBulk(look.scale);
    this.dress(view, look);
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
    this.pupsDue = 0; // the summon's units came on in the step's events, before this
    if (view.dying || this.ended) return;
    const shows = lookOf(view.key).fx;
    const shield = u.shieldLeft > 0;
    if (shows.shield === 'dome' || shows.shield === 'moon') {
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
        this.raiseArm(view, slam.windupSeconds, left);
      }
      this.windupLeft = left;
    } else if (this.windupLeft > 0) {
      this.hideTiles();
    }
    this.syncStrike(view, u);
    // From phase 2 on (after its first shield mark) its phase parts light up; from the state, so a
    // restored match shows them as its phase says.
    const angry = u.phase >= 1;
    if (angry !== this.phaseShown) {
      this.phaseShown = angry;
      for (let i = 0; i < this.phaseParts.length; i++) (this.phaseParts[i] as Object3D).visible = angry;
    }
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
      this.showStrike(e.tiles, warningOf(u.key as BossKey, strike?.status?.kind ?? 'none'), windup);
      const boss = this.boss;
      if (boss !== null && boss.id === e.unitId) this.strikeMove(boss, windup);
      return;
    }
    // The blow: the tint it was announced in (or, for a view that missed the wind-up, its list's).
    if (this.strikeLeft <= 0 && u !== undefined && Object.hasOwn(BOSS_HALF_WIDTH, u.key)) {
      this.strikeTint = hex(warningOf(u.key as BossKey, firstStrikeStatus(patternsOf(this.balance.bosses[u.key as BossKey], u.phase))).frame);
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

  /** A boss's pattern event (`state`: the state after its step, for the slam's own wind-up). */
  pattern(e: Extract<SimEvent, { type: 'bossPattern' }>, view: UnitView | undefined, state?: SimState): void {
    if (!view || view.dying) return;
    switch (e.kind) {
      case 'slam':
        if (e.windup) {
          // Each slam's own wind-up (the Titan's 1.5 s, or whatever a boss's table says).
          const u = state?.units.find((v) => v.id === e.unitId);
          const slam = u === undefined ? null : slamOf(this.balance, view.key as BossKey, u.phase, u.pattern);
          const windup = slam?.windupSeconds ?? lookOf(view.key).fx.slamRise ?? 1.5;
          this.raiseArm(view, windup, windup);
          if (e.col !== null) this.showTiles(e.lane, e.col, windup);
        } else {
          this.hideTiles();
          this.slamDown(e.lane, e.col ?? 0);
        }
        break;
      case 'summon':
        if (lookOf(view.key).fx.pups === true) this.pupsDue = PUPS_MAX;
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
        this.fx.ring(v1, this.shieldRing(lookOf(view.key).fx.shield), 1.6, true);
        this.onFeel({ shake: 0.3 });
        break;
      default: {
        const unhandled: never = e.kind;
        void unhandled;
      }
    }
  }

  /**
   * A unit came on (not a boss). Straight after a summon by a boss with `fx.pups` (the Howler), its
   * side's newcomers are its pups and get a pair of wolf ears on their heads. Views only: nothing in
   * the simulation knows, so a view that joins later shows them without.
   */
  spawned(view: UnitView): void {
    const boss = this.boss;
    if (this.pupsDue <= 0 || boss === null || view.faction !== boss.faction || view.boss) return;
    const head = view.model.root.getObjectByName('head');
    if (!head) return;
    this.pupsDue--;
    let slot = this.ears.find((e) => e.owner === null || e.owner.dying || e.owner.wrapper.parent === null);
    if (slot === undefined) {
      if (this.ears.length >= PUPS_POOL) return;
      this.earGeometry ??= wolfEars();
      const mesh = new Mesh(this.earGeometry, this.earMaterial);
      mesh.name = 'boss-pup-ears';
      slot = { mesh, owner: null };
      this.ears.push(slot);
    }
    slot.owner = view;
    // On top of its head, as modelled: the head's own boxes (the parts on it left out).
    const top = PUP_BOX.makeEmpty();
    for (const child of head.children) {
      const g = (child as Mesh).geometry;
      if (!(child as Mesh).isMesh || !g) continue;
      if (g.boundingBox === null) g.computeBoundingBox();
      top.union(g.boundingBox as Box3);
    }
    if (top.isEmpty()) return;
    slot.mesh.position.set((top.min.x + top.max.x) / 2, top.max.y, (top.min.z + top.max.z) / 2);
    slot.mesh.scale.setScalar(PUP_EAR_SCALE);
    head.add(slot.mesh);
  }

  /** A shot bounced off the dome: a ping of sparks where it hit. */
  ping(at: Vector3): void {
    this.fx.sparkles(at, this.domeSpark);
  }

  /** True while the plates (the Oak's bark, the Melon's ice) are shut (hits on them then throw chips: it takes half). */
  get barkShut(): boolean {
    return this.barkOn;
  }

  /** Hit while its plates are shut: chips of bark or ice and a spark off the plates (at most every 0.15 s). */
  barkHit(view: UnitView): void {
    if (!this.barkOn || this.barkSparkIn > 0) return;
    this.barkSparkIn = BARK_SPARK_GAP;
    v1.set(view.currX + 0.75, 0.9, view.lane + 0.5 + 0.35);
    this.fx.spark(v1);
    this.fx.burst(v1, this.plateChips, 6, 1.2);
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
    const defeat = lookOf(view.key).fx.defeat;
    if (defeat === 'leaves') {
      // The leaves start to drop at once.
      for (let i = -1; i <= 1; i++) {
        v1.set(view.currX, 2.2, view.lane + 0.5 + i);
        this.fx.burst(v1, LEAVES, 16, 1.2);
      }
    } else if (defeat === 'shards') {
      // The first chips fly as it cracks.
      v1.set(view.currX, 1.4, view.lane + 0.5);
      this.fx.burst(v1, this.shardColors, 12, 1.4);
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
    } else if (lookOf(view.key).fx.defeat === 'shards') {
      this.shatter(view, x, z);
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
      // Its tell blinks with them (the Melon's icicle crown).
      for (let i = 0; i < this.strikeParts.length; i++) (this.strikeParts[i] as Object3D).visible = on;
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
      boss.shiftPart(this.plateL, 0, 0, -apart);
      boss.shiftPart(this.plateR, 0, 0, apart);
      if (u >= 1) {
        this.barkFor = -1;
        v1.set(boss.currX + 0.75, 0.8, boss.lane + 0.5 + 0.35);
        this.fx.burst(v1, this.plateChips, 18, 1.8);
        this.fx.spark(v1);
        v1.set(boss.currX + 0.5, 0, boss.lane + 0.5);
        this.fx.ring(v1, this.plateChips[0] as number, 1.2, true);
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
    for (const e of this.ears) e.mesh.removeFromParent();
    this.earGeometry?.dispose();
    this.earMaterial.dispose();
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

  /**
   * What the boss's look asks for, once as it comes on: the dome's glass (blue, or glowing moonlight),
   * which plates its shield slides in, its strike and phase parts, its shards' colours.
   */
  private dress(view: UnitView, look: BossLook): void {
    const shows = look.fx;
    const moon = shows.shield === 'moon';
    const glass = moon ? MOON_COLOR : DOME_COLOR;
    this.domeMaterial.color.set(glass);
    this.domeMaterial.emissive.set(glass);
    this.domeMaterial.emissiveIntensity = moon ? MOON_GLOW : 0.15;
    this.edgeMaterial.color.set(glass);
    if (moon) this.edgeMaterial.color.multiplyScalar(MOON_EDGE_GLOW);
    this.domeSpark = moon ? MOON_SPARK : DOME_SPARK;
    const ice = shows.shield === 'ice';
    [this.plateL, this.plateR] = ice ? PLATES.ice : PLATES.bark;
    this.plateChips = ice ? ICE : BARK;
    this.strikeParts.length = 0;
    this.phaseParts.length = 0;
    this.phaseShown = false;
    for (const name of shows.strikeParts ?? []) {
      const part = view.model.root.getObjectByName(name);
      if (part) {
        part.visible = false;
        this.strikeParts.push(part);
      }
    }
    for (const name of shows.phaseParts ?? []) {
      const part = view.model.root.getObjectByName(name);
      if (part) {
        part.visible = false;
        this.phaseParts.push(part);
      }
    }
    this.shardColors.length = 0;
    for (const c of shows.shards ?? []) this.shardColors.push(hex(c));
    if (this.shardColors.length === 0) this.shardColors.push(0xffffff);
  }

  /** The ring thrown out as its shield goes up, in the shield's colour. */
  private shieldRing(shield: BossLook['fx']['shield']): number {
    if (shield === 'bark') return BARK[1] as number;
    if (shield === 'ice') return ICE[1] as number;
    return shield === 'moon' ? MOON_SPARK : DOME_SPARK;
  }

  /**
   * The slam's raised arm (its `ability`), sped up or slowed so the arm's rise (`fx.slamRise`, or
   * the slam's own wind-up) fills the `left` seconds until the blow.
   */
  private raiseArm(view: UnitView, windupSeconds: number, left: number): void {
    if (view.dying || !(left > 0)) return;
    const rise = lookOf(view.key).fx.slamRise ?? windupSeconds;
    view.model.play('ability', { speed: rise / left });
  }

  /**
   * A strike's move (`fx.strike`), drawn out over the `left` seconds of its wind-up so it ends with
   * the blow: a one-shot clip slowed to fit, a looping one played that long. None: it carries on.
   */
  private strikeMove(view: UnitView, left: number): void {
    const name = lookOf(view.key).fx.strike;
    if (name === undefined || view.dying || !(left > 0)) return;
    const clip = view.def.clips[name];
    if (clip === undefined) return;
    if (clip.loop) view.playFor(name, left);
    else view.model.play(name, { speed: clip.duration / left });
  }

  /** A `shards` defeat: its body breaks into chips of its colours, across the lanes it stands in, or along its fallen length. */
  private shatter(view: UnitView, x: number, z: number): void {
    const half = BOSS_HALF_WIDTH[view.key as BossKey];
    const colors = this.shardColors;
    for (let i = 0; i < BRAIN_HANDFULS; i++) {
      // A boss across lanes breaks where it stands; a walker that toppled lies along +X from its feet.
      if (half > 0) v1.set(x + 0.2 * (i % 2), 0.4 + 0.5 * (i % 3), z - half + (2 * half * i) / (BRAIN_HANDFULS - 1));
      else v1.set(x + 0.3 + i * 0.45, 0.4, z + (i % 2 === 0 ? 0.3 : -0.3));
      this.fx.debris(v1, colors, 5);
      this.fx.debris(v1, colors, 5);
      this.fx.burst(v1, colors, 14, 3.2);
    }
    v1.set(half > 0 ? x : x + 1, 0, z);
    this.fx.ring(v1, colors[0] as number, 1.1 + half);
    this.onFeel({ shake: 1, hitStop: 0.1 });
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
  private syncStrike(view: UnitView, u: Unit): void {
    if (u.strikeTiles.length === 0) {
      if (this.strikeLeft > 0) this.hideStrike();
      return;
    }
    const p = patternsOf(this.balance.bosses[view.key as BossKey], u.phase)[u.pattern];
    if (p === undefined || p.kind !== 'strike' || u.patternTimer <= 0) return;
    const left = u.patternTimer / TICKS_PER_SECOND;
    if (this.strikeLeft <= 0) {
      // Joined during the wind-up (or restored into one): the warning and the move, timed to the blow.
      const tiles: { lane: number; col: number }[] = [];
      for (const t of u.strikeTiles) tiles.push({ lane: Math.floor(t / COLS), col: t % COLS });
      this.showStrike(tiles, warningOf(view.key as BossKey, p.status?.kind ?? 'none'), left);
      this.strikeMove(view, left);
    }
    this.strikeLeft = left;
  }

  /** Puts the warning on `tiles` in its colours for `seconds` (the frames steady, the fills blinking). */
  private showStrike(tiles: readonly { lane: number; col: number }[], warning: StrikeWarning, seconds: number): void {
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
    this.strikeTint = hex(warning.frame);
    this.strikeFrameMaterial.color.set(warning.frame);
    this.strikeFillMaterial.color.set(warning.fill);
    this.strikeFillMaterial.opacity = warning.opacity;
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
    for (let i = 0; i < this.strikeParts.length; i++) (this.strikeParts[i] as Object3D).visible = false;
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

  /** Its plates (bark or ice) show and start to slide shut, or go. */
  private setBark(view: UnitView, on: boolean): void {
    this.barkOn = on;
    view.showPart(this.plateL, on);
    view.showPart(this.plateR, on);
    this.barkFor = on ? 0 : -1;
    const apart = on ? BARK_APART / lookOf(view.key).scale : 0;
    view.shiftPart(this.plateL, 0, 0, -apart);
    view.shiftPart(this.plateR, 0, 0, apart);
  }

  /** Its pupils (the Oak's, the Melon's) turn towards the nearest standing zombie (across the lanes). */
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

/**
 * How a boss's strike leaving `status` is warned of: its look's own colours for that status
 * (`fx.strikeWarnings`: the Howler's blinding howl is dark smoke with a light outline, which reads
 * on the night lawn), or the shared tint (`STRIKE_TINT`) for frame and fill alike.
 */
function warningOf(key: BossKey, status: StatusKind | 'none'): StrikeWarning {
  const own = BOSS_LOOK[key]?.fx.strikeWarnings?.[status];
  if (own !== undefined) return own;
  const tint = STRIKE_TINT[status];
  const shared = SHARED_WARNINGS[status];
  shared.fill = shared.frame = tint;
  return shared;
}
/** The shared warnings, one object per status (no allocation per strike). */
const SHARED_WARNINGS: Record<StatusKind | 'none', { fill: string; frame: string; opacity: number }> = {
  stun: { fill: '', frame: '', opacity: STRIKE_FILL_OPACITY }, blind: { fill: '', frame: '', opacity: STRIKE_FILL_OPACITY },
  burn: { fill: '', frame: '', opacity: STRIKE_FILL_OPACITY }, none: { fill: '', frame: '', opacity: STRIKE_FILL_OPACITY },
  poison: { fill: '', frame: '', opacity: STRIKE_FILL_OPACITY }, tied: { fill: '', frame: '', opacity: STRIKE_FILL_OPACITY },
  haste: { fill: '', frame: '', opacity: STRIKE_FILL_OPACITY },
};

/** The status of the first strike in a pattern list ('none' when it has no strike or that leaves none). */
function firstStrikeStatus(list: readonly BossPattern[]): StatusKind | 'none' {
  for (const p of list) if (p.kind === 'strike') return p.status?.kind ?? 'none';
  return 'none';
}

/** At most this many pups a summon, and pairs of ears in all (a pup's are reused once it is gone). */
const PUPS_MAX = 4;
const PUPS_POOL = 12;
const PUP_BOX = new Box3();
/** Ears a little bigger than the Howler's voxels, so they read on a small zombie from the lawn camera. */
const PUP_EAR_SCALE = 1.4;

/**
 * A pup's wolf ears, in tiles about the top middle of its head: two stepped grey-violet points with
 * pink insides, standing up either side, like the Howler's.
 */
function wolfEars(): ReturnType<BoxBatch['build']> {
  const b = new BoxBatch();
  const v = VOXEL;
  for (const side of [1, -1]) {
    const z = side > 0 ? 1 * v : -3.5 * v;
    b.box(-1.5 * v, 0, z, 3 * v, 1.5 * v, 2.5 * v, '#9C98B8');
    b.box(-1 * v, 1.5 * v, z + 0.5 * v, 2 * v, 1.5 * v, 1.5 * v, '#9C98B8');
    b.box(-0.5 * v, 3 * v, z + 0.75 * v, 1 * v, 1 * v, 1 * v, '#CFCBE2');
    b.box(-2 * v, 0.5 * v, z + 0.5 * v, 0.5 * v, 2 * v, 1.5 * v, '#F2A0BE');
  }
  return b.build();
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
