/**
 * The game's sound: one Web Audio context, an effects bus and a music bus into a master gain,
 * a compressor and a limiter. Effects come from sfx.ts, music notes from music.ts, played with
 * the instruments in instruments.ts.
 *
 * Browsers (Safari on iPad most strictly) only let audio start inside a user gesture, so nothing
 * is created until `unlock()` is called from a pointer, touch or key event; until then every call
 * is a silent no-op. Nothing here throws at the game: a browser that refuses gets silence.
 *
 * Clean-up: every sound is a `Voice` that knows its nodes. Each source is given its stop time when
 * it starts; when the last one fires `ended` the voice disconnects everything it made. A sweep on
 * every play and every music tick disposes any voice more than half a second past its end, in
 * case a browser never fires `ended`, so a long match cannot pile up nodes.
 */
import { INSTRUMENT_PAN, playNote } from './instruments';
import { BAR_SECONDS, barNotes, easeIntensity, instrumentFor, topLayer } from './music';
import type { Layer, NoteEvent, Theme } from './music';
import { SFX } from './sfx';
import type { SfxName } from './sfx';
import { Voice, holdAt, makeNoise, rampTo } from './synth';

export type { SfxName } from './sfx';
export interface PlayOptions { pitch?: number; pan?: number; volume?: number }

/** The master level before the compressor: headroom for a crowd of effects on top of the music. */
const MASTER_LEVEL = 0.8;
/** The same effect plays at most once per this many seconds... */
const REPEAT_GAP = 0.04;
/** ...or per this many for these. */
const COOLDOWN: Partial<Record<SfxName, number>> = { baseHit: 0.25 };
const MAX_VOICES = 24;
/** Each play varies its pitch by up to ±6% unless a pitch is given, so repeats do not machine-gun. */
const PITCH_SPREAD = 0.06;
/** Effects start this far ahead of the clock, so their first samples are never in the past. */
const START_DELAY = 0.01;
const STEAL_FADE = 0.02;
const VOLUME_RAMP = 0.05;
const MUTE_RAMP = 0.03;
const SWEEP_GRACE = 0.5;
/** The music scheduler wakes this often; it looks ahead at least MIN_AHEAD and at most one bar. */
const TIMER_MS = 100;
const MIN_AHEAD = 0.25;
const FIRST_BAR_DELAY = 0.1;
const SWITCH_FADE = 0.6;
/** `unlock` stops waiting for `resume()` after this long; a later gesture tries again. */
const RESUME_TIMEOUT_MS = 300;
/**
 * A call that arrives this long after the pending attempt began is taken for a new tap (one tap's
 * pointerup, click and keyup all arrive within a few milliseconds) and asks the browser itself.
 */
const NEW_GESTURE_MS = 50;
/** Musical effects stay at their written pitch unless a pitch is given, so they are in tune. */
const IN_TUNE: ReadonlySet<SfxName> = new Set<SfxName>(['win', 'lose', 'suddenDeath']);

/** When the voices are all taken, a new effect may only push out one of equal or lower rank. */
const PRIORITY: Record<SfxName, number> = {
  place: 1, spawnZombie: 1, pea: 1, brainThrow: 1, hit: 1, chomp: 1, block: 1, sun: 1, bounty: 1, baseStrike: 1,
  explode: 2, merge: 2, baseHit: 2, click: 2, deny: 2,
  suddenDeath: 3, win: 3, lose: 3, collapse: 3,
  kernel: 1, butter: 1, mango: 1, sand: 1, arrow: 1, bullet: 1, trident: 1, rot: 1, stun: 1, blind: 1, lasso: 1,
  poison: 1, burn: 1, heal: 1, raise: 1, miss: 1, grow: 1, fuse: 1, mineArm: 1,
  mineBoom: 2, cherryBoom: 2, squash: 2, heroReady: 2, spellReady: 2, vines: 2, sunShower: 2, healingRain: 2,
  rockWall: 2, fog: 2, brainFeast: 2, frenzy: 2, graveRise: 2,
  megaMower: 3, boneStorm: 3, thunderbolt: 3, meteor: 3,
};

