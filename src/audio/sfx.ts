/**
 * Every sound effect, synthesised: one small recipe per effect. A recipe adds its sources and
 * nodes to the voice it is given, starting at `t`, with every frequency multiplied by `p` (the
 * engine's pitch variation). Shared helpers (tone, noise, envelopes) are in synth.ts.
 *
 * Character: plants are round and poppy (sine, triangle); zombies gritty and comic (saw, noise);
 * explosions have a low thump under filtered noise; income is coin-like blips; peaks stay low
 * (≤ 0.6, most ≤ 0.35) so a crowd of effects has headroom before the master compressor.
 */
import { playNote } from './instruments';
import { instrumentFor, stingNotes } from './music';
import { filter, noise, tone, vibrato, envelope } from './synth';
import type { Voice } from './synth';

export type SfxName = 'place' | 'spawnZombie' | 'pea' | 'brainThrow' | 'hit' | 'chomp' | 'block' | 'explode'
  | 'merge' | 'sun' | 'bounty' | 'baseHit' | 'click' | 'deny' | 'suddenDeath' | 'win' | 'lose' | 'collapse'
  | 'baseStrike';

export type Recipe = (v: Voice, t: number, p: number) => void;

/** A plant goes in: a round "plop" as it lands in the soil, a puff of dirt, a perky rising chirp. */
function place(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 520 * p, to: 180 * p, glide: 0.09, at: t, attack: 0.003, peak: 0.55, decay: 0.16 });
  noise(v, { at: t, peak: 0.18, decay: 0.06, filter: 'bandpass', freq: 1100, q: 1.2 });
  tone(v, { type: 'triangle', freq: 660 * p, to: 990 * p, glide: 0.07, at: t + 0.06, peak: 0.22, decay: 0.12 });
}

/**
 * A zombie climbs out of the graveyard: a comic groan (two detuned saws sliding down through a
 * "vowel" filter that opens and closes, with a wobble) over a rumble of earth and a raspy breath.
 */
function spawnZombie(v: Voice, t: number, p: number): void {
  const vowel = filter(v, 'bandpass', 500, 4);
  vowel.frequency.setValueAtTime(500, t);
  vowel.frequency.linearRampToValueAtTime(950, t + 0.18);
  vowel.frequency.linearRampToValueAtTime(450, t + 0.5);
  const env = envelope(v, t, 0.06, 0.3, 0.12, 0.38);
  const saws = [1, 1.012].map((detune) => {
    const o = v.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120 * p * detune, t);
    o.frequency.exponentialRampToValueAtTime(92 * p * detune, t + 0.5);
    o.connect(vowel);
    v.play(o, t, env.end);
    return o;
  });
  vibrato(v, saws.map((o) => o.frequency), 7, 3 * p, t, 0, env.end);
  vowel.connect(env.gain);
  env.gain.connect(v.input);
  noise(v, { at: t, attack: 0.01, peak: 0.25, decay: 0.25, filter: 'lowpass', freq: 400 });
  noise(v, { at: t + 0.04, attack: 0.05, peak: 0.04, decay: 0.4, filter: 'bandpass', freq: 1800, q: 2 });
}

/** A pea is shot: a soft round "puh" with a breath of air. Quiet, because it is the most frequent. */
function pea(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 760 * p, to: 340 * p, glide: 0.05, at: t, attack: 0.002, peak: 0.32, decay: 0.07 });
  noise(v, { at: t, attack: 0.001, peak: 0.06, decay: 0.02, filter: 'highpass', freq: 2500 });
}

/** A brain is lobbed: a squishy whoosh and a wet "blub". */
function brainThrow(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.03, peak: 0.22, decay: 0.15, filter: 'bandpass', freq: 500 * p, to: 1800 * p, glide: 0.15, q: 1.5 });
  tone(v, { type: 'triangle', freq: 260 * p, to: 140 * p, glide: 0.12, at: t, attack: 0.005, peak: 0.2, decay: 0.12, lowpass: 900 });
}

/** A projectile lands: a short squishy "tok". */
function hit(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.001, peak: 0.3, decay: 0.06, filter: 'lowpass', freq: 2200 * p, to: 600 * p, glide: 0.05 });
  tone(v, { type: 'sine', freq: 240 * p, to: 120 * p, glide: 0.05, at: t, attack: 0.002, peak: 0.3, decay: 0.07 });
}

/** A zombie bites: "ch" of teeth, then a gritty "omp" with a crunch. */
function chomp(v: Voice, t: number, p: number): void {
  noise(v, { at: t, peak: 0.25, decay: 0.035, filter: 'bandpass', freq: 2400 * p, q: 1.5 });
  tone(v, { type: 'sawtooth', freq: 150 * p, to: 80 * p, glide: 0.09, at: t + 0.04, peak: 0.28, decay: 0.13, lowpass: 700 });
  noise(v, { at: t + 0.045, peak: 0.18, decay: 0.06, filter: 'bandpass', freq: 900 * p, q: 2 });
}

