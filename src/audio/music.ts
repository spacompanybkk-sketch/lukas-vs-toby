/**
 * The music as notes: two eight-bar themes and two stings, written in a small text notation and
 * turned into timed `NoteEvent`s. Pure: no audio here, nothing random, so it can be tested and
 * read on its own. The engine turns the events into sound (instruments.ts).
 *
 * 112 bpm, 4/4. `backyard` is in C major, `menu` in A minor. Three layers:
 * - 0: bass and pad, always playing;
 * - 1: the melody, from intensity 0.35;
 * - 2: drums and a counter line, from intensity 0.7.
 *
 * Within a layer the instrument follows from the note (see `instrumentFor`): in layer 0, MIDI
 * notes below 48 are bass and the rest pad; in layer 2, notes below 48 are drums (36 kick,
 * 38 snare, 41/43/45 toms, 42 closed hat, 46 open hat) and the rest the counter line.
 */

export type Theme = 'menu' | 'backyard';
export type Layer = 0 | 1 | 2;
export interface NoteEvent { time: number; layer: Layer; midi: number; length: number; velocity: number }
export type Instrument = 'bass' | 'pad' | 'lead' | 'counter' | 'kick' | 'snare' | 'hat' | 'openHat' | 'tom';

export const BPM = 112;
export const BEAT_SECONDS = 60 / BPM;
export const BAR_SECONDS = 4 * BEAT_SECONDS;
export const LOOP_BARS = 8;
/** The intensity from which each layer plays. */
export const LAYER_THRESHOLDS: readonly [number, number, number] = [0, 0.35, 0.7];
/** `setIntensity` moves the music's intensity to the new value over this many seconds. */
export const INTENSITY_EASE_SECONDS = 2;
/** The intensity a theme never drops below: the menu always has its tune. */
const THEME_FLOOR: Record<Theme, number> = { menu: 0.5, backyard: 0 };

/** A note within its bar, in beats. */
interface Note { layer: Layer; midi: number; beat: number; beats: number; velocity: number }

// ---------------------------------------------------------------------------------------------
// Notation

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' → 60, 'F#2' → 42, 'Bb3' → 58. */
export function midiOf(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (m === null) throw new Error(`bad note name ${name}`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + (STEP[m[1]!] ?? 0) + accidental;
}

/**
 * Notes one after another: `'C5:0.5 E5:0.5 r:1'` is C5 for half a beat, E5 for half a beat, then a
 * one-beat rest. `|` marks bar lines and is ignored. Each note sounds for `gate` of its step.
 */
function line(layer: Layer, velocity: number, text: string, gate: number): Note[] {
  const notes: Note[] = [];
  let beat = 0;
  for (const token of text.split(/\s+/)) {
    if (token === '' || token === '|') continue;
    const [name, length] = token.split(':');
    const beats = Number(length);
    if (name === undefined || !(beats > 0)) throw new Error(`bad token ${token}`);
    if (name !== 'r') notes.push({ layer, midi: midiOf(name), beat, beats: beats * gate, velocity });
    beat += beats;
  }
  return notes;
}

/** The same chord struck on each of `beats`. */
function chord(velocity: number, names: string, beats: readonly number[], length: number): Note[] {
  return beats.flatMap((beat) => names.split(' ').map((n) => ({ layer: 0 as const, midi: midiOf(n), beat, beats: length, velocity })));
}

/** Drum hits in layer 2. */
function hits(midi: number, beats: readonly number[], velocity: number, length = 0.25): Note[] {
  return beats.map((beat) => ({ layer: 2 as const, midi, beat, beats: length, velocity }));
}

const KICK = 36;
const SNARE = 38;
const TOM_LOW = 41;
const HAT = 42;
const TOM_MID = 43;
const TOM_HIGH = 45;
const OPEN_HAT = 46;
const EIGHTHS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] as const;

// ---------------------------------------------------------------------------------------------
// Backyard: C major, a bouncy "oom-pah" (bass on 1 and 3, chord on 2 and 4), I–vi–IV–V twice.

const BACKYARD_CHORDS = {
  C: 'C4 E4 G4', Am: 'C4 E4 A4', F: 'C4 F4 A4', G: 'B3 D4 G4', G7: 'B3 D4 F4',
} as const;
const BACKYARD_PROGRESSION = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G7'] as const;

