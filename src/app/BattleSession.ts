import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { Vector3 } from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import { battleIntensity, playEventSounds } from '../audio/bindings';
import { BattleView } from '../render/battle/BattleView';
import type { PlacementPreview } from '../render/battle/types';
import { LAWN_COLS, LAWN_LANES, tileCenter, worldToClient } from '../render/coords';
import type { CommandRejection, Faction, SimEvent } from '../sim/types';
import { BattleController } from './BattleController';
import type { BattleOptions } from './BattleController';
import { BattleInput } from './input';
import type { InputTarget, Picked, Tile } from './input';
import { FeelClock } from './Stage';
import type { Director, StageLike } from './Stage';

/** Seconds of the opening camera move, before the READY and FIGHT! banners. */
export const INTRO_SECONDS = 1.8;

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
  readonly view: BattleView;
  /** True once the end of the match has played out and the result panel may show. */
  readonly resultReady: ReadonlySignal<boolean>;
  /** Resolves when the opening camera move has landed (the banners wait for it). */
  intro: Promise<void> = Promise.resolve();
  /** True when the battle was begun at once (a test scene): the HUD shows no banners. */
  skipIntro = false;

  private readonly stage: StageLike;
  private readonly audio: AudioEngine;
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
  private readonly offEffects: (() => void)[] = [];

  constructor(stage: StageLike, audio: AudioEngine, opts: BattleOptions, options: BattleSessionOptions = {}) {
    this.stage = stage;
    this.audio = audio;
    this.introSeconds = options.introSeconds ?? INTRO_SECONDS;
    this.onToken = options.onToken;
    this.resultReady = this.ready;
    this.controller = new BattleController(opts);
    const cards = this.controller.match.state.config.cards;
    stage.show(this);
    this.view = new BattleView(stage.scene, stage.camera, stage.lawn, stage.fx, opts.playerFaction, {
      units: [...cards.plants, ...cards.zombies],
    });
    this.view.onFeel = (f) => this.clock.feel(f, stage.rig);
    this.view.onEnergyToken = (side, from, amount) => this.flyToken(side, from, amount);
    this.input = new BattleInput(this, { canvas: stage.canvas, ...options.input });
    // A new card (or none) changes what the ghost should show where the pointer already is.
    const hud = this.controller.hud;
    this.offEffects.push(hud.selected.subscribe(() => this.input.refresh()));
    this.offEffects.push(hud.shovel.subscribe(() => this.input.refresh()));
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
    this.audio.startMusic('backyard');
  }

  // ---- Director ------------------------------------------------------------------------------

  step(): void {
    if (!this.begun || this.detached) return;
    this.advance(true);
  }

  frame(alpha: number, realDt: number, gameDt: number): void {
    if (this.detached) return;
    const state = this.controller.match.state;
    this.stage.paused = this.controller.hud.paused.peek();
    this.stage.timeScale = this.clock.tick(realDt);
    this.time += gameDt;
    this.view.frame(state, alpha, gameDt, this.time);
    if (!this.ended) this.audio.setIntensity(battleIntensity(state));
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.input.dispose();
    this.view.dispose();
  }

  /** Takes the battle off the stage and stops its music; the stage stays for the next one. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offEffects) off();
    this.offEffects.length = 0;
    this.stage.release(this);
    this.detach();
    this.audio.stopMusic(0.4);
  }

  // ---- Test hooks ----------------------------------------------------------------------------

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

  // ---- InputTarget ---------------------------------------------------------------------------

  isLive(): boolean {
    return this.live;
  }

  pick(clientX: number, clientY: number): Picked {
    const rect = this.canvasRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const unitId = this.view.unitAtRay(nx, ny, rect);
    return { tile: this.tileAt(nx, ny), unitId };
  }

  hover(tile: Tile | null, unitId: number | null): PlacementPreview | null {
    return this.controller.hover(tile, unitId);
  }

  click(tile: Tile | null, unitId: number | null): CommandRejection | 'ignored' | null {
    return this.controller.click(tile, unitId);
  }

  setPreview(p: PlacementPreview | null): void {
    if (!this.detached) this.view.setPreview(p);
  }

  clearSelection(): void {
    this.controller.hotkey('Escape');
  }

  hotkey(key: string): void {
    this.controller.hotkey(key);
  }

  denied(): void {
    this.audio.play('deny');
  }

  // ---- Inside --------------------------------------------------------------------------------

  private advance(withSound: boolean): void {
    if (this.ended || this.controller.hud.paused.peek()) return;
    const events: SimEvent[] = this.controller.step();
    this.view.applyEvents(events, this.controller.match.state);
    if (withSound) playEventSounds(this.audio, events, this.playerFaction);
    if (this.controller.hud.result.peek() !== null) this.finish();
    else if (withSound) this.input.refresh(); // energy or the lawn changed: the ghost may turn red or green
  }

  /** The loser's base falls and the camera swings to the winner; then the result may show. */
  private finish(): void {
    const result = this.controller.hud.result.peek();
    if (this.ended || result === null) return;
    this.ended = true;
    this.view.setPreview(null);
    this.audio.stopMusic(0.8);
    this.audio.play('collapse');
    // The camera holds still while the loser's base falls, so the fall is seen; then it swings
    // round to the winner's base behind the result panel.
    void this.view.celebrate(result.winner).then(() => {
      if (this.disposed) return;
      if (result.winner !== 'draw') {
        this.stage.rig.orbitVictory(result.winner);
        this.audio.play(result.playerWon ? 'win' : 'lose');
      }
      this.ready.value = true;
    });
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

  private flyToken(side: Faction, from: Vector3, amount: number): void {
    if (!this.onToken || this.detached) return;
    const rect = this.canvasRect();
    const at = worldToClient(from, this.stage.camera, rect);
    this.onToken({ x: rect.left + at.x, y: rect.top + at.y }, side, amount);
  }
}
