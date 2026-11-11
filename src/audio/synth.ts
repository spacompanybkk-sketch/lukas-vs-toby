/**
 * Building blocks shared by the effects (sfx.ts) and the music instruments (instruments.ts).
 *
 * Rules every sound here keeps, so nothing clicks:
 * - every gain envelope starts at 0, rises with a ramp, fades exponentially to 60 dB below its
 *   peak and then ramps the last tiny step to 0; no gain ever jumps while sound passes through it;
 * - every source is given its stop time when it starts, a little after its envelope reaches 0.
 */

/** −60 dB under the peak: where an exponential fade ends before the last short linear step. */
const FLOOR = 0.001;
/** That last linear step to exactly 0. */
export const TAIL = 0.005;

/**
 * One sound: every node it creates, so they can all be disconnected when it ends. The recipe
 * connects its sound into `input`; the voice carries it through its level (and pan) onwards.
 *
 * It cleans up after itself: once `seal` has been called and every source has fired `ended`,
 * every node is disconnected and `onDone` runs. `dispose` does the same at once, for the owner's
 * sweep in case a browser never fires `ended`.
 */
export class Voice {
  readonly ctx: BaseAudioContext;
  readonly input: GainNode;
  readonly noise: AudioBuffer;
  /** When the last source stops, in audio time. */
  end = 0;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: Array<{ node: AudioScheduledSourceNode; stop: number }> = [];
  private running = 0;
  private sealed = false;
  private disposed = false;
  private onDone: (() => void) | null = null;

  constructor(ctx: BaseAudioContext, destination: AudioNode, noise: AudioBuffer, opts: { level?: number; pan?: number } = {}) {
    this.ctx = ctx;
    this.noise = noise;
    this.input = this.add(ctx.createGain());
    this.input.gain.value = opts.level ?? 1; // set before anything sounds through it
    let out: AudioNode = this.input;
    const pan = opts.pan ?? 0;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = this.add(ctx.createStereoPanner());
      panner.pan.value = pan;
      out.connect(panner);
      out = panner;
    }
    out.connect(destination);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /** Registers a source and starts it; it stops at `stop`. */
  play<T extends AudioScheduledSourceNode>(node: T, start: number, stop: number, offset?: number): T {
    this.add(node);
    this.sources.push({ node, stop });
    this.running += 1;
    node.onended = () => {
      this.running -= 1;
      if (this.running <= 0 && this.sealed) this.dispose();
    };
    if (offset === undefined) node.start(start);
    else (node as unknown as AudioBufferSourceNode).start(start, offset);
    node.stop(stop);
    this.end = Math.max(this.end, stop);
    return node;
  }

  /** Call once everything has been added; `onDone` runs when the voice has cleaned up. */
  seal(onDone: () => void): void {
    this.sealed = true;
    this.onDone = onDone;
    if (this.running <= 0) this.dispose();
  }

  /** Makes every source stop by `time` (sources due to start later never sound). */
  stopBy(time: number): void {
    for (const s of this.sources) {
      if (s.stop <= time) continue;
      try {
        s.node.stop(time);
        s.stop = time;
      } catch {
        // an older Safari refuses a second stop(); the source then ends at its own time
      }
    }
    this.end = Math.min(this.end, Math.max(time, 0));
  }

  /** Fades the whole voice out over `fade` seconds from `at`, then stops it. */
  release(at: number, fade: number): void {
    if (this.disposed) return;
    holdAt(this.input.gain, at);
    this.input.gain.linearRampToValueAtTime(0, at + fade);
    this.stopBy(at + fade + TAIL);
  }

  /** Disconnects every node now. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.sources) s.node.onended = null;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }
}

/** Freezes a parameter at its current value from `time` on, so a ramp can start from there. */
export function holdAt(param: AudioParam, time: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time);
    return;
  }
  const value = param.value;
  param.cancelScheduledValues(time);
  param.setValueAtTime(value, time);
}

