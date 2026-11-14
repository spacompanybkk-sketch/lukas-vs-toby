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
  | 'baseStrike'
  // phase 2: projectiles, effects on units, the new plants and zombies, heroes and spells
  | 'kernel' | 'butter' | 'mango' | 'sand' | 'arrow' | 'bullet' | 'trident' | 'rot' | 'stun' | 'blind' | 'lasso'
  | 'poison' | 'burn' | 'heal' | 'raise' | 'mineArm' | 'mineBoom' | 'fuse' | 'cherryBoom' | 'squash' | 'grow'
  | 'miss' | 'heroReady' | 'megaMower' | 'boneStorm' | 'spellReady' | 'thunderbolt' | 'vines' | 'sunShower'
  | 'healingRain' | 'rockWall' | 'meteor' | 'fog' | 'brainFeast' | 'frenzy' | 'graveRise'
  // phase 3: the bosses, two each (a signature call for the entrance and the patterns, a defeat sting)
  | 'titanRoar' | 'titanDefeat' | 'oakCreak' | 'oakDefeat'
  // worlds machinery: any boss's strike (its warning, its blow)
  | 'strikeWindup' | 'strikeImpact';

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

// ---------------------------------------------------------------------------------------------
// Phase 2. Every new sound is kept friendly (soft attacks, rounded tops, no harsh highs) and has
// its own shape so it can be told apart by ear: pops and plops for plant shots, whooshes and
// pings for zombie shots, little tunes for status effects, thumps for explosions, bells for the
// "ready" calls. All under 0.6 s except the four big ones (under 1.5 s).
// ---------------------------------------------------------------------------------------------

/** Corn: a dry double "pok-pok", the second a little higher. Very short: it is fired often. */
function kernel(v: Voice, t: number, p: number): void {
  tone(v, { type: 'triangle', freq: 980 * p, to: 640 * p, glide: 0.04, at: t, attack: 0.001, peak: 0.26, decay: 0.05 });
  tone(v, { type: 'triangle', freq: 1240 * p, to: 800 * p, glide: 0.04, at: t + 0.05, attack: 0.001, peak: 0.2, decay: 0.05 });
  noise(v, { at: t, attack: 0.001, peak: 0.05, decay: 0.015, filter: 'highpass', freq: 3000 });
}

/** Butter: a soft wobbling "bloo-oop", up then down, with a wet smack. */
function butter(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 220 * p, to: 430 * p, glide: 0.08, at: t, attack: 0.004, peak: 0.3, decay: 0.09 });
  tone(v, { type: 'sine', freq: 430 * p, to: 200 * p, glide: 0.13, at: t + 0.08, attack: 0.004, peak: 0.28, decay: 0.15 });
  noise(v, { at: t + 0.1, attack: 0.004, peak: 0.1, decay: 0.08, filter: 'bandpass', freq: 800 * p, q: 1.2 });
}

/** Mango: a juicy "plip" with a bright wet spritz on top. */
function mango(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 640 * p, to: 260 * p, glide: 0.07, at: t, attack: 0.002, peak: 0.3, decay: 0.1 });
  tone(v, { type: 'sine', freq: 1500 * p, to: 1050 * p, glide: 0.06, at: t + 0.015, attack: 0.002, peak: 0.1, decay: 0.08 });
  noise(v, { at: t, attack: 0.003, peak: 0.1, decay: 0.09, filter: 'bandpass', freq: 2300 * p, to: 1400 * p, glide: 0.09, q: 1.5 });
}

/** Sand: a dry hushed puff that never quite becomes a note. */
function sand(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.02, peak: 0.2, decay: 0.16, filter: 'bandpass', freq: 3200 * p, to: 1500 * p, glide: 0.18, q: 0.8 });
  tone(v, { type: 'sine', freq: 170 * p, to: 110 * p, glide: 0.1, at: t, attack: 0.005, peak: 0.12, decay: 0.12 });
}

/** Arrow: a quick air-whoosh, a bow "twang", and a soft "thk" where it lands. */
function arrow(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.015, peak: 0.16, decay: 0.1, filter: 'highpass', freq: 2600 * p, to: 900 * p, glide: 0.1 });
  tone(v, { type: 'triangle', freq: 1150 * p, to: 700 * p, glide: 0.08, at: t, attack: 0.002, peak: 0.16, decay: 0.09 });
  tone(v, { type: 'sine', freq: 210 * p, to: 140 * p, glide: 0.04, at: t + 0.12, attack: 0.001, peak: 0.28, decay: 0.05 });
}

