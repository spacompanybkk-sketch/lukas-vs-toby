/**
 * The music's instruments, built from oscillators, noise and envelopes (synth.ts). Used for the
 * themes (one voice per note) and for the win and lose stings (one voice for the whole sting).
 *
 * The bass has bright harmonics on purpose: laptop and iPad speakers give almost nothing below
 * about 100 Hz, so a pure low sine would vanish there.
 */
import type { Instrument } from './music';
import { adsr, filter, level, noise, tone, vibrato } from './synth';
import type { Voice } from './synth';

/** A little stereo spread so the band does not sit in one spot. */
export const INSTRUMENT_PAN: Record<Instrument, number> = {
  bass: 0, pad: -0.15, lead: 0.05, counter: 0.3, kick: 0, snare: 0.05, hat: -0.25, openHat: -0.25, tom: 0.1,
};

export function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Plays one note into `v`. `pitch` multiplies every frequency (drums keep theirs). */
export function playNote(v: Voice, inst: Instrument, midi: number, at: number, length: number, velocity: number, pitch = 1): void {
  const f = hz(midi) * pitch;
  const vel = Math.min(1, Math.max(0.01, velocity));
  switch (inst) {
    case 'bass': return bass(v, f, at, length, vel);
    case 'pad': return pad(v, f, at, length, vel);
    case 'lead': return lead(v, f, at, length, vel);
    case 'counter': return counter(v, f, at, length, vel);
    case 'kick': return kick(v, at, vel);
    case 'snare': return snare(v, at, vel);
    case 'hat': return void noise(v, { at, attack: 0.001, peak: 0.09 * vel, decay: 0.03, filter: 'highpass', freq: 7000 });
    case 'openHat':
      return void noise(v, { at, attack: 0.002, peak: 0.07 * vel, hold: 0.04, decay: Math.min(0.5, length), filter: 'highpass', freq: 6500 });
    case 'tom': return tom(v, midi, at, vel);
    default: {
      const unhandled: never = inst;
      throw new Error(`no instrument ${String(unhandled)}`);
    }
  }
}

/** A plucky cartoon synth bass: a saw through a low-pass that closes fast, plus a sine at the root. */
function bass(v: Voice, f: number, at: number, length: number, vel: number): void {
  const env = adsr(v, at, length, { attack: 0.005, decay: 0.12, sustain: 0.55, release: 0.07, peak: 0.24 * vel });
  const saw = v.ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(f, at);
  const lp = filter(v, 'lowpass', 1100, 3);
  lp.frequency.setValueAtTime(1100, at);
  lp.frequency.exponentialRampToValueAtTime(320, at + 0.15);
  const sub = v.ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(f, at);
  saw.connect(lp);
  lp.connect(env.gain);
  sub.connect(env.gain);
  env.gain.connect(v.input);
  v.play(saw, at, env.end);
  v.play(sub, at, env.end);
}

/** Soft chord tones: two slightly detuned triangles. Short notes are a "pah", long ones swell in. */
function pad(v: Voice, f: number, at: number, length: number, vel: number): void {
  const long = length > 1;
  const env = adsr(v, at, length, {
    attack: long ? 0.25 : 0.015, decay: 0.2, sustain: long ? 0.8 : 0.45, release: long ? 0.3 : 0.12, peak: (long ? 0.06 : 0.08) * vel,
  });
  const lp = filter(v, 'lowpass', 1800);
  for (const cents of [-6, 6]) {
    const o = v.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * Math.pow(2, cents / 1200), at);
    o.connect(lp);
    v.play(o, at, env.end);
  }
  lp.connect(env.gain);
  env.gain.connect(v.input);
}

/**
 * The tune: a soft square and a triangle through a low-pass, with a vibrato that fades in on held
 * notes and widens to a comic wobble on notes over a second.
 */
function lead(v: Voice, f: number, at: number, length: number, vel: number): void {
  const env = adsr(v, at, length, { attack: 0.012, decay: 0.12, sustain: 0.7, release: 0.09, peak: 0.13 * vel });
  const lp = filter(v, 'lowpass', 2600, 0.8);
  const squareLevel = level(v, 0.4);
  const square = v.ctx.createOscillator();
  square.type = 'square';
  square.frequency.setValueAtTime(f, at);
  const tri = v.ctx.createOscillator();
  tri.type = 'triangle';
  tri.frequency.setValueAtTime(f, at);
  square.connect(squareLevel);
  squareLevel.connect(lp);
  tri.connect(lp);
  lp.connect(env.gain);
  env.gain.connect(v.input);
  v.play(square, at, env.end);
  v.play(tri, at, env.end);
  if (length >= 0.3) {
    const wobble = length > 1;
    vibrato(v, [square.frequency, tri.frequency], wobble ? 6 : 5.5, f * (wobble ? 0.02 : 0.005), at, 0.12, env.end);
  }
}

/** A glockenspiel / marimba tick: a sine with a quiet, quickly fading partial four times higher. */
function counter(v: Voice, f: number, at: number, length: number, vel: number): void {
  tone(v, { type: 'sine', freq: f, at, attack: 0.002, peak: 0.12 * vel, decay: Math.min(0.5, length + 0.25) });
  tone(v, { type: 'sine', freq: f * 4, at, attack: 0.001, peak: 0.03 * vel, decay: 0.06 });
}

function kick(v: Voice, at: number, vel: number): void {
  tone(v, { type: 'sine', freq: 160, to: 48, glide: 0.1, at, attack: 0.002, peak: 0.55 * vel, decay: 0.22 });
  tone(v, { type: 'triangle', freq: 110, to: 55, glide: 0.08, at, attack: 0.002, peak: 0.15 * vel, decay: 0.1, lowpass: 300 });
  noise(v, { at, attack: 0.001, peak: 0.06 * vel, decay: 0.015, filter: 'lowpass', freq: 1500 });
}

function snare(v: Voice, at: number, vel: number): void {
  noise(v, { at, attack: 0.001, peak: 0.22 * vel, decay: 0.12, filter: 'highpass', freq: 1200 });
  tone(v, { type: 'triangle', freq: 200, to: 160, glide: 0.05, at, attack: 0.001, peak: 0.18 * vel, decay: 0.06 });
}

const TOM_HZ: Record<number, number> = { 41: 98, 43: 123, 45: 147 };

function tom(v: Voice, midi: number, at: number, vel: number): void {
  const f = TOM_HZ[midi] ?? 123;
  tone(v, { type: 'sine', freq: f, to: f * 0.7, glide: 0.2, at, attack: 0.002, peak: 0.4 * vel, decay: 0.22 });
  tone(v, { type: 'triangle', freq: f * 2, to: f * 1.4, glide: 0.15, at, attack: 0.002, peak: 0.1 * vel, decay: 0.12, lowpass: 600 });
}