/** Ramps a parameter from wherever it is now to `value` over `seconds`. */
export function rampTo(param: AudioParam, value: number, now: number, seconds: number): void {
  holdAt(param, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

/** One second of white noise, made once per context and shared by every voice. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function filter(v: Voice, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const f = v.add(v.ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

/** A fixed mixing level: set once, before anything sounds through it. */
export function level(v: Voice, value: number): GainNode {
  const g = v.add(v.ctx.createGain());
  g.gain.value = value;
  return g;
}

/** An exponential slide of a frequency from `from` to `to` over `seconds`. */
export function glide(param: AudioParam, from: number, to: number, at: number, seconds: number): void {
  param.setValueAtTime(from, at);
  param.exponentialRampToValueAtTime(to, at + Math.max(0.001, seconds));
}

/**
 * A percussive or swelling envelope: 0, a ramp up to `peak` over `attack`, held for `hold`, then
 * an exponential fade over `decay`. Returns the node and the time it reaches 0.
 */
export function envelope(v: Voice, at: number, attack: number, peak: number, hold: number, decay: number): { gain: GainNode; end: number } {
  const g = v.add(v.ctx.createGain());
  const p = g.gain;
  const top = Math.max(peak, 1e-4);
  p.value = 0;
  p.setValueAtTime(0, at);
  p.linearRampToValueAtTime(top, at + attack);
  if (hold > 0) p.setValueAtTime(top, at + attack + hold);
  const faded = at + attack + hold + Math.max(0.005, decay);
  p.exponentialRampToValueAtTime(top * FLOOR, faded);
  p.linearRampToValueAtTime(0, faded + TAIL);
  return { gain: g, end: faded + TAIL };
}

export interface Adsr { attack: number; decay: number; sustain: number; release: number; peak: number }

/**
 * A held note's envelope: up to `peak`, down to `peak × sustain`, held until `at + length`, then
 * released. A note shorter than its attack and decay shortens them. Returns the node and its end.
 */
export function adsr(v: Voice, at: number, length: number, e: Adsr): { gain: GainNode; end: number } {
  const g = v.add(v.ctx.createGain());
  const p = g.gain;
  const len = Math.max(0.02, length);
  const peak = Math.max(e.peak, 1e-4);
  const attack = Math.min(e.attack, len * 0.5);
  const sustain = peak * Math.max(e.sustain, FLOOR);
  const decayEnd = at + attack + Math.max(0.005, Math.min(e.decay, len - attack));
  p.value = 0;
  p.setValueAtTime(0, at);
  p.linearRampToValueAtTime(peak, at + attack);
  p.exponentialRampToValueAtTime(sustain, decayEnd);
  const releaseAt = Math.max(decayEnd, at + len);
  if (releaseAt > decayEnd) p.setValueAtTime(sustain, releaseAt);
  const faded = releaseAt + Math.max(0.01, e.release);
  p.exponentialRampToValueAtTime(sustain * FLOOR, faded);
  p.linearRampToValueAtTime(0, faded + TAIL);
  return { gain: g, end: faded + TAIL };
}

export interface ToneSpec {
  type: OscillatorType;
  freq: number;
  /** Slide to this frequency over `glide` seconds (default: the decay). */
  to?: number;
  glide?: number;
  at: number;
  attack?: number;
  peak: number;
  hold?: number;
  decay: number;
  lowpass?: number;
  q?: number;
}

/** One oscillator through an envelope (and an optional low-pass) into the voice. Returns its end. */
export function tone(v: Voice, s: ToneSpec): number {
  const o = v.ctx.createOscillator();
  o.type = s.type;
  if (s.to === undefined) o.frequency.setValueAtTime(s.freq, s.at);
  else glide(o.frequency, s.freq, s.to, s.at, s.glide ?? s.decay);
  const env = envelope(v, s.at, s.attack ?? 0.004, s.peak, s.hold ?? 0, s.decay);
  let head: AudioNode = o;
  if (s.lowpass !== undefined) {
    const f = filter(v, 'lowpass', s.lowpass, s.q);
    o.connect(f);
    head = f;
  }
  head.connect(env.gain);
  env.gain.connect(v.input);
  v.play(o, s.at, env.end);
  return env.end;
}

export interface NoiseSpec {
  at: number;
  attack?: number;
  peak: number;
  hold?: number;
  decay: number;
  filter: BiquadFilterType;
  freq: number;
  /** Slide the filter to this frequency over `glide` seconds (default: the decay). */
  to?: number;
  glide?: number;
  q?: number;
}

/** A burst of filtered noise into the voice. Returns its end. */
export function noise(v: Voice, s: NoiseSpec): number {
  const src = v.ctx.createBufferSource();
  src.buffer = v.noise;
  src.loop = true;
  const f = filter(v, s.filter, s.freq, s.q);
  if (s.to !== undefined) glide(f.frequency, s.freq, s.to, s.at, s.glide ?? s.decay);
  const env = envelope(v, s.at, s.attack ?? 0.002, s.peak, s.hold ?? 0, s.decay);
  src.connect(f);
  f.connect(env.gain);
  env.gain.connect(v.input);
  v.play(src, s.at, env.end, Math.random() * 0.5);
  return env.end;
}

/**
 * A vibrato on `targets` (oscillator frequencies): `depth` Hz at `rate` Hz, fading in from
 * nothing between `at + delay` and `at + delay + 0.2`.
 */
export function vibrato(v: Voice, targets: AudioParam[], rate: number, depth: number, at: number, delay: number, stop: number): void {
  const lfo = v.ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(rate, at);
  const amount = v.add(v.ctx.createGain());
  amount.gain.value = 0;
  amount.gain.setValueAtTime(0, at + delay);
  amount.gain.linearRampToValueAtTime(depth, at + delay + 0.2);
  lfo.connect(amount);
  for (const t of targets) amount.connect(t);
  v.play(lfo, at, stop);
}