/** Bullet: a cartoon "pew" (a square wave falling fast, softened) with a puff of smoke. */
function bullet(v: Voice, t: number, p: number): void {
  tone(v, { type: 'square', freq: 1500 * p, to: 320 * p, glide: 0.09, at: t, attack: 0.002, peak: 0.16, decay: 0.1, lowpass: 2400 });
  noise(v, { at: t, attack: 0.001, peak: 0.12, decay: 0.03, filter: 'bandpass', freq: 2000 * p, q: 1 });
}

/** Trident: three quick rising pings, "tri-den-t", over a splash of water. */
function trident(v: Voice, t: number, p: number): void {
  [740, 932, 1175].forEach((f, i) => {
    tone(v, { type: 'triangle', freq: f * p, at: t + i * 0.055, attack: 0.002, peak: 0.2, decay: 0.09 });
  });
  noise(v, { at: t, attack: 0.01, peak: 0.1, decay: 0.2, filter: 'bandpass', freq: 1800 * p, to: 700 * p, glide: 0.2, q: 1 });
}

/** Brain Rot: a gloopy burble, a low saw wobbling fast through a muffled filter. Silly, not scary. */
function rot(v: Voice, t: number, p: number): void {
  const env = envelope(v, t, 0.03, 0.22, 0.12, 0.2);
  const lp = filter(v, 'lowpass', 520, 3);
  const saw = v.ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(130 * p, t);
  saw.frequency.exponentialRampToValueAtTime(80 * p, t + 0.35);
  saw.connect(lp);
  v.play(saw, t, env.end);
  vibrato(v, [saw.frequency], 15, 9 * p, t, 0, env.end);
  lp.connect(env.gain);
  env.gain.connect(v.input);
  noise(v, { at: t, attack: 0.02, peak: 0.08, decay: 0.3, filter: 'bandpass', freq: 400 * p, q: 3 });
}

/** Stunned: dizzy little birds, "tweet-tweet-tweet", alternating high and low. */
function stun(v: Voice, t: number, p: number): void {
  [1320, 990, 1320, 990, 1480].forEach((f, i) => {
    tone(v, { type: 'triangle', freq: f * p, to: f * 1.12 * p, glide: 0.04, at: t + i * 0.065, attack: 0.003, peak: 0.17, decay: 0.07 });
  });
}

/** Blinded: a soft "poof" of ink, a falling bubble under a puff of dark air. */
function blind(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.04, peak: 0.2, decay: 0.28, filter: 'lowpass', freq: 1600 * p, to: 300 * p, glide: 0.3 });
  tone(v, { type: 'sine', freq: 520 * p, to: 230 * p, glide: 0.25, at: t, attack: 0.01, peak: 0.2, decay: 0.28 });
}

/** Lasso: a rope whirling round (two sweeps of airy noise) and a "snap" as it catches. */
function lasso(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.05, peak: 0.12, decay: 0.1, filter: 'bandpass', freq: 800 * p, to: 2000 * p, glide: 0.12, q: 3 });
  noise(v, { at: t + 0.12, attack: 0.03, peak: 0.14, decay: 0.1, filter: 'bandpass', freq: 900 * p, to: 2200 * p, glide: 0.1, q: 3 });
  noise(v, { at: t + 0.26, attack: 0.001, peak: 0.28, decay: 0.03, filter: 'highpass', freq: 2800 });
  tone(v, { type: 'sine', freq: 420 * p, to: 210 * p, glide: 0.07, at: t + 0.26, attack: 0.002, peak: 0.25, decay: 0.08 });
}

/** Poison ticking: three small bubbles "blip-blup-blip". Quiet, since it repeats. */
function poison(v: Voice, t: number, p: number): void {
  [[0, 1], [0.075, 1.35], [0.15, 0.8]].forEach(([off, k]) => {
    tone(v, { type: 'sine', freq: 300 * k! * p, to: 720 * k! * p, glide: 0.05, at: t + off!, attack: 0.003, peak: 0.14, decay: 0.07 });
  });
}

