import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { Vector3 } from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import { SoundGate, battleIntensity, playEventSounds } from '../audio/bindings';
import type { Theme } from '../audio/music';
import { WORLDS, arenaOf, type WorldKey } from '../data/worlds';
import { BattleView } from '../render/battle/BattleView';
import type { AimPreview } from '../render/battle/types';
import { LAWN_COLS, LAWN_LANES, simToWorld, tileCenter, worldToClient } from '../render/coords';
import { MARKS_LOUD, MARKS_QUIET } from '../render/world/PlaceMarks';
import { TwistShow } from '../render/world/TwistTiles';
import { NO_TWIST } from '../sim/lawn';
import type { CommandRejection, Faction, LawnConfig, SimEvent } from '../sim/types';
import { STEPS_PER_SECOND } from '../game/GameLoop';
import type { LockstepMatch } from '../net/lockstepMatch';
import { BattleController } from './BattleController';
import type { BattleOptions, OnlineSignals } from './BattleController';
import { BattleInput } from './input';
import { modelsFor } from './prewarm';
import { BattleSpeed, lessonShowing } from './speed';
import type { InputTarget, Picked, Tile } from './input';
import { FeelClock } from './Stage';
import type { Director, StageLike } from './Stage';

/** Seconds of the opening camera move, before the READY and FIGHT! banners. */
export const INTRO_SECONDS = 1.8;

/** Seconds the winners cheer, after the loser's base has fallen, before the result panel shows. */
export const CHEER_SECONDS = 2;

/** The place marks show loud this long (real seconds) after a card is tapped. */
export const PLACE_LOUD_SECONDS = 1;

/** A hero power just used: whose (the banner shows that boy), numbered so two in a row both show. */
export interface HeroBanner { side: Faction; n: number }

/** Where an energy token flies from (client pixels) when the player's side earns energy. */
export type TokenSink = (from: { x: number; y: number }, side: Faction, amount: number) => void;

export interface BattleSessionOptions {
  /** Seconds of the opening camera move (default `INTRO_SECONDS`; 0 skips it). */
  introSeconds?: number;
  /** Flies a token to the HUD's energy counter. */
  onToken?: TokenSink;
  /** For tests: input options other than the canvas (a fake document, a lawn test). */
  input?: Partial<ConstructorParameters<typeof BattleInput>[1]>;
}

/**
 * The world a battle is played in and the music it plays to: an Adventure level's arena (its
 * side's world, the zombies travelling the worlds in reverse) with the level's own lawn twists and
 * the arena's theme; the Backyard with no twist and the Backyard theme for everything else (Quick
 * Battle, Versus, Free Play, the demos). Zombie world 1 is the Citadel with its lava off (the
 * level has no twist) and the Citadel theme.
 */
export function battleWorld(opts: BattleOptions): { world: WorldKey; lawn: LawnConfig; theme: Theme } {
  const play = opts.play;
  if (play === undefined) return { world: 'backyard', lawn: NO_TWIST, theme: 'backyard' };
  const world = arenaOf(play.def.side, play.def.world);
  return { world, lawn: play.config.lawn, theme: WORLDS[world].theme };
}

const near = new Vector3();
const far = new Vector3();
const point = new Vector3();

/**
 * One battle on the stage: the controller (match, opponent, HUD signals), the view binding it to
 * the 3D lawn, the player's input and the sound. It takes the stage from the title's demo when
 * made and gives it back when disposed, so a second battle starts on the same renderer.
 *
 * Life: made → `start()` plays the camera intro → the HUD shows READY and FIGHT! and calls
 * `begin()`, which lets the simulation and the input go → the match ends: the loser's base falls,
 * then the camera swings to the winner, `resultReady` turns true and the result panel shows.
 */
export class BattleSession implements Director, InputTarget {
  readonly controller: BattleController;
  /** True once the end of the match has played out and the result panel may show. */
  readonly resultReady: ReadonlySignal<boolean>;
  /** Resolves when the opening camera move has landed (the banners wait for it). */
  intro: Promise<void> = Promise.resolve();
  /** True when the battle was begun at once (a test scene): the HUD shows no banners. */
  skipIntro = false;
  /** The last hero power used, by either side: the HUD shows its boy's banner. */
  readonly heroBanner = signal<HeroBanner | null>(null);
  /** The world this battle is played in. */
  readonly world: WorldKey;
  /** The 2X button: the player's choice and when it applies (offered in every battle but Versus). */
  readonly speed: BattleSpeed;
  /** The music this battle plays to: its arena's theme in the Adventure, else the Backyard's. */
  private readonly theme: Theme;