/** A pea bounces off a shield: a cartoon metal "tink" (bell partials 1 : 2.76 : 5.4) and a click. */
function block(v: Voice, t: number, p: number): void {
  const partials: Array<[number, number, number]> = [[1, 0.18, 0.3], [2.76, 0.1, 0.18], [5.4, 0.05, 0.1]];
  for (const [ratio, peak, decay] of partials) {
    tone(v, { type: 'sine', freq: 1250 * p * ratio, at: t, attack: 0.001, peak, decay });
  }
  noise(v, { at: t, attack: 0.001, peak: 0.1, decay: 0.015, filter: 'highpass', freq: 4000 });
}

/**
 * The Walnut Bomb goes off: a low thump (with a triangle on top so laptop speakers hear it),
 * a blast of noise whose filter closes, and a crackle.
 */
function explode(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 150 * p, to: 42 * p, glide: 0.35, at: t, attack: 0.004, peak: 0.6, decay: 0.5 });
  tone(v, { type: 'triangle', freq: 110 * p, to: 40 * p, glide: 0.3, at: t, attack: 0.004, peak: 0.3, decay: 0.3, lowpass: 400 });
  noise(v, { at: t, attack: 0.005, peak: 0.5, decay: 0.7, filter: 'lowpass', freq: 3500 * p, to: 250 * p, glide: 0.6, q: 0.8 });
  noise(v, { at: t + 0.01, peak: 0.12, decay: 0.12, filter: 'highpass', freq: 2500 });
}

/** Two units become one: a rising sparkle, E5 G5 C6, each with a bell an octave up. */
function merge(v: Voice, t: number, p: number): void {
  [659.25, 783.99, 1046.5].forEach((f, i) => {
    const at = t + i * 0.07;
    tone(v, { type: 'triangle', freq: f * p, at, peak: 0.24, decay: 0.28 });
    tone(v, { type: 'sine', freq: 2 * f * p, at, attack: 0.003, peak: 0.07, decay: 0.18 });
  });
  tone(v, { type: 'sine', freq: 2093 * p, at: t + 0.21, attack: 0.01, peak: 0.05, decay: 0.35 });
}

/** A Sunflower pays: the classic coin, B5 then a ringing E6. */
function sun(v: Voice, t: number, p: number): void {
  tone(v, { type: 'triangle', freq: 987.77 * p, at: t, attack: 0.003, peak: 0.25, decay: 0.07 });
  tone(v, { type: 'triangle', freq: 1318.5 * p, at: t + 0.07, attack: 0.003, peak: 0.27, decay: 0.28 });
  tone(v, { type: 'sine', freq: 2637 * p, at: t + 0.07, attack: 0.002, peak: 0.06, decay: 0.15 });
}

/** A bounty: a quicker coin a fifth apart, C6 then G6, with a "ching" of bright noise. */
function bounty(v: Voice, t: number, p: number): void {
  tone(v, { type: 'triangle', freq: 1046.5 * p, at: t, attack: 0.002, peak: 0.2, decay: 0.06 });
  tone(v, { type: 'triangle', freq: 1568 * p, at: t + 0.05, attack: 0.002, peak: 0.22, decay: 0.2 });
  noise(v, { at: t + 0.05, attack: 0.002, peak: 0.05, decay: 0.12, filter: 'highpass', freq: 6000 });
}

/** A base takes a hit: a deep wooden "thoomp" with a crunch and a short rumble. */
function baseHit(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 110 * p, to: 55 * p, glide: 0.18, at: t, attack: 0.003, peak: 0.5, decay: 0.25 });
  tone(v, { type: 'triangle', freq: 180 * p, to: 90 * p, glide: 0.12, at: t, attack: 0.003, peak: 0.25, decay: 0.12, lowpass: 600 });
  noise(v, { at: t, peak: 0.3, decay: 0.09, filter: 'bandpass', freq: 650 * p, q: 1.2 });
  noise(v, { at: t, attack: 0.005, peak: 0.22, decay: 0.2, filter: 'lowpass', freq: 300 });
}

/** The plant base whacks a zombie: a woody "thwack", a wood-block knock over a slap and a thud. */
function baseStrike(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 700 * p, to: 520 * p, glide: 0.04, at: t, attack: 0.001, peak: 0.35, decay: 0.08 });
  tone(v, { type: 'triangle', freq: 330 * p, to: 260 * p, glide: 0.08, at: t, attack: 0.001, peak: 0.2, decay: 0.1 });
  noise(v, { at: t, attack: 0.001, peak: 0.35, decay: 0.035, filter: 'bandpass', freq: 1600 * p, q: 1.8 });
  noise(v, { at: t, peak: 0.2, decay: 0.07, filter: 'lowpass', freq: 500 });
}

