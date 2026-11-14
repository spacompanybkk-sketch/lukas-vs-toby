import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { BAR_SECONDS, LOOP_BARS, THEME_KEYS, barNotes, instrumentFor, scheduleBar, topLayer } from '../../src/audio/music';
import type { NoteEvent, Theme } from '../../src/audio/music';
import { WORLDS, WORLD_ORDER } from '../../src/data/worlds';
import { FakeAudioContext, FakeGain, FakeNode } from './fakeAudioContext';
import type { FakeParam, FakeSource } from './fakeAudioContext';

// Worlds machinery, Task 6: one theme per world beside the menu's, all at 112 bpm with the same
// three layers. The menu and the Backyard must play exactly as they did before.

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Every note of the loop, bar by bar from 0 s. */
function loop(theme: Theme): NoteEvent[] {
  const all: NoteEvent[] = [];
  for (let bar = 0; bar < LOOP_BARS; bar++) all.push(...scheduleBar(theme, bar, bar * BAR_SECONDS));
  return all;
}

const WORLD_THEMES = WORLD_ORDER.map((w) => WORLDS[w].theme);
const NEW_THEMES = ['meadow', 'desert', 'tundra', 'citadel'] as const;

describe('the themes as notes', () => {
  it('there is one per world, plus the menu\'s', () => {
    expect([...THEME_KEYS].sort()).toEqual(['menu', ...WORLD_THEMES].sort());
  });

  // Pinned from the notes before this task (the loop, and the loop shaped at four intensities).
  it.each([
    ['menu', 196, 4284035368, 496, 755693153],
    ['backyard', 242, 3332773396, 491, 2437101403],
  ] as const)('%s plays exactly the notes it played before', (theme, count, hash, shapedCount, shapedHash) => {
    const all = loop(theme);
    const shaped: NoteEvent[] = [];
    for (const i of [0, 0.2, 0.5, 0.9]) for (let bar = 0; bar < LOOP_BARS; bar++) shaped.push(...barNotes(theme, bar, bar * BAR_SECONDS, i));
    expect([all.length, fnv(JSON.stringify(all)), shaped.length, fnv(JSON.stringify(shaped))]).toEqual([count, hash, shapedCount, shapedHash]);
  });

  it.each(NEW_THEMES)('%s has the three layers: bass and pad always, the tune from 0.35, drums and a counter line from 0.7', (theme) => {
    const all = loop(theme);
    const inst = new Set(all.map(instrumentFor));
    for (const i of ['bass', 'pad', 'lead', 'counter', 'kick', 'hat'] as const) expect(inst, i).toContain(i);
    for (let bar = 0; bar < LOOP_BARS; bar++) {
      const layers = new Set(scheduleBar(theme, bar, 0).map((n) => n.layer));
      expect([...layers].sort(), `bar ${bar}`).toEqual([0, 1, 2]);
    }
    expect(topLayer(theme, 0)).toBe(0);
    expect(topLayer(theme, 0.5)).toBe(1);
    expect(topLayer(theme, 0.9)).toBe(2);
    expect(new Set(barNotes(theme, 0, 0, 0).map((n) => n.layer))).toEqual(new Set([0]));
  });

  it.each(NEW_THEMES)('%s keeps every note inside its bar of 4 beats at 112 bpm, and never sounds harsh', (theme) => {
    for (let bar = 0; bar < LOOP_BARS; bar++) {
      for (const n of scheduleBar(theme, bar, 10)) {
        expect(n.time).toBeGreaterThanOrEqual(10);
        expect(n.time).toBeLessThan(10 + BAR_SECONDS - 1e-9);
        expect(n.time + n.length).toBeLessThanOrEqual(10 + BAR_SECONDS + 1e-9);
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(0.9);
      }
    }
  });

  // Each in its own key and scale (pitch classes of every pitched note; drums aside).
  const SCALES: Record<(typeof NEW_THEMES)[number], string[]> = {
    meadow: ['E', 'F#', 'G', 'A', 'B', 'C', 'D', 'D#'], // E minor, its raised leading note in the V7
    desert: ['E', 'F', 'G', 'A', 'B', 'C', 'D'], // E Phrygian
    tundra: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'], // A major
    citadel: ['D', 'E', 'F', 'G', 'A', 'Bb', 'C', 'C#'], // D minor, its raised leading note in the V
  };
  const PC: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, Bb: 10, B: 11 };
  it.each(NEW_THEMES)('%s stays in its own scale', (theme) => {
    const allowed = new Set(SCALES[theme].map((n) => PC[n]));
    const pitched = loop(theme).filter((n) => !['kick', 'snare', 'hat', 'openHat', 'tom'].includes(instrumentFor(n)));
    const outside = pitched.filter((n) => !allowed.has(n.midi % 12));
    expect(outside.map((n) => n.midi)).toEqual([]);
  });

  it('the desert sounds Phrygian: its tune leans on F over E', () => {
    const tune = loop('desert').filter((n) => n.layer === 1);
    expect(tune.filter((n) => n.midi % 12 === 5).length).toBeGreaterThanOrEqual(8);
  });

  it('the tundra is sparse and high, the citadel low and driving', () => {
    const lead = (t: Theme) => loop(t).filter((n) => n.layer === 1);
    const mean = (ns: NoteEvent[]) => ns.reduce((a, n) => a + n.midi, 0) / ns.length;
    expect(lead('tundra').length).toBeLessThan(lead('backyard').length * 0.6);
    expect(mean(lead('tundra'))).toBeGreaterThan(mean(lead('citadel')) + 7);
    const bass = (t: Theme) => loop(t).filter((n) => instrumentFor(n) === 'bass');
    expect(bass('citadel').length).toBe(LOOP_BARS * 8); // eighth notes all the way
    expect(loop('citadel').filter((n) => instrumentFor(n) === 'kick').length).toBeGreaterThanOrEqual(LOOP_BARS * 4);
  });

  it('every theme is its own tune', () => {
    const tunes = THEME_KEYS.map((t) => JSON.stringify(loop(t).filter((n) => n.layer === 1).map((n) => n.midi)));
    expect(new Set(tunes).size).toBe(THEME_KEYS.length);
  });
});