  /** A tap on the boss's entrance card ends the lawn's entrance show. */
  skipBossEntrance(): void {
    this.current.bossFx.skipEntrance();
  }

  private readonly stage: StageLike;
  private readonly audio: AudioEngine;
  /** The view of the lawn; a repair builds a new one (`rebuildView`). */
  private current: BattleView;
  /** Two-device Versus: the controller's online signals and the seat's link, or null. */
  private readonly online: OnlineSignals | null;
  private readonly link: LockstepMatch | null;
  /** Online, while the loop is paused: steps owed to the link (see `frame`). */
  private idleOwed = 0;
  private readonly input: BattleInput;
  private readonly clock = new FeelClock();
  private readonly ready = signal(false);
  private readonly introSeconds: number;
  private readonly onToken: TokenSink | undefined;
  private begun = false;
  private ended = false;
  private detached = false;
  private disposed = false;
  private time = 0;
  /** The loser's base has finished falling; seconds of cheering since. */
  private fallen = false;
  private cheerFor = 0;
  private endSounds = false;
  private readonly offEffects: (() => void)[] = [];
  /** The version of the controller's place marks the lawn shows (-1: none shown). */
  private placeShown = -1;
  /** Real seconds since the session was made, and until when the place marks show loud. */
  private realTime = 0;
  private loudUntil = 0;
  private placeStrength = MARKS_QUIET;
  /** Keeps poison and burn to one sound a second across the battle. */
  private readonly soundGate = new SoundGate();
  /** The twist lesson's ghosts while its step holds the match (the camera pans over them). */
  private twist: TwistShow | null = null;

  constructor(stage: StageLike, audio: AudioEngine, opts: BattleOptions, options: BattleSessionOptions = {}) {
    this.stage = stage;
    this.audio = audio;
    this.introSeconds = options.introSeconds ?? INTRO_SECONDS;
    this.onToken = options.onToken;
    this.resultReady = this.ready;
    this.controller = new BattleController(opts);
    // Speed belongs to this driver, never to the match: a two-player Versus simply does not offer it.
    this.speed = new BattleSpeed({ offered: opts.versus !== true, lesson: lessonShowing(this.controller.tutorial) });
    stage.show(this);
    const { world, lawn, theme } = battleWorld(opts);
    this.world = world;
    this.theme = theme;
    stage.setWorld(world, lawn);
    this.online = this.controller.online;
    this.link = opts.online?.link ?? null;
    this.current = this.makeView();
    this.input = new BattleInput(this, { canvas: stage.canvas, ...options.input });
    // A new card (or none) changes what the ghost should show where the pointer already is.
    const hud = this.controller.hud;
    this.offEffects.push(hud.selected.subscribe(() => this.input.refresh()));
    this.offEffects.push(hud.shovel.subscribe(() => this.input.refresh()));
    this.offEffects.push(hud.heroSelected.subscribe(() => this.input.refresh()));
    this.offEffects.push(hud.spellSelected.subscribe(() => this.input.refresh()));
    // A card picked (from the tray or the belt) shows where it may go at full strength for a moment.
    // Subscribing calls back at once with the card picked at the start: that one stays quiet.
    let first = 2;
    const loud = (v: unknown): void => {
      if (first > 0) { first -= 1; return; }
      if (v !== null) this.loudUntil = this.realTime + PLACE_LOUD_SECONDS;
    };
    this.offEffects.push(hud.selected.subscribe(loud));
    this.offEffects.push(this.controller.levelHud.beltSlot.subscribe(loud));
    // Every refusal, from a lawn tap or a HUD button (a power still charging), is heard once.
    let denied = hud.denied.peek();
    this.offEffects.push(hud.denied.subscribe((n) => {
      if (n > denied && !this.disposed) this.audio.play('deny');
      denied = n;
    }));
    const online = this.online;
    if (online !== null) {
      // The own taps waiting to run show on the lawn (spec 6.4); a repair redraws it (6.6 item 4).
      this.offEffects.push(online.pending.subscribe((marks) => {
        if (!this.detached) this.current.setPending(marks);
      }));
      let repairs = online.repairs.peek();
      this.offEffects.push(online.repairs.subscribe((n) => {
        if (n === repairs) return;
        repairs = n;
        this.rebuildView();
      }));
    }
  }