/** Burning ticking: a soft falling "fwoosh" with a few low, round crackle pops. Quiet, it repeats. */
function burn(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.02, peak: 0.1, decay: 0.28, filter: 'lowpass', freq: 1100 * p, to: 240 * p, glide: 0.3, q: 0.7 });
  [0.03, 0.09, 0.14, 0.22].forEach((off, i) => {
    noise(v, { at: t + off, attack: 0.002, peak: 0.1, decay: 0.03, filter: 'bandpass', freq: (520 + i * 130) * p, q: 2.5 });
    tone(v, { type: 'sine', freq: (190 + i * 25) * p, to: 120 * p, glide: 0.04, at: t + off, attack: 0.002, peak: 0.06, decay: 0.04 });
  });
}

/** Healing: a warm slide up a sixth (C5 to A5) in sine, an octave shimmer, and two sparkles. */
function heal(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 523.25 * p, to: 880 * p, glide: 0.2, at: t, attack: 0.02, peak: 0.24, hold: 0.1, decay: 0.2 });
  tone(v, { type: 'sine', freq: 1046.5 * p, to: 1760 * p, glide: 0.2, at: t, attack: 0.03, peak: 0.07, hold: 0.1, decay: 0.2 });
  tone(v, { type: 'sine', freq: 2637 * p, at: t + 0.22, attack: 0.003, peak: 0.07, decay: 0.12 });
  tone(v, { type: 'sine', freq: 3136 * p, at: t + 0.28, attack: 0.003, peak: 0.05, decay: 0.12 });
}

/** The Necromancer raises a zombie: a comic wobbling "ooOOP" rising out of the earth, then a pop. */
function raise(v: Voice, t: number, p: number): void {
  const env = envelope(v, t, 0.05, 0.22, 0.15, 0.1);
  const lp = filter(v, 'lowpass', 700, 2);
  const saw = v.ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(90 * p, t);
  saw.frequency.exponentialRampToValueAtTime(190 * p, t + 0.3);
  saw.connect(lp);
  v.play(saw, t, env.end);
  vibrato(v, [saw.frequency], 9, 5 * p, t, 0, env.end);
  lp.connect(env.gain);
  env.gain.connect(v.input);
  noise(v, { at: t, attack: 0.03, peak: 0.2, decay: 0.3, filter: 'lowpass', freq: 380, to: 160, glide: 0.3 });
  tone(v, { type: 'triangle', freq: 440 * p, to: 660 * p, glide: 0.05, at: t + 0.32, attack: 0.002, peak: 0.2, decay: 0.08 });
}

/** A mine arms itself: two tiny soft "bip-bip" beeps. */
function mineArm(v: Voice, t: number, p: number): void {
  [0, 0.09].forEach((off) => {
    tone(v, { type: 'square', freq: 1760 * p, at: t + off, attack: 0.002, peak: 0.1, decay: 0.04, lowpass: 2400 });
    tone(v, { type: 'sine', freq: 880 * p, at: t + off, attack: 0.002, peak: 0.12, decay: 0.05 });
  });
}

/** A mine goes off: a punchy low thump and a short, tight burst, smaller than the Walnut Bomb. */
function mineBoom(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 130 * p, to: 48 * p, glide: 0.2, at: t, attack: 0.003, peak: 0.55, decay: 0.3 });
  tone(v, { type: 'triangle', freq: 220 * p, to: 80 * p, glide: 0.15, at: t, attack: 0.003, peak: 0.22, decay: 0.15, lowpass: 600 });
  noise(v, { at: t, attack: 0.003, peak: 0.4, decay: 0.38, filter: 'lowpass', freq: 2800 * p, to: 300 * p, glide: 0.35, q: 0.8 });
  noise(v, { at: t + 0.01, peak: 0.1, decay: 0.08, filter: 'highpass', freq: 2800 });
}

/** A fuse: ticks that speed up and climb in pitch over a rising sizzle, ending on a little upward blip. */
function fuse(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.1, peak: 0.07, hold: 0.25, decay: 0.1, filter: 'bandpass', freq: 3500 * p, to: 7000 * p, glide: 0.45, q: 1.2 });
  [0, 0.12, 0.21, 0.28, 0.34, 0.39, 0.43, 0.46].forEach((off, i) => {
    tone(v, { type: 'triangle', freq: (900 + i * 170) * p, at: t + off, attack: 0.001, peak: 0.1, decay: 0.02 });
  });
  tone(v, { type: 'sine', freq: 1200 * p, to: 2400 * p, glide: 0.06, at: t + 0.48, attack: 0.003, peak: 0.12, decay: 0.07 });
}