// ---- Through the engine, in the offline context --------------------------------------------

function run(fake: FakeAudioContext, seconds: number, stepMs = 100): void {
  for (let t = 0; t < seconds * 1000 - 1e-6; t += stepMs) {
    fake.advance(stepMs / 1000);
    vi.advanceTimersByTime(stepMs);
  }
}

async function setup(): Promise<{ engine: AudioEngine; fake: FakeAudioContext }> {
  const fake = new FakeAudioContext();
  const engine = new AudioEngine(() => fake as unknown as AudioContext);
  await engine.unlock();
  fake.advance(0.5);
  return { engine, fake };
}

/** Whether `from` feeds `to`, through any chain of connections. */
function feeds(from: FakeNode, to: FakeNode): boolean {
  const seen = new Set<FakeNode | FakeParam>();
  const stack: (FakeNode | FakeParam)[] = [from];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n) || !(n instanceof FakeNode)) continue;
    seen.add(n);
    stack.push(...n.connections);
  }
  return false;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the world themes in the engine', () => {
  it.each(THEME_KEYS)('%s plays 32 bars at full intensity without a problem, every layer heard', async (theme) => {
    const errors = vi.spyOn(console, 'error');
    const { engine, fake } = await setup();
    engine.setIntensity(1);
    engine.startMusic(theme);
    run(fake, 32 * BAR_SECONDS);
    const sources = fake.sources();
    expect(sources.length).toBeGreaterThan(32 * 8);
    expect(sources.some((s) => s.kind === 'oscillator')).toBe(true);
    expect(sources.some((s) => s.kind === 'bufferSource')).toBe(true); // the drums' noise: layer 2
    engine.stopMusic(0.1);
    run(fake, 1);
    expect(fake.allProblems()).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('switching to another world\'s theme stops the old one: it fades, is cut loose, and plays no new note', async () => {
    const { engine, fake } = await setup();
    const start = fake.nodes.length;
    engine.startMusic('meadow');
    const oldGroup = fake.nodes.slice(start).find((n): n is FakeGain => n instanceof FakeGain)!;
    run(fake, 3);
    const made: FakeSource[] = [];
    const count = fake.sources().length;
    engine.startMusic('citadel');
    run(fake, 3);
    made.push(...fake.sources().slice(count));
    expect(made.length).toBeGreaterThan(0);
    expect(made.filter((s) => feeds(s, oldGroup))).toEqual([]);
    expect(oldGroup.disconnected).toBe(true);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2); // the new theme's scheduler (and at most one voice timer)
    expect(fake.allProblems()).toEqual([]);
    engine.stopMusic(0.1);
  });

  it('the same theme asked again carries on (no restart)', async () => {
    const { engine, fake } = await setup();
    engine.startMusic('tundra');
    run(fake, 2);
    const gains = fake.nodes.filter((n) => n instanceof FakeGain).length;
    engine.startMusic('tundra');
    const after = fake.nodes.filter((n) => n instanceof FakeGain).length;
    expect(after).toBe(gains);
    engine.stopMusic(0.1);
  });
});