  /** The 3D lawn's view of this battle (a new one after a repair). */
  get view(): BattleView {
    return this.current;
  }

  get playerFaction(): Faction {
    return this.controller.playerFaction;
  }

  /** True between `begin()` and the end of the match. */
  get live(): boolean {
    return this.begun && !this.ended && !this.disposed;
  }

  /** Plays the opening camera move; the battle itself waits for `begin()`. */
  start(): Promise<void> {
    this.intro = this.introSeconds > 0 ? this.stage.rig.playIntro(this.introSeconds) : Promise.resolve();
    return this.intro;
  }

  /** Lets the simulation run and the lawn take taps. Called by the HUD after FIGHT!; safe to call twice. */
  begin(): void {
    if (this.begun || this.disposed) return;
    this.begun = true;
    this.audio.startMusic(this.theme);
  }

  /**
   * Game time per real time the 2X button asks of the loop now: its own factor (2 when lit, 1
   * during a lesson that waits for the player or in Versus) while the battle runs, but 1 before it
   * begins, during the boss's entrance and once the match is decided, so those play as they always
   * have. The choice itself is kept through all of them.
   */
  speedFactor(): number {
    if (!this.live || this.current.bossFx.entering) return 1;
    return this.speed.factor();
  }

  /**
   * After a repair (spec 6.6 item 4): the view is disposed and built again from the restored state,
   * on the same stage and renderer, as a reload would draw it. Its marks, cue and pending taps follow.
   */
  rebuildView(): void {
    if (this.detached) return;
    this.current.dispose();
    this.current = this.makeView();
    this.current.applyEvents([], this.controller.match.state);
    this.placeShown = -1;
    this.current.setPlaceStrength(this.placeStrength);
    if (this.online !== null) this.current.setPending(this.online.pending.peek());
    this.input.refresh();
  }

  /**
   * The page hides (`true`) or shows again (`false`). Two-device Versus: hiding pauses both screens
   * with a write that can leave as the page goes (`link.hidden`); coming back reopens the streams
   * (`link.visible`) and stays paused until a boy resumes. Otherwise a hidden page pauses the battle.
   */
  visibility(hidden: boolean): void {
    if (this.disposed) return;
    const link = this.link;
    if (link !== null) {
      if (hidden) link.hidden();
      else link.visible();
      return;
    }
    if (hidden && this.controller.hud.result.peek() === null) this.controller.setPaused(true);
  }

  // ---- Director ------------------------------------------------------------------------------

  step(): void {
    if (!this.begun || this.detached) return;
    this.advance(true);
  }

  frame(alpha: number, realDt: number, gameDt: number): void {
    if (this.detached) return;
    // Online the link is asked at the loop's pace even while the loop takes no steps (paused): it
    // waits out the other device's silence and settles the end (`advance`).
    const loopPaused = this.stage.paused;
    if (loopPaused && this.online !== null && this.begun) this.idleSteps(realDt);
    else this.idleOwed = 0;
    if (this.detached) return;
    const state = this.controller.match.state;
    this.stage.paused = this.controller.hud.paused.peek();
    this.stage.timeScale = this.clock.tick(realDt) * this.speedFactor();
    this.time += gameDt;
    this.current.setMergeCue(this.live ? this.controller.mergeCue() : null);
    // Where the picked card may go: redrawn only when the tiles change (`placeTiles` keeps a version).
    const place = this.live ? this.controller.placeTiles() : -1;
    if (place !== this.placeShown) {
      this.placeShown = place;
      this.current.setPlaceable(place < 0 ? null : this.controller.placeable);
    }
    // Quiet while a card just stays picked; loud while one is dragged or just after a tap.
    this.realTime += realDt > 0 ? realDt : 0;
    const strength = this.input.dragging() || this.realTime < this.loudUntil ? MARKS_LOUD : MARKS_QUIET;
    if (strength !== this.placeStrength) {
      this.placeStrength = strength;
      this.current.setPlaceStrength(strength);
    }
    this.current.frame(state, alpha, gameDt, this.time, realDt);
    this.twistFrame(realDt);
    if (!this.ended) this.audio.setIntensity(battleIntensity(state));
    else if (this.fallen && !this.ready.peek()) {
      this.cheerFor += realDt > 0 ? realDt : 0;
      if (this.cheerFor >= CHEER_SECONDS) this.showResult();
    }
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.endTwist();
    this.input.dispose();
    this.current.dispose();
    // The next director (a turntable after a level's result, the map) starts in normal time.
    this.stage.paused = false;
    this.stage.timeScale = 1;
  }