/** The Cherry Bomb: a round fruity "bwoomp" with a pop on top and a bright little bell. */
function cherryBoom(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 190 * p, to: 55 * p, glide: 0.25, at: t, attack: 0.003, peak: 0.55, decay: 0.35 });
  tone(v, { type: 'triangle', freq: 760 * p, to: 300 * p, glide: 0.08, at: t, attack: 0.002, peak: 0.28, decay: 0.12 });
  noise(v, { at: t, attack: 0.004, peak: 0.34, decay: 0.3, filter: 'lowpass', freq: 3600 * p, to: 400 * p, glide: 0.3, q: 0.8 });
  tone(v, { type: 'sine', freq: 1568 * p, at: t + 0.06, attack: 0.003, peak: 0.08, decay: 0.2 });
}

/** The Squash drops: a flat "splat" thud then a cartoon "boing" as it bounces. */
function squash(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 190 * p, to: 55 * p, glide: 0.12, at: t, attack: 0.002, peak: 0.55, decay: 0.16 });
  noise(v, { at: t, attack: 0.002, peak: 0.28, decay: 0.1, filter: 'lowpass', freq: 900 * p, q: 0.8 });
  tone(v, { type: 'sine', freq: 240 * p, to: 520 * p, glide: 0.14, at: t + 0.1, attack: 0.004, peak: 0.2, decay: 0.2 });
}

/** A unit levels up: a springy rising "boi-oing" with a tiny pop at the top. */
function grow(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 200 * p, to: 640 * p, glide: 0.24, at: t, attack: 0.01, peak: 0.28, decay: 0.28 });
  tone(v, { type: 'triangle', freq: 400 * p, to: 1280 * p, glide: 0.24, at: t, attack: 0.01, peak: 0.08, decay: 0.28 });
  tone(v, { type: 'sine', freq: 1900 * p, at: t + 0.25, attack: 0.002, peak: 0.1, decay: 0.08 });
}

/** A swing hits nothing: a soft airy "whff" and a sagging "wuh". Quiet and gentle. */
function miss(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.04, peak: 0.12, decay: 0.15, filter: 'bandpass', freq: 1500 * p, to: 500 * p, glide: 0.18, q: 1 });
  tone(v, { type: 'sine', freq: 320 * p, to: 190 * p, glide: 0.18, at: t + 0.02, attack: 0.01, peak: 0.1, decay: 0.2 });
}

/** The hero power is ready: a warm brassy "ta-DAA", C5 up to G5, a fifth, held. Mid register. */
function heroReady(v: Voice, t: number, p: number): void {
  [[523.25, 0, 0.12], [783.99, 0.14, 0.26]].forEach(([f, off, decay]) => {
    const at = t + off!;
    const lp = filter(v, 'lowpass', 1800, 1);
    const env = envelope(v, at, 0.01, 0.2, 0.03, decay!);
    const o = v.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f! * p, at);
    o.connect(lp);
    v.play(o, at, env.end);
    lp.connect(env.gain);
    env.gain.connect(v.input);
    const tri = v.ctx.createOscillator();
    tri.type = 'triangle';
    tri.frequency.setValueAtTime(f! * p, at);
    const env2 = envelope(v, at, 0.008, 0.2, 0.03, decay!);
    tri.connect(env2.gain);
    env2.gain.connect(v.input);
    v.play(tri, at, env2.end);
  });
}

/** A spell is ready: two high bell notes, E6 then A6, each with a glassy overtone. Above heroReady. */
function spellReady(v: Voice, t: number, p: number): void {
  [[1318.5, 0], [1760, 0.13]].forEach(([f, off]) => {
    const at = t + off!;
    tone(v, { type: 'sine', freq: f! * p, at, attack: 0.002, peak: 0.2, decay: 0.2 });
    tone(v, { type: 'sine', freq: f! * 2.76 * p, at, attack: 0.001, peak: 0.05, decay: 0.1 });
  });
  tone(v, { type: 'sine', freq: 3520 * p, at: t + 0.13, attack: 0.003, peak: 0.04, decay: 0.18 });
}

/**
 * The Mega Mower: an engine revving up (a saw sliding up through a filter with a fast chug), a
 * rush of cut grass for the lane's 0.9 s, and a happy bell at the end.
 */