/** A button or the shovel: a short soft tick. */
function click(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 1500 * p, to: 900 * p, glide: 0.03, at: t, attack: 0.001, peak: 0.22, decay: 0.04 });
  tone(v, { type: 'triangle', freq: 3000 * p, at: t, attack: 0.001, peak: 0.05, decay: 0.015 });
}

/** Not allowed: a friendly "uh-uh", E4 then C4, rounded with a little buzz. Never harsh. */
function deny(v: Voice, t: number, p: number): void {
  [329.63, 261.63].forEach((f, i) => {
    const at = t + i * 0.11;
    tone(v, { type: 'triangle', freq: f * p, at, attack: 0.005, peak: 0.3, decay: 0.1 });
    tone(v, { type: 'square', freq: f * p, at, attack: 0.005, peak: 0.07, decay: 0.08, lowpass: 900 });
  });
}

/**
 * Sudden death: a comic-dramatic brass "dun dun DUNNN" (G3, G3, E♭3) with a drum under each hit
 * and a gong shimmer on the last.
 */
function suddenDeath(v: Voice, t: number, p: number): void {
  const hits: Array<[number, number, number]> = [[0, 196, 0.16], [0.22, 196, 0.16], [0.44, 155.56, 0.9]];
  for (const [offset, f, length] of hits) {
    const at = t + offset;
    const lp = filter(v, 'lowpass', 400, 1.5);
    lp.frequency.setValueAtTime(400, at);
    lp.frequency.exponentialRampToValueAtTime(2200, at + 0.06);
    lp.frequency.exponentialRampToValueAtTime(900, at + length);
    const env = envelope(v, at, 0.02, 0.14, length, 0.25);
    for (const cents of [-7, 7]) {
      const o = v.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * p * Math.pow(2, cents / 1200), at);
      o.connect(lp);
      v.play(o, at, env.end);
    }
    lp.connect(env.gain);
    env.gain.connect(v.input);
    tone(v, { type: 'sine', freq: 110 * p, to: 60 * p, glide: 0.2, at, attack: 0.003, peak: 0.35, decay: 0.25 });
  }
  noise(v, { at: t + 0.44, attack: 0.01, peak: 0.07, decay: 1, filter: 'bandpass', freq: 3000, q: 0.5 });
}

/** A sting from music.ts played with the music's instruments, all in this one voice. */
function sting(kind: 'win' | 'lose'): Recipe {
  return (v, t, p) => {
    for (const n of stingNotes(kind, t)) playNote(v, instrumentFor(n), n.midi, n.time, n.length, n.velocity, p);
  };
}

/**
 * A base falls: a long low rumble (1.6 s, the length of the collapse), a crack, falling debris,
 * and a crumbling layer in the mids (1.2 kHz sliding to 350 Hz) so laptop and iPad speakers,
 * which give little below 200 Hz, still hear it come down.
 */
function collapse(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.05, peak: 0.5, hold: 0.5, decay: 1.2, filter: 'lowpass', freq: 260, to: 90, glide: 1.6 });
  noise(v, { at: t, attack: 0.03, peak: 0.24, hold: 0.3, decay: 1.2, filter: 'bandpass', freq: 1200, to: 350, glide: 1.5, q: 0.9 });
  tone(v, { type: 'sawtooth', freq: 300 * p, to: 140 * p, glide: 0.9, at: t, attack: 0.01, peak: 0.08, hold: 0.2, decay: 0.8, lowpass: 1200 });
  tone(v, { type: 'sine', freq: 70 * p, to: 32 * p, glide: 1.4, at: t, attack: 0.02, peak: 0.45, decay: 1.4 });
  tone(v, { type: 'triangle', freq: 140 * p, to: 60 * p, glide: 1.2, at: t, attack: 0.02, peak: 0.2, decay: 1.2, lowpass: 300 });
  noise(v, { at: t, peak: 0.4, decay: 0.12, filter: 'bandpass', freq: 900, q: 1 });
  for (let i = 0; i < 9; i++) {
    const at = t + 0.1 + i * 0.15 + Math.random() * 0.08;
    const loud = 0.12 + Math.random() * 0.08;
    noise(v, { at, attack: 0.001, peak: loud, decay: 0.04 + Math.random() * 0.05, filter: 'bandpass', freq: 700 + Math.random() * 1900, q: 3 });
    if (i % 3 === 0) tone(v, { type: 'sine', freq: (300 + Math.random() * 300) * p, at, attack: 0.001, peak: 0.12, decay: 0.06 });
  }
}

export const SFX: Record<SfxName, Recipe> = {
  place, spawnZombie, pea, brainThrow, hit, chomp, block, explode, merge, sun, bounty, baseHit,
  click, deny, suddenDeath, win: sting('win'), lose: sting('lose'), collapse, baseStrike,
};

export const SFX_NAMES = Object.keys(SFX) as SfxName[];