  /**
   * Takes the battle off the stage; the stage stays for the next one. The music is left alone:
   * the app has already started the menu tune when Quit or Menu is pressed (the battle unmounts
   * after that), and a restart keeps the backyard tune going.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offEffects) off();
    this.offEffects.length = 0;
    this.controller.dispose(); // the link may live on (its owner disposes of it): it no longer reaches this battle
    this.stage.release(this);
    this.detach();
  }

  // ---- Test hooks ----------------------------------------------------------------------------

  /** The twist lesson's show while it plays, or null (tests and tools). */
  get twistShow(): TwistShow | null {
    return this.twist;
  }

  /** Steps the match `ticks` times with no drawing in between, every step's events to the view. */
  fastForward(ticks: number): void {
    const n = Math.max(0, Math.floor(ticks));
    for (let i = 0; i < n && !this.detached; i++) this.advance(false);
  }

  /** Knocks `amount` off a base's health (the next step decides the match if it has fallen). */
  damageBase(side: Faction, amount: number): void {
    const s = this.controller.match.state;
    s.baseHp[side] = Math.max(0, s.baseHp[side] - Math.max(0, amount));
  }

  /** Client pixel position of the middle of a tile. */
  tileToClient(lane: number, col: number): { x: number; y: number } {
    const rect = this.canvasRect();
    const at = worldToClient(tileCenter(lane, col, point), this.stage.camera, rect);
    return { x: rect.left + at.x, y: rect.top + at.y };
  }

  /** Client pixel position of a unit's body (half a tile above its feet), or null when it is gone. */
  unitToClient(id: number): { x: number; y: number } | null {
    const u = this.controller.match.state.units.find((x) => x.id === id);
    if (u === undefined) return null;
    const rect = this.canvasRect();
    const at = worldToClient(simToWorld(u.lane, u.x, point).setY(0.5), this.stage.camera, rect);
    return { x: rect.left + at.x, y: rect.top + at.y };
  }

  /** Client corners of lanes 0–4 (back-left, back-right, front-right, front-left), for layout checks. */
  lawnCorners(): { x: number; y: number }[] {
    const rect = this.canvasRect();
    return [[0, 0], [LAWN_COLS, 0], [LAWN_COLS, LAWN_LANES], [0, LAWN_LANES]].map(([x, z]) => {
      const at = worldToClient(point.set(x as number, 0, z as number), this.stage.camera, rect);
      return { x: rect.left + at.x, y: rect.top + at.y };
    });
  }

  // ---- InputTarget ---------------------------------------------------------------------------

  isLive(): boolean {
    return this.live;
  }

  pick(clientX: number, clientY: number): Picked {
    const rect = this.canvasRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    // The ground tile under the pointer decides, never a body standing over it (a tall plant's
    // covers the lanes behind it). `aimAt` says when a model hit counts: the shovel on a plant
    // whose tile is not the one under the finger, and the player's own zombie (see there).
    const tile = this.tileAt(nx, ny);
    const hit = this.current.unitHitByRay(nx, ny);
    const aimed = hit === null ? null : this.controller.aimAt(hit, tile);
    if (aimed !== null) return { tile: aimed, unitId: hit };
    const unitId = hit ?? this.current.unitNearRay(nx, ny, rect);
    return { tile, unitId };
  }

