/** What the loop drives: the simulation in fixed steps, the picture once per animation frame. */
export interface LoopHost {
  /** Advance the simulation by one fixed step (1/30 s of game time). */
  step(): void;
  /**
   * Draw. `alpha` in [0, 1) is how far the picture is between the last two steps.
   *
   * `realDt` is the seconds since the previous frame (a long gap counts as 0.25): use it
   * for the camera and anything else that keeps moving through a hit-stop or a pause.
   * `gameDt` is `realDt × timeScale`, and 0 while paused: use it for animations, particles
   * and whatever else belongs to the world.
   */
  frame(alpha: number, realDt: number, gameDt: number): void;
}

export const STEPS_PER_SECOND = 30;
/** A longer gap (hidden tab, sleeping laptop, a breakpoint) is treated as this long. */
const MAX_GAP_MS = 250;
/** The most steps one frame may run; whatever game time is still owed after that is dropped. */
const MAX_STEPS_PER_FRAME = 5;
/**
 * Sped up (`timeScale` above 1: the 2X button), the steps of one frame beyond what 1x would run
 * stop once they have taken this long and the game time still owed is dropped: a device that cannot run double speed plays
 * as fast as it can rather than falling behind and stalling. Normal speed is never cut by it.
 */
export const FAST_STEP_BUDGET_MS = 20;

export interface GameLoopOptions {
  /** The real-time clock the step budget is measured with (default `performance.now`). */
  now?: () => number;
}

/** Fixed-step loop with interpolation: 30 simulation steps per second at any frame rate. */
export class GameLoop {
  /** While true no steps run; frames still draw, with alpha 0. */
  paused = false;
  /** Game time per real time: 1 normal, below 1 slow motion, 0 a hit-stop. */
  timeScale = 1;

  private readonly host: LoopHost;
  /** Game time owed to the simulation, in steps. Always in [0, 1) between frames. */
  private owed = 0;
  private lastMs: number | null = null;
  private rafId: number | null = null;
  private readonly now: () => number;

  constructor(host: LoopHost, opts: GameLoopOptions = {}) {
    this.host = host;
    this.now = opts.now ?? (() => performance.now());
  }

  /** Starts calling `advance` on every animation frame. */
  start(): void {
    if (this.rafId !== null) return;
    this.lastMs = null;
    const tick = (nowMs: number): void => {
      this.rafId = requestAnimationFrame(tick);
      this.advance(nowMs);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** One animation frame at time `nowMs`. The first call only sets the clock. */
  advance(nowMs: number): void {
    const elapsed = this.lastMs === null ? 0 : nowMs - this.lastMs;
    this.lastMs = nowMs;
    // NaN or a clock running backwards counts as no time at all.
    const gapMs = elapsed > 0 ? Math.min(elapsed, MAX_GAP_MS) : 0;

    const realDt = gapMs / 1000;

    if (this.paused) {
      this.owed = 0;
      this.host.frame(0, realDt, 0);
      return;
    }

    // A scale that is negative or not a number at all stops game time rather than breaking it.
    const scale = Number.isFinite(this.timeScale) && this.timeScale > 0 ? this.timeScale : 0;
    // Counting in steps rather than milliseconds keeps 100 ms at exactly 3 steps.
    this.owed += (gapMs * scale * STEPS_PER_SECOND) / 1000;

    let steps = 0;
    const budgeted = scale > 1;
    const startMs = budgeted ? this.now() : 0;
    // The budget only cuts the steps beyond what normal speed would run this frame: sped up is never
    // slower than 1x. Rounded up, since 1x may run one more than the frame's own time when it carries some over.
    const base = Math.ceil((gapMs * STEPS_PER_SECOND) / 1000);
    while (this.owed >= 1 && steps < MAX_STEPS_PER_FRAME) {
      if (budgeted && steps > 0 && steps >= base && this.now() - startMs >= FAST_STEP_BUDGET_MS) break;
      this.host.step();
      this.owed -= 1;
      steps++;
    }
    if (this.owed >= 1) this.owed = 0;

    this.host.frame(this.owed, realDt, realDt * scale);
  }
}
