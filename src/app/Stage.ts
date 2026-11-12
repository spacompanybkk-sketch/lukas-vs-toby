import type { PerspectiveCamera, Scene } from 'three';
import { GameLoop } from '../game/GameLoop';
import type { CameraRig } from '../render/CameraRig';
import { Effects } from '../render/fx/Effects';
import { Particles } from '../render/fx/Particles';
import { Renderer, type Quality } from '../render/Renderer';
import type { Feel } from '../render/battle/types';
import { disposeModels } from '../render/voxel/build';
import { seededRandom } from '../render/world/boxes';
import { Lawn } from '../render/world/Lawn';
import { Sky } from '../render/world/Sky';

/**
 * Whatever is playing on the stage: the title's demo battle, or the player's battle. The stage's
 * loop calls `step` 30 times a second of game time and `frame` once per animation frame.
 */
export interface Director {
  step(): void;
  /** Before the stage moves the effects, lawn and sky on and draws. */
  frame(alpha: number, realDt: number, gameDt: number): void;
  /** The stage has handed over to another director (or is going away): take everything out of the scene. */
  detach(): void;
}

/** What a director needs from the stage. The real `Stage` draws with WebGL; tests pass a fake. */
export interface StageLike {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly rig: CameraRig;
  readonly lawn: Lawn;
  readonly fx: Effects;
  readonly particles: Particles;
  /** The canvas the scene is drawn on, for turning client coordinates into rays. */
  readonly canvas: HTMLCanvasElement;
  /** The loop's own switches: no steps while paused; game time per real time. */
  paused: boolean;
  timeScale: number;
  readonly director: Director | null;
  /** Hands the stage to `director`; the one before is detached. */
  show(director: Director | null): void;
  /** Detaches `director` if it is the one on stage; does nothing otherwise. */
  release(director: Director): void;
}

/**
 * Hit-stop and slow motion for a director: `feel` takes the view's requests, `tick` counts them
 * down in real time and gives the loop's time scale (0 in a hit-stop, a third in slow motion).
 */
export class FeelClock {
  private hitStop = 0;
  private slowMo = 0;

  feel(f: Feel, rig: Pick<CameraRig, 'shake' | 'punch'>): void {
    if (f.shake) rig.shake(f.shake, 0.35);
    if (f.punch) rig.punch(f.punch, f.punchSeconds ?? 0.25, f.focusZ);
    if (f.hitStop) this.hitStop = Math.max(this.hitStop, f.hitStop);
    if (f.slowMo) this.slowMo = Math.max(this.slowMo, f.slowMo);
  }

  tick(realDt: number): number {
    const dt = realDt > 0 ? realDt : 0;
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - dt);
    else if (this.slowMo > 0) this.slowMo = Math.max(0, this.slowMo - dt);
    return this.hitStop > 0 ? 0 : this.slowMo > 0 ? 0.33 : 1;
  }

  reset(): void {
    this.hitStop = 0;
    this.slowMo = 0;
  }
}

/**
 * The one renderer (so the one WebGL context) of the app, with the lawn, the sky, the effects and
 * the loop. It lives for the whole page; the title's demo battle and each real battle take turns
 * on it as its director, so going from the title to a battle and back builds nothing twice.
 */
export class Stage implements StageLike {
  readonly renderer: Renderer;
  readonly lawn = new Lawn();
  readonly sky = new Sky();
  readonly particles = new Particles();
  readonly fx = new Effects(this.particles, seededRandom(2026));
  readonly canvas: HTMLCanvasElement;
  /** Frames drawn so far (for tools waiting on the first picture). */
  frames = 0;
  /** Called once after the first few frames have been drawn. */
  onFirstFrames?: () => void;

  private readonly loop: GameLoop;
  private current: Director | null = null;
  private time = 0;
  private disposed = false;

  /** Throws `Error('webgl2-unavailable')` when the browser cannot draw. */
  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, quality);
    this.renderer.scene.add(this.sky.group, this.lawn.group, this.particles.object, this.fx.group);
    this.loop = new GameLoop({
      step: () => this.current?.step(),
      frame: (alpha, realDt, gameDt) => this.draw(alpha, realDt, gameDt),
    });
    window.addEventListener('resize', this.onResize);
    this.loop.start();
  }

  get scene(): Scene {
    return this.renderer.scene;
  }

  get camera(): PerspectiveCamera {
    return this.renderer.camera;
  }

  get rig(): CameraRig {
    return this.renderer.rig;
  }

  get director(): Director | null {
    return this.current;
  }

  get paused(): boolean {
    return this.loop.paused;
  }

  set paused(v: boolean) {
    this.loop.paused = v;
  }

  get timeScale(): number {
    return this.loop.timeScale;
  }

  set timeScale(v: number) {
    this.loop.timeScale = v;
  }

  show(director: Director | null): void {
    if (director === this.current) return;
    const old = this.current;
    this.current = null;
    if (old) this.handOver(old);
    this.current = director;
  }

  release(director: Director): void {
    if (this.current !== director) return;
    this.current = null;
    this.handOver(director);
  }

  setQuality(q: Quality): void {
    this.renderer.setQuality(q);
  }

  /** Stops the loop and frees everything; the director on stage is detached first. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.show(null);
    this.loop.stop();
    window.removeEventListener('resize', this.onResize);
    this.renderer.scene.remove(this.particles.object, this.fx.group, this.sky.group, this.lawn.group);
    this.particles.dispose();
    this.fx.dispose();
    disposeModels();
    this.lawn.dispose();
    this.sky.dispose();
    this.renderer.dispose();
  }

  /** What every director leaves behind is cleared, so the next one starts on a clean lawn. */
  private handOver(old: Director): void {
    old.detach();
    this.fx.clear();
    this.particles.clear();
    this.loop.paused = false;
    this.loop.timeScale = 1;
    this.rig.reset();
    this.lawn.highlightTile(0, 0, null);
    this.lawn.highlightLane(null, 'ok');
  }

  private draw(alpha: number, realDt: number, gameDt: number): void {
    this.time += gameDt;
    this.current?.frame(alpha, realDt, gameDt);
    this.fx.update(gameDt, this.renderer.camera);
    this.lawn.update(this.time);
    this.sky.update(this.time);
    this.renderer.render(realDt);
    this.frames++;
    if (this.frames === 6) this.onFirstFrames?.();
  }

  private readonly onResize = (): void => this.renderer.resize();
}