  hover(tile: Tile | null, unitId: number | null): AimPreview | null {
    return this.controller.hover(tile, unitId);
  }

  /** Online, a card's tap taken plays the place sound at once, though its unit comes `delay` ticks later (spec 6.4). */
  click(tile: Tile | null, unitId: number | null): CommandRejection | 'ignored' | null {
    const hud = this.controller.hud;
    const card = this.online !== null && hud.selected.peek() !== null && !hud.shovel.peek() && !this.aiming();
    const answer = this.controller.click(tile, unitId);
    if (answer === null && card && !this.disposed) this.audio.play('place');
    return answer;
  }

  setPreview(p: AimPreview | null): void {
    if (!this.detached) this.current.setPreview(p);
  }

  clearSelection(): void {
    this.controller.hotkey('Escape');
  }

  hotkey(key: string): void {
    this.controller.hotkey(key);
  }

  aiming(): boolean {
    const hud = this.controller.hud;
    return hud.heroSelected.peek() || hud.spellSelected.peek() !== null;
  }

  /** The sound comes from `hud.denied` (see the constructor), which every refusal counts. */
  denied(): void {}

  // ---- Inside --------------------------------------------------------------------------------

  /**
   * The twist lesson (a `twist` step holding the match): its ghosts on the lawn and the camera
   * easing in to frame them (one `focus`, made when the show starts), from the moment the step holds until it ends (a tap), the battle leaves the
   * stage or the stage shows another world. Paused, the show waits. Nothing here reaches the match.
   */
  private twistFrame(realDt: number): void {
    const vm = this.controller.tutorial?.twist.peek() ?? null;
    const want = vm !== null && vm.holding && this.live && this.stage.lawn.world === this.world;
    if (!want) {
      if (this.twist !== null) this.endTwist();
      return;
    }
    if (this.twist === null || this.twist.kind !== vm.kind) {
      this.endTwist();
      this.twist = new TwistShow(vm.kind, this.controller.match.state.config.lawn, this.stage.fx);
      this.stage.scene.add(this.twist.group);
      // Once: the rig eases in on its own and keeps the shot through resizes.
      this.stage.rig.focus(this.twist.box, this.twist.view);
    }
    if (!this.stage.paused) this.twist.update(realDt);
  }

  /** The twist show goes (ghosts freed) and the camera eases back to the lawn. */
  private endTwist(): void {
    if (this.twist === null) return;
    this.twist.dispose();
    this.twist = null;
    this.stage.rig.focus(null);
  }

  /**
   * One step. Online the controller is asked even paused or once the match is decided: the link
   * decides whether a tick runs, and between ticks it waits out the stall and settles the end.
   */
  private advance(withSound: boolean): void {
    const online = this.online !== null;
    if (!online && (this.ended || this.controller.hud.paused.peek())) return;
    const view = this.current;
    const events: SimEvent[] = this.controller.step();
    if (this.ended || this.detached) return;
    // A repair in this step built a new view from the state after it: these events are in it already.
    if (this.current === view) this.current.applyEvents(events, this.controller.match.state);
    // Online an own tap refused when it runs is heard once, as the denial it counts (`hud.denied`).
    const heard = online ? events.filter((e) => e.type !== 'commandRejected' || e.command.faction !== this.playerFaction) : events;
    if (withSound) playEventSounds(this.audio, heard, this.playerFaction, { state: this.controller.match.state, gate: this.soundGate });
    if (this.controller.hud.result.peek() !== null) this.finish(withSound);
    else if (withSound) this.input.refresh(); // energy or the lawn changed: the ghost may turn red or green
  }

  /** Online, while the loop is paused: the steps the loop would have run in `realDt`, at most its five a frame. */
  private idleSteps(realDt: number): void {
    this.idleOwed += (realDt > 0 ? realDt : 0) * STEPS_PER_SECOND;
    let n = 0;
    while (this.idleOwed >= 1 && n < 5 && !this.detached) {
      this.advance(true);
      this.idleOwed -= 1;
      n++;
    }
    if (this.idleOwed >= 1) this.idleOwed = 0;
  }