function megaMower(v: Voice, t: number, p: number): void {
  const env = envelope(v, t, 0.08, 0.2, 0.7, 0.3);
  const lp = filter(v, 'lowpass', 500, 1.5);
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.linearRampToValueAtTime(1500, t + 0.8);
  const saw = v.ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(65 * p, t);
  saw.frequency.exponentialRampToValueAtTime(150 * p, t + 0.8);
  saw.connect(lp);
  v.play(saw, t, env.end);
  vibrato(v, [saw.frequency], 22, 8 * p, t, 0, env.end);
  lp.connect(env.gain);
  env.gain.connect(v.input);
  noise(v, { at: t, attack: 0.1, peak: 0.2, hold: 0.7, decay: 0.2, filter: 'bandpass', freq: 1200 * p, to: 2600 * p, glide: 0.9, q: 0.7 });
  tone(v, { type: 'sine', freq: 70 * p, to: 110 * p, glide: 0.8, at: t, attack: 0.05, peak: 0.3, hold: 0.7, decay: 0.2 });
  tone(v, { type: 'sine', freq: 1568 * p, at: t + 0.95, attack: 0.003, peak: 0.12, decay: 0.3 });
}

/** The Bone Storm: a rattle of xylophone-like clacks falling across 1 s, over a soft rumble. */
function boneStorm(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.15, peak: 0.16, hold: 0.6, decay: 0.4, filter: 'lowpass', freq: 300, q: 0.7 });
  const offsets = [0, 0.07, 0.11, 0.19, 0.24, 0.3, 0.37, 0.41, 0.5, 0.55, 0.62, 0.68, 0.75, 0.81, 0.9, 0.97];
  const notes = [740, 880, 660, 988, 784, 587, 932, 698];
  offsets.forEach((off, i) => {
    const f = notes[(i * 3) % notes.length]! * p;
    tone(v, { type: 'sine', freq: f, at: t + off, attack: 0.001, peak: 0.15, decay: 0.06 });
    noise(v, { at: t + off, attack: 0.001, peak: 0.09, decay: 0.025, filter: 'bandpass', freq: 1400 + (i % 4) * 300, q: 2 });
  });
  tone(v, { type: 'sine', freq: 90 * p, to: 55 * p, glide: 0.3, at: t + 0.97, attack: 0.003, peak: 0.3, decay: 0.3 });
}

/** A thunderbolt: a stepped zig-zag "krzzt" of three falling squares, a crack, a long soft rumble. */
function thunderbolt(v: Voice, t: number, p: number): void {
  [1700, 1250, 900].forEach((f, i) => {
    tone(v, { type: 'square', freq: f * p, at: t + i * 0.035, attack: 0.001, peak: 0.1, decay: 0.03, lowpass: 3000 });
  });
  noise(v, { at: t, attack: 0.002, peak: 0.4, decay: 0.12, filter: 'highpass', freq: 2800 });
  noise(v, { at: t + 0.05, attack: 0.03, peak: 0.34, hold: 0.1, decay: 0.9, filter: 'lowpass', freq: 700 * p, to: 120 * p, glide: 1, q: 0.7 });
  tone(v, { type: 'sine', freq: 85 * p, to: 38 * p, glide: 0.9, at: t + 0.04, attack: 0.02, peak: 0.45, decay: 1 });
}

/** Vines: a leafy rustle of four bursts and a rising wooden "creeak". */
function vines(v: Voice, t: number, p: number): void {
  [0, 0.07, 0.14, 0.22].forEach((off, i) => {
    noise(v, { at: t + off, attack: 0.02, peak: 0.12, decay: 0.08, filter: 'bandpass', freq: (2200 + i * 350) * p, q: 2 });
  });
  tone(v, { type: 'sawtooth', freq: 240 * p, to: 420 * p, glide: 0.3, at: t, attack: 0.03, peak: 0.08, hold: 0.1, decay: 0.15, lowpass: 600 });
}

/** Sun Shower: warm bells falling like drops down a pentatonic scale. */
function sunShower(v: Voice, t: number, p: number): void {
  [1568, 1318.5, 1174.7, 987.77, 880, 783.99, 659.25].forEach((f, i) => {
    tone(v, { type: 'triangle', freq: f * p, at: t + i * 0.045, attack: 0.002, peak: 0.15, decay: 0.12 });
  });
  tone(v, { type: 'sine', freq: 392 * p, at: t, attack: 0.03, peak: 0.1, hold: 0.2, decay: 0.2 });
}

