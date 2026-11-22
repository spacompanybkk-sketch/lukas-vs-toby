import { computed, signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { GloveVM, TwistVM } from './tutorial';

/**
 * The battle's 2X button (the owner: "we probably need '2X' button to speed gameplay if it is too
 * boring"). Speed belongs to the driver, never to the simulation: 2X runs the stage's fixed-step
 * loop at twice the game time per real time (its `timeScale`, the same switch slow motion and
 * hit-stops use), so the match takes exactly the same ticks, with the same tick length, and ends
 * on the same state and result. Stars, clocks and times are counted in ticks, so they do not change.
 *
 * The choice is a per-device convenience: kept in `localStorage` (default off) and in memory for
 * this visit when storage is blocked. It is never put in the cloud player record.
 */

/** Game time per real time with the button lit. */
export const FAST = 2;

export type Speed = 1 | typeof FAST;

export const SPEED_KEY = 'lvt2_speed';

/** The choice made on this visit (null: none yet), so a blocked storage still carries it to the next battle. */
let remembered: Speed | null = null;

/** `localStorage`, or undefined where there is none or touching it throws (Safari private mode, node). */
function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The speed chosen on this device: this visit's choice, else the stored one, else 1. */
export function loadSpeed(storage: Storage | undefined = defaultStorage()): Speed {
  if (remembered !== null) return remembered;
  try {
    return storage?.getItem(SPEED_KEY) === String(FAST) ? FAST : 1;
  } catch {
    return 1;
  }
}

/** Remembers the speed for this visit and, where storage works, for the next ones. */
export function saveSpeed(speed: Speed, storage: Storage | undefined = defaultStorage()): void {
  remembered = speed;
  try {
    storage?.setItem(SPEED_KEY, String(speed));
  } catch {
    // Blocked or full: the choice lasts this visit only.
  }
}

/** Forgets this visit's choice (tests). */
export function forgetSpeed(): void {
  remembered = null;
}

/** What a lesson shows: the tutorial's glove and twist pan. */
export interface LessonSignals {
  glove: ReadonlySignal<GloveVM | null>;
  twist: ReadonlySignal<TwistVM | null>;
}

/**
 * True while a lesson step waits for the player: the glove points at something (a step is armed,
 * the match held) or a twist pan plays. Between steps, and after the last, it is false.
 */
export function lessonShowing(tutorial: LessonSignals | null): ReadonlySignal<boolean> {
  if (tutorial === null) return signal(false);
  return computed(() => tutorial.glove.value !== null || tutorial.twist.value !== null);
}

export interface BattleSpeedOptions {
  /** False for a battle that must not offer it (a two-player Versus): never shown, always 1x. */
  offered: boolean;
  /** True while a lesson waits for the player: the button hides and the speed is 1x. */
  lesson?: ReadonlySignal<boolean>;
  /** Where the choice is kept (default `localStorage`). */
  storage?: Storage;
}

/** One battle's speed: the player's choice (remembered on the device) and when it may apply. */
export class BattleSpeed {
  readonly offered: boolean;
  /** The button is lit: the player chose 2X (it stays chosen through lessons, pauses and the boss's entrance). */
  readonly fast: ReadonlySignal<boolean>;
  /** The button is there: offered and no lesson waiting. */
  readonly shown: ReadonlySignal<boolean>;
  /** Offered but a lesson waits: the button stays on screen, greyed, so it does not come and go between steps. */
  readonly held: ReadonlySignal<boolean>;

  private readonly chosen: ReturnType<typeof signal<Speed>>;
  private readonly storage: Storage | undefined;

  constructor(opts: BattleSpeedOptions) {
    this.offered = opts.offered;
    this.storage = 'storage' in opts ? opts.storage : defaultStorage();
    this.chosen = signal<Speed>(loadSpeed(this.storage));
    const lesson = opts.lesson ?? signal(false);
    this.fast = computed(() => this.chosen.value === FAST);
    this.shown = computed(() => this.offered && !lesson.value);
    this.held = computed(() => this.offered && lesson.value);
  }

  /** The button: 1x ↔ 2x, remembered on the device. Does nothing while the button is not shown. */
  toggle(): void {
    if (!this.shown.peek()) return;
    const next: Speed = this.chosen.peek() === FAST ? 1 : FAST;
    this.chosen.value = next;
    saveSpeed(next, this.storage);
  }

  /** Game time per real time from the button: `FAST` while chosen and shown, else 1. */
  factor(): number {
    return this.shown.peek() && this.chosen.peek() === FAST ? FAST : 1;
  }
}