  /**
   * The end: the loser's base falls with the camera holding still, so the fall is seen; then the
   * camera swings round to the winner's base and the winners cheer for `CHEER_SECONDS` before the
   * result panel shows. A match decided inside `fastForward` (a test hook) makes no sound and
   * leaves the music alone.
   */
  private finish(withSound: boolean): void {
    const result = this.controller.hud.result.peek();
    if (this.ended || result === null) return;
    this.ended = true;
    if (this.controller.endless?.quit.peek() === true) {
      // A Free Play run ended from the pause menu: nothing fell; its result shows at once.
      this.current.setPreview(null);
      if (withSound) this.audio.stopMusic(0.8);
      this.ready.value = true;
      return;
    }
    this.endSounds = withSound;
    this.current.setPreview(null);
    if (withSound) {
      this.audio.stopMusic(0.8);
      this.audio.play('collapse');
    }
    void this.current.celebrate(result.winner).then(() => {
      if (this.disposed) return;
      this.fallen = true;
      if (result.winner !== 'draw') this.stage.rig.orbitVictory(result.winner, this.winnersX(result.winner));
      // Confetti over the winners while they cheer, and a little on behind the result panel.
      this.current.cheer(result.winner, CHEER_SECONDS + 1.5);
    });
  }

  /** Where the winners stand along the lawn (their mean x), or undefined when none is left. */
  private winnersX(side: Faction): number | undefined {
    const winners = this.controller.match.state.units.filter((u) => u.faction === side);
    if (winners.length === 0) return undefined;
    return winners.reduce((sum, u) => sum + u.x, 0) / winners.length;
  }

  private showResult(): void {
    const result = this.controller.hud.result.peek();
    if (result === null || this.disposed) return;
    if (this.endSounds && result.winner !== 'draw') this.audio.play(result.playerWon ? 'win' : 'lose');
    this.ready.value = true;
  }

  /**
   * The tile under a point. Zombies go by lane, so a tap a little off the lawn's right end (the
   * graveyard edge, their own base) still names the lane, at the last column.
   */
  private tileAt(nx: number, ny: number): Tile | null {
    const camera = this.stage.camera;
    camera.updateMatrixWorld();
    near.set(nx, ny, -1).unproject(camera);
    far.set(nx, ny, 1).unproject(camera);
    const fall = near.y - far.y;
    if (!(fall > 0) || !(near.y > 0)) return null;
    const t = near.y / fall;
    const x = near.x + (far.x - near.x) * t;
    const z = near.z + (far.z - near.z) * t;
    if (!(z >= 0 && z < LAWN_LANES)) return null;
    const lane = Math.floor(z);
    if (x >= 0 && x < LAWN_COLS) return { lane, col: Math.floor(x) };
    if (this.playerFaction === 'zombies' && x >= LAWN_COLS && x < LAWN_COLS + 2) return { lane, col: LAWN_COLS - 1 };
    return null;
  }

  private canvasRect(): { left: number; top: number; width: number; height: number } {
    const r = this.stage.canvas.getBoundingClientRect();
    const width = r.width > 0 ? r.width : window.innerWidth;
    const height = r.height > 0 ? r.height : window.innerHeight;
    return { left: r.left, top: r.top, width, height };
  }

  /** A view of this battle on the stage, its feel, tokens and hero banners wired to the session. */
  private makeView(): BattleView {
    const stage = this.stage;
    // The Bone Minion is no card, but a Necromancer or Grave Rise brings them: built ahead like the rest.
    const view = new BattleView(stage.scene, stage.camera, stage.lawn, stage.fx, this.controller.playerFaction, {
      units: modelsFor(this.controller.match.state),
      balance: this.controller.match.balance,
    });
    view.onFeel = (f) => this.clock.feel(f, stage.rig);
    view.onEnergyToken = (side, from, amount) => this.flyToken(side, from, amount);
    view.onHero = (side) => {
      this.heroBanner.value = { side, n: (this.heroBanner.peek()?.n ?? 0) + 1 };
    };
    return view;
  }

  private flyToken(side: Faction, from: Vector3, amount: number): void {
    if (!this.onToken || this.detached) return;
    const rect = this.canvasRect();
    const at = worldToClient(from, this.stage.camera, rect);
    this.onToken({ x: rect.left + at.x, y: rect.top + at.y }, side, amount);
  }
}