const BACKYARD_BASS = [
  'C2:1 r:1 G2:1 r:1',
  'A1:1 r:1 E2:1 r:1',
  'F2:1 r:1 C2:1 r:1',
  'G2:1 r:1 D2:1 r:0.5 B1:0.5',
  'C2:1 r:1 G2:1 r:1',
  'A2:1 r:1 E2:1 r:1',
  'F2:1 r:1 C2:1 r:0.5 F#2:0.5',
  'G2:1 r:1 D2:0.5 E2:0.5 F2:0.5 B1:0.5',
] as const;

const BACKYARD_TUNE = [
  'C5:0.5 E5:0.5 G5:1 E5:0.5 C5:0.5 G4:1',
  'A4:0.5 C5:0.5 E5:1 D5:0.5 C5:0.5 A4:1',
  'F4:0.5 A4:0.5 C5:1 F5:1 E5:0.5 D5:0.5',
  'D5:1.5 B4:0.5 G4:1 r:1',
  'C5:0.5 E5:0.5 G5:1 C6:1 G5:0.5 E5:0.5',
  'A5:1 G5:0.5 E5:0.5 C5:1 E5:1',
  'F5:1 E5:0.5 D5:0.5 C5:1 A4:1',
  'B4:0.5 C5:0.5 D5:1 G4:1 B4:1',
] as const;

/** Off-beat glockenspiel arpeggios above the tune. */
const BACKYARD_COUNTER = [
  'r:0.5 G5:0.5 r:0.5 C6:0.5 r:0.5 E6:0.5 r:0.5 C6:0.5',
  'r:0.5 A5:0.5 r:0.5 C6:0.5 r:0.5 E6:0.5 r:0.5 C6:0.5',
  'r:0.5 A5:0.5 r:0.5 C6:0.5 r:0.5 F6:0.5 r:0.5 C6:0.5',
  'r:0.5 G5:0.5 r:0.5 B5:0.5 r:0.5 D6:0.5 r:0.5 B5:0.5',
  'r:0.5 G5:0.5 r:0.5 C6:0.5 r:0.5 E6:0.5 r:0.5 G6:0.5',
  'r:0.5 A5:0.5 r:0.5 C6:0.5 r:0.5 E6:0.5 r:0.5 A6:0.5',
  'r:0.5 A5:0.5 r:0.5 C6:0.5 r:0.5 F6:0.5 r:0.5 C6:0.5',
  'r:0.5 G5:0.5 r:0.5 B5:0.5 r:0.5 D6:0.5 F6:0.5 D6:0.5',
] as const;

function backyardDrums(bar: number): Note[] {
  if (bar === 7) {
    // turnaround fill into the loop
    return [
      ...hits(KICK, [0, 2], 0.9), ...hits(SNARE, [1], 0.7),
      ...hits(HAT, [0, 0.5, 1, 1.5, 2, 2.5], 0.35),
      ...hits(TOM_HIGH, [3], 0.7), ...hits(TOM_MID, [3.25], 0.7), ...hits(TOM_LOW, [3.5], 0.75), ...hits(SNARE, [3.75], 0.6),
    ];
  }
  return [
    ...hits(KICK, bar === 3 ? [0, 2, 2.5] : [0, 2], 0.9),
    ...hits(SNARE, [1, 3], 0.7),
    ...EIGHTHS.filter((b) => !(bar === 0 && b === 3.5)).flatMap((b) => hits(HAT, [b], b % 1 === 0 ? 0.45 : 0.28)),
    ...(bar === 0 ? hits(OPEN_HAT, [3.5], 0.35, 0.5) : []),
  ];
}

const BACKYARD: readonly (readonly Note[])[] = BACKYARD_PROGRESSION.map((name, i) => [
  ...line(0, 0.85, BACKYARD_BASS[i]!, 0.8),
  ...chord(0.6, BACKYARD_CHORDS[name], [1, 3], 0.45),
  ...line(1, 0.8, BACKYARD_TUNE[i]!, 0.92),
  ...line(2, 0.5, BACKYARD_COUNTER[i]!, 0.8),
  ...backyardDrums(i),
]);

// ---------------------------------------------------------------------------------------------
// Menu: A minor, a tiptoeing comic-spooky tune over a soft held pad, i–VI–VII–V, i–VI–iv–V.