/** Healing Rain: soft pit-pat of raindrops and a gentle rising pair of sine notes, G5 then B5. */
function healingRain(v: Voice, t: number, p: number): void {
  [0, 0.04, 0.09, 0.13, 0.19, 0.24, 0.3, 0.36].forEach((off, i) => {
    noise(v, { at: t + off, attack: 0.001, peak: 0.07, decay: 0.02, filter: 'bandpass', freq: 4500 + (i % 3) * 700, q: 3 });
  });
  tone(v, { type: 'sine', freq: 783.99 * p, at: t + 0.05, attack: 0.03, peak: 0.16, decay: 0.2 });
  tone(v, { type: 'sine', freq: 987.77 * p, at: t + 0.22, attack: 0.03, peak: 0.16, decay: 0.25 });
}

/** Rock Wall: stone grinding up, two heavy knocks, and a low thud. */
function rockWall(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.05, peak: 0.26, hold: 0.1, decay: 0.2, filter: 'lowpass', freq: 600 * p, to: 250 * p, glide: 0.35, q: 1 });
  [0.18, 0.3].forEach((off) => {
    noise(v, { at: t + off, attack: 0.001, peak: 0.28, decay: 0.05, filter: 'bandpass', freq: 750 * p, q: 2 });
    tone(v, { type: 'triangle', freq: 210 * p, to: 150 * p, glide: 0.06, at: t + off, attack: 0.001, peak: 0.25, decay: 0.08 });
  });
  tone(v, { type: 'sine', freq: 95 * p, to: 50 * p, glide: 0.2, at: t + 0.3, attack: 0.003, peak: 0.45, decay: 0.22 });
}

/** The Meteor: a falling whistle for 0.6 s, then a big soft "BOOM" with debris. */
function meteor(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 1900 * p, to: 320 * p, glide: 0.6, at: t, attack: 0.05, peak: 0.14, hold: 0.45, decay: 0.1 });
  noise(v, { at: t, attack: 0.1, peak: 0.1, hold: 0.4, decay: 0.1, filter: 'bandpass', freq: 3000 * p, to: 600 * p, glide: 0.6, q: 2 });
  const at = t + 0.62;
  tone(v, { type: 'sine', freq: 140 * p, to: 36 * p, glide: 0.5, at, attack: 0.004, peak: 0.6, decay: 0.6 });
  tone(v, { type: 'triangle', freq: 110 * p, to: 45 * p, glide: 0.35, at, attack: 0.004, peak: 0.25, decay: 0.4, lowpass: 400 });
  noise(v, { at, attack: 0.004, peak: 0.45, decay: 0.65, filter: 'lowpass', freq: 3200 * p, to: 220 * p, glide: 0.6, q: 0.8 });
  noise(v, { at: at + 0.02, peak: 0.1, decay: 0.15, filter: 'highpass', freq: 2500 });
}

/** Fog: a soft airy "whooo", a wide band of breath with a slow tremble of a low sine. */
function fog(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.18, peak: 0.2, hold: 0.1, decay: 0.22, filter: 'bandpass', freq: 650 * p, to: 420 * p, glide: 0.5, q: 0.8 });
  const env = envelope(v, t, 0.15, 0.12, 0.1, 0.25);
  const o = v.ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(230 * p, t);
  o.connect(env.gain);
  env.gain.connect(v.input);
  v.play(o, t, env.end);
  vibrato(v, [o.frequency], 5, 6 * p, t, 0, env.end);
}

/** Brain Feast: a happy "nom nom nom" (three round chews) and a satisfied rising hum. */
function brainFeast(v: Voice, t: number, p: number): void {
  [0, 0.12, 0.24].forEach((off) => {
    tone(v, { type: 'triangle', freq: 230 * p, to: 130 * p, glide: 0.07, at: t + off, attack: 0.006, peak: 0.26, decay: 0.08, lowpass: 800 });
    noise(v, { at: t + off, attack: 0.004, peak: 0.12, decay: 0.05, filter: 'bandpass', freq: 800 * p, q: 2 });
  });
  tone(v, { type: 'sine', freq: 300 * p, to: 450 * p, glide: 0.15, at: t + 0.38, attack: 0.02, peak: 0.16, decay: 0.15 });
}