interface Graph { master: GainNode; sfx: GainNode; music: GainNode; noise: AudioBuffer }
interface SfxVoice { voice: Voice; priority: number; start: number }
interface Playback {
  theme: Theme;
  group: GainNode;
  nextBar: number;
  nextBarStart: number;
  queue: NoteEvent[];
  /** The highest layer playing in the last queued bar, for the gates' hysteresis. */
  top: Layer;
  voices: Set<Voice>;
  lastTick: number;
  timer: ReturnType<typeof setInterval>;
}

type ContextConstructor = new (options?: AudioContextOptions) => AudioContext;

/** The browser's AudioContext, under its standard name or Safari's older `webkitAudioContext`. */
function defaultContext(): AudioContext {
  const g = globalThis as { AudioContext?: ContextConstructor; webkitAudioContext?: ContextConstructor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (Ctor === undefined) throw new Error('web-audio-unavailable');
  return new Ctor({ latencyHint: 'interactive' });
}

/** Read through a function so TypeScript does not narrow the state across an `await`. */
function isRunning(ctx: BaseAudioContext): boolean {
  return ctx.state === 'running';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Slider position to gain: squared, so the slider feels even to the ear. */
function loudness(slider: number): number {
  return slider * slider;
}

/**
 * Lets audio play with the iPad's silent switch on (Safari 16.4+), as a game expects. Never throws.
 */
function preferPlaybackSession(): void {
  try {
    const session = (globalThis.navigator as { audioSession?: { type: string } } | undefined)?.audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch {
    // an older or locked-down browser: the silent switch then mutes us, nothing worse
  }
}

/** Resolves when `promise` settles or after `ms`, whichever is first; never rejects. */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

function report(err: unknown): void {
  if (import.meta.env?.DEV) console.error('[audio]', err);
}

export class AudioEngine {
  private readonly createContext: () => AudioContext;
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private ready = false;
  private readonly volumes: Record<'music' | 'sfx', number> = { music: 0.6, sfx: 0.8 };
  private muted = false;
  private readonly sfxVoices: SfxVoice[] = [];
  private readonly live = new Set<Voice>();
  private readonly lastPlayed = new Map<SfxName, number>();
  private playback: Playback | null = null;
  private wantedTheme: Theme | null = null;
  private intensity = { from: 0, to: 0, at: 0 };
  /** The unlock waiting on the browser, shared by every call made meanwhile. */
  private unlocking: Promise<void> | null = null;
  private unlockingSince = 0;
  private watchingVisibility = false;

  constructor(createContext: () => AudioContext = defaultContext) {
    this.createContext = createContext;
  }

  /** True once the browser has let audio run. */
  get unlocked(): boolean {
    return this.ready;
  }

  /** Effects currently sounding (at most 24). */
  get voiceCount(): number {
    return this.sfxVoices.length;
  }

  /**
   * True while sound cannot play until the next gesture: before the first unlock, and whenever the
   * browser has suspended or interrupted the context since (a call, Siri, another app, the iPad
   * locked). It follows the context's `statechange`.
   */
  get needsGesture(): boolean {
    return this.ctx === null || !this.ready || !isRunning(this.ctx);
  }

  /**
   * Call from every pointerup, touchend, click or keydown, for the whole life of the page: the
   * first one starts audio, and one after Safari has suspended or interrupted the audio resumes
   * it. While audio is running it returns at once. Calls made while one is still waiting on the
   * browser share that one (a single tap fires several of these events). Never throws; if the
   * browser refuses, audio stays off until the next try.
   */
  unlock(): Promise<void> {
    if (!this.needsGesture) return Promise.resolve();
    if (this.unlocking !== null) {
      // Safari only honours resume() made inside the gesture that calls it: a tap that comes
      // while an earlier attempt still waits must ask for itself, not rely on the old one.
      if (Date.now() - this.unlockingSince >= NEW_GESTURE_MS) this.resumeNow();
      return this.unlocking;
    }
    this.unlockingSince = Date.now();
    const attempt = this.tryUnlock().finally(() => {
      if (this.unlocking === attempt) this.unlocking = null;
    });
    this.unlocking = attempt;
    return attempt;
  }

  /** A fire-and-forget resume() inside the caller's gesture; the pending attempt sees the result. */
  private resumeNow(): void {
    const ctx = this.ctx;
    if (ctx === null || isRunning(ctx)) return;
    try {
      ctx.resume().catch(() => undefined);
    } catch {
      // refused outright: the pending attempt carries on
    }
  }

  /** Back on the page after Safari suspended the audio: try to resume (it may need a tap instead). */
  private watchVisibility(): void {
    if (this.watchingVisibility) return;
    const doc = (globalThis as { document?: Pick<Document, 'addEventListener' | 'visibilityState'> }).document;
    if (doc === undefined || typeof doc.addEventListener !== 'function') return;
    this.watchingVisibility = true;
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible' && this.ctx !== null && this.needsGesture) void this.unlock();
    });
  }

  private async tryUnlock(): Promise<void> {
    preferPlaybackSession();
    const ctx = this.ensureContext();
    if (ctx === null) return;
    if (!isRunning(ctx)) {
      this.primeInGesture(ctx);
      let resumed: Promise<void>;
      try {
        resumed = ctx.resume();
      } catch {
        return;
      }
      await settleWithin(resumed, RESUME_TIMEOUT_MS); // a refusal or a hang both just leave it locked
    }
    if (this.ctx !== ctx || !isRunning(ctx) || this.ready) return;
    this.ready = true;
    if (this.wantedTheme !== null) this.beginMusic(this.wantedTheme);
  }

  /** 0..1, applied with a short ramp. */
  setVolume(bus: 'music' | 'sfx', volume: number): void {
    if (!Number.isFinite(volume) || (bus !== 'music' && bus !== 'sfx')) return;
    this.volumes[bus] = clamp(volume, 0, 1);
    const ctx = this.ctx;
    const graph = this.graph;
    if (ctx === null || graph === null) return;
    rampTo((bus === 'music' ? graph.music : graph.sfx).gain, loudness(this.volumes[bus]), ctx.currentTime, VOLUME_RAMP);
  }

  /** Fades everything out (or back in) over 30 ms. While muted, no effects or notes are made. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = this.ctx;
    const graph = this.graph;
    if (ctx === null || graph === null) return;
    rampTo(graph.master.gain, muted ? 0 : MASTER_LEVEL, ctx.currentTime, MUTE_RAMP);
  }

  /**
   * Plays an effect. Does nothing until unlocked, while muted, or within its repeat limit. The
   * pitch varies by ±6% unless given; win, lose and suddenDeath default to their written pitch.
   */
  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    const graph = this.graph;
    const recipe = SFX[name];
    if (!this.ready || ctx === null || graph === null || this.muted || recipe === undefined || !isRunning(ctx)) return;
    const volume = opts.volume === undefined ? 1 : clamp(opts.volume, 0, 1);
    if (!(volume > 0)) return;
    const now = ctx.currentTime;
    this.sweep(now);
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < (COOLDOWN[name] ?? REPEAT_GAP)) return;
    const priority = PRIORITY[name];
    if (!this.makeRoom(priority, now)) return;
    const pitch = opts.pitch !== undefined && opts.pitch > 0 && Number.isFinite(opts.pitch)
      ? opts.pitch
      : IN_TUNE.has(name) ? 1 : 1 + (Math.random() * 2 - 1) * PITCH_SPREAD;
    const pan = opts.pan !== undefined && Number.isFinite(opts.pan) ? clamp(opts.pan, -1, 1) : 0;
    let voice: Voice | null = null;
    try {
      voice = new Voice(ctx, graph.sfx, graph.noise, { level: volume, pan });
      recipe(voice, now + START_DELAY, pitch);
    } catch (err) {
      voice?.dispose();
      report(err);
      return;
    }
    this.lastPlayed.set(name, now); // only once it really plays
    const entry: SfxVoice = { voice, priority, start: now };
    const v = voice;
    this.sfxVoices.push(entry);
    this.live.add(v);
    v.seal(() => {
      this.live.delete(v);
      const i = this.sfxVoices.indexOf(entry);
      if (i >= 0) this.sfxVoices.splice(i, 1);
    });
  }

  /**
   * Starts a theme from its first bar (the same theme already playing carries on; another one
   * crossfades). Asked before the unlock, it starts at the unlock. It starts straight at the
   * latest `setIntensity` target, even one given before the unlock or before this call.
   */
  startMusic(theme: 'menu' | 'backyard'): void {
    this.wantedTheme = theme;
    if (!this.ready || this.playback?.theme === theme) return;
    this.beginMusic(theme);
  }

  /** 0..1: how heated the battle is. The music follows it over 2 s; see music.ts for the layers. */
  setIntensity(v: number): void {
    if (!Number.isFinite(v)) return;
    const target = clamp(v, 0, 1);
    const ctx = this.ctx;
    if (ctx === null) {
      this.intensity = { from: target, to: target, at: 0 };
      return;
    }
    const now = ctx.currentTime;
    this.intensity = { from: this.intensityAt(now), to: target, at: now };
  }

  /** Fades the music out over `fadeSeconds` (default 1) and cancels every note scheduled after it. */
  stopMusic(fadeSeconds = 1): void {
    this.wantedTheme = null;
    const ctx = this.ctx;
    if (ctx === null || this.playback === null) return;
    try {
      this.endMusic(fadeSeconds, ctx.currentTime);
    } catch (err) {
      report(err);
    }
  }

  // -------------------------------------------------------------------------------------------

  private ensureContext(): AudioContext | null {
    if (this.ctx !== null && this.ctx.state === 'closed') this.forgetContext();
    if (this.ctx !== null) return this.ctx;
    let ctx: AudioContext;
    try {
      ctx = this.createContext();
    } catch {
      return null; // no Web Audio here: stay silent
    }
    try {
      this.graph = this.buildGraph(ctx);
    } catch (err) {
      report(err);
      void ctx.close?.().catch(() => undefined);
      return null;
    }
    this.ctx = ctx;
    this.watchState(ctx);
    this.watchVisibility();
    return ctx;
  }

  /**
   * Follows the context's state: when the browser suspends or interrupts it, sound stops until a
   * gesture resumes it (`needsGesture` turns true, and the page keeps offering every gesture to
   * `unlock`); when it is closed under us, everything on it is dropped so the next gesture starts
   * afresh.
   */
  private watchState(ctx: AudioContext): void {
    try {
      ctx.addEventListener('statechange', () => {
        if (this.ctx === ctx && ctx.state === 'closed') this.forgetContext();
      });
    } catch {
      // an old browser without the event: `needsGesture` still reads the state directly
    }
  }

  /** The context was closed under us: drop it and everything on it; the next unlock starts afresh. */
  private forgetContext(): void {
    const pb = this.playback;
    if (pb !== null) {
      clearInterval(pb.timer);
      this.playback = null;
      this.wantedTheme = pb.theme; // played again once a new context is unlocked
    }
    for (const v of this.live) v.dispose();
    this.live.clear();
    this.sfxVoices.length = 0;
    this.lastPlayed.clear();
    this.ctx = null;
    this.graph = null;
    this.ready = false;
  }

  private buildGraph(ctx: AudioContext): Graph {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    // initial levels, set while nothing can sound yet
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    const sfx = ctx.createGain();
    sfx.gain.value = loudness(this.volumes.sfx);
    const music = ctx.createGain();
    music.gain.value = loudness(this.volumes.music);
    sfx.connect(master);
    music.connect(master);
    master.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(ctx.destination);
    return { master, sfx, music, noise: makeNoise(ctx) };
  }

  /**
   * Starts a one-sample silent buffer while still inside the gesture. Older iPad Safari only
   * unlocks audio once something has played from a gesture; resume() alone is not always enough.
   */
  private primeInGesture(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.onended = () => {
        src.onended = null;
        src.disconnect();
      };
      const now = ctx.currentTime;
      src.start(now);
      src.stop(now + 0.001);
    } catch {
      // not needed where resume() works on its own
    }
  }

  private intensityAt(t: number): number {
    return easeIntensity(this.intensity.from, this.intensity.to, t - this.intensity.at);
  }

  /** Disposes voices long past their end whose `ended` never came. */
  private sweep(now: number): void {
    for (const v of this.live) {
      if (v.end + SWEEP_GRACE < now) v.dispose();
    }
  }

  /** Frees a voice slot if one is needed, by stealing the oldest of the lowest rank ≤ `priority`. */
  private makeRoom(priority: number, now: number): boolean {
    for (let i = this.sfxVoices.length - 1; i >= 0; i--) {
      if (this.sfxVoices[i]!.voice.end <= now) this.sfxVoices.splice(i, 1); // silent, ending any moment
    }
    if (this.sfxVoices.length < MAX_VOICES) return true;
    let victim: SfxVoice | null = null;
    for (const v of this.sfxVoices) {
      if (v.priority > priority) continue;
      if (victim === null || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
    }
    if (victim === null) return false;
    this.sfxVoices.splice(this.sfxVoices.indexOf(victim), 1);
    victim.voice.release(now, STEAL_FADE);
    return true;
  }

  private beginMusic(theme: Theme): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (ctx === null || graph === null) return;
    try {
      const now = ctx.currentTime;
      if (this.playback !== null) this.endMusic(SWITCH_FADE, now);
      this.intensity = { from: this.intensity.to, to: this.intensity.to, at: now };
      const group = ctx.createGain();
      group.gain.value = 0;
      group.gain.setValueAtTime(0, now);
      group.gain.linearRampToValueAtTime(1, now + FIRST_BAR_DELAY);
      group.connect(graph.music);
      const pb: Playback = {
        theme, group, nextBar: 0, nextBarStart: now + FIRST_BAR_DELAY, queue: [], top: 0, voices: new Set(), lastTick: now,
        timer: setInterval(() => this.tick(pb), TIMER_MS),
      };
      this.playback = pb;
      this.tick(pb);
    } catch (err) {
      report(err);
    }
  }

  /**
   * One wake-up of the scheduler. It looks ahead 2.5 × the time since the last wake-up (at least
   * 0.25 s, at most one bar), so a tab whose timers the browser slows to once a second keeps
   * playing. Bars are queued at most one bar ahead; a bar that is already over when a late timer
   * fires is skipped, and notes whose time has passed are dropped, never crammed in at "now".
   */
  private tick(pb: Playback): void {
    const ctx = this.ctx;
    if (this.playback !== pb || ctx === null || !isRunning(ctx)) return;
    try {
      const now = ctx.currentTime;
      this.sweep(now);
      const gap = now - pb.lastTick;
      pb.lastTick = now;
      const ahead = clamp(gap * 2.5, MIN_AHEAD, BAR_SECONDS);
      if (pb.nextBarStart + BAR_SECONDS <= now) {
        const skip = Math.floor((now - pb.nextBarStart) / BAR_SECONDS);
        pb.nextBar += skip;
        pb.nextBarStart += skip * BAR_SECONDS;
      }
      while (pb.nextBarStart < now + ahead) {
        const intensity = this.intensityAt(pb.nextBarStart);
        pb.top = topLayer(pb.theme, intensity, pb.top);
        pb.queue.push(...barNotes(pb.theme, pb.nextBar, pb.nextBarStart, intensity, pb.top));
        pb.nextBar += 1;
        pb.nextBarStart += BAR_SECONDS;
      }
      let used = 0;
      for (const note of pb.queue) {
        if (note.time >= now + ahead) break;
        used += 1;
        if (note.time < now || this.muted) continue;
        this.playMusicNote(pb, note);
      }
      pb.queue.splice(0, used);
    } catch (err) {
      report(err);
    }
  }

  private playMusicNote(pb: Playback, note: NoteEvent): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (ctx === null || graph === null) return;
    const inst = instrumentFor(note);
    const v = new Voice(ctx, pb.group, graph.noise, { pan: INSTRUMENT_PAN[inst] });
    try {
      playNote(v, inst, note.midi, note.time, note.length, note.velocity);
    } catch (err) {
      v.dispose();
      report(err);
      return;
    }
    pb.voices.add(v);
    this.live.add(v);
    v.seal(() => {
      pb.voices.delete(v);
      this.live.delete(v);
    });
  }

  private endMusic(fadeSeconds: number, now: number): void {
    const pb = this.playback;
    if (pb === null) return;
    this.playback = null;
    clearInterval(pb.timer);
    pb.queue.length = 0;
    const fade = Number.isFinite(fadeSeconds) ? Math.max(0.02, fadeSeconds) : 1;
    holdAt(pb.group.gain, now);
    pb.group.gain.linearRampToValueAtTime(0, now + fade);
    for (const v of pb.voices) v.stopBy(now + fade);
    const group = pb.group;
    setTimeout(() => {
      try {
        group.disconnect();
      } catch {
        // already gone
      }
    }, (fade + 0.2) * 1000);
  }
}