const MENU_CHORDS = {
  Am: 'A3 C4 E4', F: 'A3 C4 F4', G: 'B3 D4 G4', E: 'G#3 B3 E4', Dm: 'A3 D4 F4',
} as const;
const MENU_PROGRESSION = ['Am', 'F', 'G', 'E', 'Am', 'F', 'Dm', 'E'] as const;

const MENU_BASS = [
  'A2:1 E2:1 A2:1 E2:1',
  'F2:1 C2:1 F2:1 C2:1',
  'G2:1 D2:1 G2:1 D2:1',
  'E2:1 B1:1 E2:1 G#2:1',
  'A2:1 E2:1 A2:1 E2:1',
  'F2:1 C2:1 F2:1 A2:1',
  'D2:1 A1:1 D2:1 F2:1',
  'E2:1 B1:1 E2:1 G#2:1',
] as const;

const MENU_TUNE = [
  'A4:0.5 C5:0.5 E5:0.5 C5:0.5 A5:1 G5:0.5 E5:0.5',
  'F5:1 E5:0.5 C5:0.5 A4:1.5 r:0.5',
  'G4:0.5 B4:0.5 D5:0.5 B4:0.5 G5:1 F5:0.5 D5:0.5',
  'E5:1 G#4:0.5 B4:0.5 E5:1.5 r:0.5',
  'A4:0.5 C5:0.5 E5:0.5 C5:0.5 A5:1 B5:0.5 C6:0.5',
  'A5:1 G5:0.5 F5:0.5 E5:1 C5:1',
  'D5:0.5 F5:0.5 A5:1 G5:0.5 F5:0.5 E5:0.5 D5:0.5',
  'B4:1 G#4:1 E4:1 r:1',
] as const;

const MENU_COUNTER = [
  'r:0.5 E5:0.5 r:0.5 A5:0.5 r:0.5 C6:0.5 r:0.5 A5:0.5',
  'r:0.5 F5:0.5 r:0.5 A5:0.5 r:0.5 C6:0.5 r:0.5 A5:0.5',
  'r:0.5 G5:0.5 r:0.5 B5:0.5 r:0.5 D6:0.5 r:0.5 B5:0.5',
  'r:0.5 G#5:0.5 r:0.5 B5:0.5 r:0.5 E6:0.5 r:0.5 B5:0.5',
  'r:0.5 E5:0.5 r:0.5 A5:0.5 r:0.5 C6:0.5 r:0.5 E6:0.5',
  'r:0.5 F5:0.5 r:0.5 A5:0.5 r:0.5 C6:0.5 r:0.5 A5:0.5',
  'r:0.5 F5:0.5 r:0.5 A5:0.5 r:0.5 D6:0.5 r:0.5 A5:0.5',
  'r:0.5 G#5:0.5 r:0.5 B5:0.5 r:0.5 E6:0.5 r:0.5 D6:0.5',
] as const;

function menuDrums(): Note[] {
  return [...hits(KICK, [0, 2.5], 0.6), ...hits(SNARE, [1, 3], 0.4), ...hits(HAT, [0.5, 1.5, 2.5, 3.5], 0.3)];
}

const MENU: readonly (readonly Note[])[] = MENU_PROGRESSION.map((name, i) => [
  ...line(0, 0.8, MENU_BASS[i]!, 0.4),
  ...chord(0.5, MENU_CHORDS[name], [0], 3.8),
  ...line(1, 0.75, MENU_TUNE[i]!, 0.85),
  ...line(2, 0.4, MENU_COUNTER[i]!, 0.8),
  ...menuDrums(),
]);

const THEMES: Record<Theme, readonly (readonly Note[])[]> = { menu: MENU, backyard: BACKYARD };

// ---------------------------------------------------------------------------------------------
// Stings: four bars of 2/4 at the same 112 bpm (4.3 s), played as one effect each.