/** Frenzy: a fast, bouncy run up six notes in a square wave with two drum beats under it. */
function frenzy(v: Voice, t: number, p: number): void {
  [392, 440, 493.88, 523.25, 587.33, 659.25].forEach((f, i) => {
    tone(v, { type: 'square', freq: f * p, at: t + i * 0.05, attack: 0.002, peak: 0.1, decay: 0.07, lowpass: 1800 });
  });
  [0, 0.15].forEach((off) => {
    tone(v, { type: 'sine', freq: 140 * p, to: 70 * p, glide: 0.08, at: t + off, attack: 0.002, peak: 0.35, decay: 0.1 });
  });
}

/** Grave Rise: earth rumbling, three crumbling dirt pops, and a soft ghostly minor third (A4, C5). */
function graveRise(v: Voice, t: number, p: number): void {
  noise(v, { at: t, attack: 0.08, peak: 0.28, hold: 0.15, decay: 0.28, filter: 'lowpass', freq: 320, to: 140, glide: 0.5, q: 0.8 });
  [0.12, 0.22, 0.32].forEach((off, i) => {
    noise(v, { at: t + off, attack: 0.001, peak: 0.16, decay: 0.05, filter: 'bandpass', freq: 600 + i * 250, q: 3 });
    tone(v, { type: 'sine', freq: (200 + i * 40) * p, to: 120 * p, glide: 0.06, at: t + off, attack: 0.002, peak: 0.18, decay: 0.08 });
  });
  tone(v, { type: 'sine', freq: 440 * p, at: t + 0.3, attack: 0.04, peak: 0.1, decay: 0.2 });
  tone(v, { type: 'sine', freq: 523.25 * p, at: t + 0.3, attack: 0.04, peak: 0.08, decay: 0.2 });
}

/**
 * The Brain Titan's roar: a big, goofy "BLAAARGH" (two detuned saws sliding down through a vowel
 * filter that opens and closes, wobbling) over a rumble, ending in a silly hiccup. Loud, not scary.
 */
function titanRoar(v: Voice, t: number, p: number): void {
  const vowel = filter(v, 'bandpass', 420, 3);
  vowel.frequency.setValueAtTime(420, t);
  vowel.frequency.linearRampToValueAtTime(1100, t + 0.25);
  vowel.frequency.linearRampToValueAtTime(380, t + 0.75);
  const env = envelope(v, t, 0.05, 0.35, 0.35, 0.4);
  const saws = [1, 1.015].map((detune) => {
    const o = v.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95 * p * detune, t);
    o.frequency.exponentialRampToValueAtTime(62 * p * detune, t + 0.75);
    o.connect(vowel);
    v.play(o, t, env.end);
    return o;
  });
  vibrato(v, saws.map((o) => o.frequency), 9, 4 * p, t, 0, env.end);
  vowel.connect(env.gain);
  env.gain.connect(v.input);
  noise(v, { at: t, attack: 0.03, peak: 0.25, hold: 0.2, decay: 0.4, filter: 'lowpass', freq: 260 });
  tone(v, { type: 'triangle', freq: 330 * p, to: 520 * p, glide: 0.05, at: t + 0.82, attack: 0.004, peak: 0.18, decay: 0.08 });
}

/**
 * The Brain Titan beaten: a sad-trombone "wah wah wah waaah" (a soft saw, filtered round, down four
 * notes, the last wobbling) that makes the fall funny, then a soft thump as it lands.
 */
function titanDefeat(v: Voice, t: number, p: number): void {
  const notes = [196, 185, 174.6, 164.8];
  notes.forEach((f, i) => {
    const last = i === notes.length - 1;
    tone(v, {
      type: 'sawtooth', freq: f * p, to: last ? f * 0.94 * p : undefined, glide: last ? 0.5 : undefined,
      at: t + i * 0.22, attack: 0.02, peak: 0.22, hold: last ? 0.3 : 0.08, decay: last ? 0.3 : 0.08, lowpass: 900,
    });
  });
  tone(v, { type: 'sine', freq: 90 * p, to: 45 * p, glide: 0.15, at: t + 1.15, attack: 0.003, peak: 0.4, decay: 0.2 });
}

/**
 * The Elder Oak's creak: an old wooden "crrreeak" (a buzzy low saw whose pitch and filter jitter in
 * steps) and two hollow knocks of wood, like a grumpy grandpa getting up.
 */
