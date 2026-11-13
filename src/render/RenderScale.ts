const SCALE_MIN_TENTHS = 6;
const SCALE_MAX_TENTHS = 10;
/** The scale goes down when the last `LOWER_WINDOW` frames average over this. */
const SLOW_MEAN_MS = 18;
const LOWER_WINDOW = 30;
/** The scale goes up when the last `RAISE_WINDOW` frames average under this … */
const FAST_MEAN_MS = 14;
/** … or at most this, once patience allows (see the class comment). */
const ON_TIME_MEAN_MS = 17.5;
const RAISE_WINDOW = 300;
/** A gap this long is a hidden tab or a breakpoint, not a slow frame. */
const STALL_MS = 250;
/** No single frame counts for more than this (three 60 Hz refreshes) in the averages. */
const HITCH_CAP_MS = 50;
/** Frames ignored after the scale changes, while the browser rebuilds its buffers. */
const SETTLE_FRAMES = 10;
const MAX_PATIENCE = 16;
const RETRY_FAILED_WITHIN_FRAMES = 300;
const RETRY_PROVEN_AFTER_FRAMES = 1800;

/**
 * Chooses the render scale from frame times, in steps of 0.1 between 0.6 and 1.
 *
 * - Down when the last 30 frames average over 18 ms. An average, not a run of slow frames:
 *   at 45 or 50 fps on a 60 Hz display most frames are on time and only every third or
 *   fifth takes two refreshes, so no run of slow frames ever forms.
 * - Up when the last 300 frames average under 14 ms.
 * - A 60 Hz display never shows a frame under 14 ms, so by that rule alone the scale could
 *   only ever go down. Frames that merely arrive on time (averaging 17.5 ms or less) also
 *   let it go up, after 300 frames times a patience factor. Patience doubles, to at most
 *   16, whenever going up had to be undone straight away, so a machine that cannot hold
 *   full resolution is not made to stutter by retries.
 *
 * One frame counts for at most 50 ms, so a single hitch cannot lower the scale by itself,
 * and both windows start afresh after every change.
 */
export class RenderScale {
  /** Current scale, 0.6 to 1. */
  value = 1;
  /** Smoothed frames per second. */
  fps = 60;

  private tenths = SCALE_MAX_TENTHS;
  private smoothedMs = 1000 / 60;
  /** The last `RAISE_WINDOW` frame times, as a ring. */
  private readonly times = new Float64Array(RAISE_WINDOW);
  /** Frames recorded since the windows last started afresh. */
  private recorded = 0;
  private ignore = 0;
  private patience = 1;
  private sinceRaise = Infinity;

  /** Set while the scale is held (see `pin`). */
  private pinned = false;

  /**
   * Holds the scale at `value` (rounded to tenths, 0.6 to 1) whatever the frame times say, for
   * measuring at a known resolution; null lets it adapt again from there.
   */
  pin(value: number | null): void {
    if (value === null) {
      this.pinned = false;
      this.settle(SETTLE_FRAMES);
      return;
    }
    this.pinned = true;
    this.tenths = Math.min(SCALE_MAX_TENTHS, Math.max(SCALE_MIN_TENTHS, Math.round(value * 10)));
    this.value = this.tenths / 10;
  }

  /** Whether the scale is held (see `pin`). */
  get held(): boolean {
    return this.pinned;
  }

  /** Ignore the next `frames` samples (after a resize or a change of quality) and start the windows afresh. */
  settle(frames: number): void {
    this.ignore = Math.max(this.ignore, frames);
    this.recorded = 0;
  }

  /** Feed the time between two frames. Returns true when `value` changed. */
  sample(frameMs: number): boolean {
    if (!(frameMs > 0) || this.pinned) return false;
    if (frameMs > STALL_MS) {
      this.recorded = 0;
      return false;
    }
    this.smoothedMs += (frameMs - this.smoothedMs) * 0.1;
    this.fps = 1000 / this.smoothedMs;
    if (this.ignore > 0) {
      this.ignore--;
      return false;
    }

    this.times[this.recorded % RAISE_WINDOW] = Math.min(frameMs, HITCH_CAP_MS);
    this.recorded++;
    this.sinceRaise++;

    if (this.recorded >= LOWER_WINDOW && this.mean(LOWER_WINDOW) > SLOW_MEAN_MS) {
      if (this.tenths === SCALE_MIN_TENTHS) return false;
      if (this.sinceRaise <= RETRY_FAILED_WITHIN_FRAMES) this.patience = Math.min(this.patience * 2, MAX_PATIENCE);
      else if (this.sinceRaise >= RETRY_PROVEN_AFTER_FRAMES) this.patience = 1;
      return this.move(-1);
    }

    if (this.recorded >= RAISE_WINDOW && this.tenths < SCALE_MAX_TENTHS) {
      const mean = this.mean(RAISE_WINDOW);
      const patient = this.recorded >= RAISE_WINDOW * this.patience;
      if (mean < FAST_MEAN_MS || (patient && mean <= ON_TIME_MEAN_MS)) {
        this.sinceRaise = 0;
        return this.move(1);
      }
    }
    return false;
  }

  /** Mean of the last `count` recorded frame times; `count` must not exceed what is recorded. */
  private mean(count: number): number {
    let sum = 0;
    for (let i = 1; i <= count; i++) sum += this.times[(this.recorded - i) % RAISE_WINDOW] as number;
    return sum / count;
  }

  private move(direction: 1 | -1): boolean {
    this.tenths += direction;
    this.value = this.tenths / 10;
    this.settle(SETTLE_FRAMES);
    return true;
  }
}