const WIN: readonly Note[] = [
  // a rising fanfare that lands on the tonic: C | C | F G | C
  ...line(1, 0.9, 'G4:0.5 C5:0.5 E5:0.5 G5:0.5 | C6:1 G5:0.5 C6:0.5 | A5:0.5 C6:0.5 B5:0.5 D6:0.5 | C6:2', 0.9),
  ...line(0, 0.85, 'C2:1 G2:1 | C2:1 G2:1 | F2:1 G2:1 | C2:2', 0.8),
  ...chord(0.55, 'C4 E4 G4', [0.5, 1.5, 2.5, 3.5], 0.3),
  ...chord(0.55, 'C4 F4 A4', [4.5], 0.3),
  ...chord(0.55, 'B3 D4 G4', [5.5], 0.3),
  ...chord(0.6, 'C4 E4 G4 C5', [6], 1.9),
  ...hits(KICK, [0, 2, 4, 6], 0.85),
  ...hits(SNARE, [1, 3, 5, 5.25, 5.5, 5.75], 0.6),
  ...hits(OPEN_HAT, [6], 0.6, 1),
  ...line(2, 0.6, 'r:6 C6:0.25 E6:0.25 G6:0.25 C7:1', 1),
];

const LOSE: readonly Note[] = [
  // a sad trombone, "wah wah wah waaah", that settles gently on A minor
  ...line(1, 0.8, 'G4:1 F#4:1 | F4:1 E4:3 | r:2', 0.85),
  ...line(0, 0.7, 'G2:1 F#2:1 | F2:1 E2:3 | A1:1 r:1', 0.85),
  ...chord(0.4, 'A3 C4 E4', [6], 1.8),
  ...hits(KICK, [6], 0.7),
  ...hits(TOM_LOW, [6], 0.5),
];

// ---------------------------------------------------------------------------------------------

function toEvents(notes: readonly Note[], start: number): NoteEvent[] {
  return notes
    .map((n) => ({ time: start + n.beat * BEAT_SECONDS, layer: n.layer, midi: n.midi, length: n.beats * BEAT_SECONDS, velocity: n.velocity }))
    .sort((a, b) => a.time - b.time || a.layer - b.layer || a.midi - b.midi);
}

/**
 * Every note of bar `barIndex` of the eight-bar loop (any whole number; it wraps), starting at
 * `barStart` seconds, in time order. Always the same for the same arguments.
 */
export function scheduleBar(theme: Theme, barIndex: number, barStart: number): NoteEvent[] {
  const bars = THEMES[theme];
  const i = ((Math.trunc(barIndex) % LOOP_BARS) + LOOP_BARS) % LOOP_BARS;
  return toEvents(bars[i] ?? [], barStart);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** How loud a layer plays at this intensity: it comes in a little softer and grows. */
function layerLevel(layer: Layer, intensity: number): number {
  const from = LAYER_THRESHOLDS[layer];
  const span = layer === 0 ? 1 : layer === 1 ? 0.35 : 0.3;
  return 0.8 + 0.2 * clamp01((intensity - from) / span);
}

/** The notes of a bar that play at this intensity, their velocities shaped by it. */
export function barNotes(theme: Theme, barIndex: number, barStart: number, intensity: number): NoteEvent[] {
  const level = Math.max(THEME_FLOOR[theme], Number.isFinite(intensity) ? clamp01(intensity) : 0);
  return scheduleBar(theme, barIndex, barStart)
    .filter((n) => level >= LAYER_THRESHOLDS[n.layer])
    .map((n) => ({ ...n, velocity: n.velocity * layerLevel(n.layer, level) }));
}

/** The intensity `elapsed` seconds after it was asked to move from `from` to `to`. */
export function easeIntensity(from: number, to: number, elapsed: number): number {
  const t = clamp01(elapsed / INTENSITY_EASE_SECONDS);
  return from + (to - from) * t;
}

/** The win or lose sting, starting at `start`. */
export function stingNotes(kind: 'win' | 'lose', start: number): NoteEvent[] {
  return toEvents(kind === 'win' ? WIN : LOSE, start);
}

/** Which instrument plays a note (see the header for the rule). */
export function instrumentFor(e: NoteEvent): Instrument {
  if (e.layer === 1) return 'lead';
  if (e.layer === 0) return e.midi < 48 ? 'bass' : 'pad';
  if (e.midi >= 48) return 'counter';
  switch (e.midi) {
    case KICK: return 'kick';
    case SNARE: return 'snare';
    case OPEN_HAT: return 'openHat';
    case TOM_LOW: case TOM_MID: case TOM_HIGH: return 'tom';
    default: return 'hat';
  }
}