function oakCreak(v: Voice, t: number, p: number): void {
  const body = filter(v, 'bandpass', 700, 5);
  const env = envelope(v, t, 0.04, 0.3, 0.3, 0.3);
  const o = v.ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(70 * p, t);
  body.frequency.setValueAtTime(600, t);
  // Quick little ramps between creak points: the jitter of old wood, with no clicks.
  for (let i = 1; i <= 8; i++) {
    o.frequency.linearRampToValueAtTime((70 + (i % 2 === 0 ? 14 : -6) + i * 4) * p, t + i * 0.07);
    body.frequency.linearRampToValueAtTime(600 + (i % 3) * 220, t + i * 0.07);
  }
  o.connect(body);
  body.connect(env.gain);
  env.gain.connect(v.input);
  v.play(o, t, env.end);
  [0.62, 0.78].forEach((off, i) => {
    tone(v, { type: 'triangle', freq: (330 - i * 60) * p, to: (180 - i * 30) * p, glide: 0.05, at: t + off, attack: 0.002, peak: 0.3, decay: 0.09 });
    noise(v, { at: t + off, attack: 0.001, peak: 0.1, decay: 0.03, filter: 'bandpass', freq: 1400, q: 3 });
  });
}

/**
 * The Elder Oak beaten: leaves rustling down (bursts of airy noise, falling), then a little wooden
 * tune tumbling down five notes, like acorns bouncing away.
 */
function oakDefeat(v: Voice, t: number, p: number): void {
  [0, 0.12, 0.26].forEach((off, i) => {
    noise(v, { at: t + off, attack: 0.02, peak: 0.16 - i * 0.03, decay: 0.25, filter: 'highpass', freq: 3000 - i * 600, to: 1200, glide: 0.25 });
  });
  [784, 659.25, 587.33, 493.88, 392].forEach((f, i) => {
    tone(v, { type: 'triangle', freq: f * p, at: t + 0.45 + i * 0.13, attack: 0.002, peak: 0.24, decay: 0.12 });
  });
}

/**
 * A boss's strike is coming: a warning "woo-woo" (a square wave stepping up and down twice, soft
 * and filtered) and a rising whistle, like something about to fall on the marked tiles.
 */
function strikeWindup(v: Voice, t: number, p: number): void {
  [660, 880, 660, 880].forEach((f, i) => {
    tone(v, { type: 'square', freq: f * p, at: t + i * 0.11, attack: 0.004, peak: 0.08, hold: 0.04, decay: 0.06, lowpass: 1600 });
  });
  tone(v, { type: 'sine', freq: 500 * p, to: 1400 * p, glide: 0.45, at: t + 0.05, attack: 0.05, peak: 0.12, hold: 0.3, decay: 0.12 });
}

/** A boss's strike lands: a heavy crash (a low thump under a burst of noise) and a ring of glassy chips. */
function strikeImpact(v: Voice, t: number, p: number): void {
  tone(v, { type: 'sine', freq: 130 * p, to: 40 * p, glide: 0.3, at: t, attack: 0.003, peak: 0.5, decay: 0.4 });
  noise(v, { at: t, attack: 0.003, peak: 0.4, decay: 0.45, filter: 'lowpass', freq: 3000 * p, to: 300 * p, glide: 0.4, q: 0.8 });
  [1760, 2350, 1980].forEach((f, i) => {
    tone(v, { type: 'triangle', freq: f * p, at: t + 0.05 + i * 0.05, attack: 0.002, peak: 0.08, decay: 0.12 });
  });
}

export const SFX: Record<SfxName, Recipe> = {
  place, spawnZombie, pea, brainThrow, hit, chomp, block, explode, merge, sun, bounty, baseHit,
  click, deny, suddenDeath, win: sting('win'), lose: sting('lose'), collapse, baseStrike,
  kernel, butter, mango, sand, arrow, bullet, trident, rot, stun, blind, lasso, poison, burn, heal, raise,
  mineArm, mineBoom, fuse, cherryBoom, squash, grow, miss, heroReady, megaMower, boneStorm, spellReady,
  thunderbolt, vines, sunShower, healingRain, rockWall, meteor, fog, brainFeast, frenzy, graveRise,
  titanRoar, titanDefeat, oakCreak, oakDefeat, strikeWindup, strikeImpact,
};

export const SFX_NAMES = Object.keys(SFX) as SfxName[];
