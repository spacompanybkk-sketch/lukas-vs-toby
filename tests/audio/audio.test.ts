import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import type { SfxName } from '../../src/audio/AudioEngine';
import { battleIntensity, panFor, playEventSounds } from '../../src/audio/bindings';
import {
  BAR_SECONDS, LAYER_OFF_THRESHOLDS, LAYER_THRESHOLDS, barNotes, easeIntensity, instrumentFor, scheduleBar,
  stingNotes, topLayer,
} from '../../src/audio/music';
import type { NoteEvent } from '../../src/audio/music';
import { SFX_NAMES } from '../../src/audio/sfx';
import { BALANCE } from '../../src/data/balance';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { Command, SimEvent } from '../../src/sim/types';
import { FakeAudioContext, FakeOscillator } from './fakeAudioContext';
import type { FakeOptions } from './fakeAudioContext';

function engineWith(opts: FakeOptions = {}): { engine: AudioEngine; fake: FakeAudioContext; made: () => number } {
  const fake = new FakeAudioContext(opts);
  let count = 0;
  const engine = new AudioEngine(() => {
    count += 1;
    return fake as unknown as AudioContext;
  });
  return { engine, fake, made: () => count };
}

async function unlockedEngine(): Promise<{ engine: AudioEngine; fake: FakeAudioContext }> {
  const { engine, fake } = engineWith();
  await engine.unlock();
  return { engine, fake };
}

/** Events with times taken relative to `shift`, rounded so float noise does not matter. */
function rebased(events: NoteEvent[], shift: number): NoteEvent[] {
  const r = (n: number): number => Math.round(n * 1e9) / 1e9;
  return events.map((e) => ({ ...e, time: r(e.time - shift), length: r(e.length) }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AudioEngine before unlock', () => {
  it('play creates nothing and does not throw', () => {
    const { engine, fake, made } = engineWith();
    expect(() => engine.play('pea')).not.toThrow();
    expect(() => engine.startMusic('backyard')).not.toThrow();
    expect(() => engine.setVolume('music', 0.3)).not.toThrow();
    expect(() => engine.setMuted(true)).not.toThrow();
    expect(() => engine.setIntensity(0.8)).not.toThrow();
    expect(() => engine.stopMusic()).not.toThrow();
    expect(engine.unlocked).toBe(false);
    expect(made()).toBe(0);
    expect(fake.nodes).toHaveLength(0);
  });

  it('stays silent and does not throw when there is no Web Audio at all', async () => {
    const engine = new AudioEngine(() => {
      throw new Error('web-audio-unavailable');
    });
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.unlocked).toBe(false);
    expect(() => engine.play('explode')).not.toThrow();
  });

  it('the default context factory finds nothing in node and stays silent', async () => {
    const engine = new AudioEngine();
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.unlocked).toBe(false);
  });

  it('falls back to webkitAudioContext when AudioContext is missing', async () => {
    const fake = new FakeAudioContext();
    const Ctor = vi.fn(function WebkitAudioContext() {
      return fake;
    });
    vi.stubGlobal('webkitAudioContext', Ctor);
    try {
      const engine = new AudioEngine();
      await engine.unlock();
      expect(Ctor).toHaveBeenCalledTimes(1);
      expect(engine.unlocked).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('AudioEngine.unlock', () => {
  it('resumes a suspended context and unlocks', async () => {
    const { engine, fake } = engineWith({ state: 'suspended' });
    await engine.unlock();
    expect(fake.resumeCalls).toBe(1);
    expect(engine.unlocked).toBe(true);
  });

  it('is safe to call many times, at once and later, and makes one context', async () => {
    const { engine, made } = engineWith();
    await Promise.all([engine.unlock(), engine.unlock(), engine.unlock()]);
    await engine.unlock();
    expect(made()).toBe(1);
    expect(engine.unlocked).toBe(true);
  });

  it('does not throw when the browser refuses, and a later gesture succeeds', async () => {
    const { engine, fake } = engineWith({ resume: 'reject' });
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.unlocked).toBe(false);
    engine.play('pea');
    expect(fake.sources().filter((s) => s.kind === 'oscillator')).toHaveLength(0);

    fake.resumeMode = 'run';
    await engine.unlock();
    expect(engine.unlocked).toBe(true);
  });

  it('stays locked when resume resolves but the context is still suspended', async () => {
    const { engine } = engineWith({ resume: 'ignore' });
    await engine.unlock();
    expect(engine.unlocked).toBe(false);
  });

  it('does not hang when resume() never settles, and a later gesture retries', async () => {
    const { engine, fake } = engineWith({ resume: 'hang' });
    const began = Date.now();
    await engine.unlock();
    expect(Date.now() - began).toBeLessThan(2000);
    expect(engine.unlocked).toBe(false);

    fake.resumeMode = 'run';
    await engine.unlock();
    expect(fake.resumeCalls).toBe(2);
    expect(engine.unlocked).toBe(true);
  });

  it('makes a fresh context on the next unlock when the old one was closed', async () => {
    vi.useFakeTimers();
    const fakes = [new FakeAudioContext(), new FakeAudioContext()];
    let made = 0;
    const engine = new AudioEngine(() => fakes[made++] as unknown as AudioContext);
    await engine.unlock();
    engine.startMusic('menu');
    fakes[0]!.state = 'closed';
    engine.play('pea');
    await engine.unlock();
    expect(made).toBe(2);
    expect(engine.unlocked).toBe(true);
    const fresh = fakes[1]!;
    expect(fresh.sources().some((s) => s.kind === 'oscillator')).toBe(true); // the menu music came back
    fresh.advance(0.1);
    const before = fresh.sources().length;
    engine.play('pea');
    expect(fresh.sources().length).toBeGreaterThan(before);
    engine.stopMusic(0.1);
  });

  it('sets the iPad audio session to playback so the silent switch does not mute the game', async () => {
    const session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });
    try {
      const { engine } = engineWith();
      await engine.unlock();
      expect(session.type).toBe('playback');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never throws when the audio session refuses, or there is no navigator', async () => {
    const session = {};
    Object.defineProperty(session, 'type', { get: () => 'auto', set: () => { throw new Error('nope'); } });
    vi.stubGlobal('navigator', { audioSession: session });
    try {
      const { engine } = engineWith();
      await expect(engine.unlock()).resolves.toBeUndefined();
      expect(engine.unlocked).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('navigator', undefined);
    try {
      const { engine } = engineWith();
      await engine.unlock();
      expect(engine.unlocked).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('starts a silent buffer inside the gesture (iPad Safari) and cleans it up', async () => {
    const { engine, fake } = engineWith();
    await engine.unlock();
    const kick = fake.sources().filter((s) => s.kind === 'bufferSource');
    expect(kick.length).toBeGreaterThanOrEqual(1);
    fake.advance(1);
    for (const s of kick) {
      expect(s.ended).toBe(true);
      expect(s.disconnected).toBe(true);
    }
  });

  it('is silent while Safari has the context interrupted and resumes on the next gesture', async () => {
    const { engine, fake } = await unlockedEngine();
    fake.state = 'interrupted';
    const before = fake.sources().length;
    engine.play('pea');
    expect(fake.sources().length).toBe(before);

    await engine.unlock();
    expect(fake.state).toBe('running');
    engine.play('pea');
    expect(fake.sources().length).toBeGreaterThan(before);
  });

  it('starts music that was asked for before the unlock', async () => {
    vi.useFakeTimers();
    const { engine, fake } = engineWith();
    engine.startMusic('menu');
    expect(fake.nodes).toHaveLength(0);
    await engine.unlock();
    expect(fake.sources().some((s) => s.kind === 'oscillator')).toBe(true);
    engine.stopMusic(0.1);
  });
});

describe('AudioEngine.play', () => {
  it('one pea after unlock creates at least one source', async () => {
    const { engine, fake } = await unlockedEngine();
    const before = fake.sources().length;
    engine.play('pea');
    expect(fake.sources().length).toBeGreaterThan(before);
  });

  it('plays the same effect at most once per 40 ms', async () => {
    const { engine, fake } = await unlockedEngine();
    const base = fake.sources().length;
    engine.play('pea');
    const one = fake.sources().length - base;
    for (let i = 0; i < 9; i++) engine.play('pea');
    expect(fake.sources().length - base).toBe(one);

    fake.advance(0.039);
    engine.play('pea');
    expect(fake.sources().length - base).toBe(one);

    fake.advance(0.002);
    engine.play('pea');
    expect(fake.sources().length - base).toBe(2 * one);
  });

  it('does not let one effect block another', async () => {
    const { engine, fake } = await unlockedEngine();
    engine.play('pea');
    const n = fake.sources().length;
    engine.play('hit');
    expect(fake.sources().length).toBeGreaterThan(n);
  });

  it('keeps at most 24 voices, stealing the oldest', async () => {
    const { engine, fake } = await unlockedEngine();
    const firstSources: number[] = [];
    for (let i = 0; i < 30; i++) {
      const before = fake.sources().length;
      engine.play('collapse');
      if (i === 0) for (let k = before; k < fake.sources().length; k++) firstSources.push(k);
      expect(engine.voiceCount).toBeLessThanOrEqual(24);
      fake.advance(0.05);
    }
    expect(engine.voiceCount).toBe(24);
    // the very first collapse was stolen: all its sources stop long before its natural end
    const stolenAt = 24 * 0.05;
    for (const k of firstSources) {
      expect(fake.sources()[k]!.stopTime!).toBeLessThan(stolenAt + 0.1);
    }
  });

  it('drops an unimportant effect rather than cut an important one when full', async () => {
    const { engine, fake } = await unlockedEngine();
    for (let i = 0; i < 24; i++) {
      engine.play('collapse');
      fake.advance(0.05);
    }
    const before = fake.sources().length;
    engine.play('pea');
    expect(fake.sources().length).toBe(before);
    expect(engine.voiceCount).toBe(24);
  });

  it('varies pitch by up to 6% unless a pitch is given', async () => {
    const { engine, fake } = await unlockedEngine();
    const firstFrequency = (from: number): number => {
      const osc = fake.nodes.slice(from).find((n): n is FakeOscillator => n instanceof FakeOscillator)!;
      return osc.frequency.events[0]!.value;
    };
    let from = fake.nodes.length;
    engine.play('click', { pitch: 1 });
    const plain = firstFrequency(from);

    vi.spyOn(Math, 'random').mockReturnValue(0);
    fake.advance(0.1);
    from = fake.nodes.length;
    engine.play('click');
    expect(firstFrequency(from)).toBeCloseTo(plain * 0.94, 6);

    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    fake.advance(0.1);
    from = fake.nodes.length;
    engine.play('click');
    expect(firstFrequency(from)).toBeCloseTo(plain * 1.06, 3);

    fake.advance(0.1);
    from = fake.nodes.length;
    engine.play('click', { pitch: 2 });
    expect(firstFrequency(from)).toBeCloseTo(plain * 2, 6);
  });

  it('keeps win, lose and suddenDeath at their written pitch unless one is given', async () => {
    const { engine, fake } = await unlockedEngine();
    const firstFrequency = (from: number): number => {
      const osc = fake.nodes.slice(from).find((n): n is FakeOscillator => n instanceof FakeOscillator)!;
      return osc.frequency.events[0]!.value;
    };
    for (const name of ['win', 'lose', 'suddenDeath'] as const) {
      fake.advance(0.3);
      let from = fake.nodes.length;
      engine.play(name, { pitch: 1 });
      const written = firstFrequency(from);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      fake.advance(0.3);
      from = fake.nodes.length;
      engine.play(name);
      expect(firstFrequency(from), name).toBeCloseTo(written, 9);
      vi.restoreAllMocks();
    }
  });

  it('a failed effect does not use up its repeat slot', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, fake } = await unlockedEngine();
    const original = fake.createOscillator.bind(fake);
    fake.createOscillator = () => {
      throw new Error('boom');
    };
    engine.play('pea');
    expect(errors).toHaveBeenCalled();
    expect(engine.voiceCount).toBe(0);
    fake.createOscillator = original;
    const before = fake.sources().length;
    engine.play('pea'); // same instant: would be blocked had the failure counted
    expect(fake.sources().length).toBeGreaterThan(before);
  });

  it('pans an effect when asked', async () => {
    const { engine, fake } = await unlockedEngine();
    engine.play('pea', { pan: -0.6 });
    const panner = fake.nodes.find((n) => n.kind === 'panner') as unknown as { pan: { value: number } };
    expect(panner.pan.value).toBeCloseTo(-0.6);
  });

  it('every effect builds without errors, never steps a gain, and cleans up after itself', async () => {
    const errors = vi.spyOn(console, 'error');
    const { engine, fake } = await unlockedEngine();
    fake.advance(1); // let the unlock blip end
    const graphNodes = fake.nodes.length;
    expect(SFX_NAMES).toContain('baseStrike');
    for (const name of SFX_NAMES) {
      const before = fake.sources().length;
      engine.play(name, { pan: 0.3 });
      expect(fake.sources().length, name).toBeGreaterThan(before);
      fake.advance(0.3);
    }
    expect(errors).not.toHaveBeenCalled();
    expect(fake.allProblems()).toEqual([]);

    fake.advance(10);
    const made = fake.nodes.slice(graphNodes);
    for (const s of fake.sources()) {
      expect(s.stopTime, s.kind).not.toBeNull();
      expect(s.ended).toBe(true);
    }
    expect(made.filter((n) => !n.disconnected)).toEqual([]);
    expect(engine.voiceCount).toBe(0);
  });

  it('every gain envelope starts and ends at 0', async () => {
    const { engine, fake } = await unlockedEngine();
    for (const name of SFX_NAMES) {
      engine.play(name);
      fake.advance(0.05);
    }
    const envelopes = fake.params.filter((p) => p.name === 'gain' && p.events.length >= 3);
    expect(envelopes.length).toBeGreaterThan(20);
    for (const p of envelopes) {
      expect(p.events[0]!.value).toBe(0);
      expect(p.finalValue).toBe(0);
    }
  });
});

describe('AudioEngine buses', () => {
  it('has a compressor between the master gain and the speakers', async () => {
    const { fake } = await unlockedEngine();
    const master = fake.masterGain();
    const out = master.connections[0];
    expect(out?.constructor.name).toBe('FakeCompressor');
  });

  it('setMuted(true) sets the master gain to 0, ramped; unmuting brings it back', async () => {
    const { engine, fake } = await unlockedEngine();
    const master = fake.masterGain();
    const level = master.gain.value;
    expect(level).toBeGreaterThan(0);

    engine.setMuted(true);
    expect(master.gain.finalValue).toBe(0);
    fake.advance(0.1);
    expect(master.gain.value).toBe(0);

    engine.setMuted(false);
    expect(master.gain.finalValue).toBe(level);
    expect(fake.allProblems()).toEqual([]);
  });

  it('uses cancelAndHoldAtTime where the browser has it, without jumps', async () => {
    vi.useFakeTimers();
    const { engine, fake } = engineWith({ cancelAndHold: true });
    await engine.unlock();
    engine.startMusic('backyard');
    engine.play('collapse');
    fake.advance(0.01);
    for (let i = 0; i < 30; i++) {
      engine.play('collapse'); // past 24 this steals voices
      fake.advance(0.05);
    }
    engine.setVolume('music', 0.3);
    engine.setMuted(true);
    fake.advance(0.01);
    engine.setMuted(false);
    engine.stopMusic(0.5);
    expect(fake.holdCalls).toBeGreaterThan(3);
    expect(fake.masterGain().gain.finalValue).toBeGreaterThan(0);
    expect(fake.allProblems()).toEqual([]);
  });

  it('remembers mute and volumes set before the unlock', async () => {
    const { engine, fake } = engineWith();
    engine.setMuted(true);
    await engine.unlock();
    expect(fake.masterGain().gain.value).toBe(0);
  });

  it('plays nothing while muted', async () => {
    const { engine, fake } = await unlockedEngine();
    engine.setMuted(true);
    const before = fake.sources().length;
    engine.play('explode');
    expect(fake.sources().length).toBe(before);
  });

  it('ramps bus volumes rather than stepping them', async () => {
    const { engine, fake } = await unlockedEngine();
    engine.setVolume('music', 0.2);
    engine.setVolume('sfx', 1);
    engine.setVolume('sfx', Number.NaN);
    fake.advance(0.01);
    engine.setVolume('sfx', 0);
    expect(fake.allProblems()).toEqual([]);
    const ramped = fake.params.filter((p) => p.name === 'gain' && p.events.some((e) => e.kind === 'linear'));
    expect(ramped.length).toBeGreaterThanOrEqual(2);
  });
});

describe('music', () => {
  it('scheduleBar is deterministic and stays inside its bar', () => {
    const a = scheduleBar('backyard', 3, 10);
    const b = scheduleBar('backyard', 3, 10);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const e of a) {
      expect(e.time).toBeGreaterThanOrEqual(10);
      expect(e.time).toBeLessThan(10 + 2.143);
      expect(e.time + e.length).toBeLessThanOrEqual(10 + BAR_SECONDS + 1e-9);
      expect(e.length).toBeGreaterThan(0);
      expect(e.velocity).toBeGreaterThan(0);
      expect(e.velocity).toBeLessThanOrEqual(1);
    }
  });

  it('has layer 0 in every bar of both themes, and all three layers somewhere', () => {
    for (const theme of ['menu', 'backyard'] as const) {
      const layers = new Set<number>();
      for (let bar = 0; bar < 8; bar++) {
        const events = scheduleBar(theme, bar, 0);
        expect(events.some((e) => e.layer === 0), `${theme} bar ${bar}`).toBe(true);
        for (const e of events) layers.add(e.layer);
      }
      expect([...layers].sort()).toEqual([0, 1, 2]);
    }
  });

  it('loops every eight bars: bar 8 is bar 0 shifted in time', () => {
    for (const theme of ['menu', 'backyard'] as const) {
      const shift = 8 * BAR_SECONDS;
      expect(rebased(scheduleBar(theme, 8, 10 + shift), 10 + shift)).toEqual(rebased(scheduleBar(theme, 0, 10), 10));
      expect(rebased(scheduleBar(theme, 13, 0), 0)).toEqual(rebased(scheduleBar(theme, 5, 0), 0));
    }
  });

  it('the two themes differ', () => {
    expect(scheduleBar('menu', 0, 0)).not.toEqual(scheduleBar('backyard', 0, 0));
  });

  it('every bar of both themes has a tune', () => {
    for (const theme of ['menu', 'backyard'] as const) {
      for (let bar = 0; bar < 8; bar++) {
        const tune = scheduleBar(theme, bar, 0).filter((e) => e.layer === 1);
        expect(tune.length, `${theme} ${bar}`).toBeGreaterThan(0);
      }
    }
  });

  it('gates layer 1 at intensity 0.35 and layer 2 at 0.7', () => {
    const layers = (v: number): number[] => [...new Set(barNotes('backyard', 2, 0, v).map((e) => e.layer))].sort();
    expect(LAYER_THRESHOLDS).toEqual([0, 0.35, 0.7]);
    expect(layers(0)).toEqual([0]);
    expect(layers(0.34)).toEqual([0]);
    expect(layers(0.35)).toEqual([0, 1]);
    expect(layers(0.69)).toEqual([0, 1]);
    expect(layers(0.7)).toEqual([0, 1, 2]);
    expect(layers(1)).toEqual([0, 1, 2]);
  });

  it('turns layers off only below 0.30 and 0.65, so they do not flicker', () => {
    expect(LAYER_OFF_THRESHOLDS).toEqual([0, 0.3, 0.65]);
    expect(topLayer('backyard', 0.33)).toBe(0);
    expect(topLayer('backyard', 0.33, 0)).toBe(0);
    expect(topLayer('backyard', 0.33, 1)).toBe(1);
    expect(topLayer('backyard', 0.3, 1)).toBe(1);
    expect(topLayer('backyard', 0.29, 1)).toBe(0);
    expect(topLayer('backyard', 0.68, 1)).toBe(1);
    expect(topLayer('backyard', 0.68, 2)).toBe(2);
    expect(topLayer('backyard', 0.64, 2)).toBe(1);
    expect(topLayer('backyard', 0.2, 2)).toBe(0);
    const layers = [...new Set(barNotes('backyard', 0, 0, 0.66, 2).map((e) => e.layer))].sort();
    expect(layers).toEqual([0, 1, 2]);
  });

  it('the menu always has its tune', () => {
    const layers = new Set(barNotes('menu', 0, 0, 0).map((e) => e.layer));
    expect(layers.has(1)).toBe(true);
  });

  it('layers grow louder as the intensity rises', () => {
    const loud = (v: number): number => barNotes('backyard', 0, 0, v).filter((e) => e.layer === 0)[0]!.velocity;
    expect(loud(1)).toBeGreaterThan(loud(0));
  });

  it('eases the intensity over 2 seconds', () => {
    expect(easeIntensity(0, 1, 0)).toBe(0);
    expect(easeIntensity(0, 1, 1)).toBeCloseTo(0.5);
    expect(easeIntensity(0, 1, 2)).toBe(1);
    expect(easeIntensity(0.8, 0.2, 5)).toBeCloseTo(0.2, 12);
  });

  it('gives drums, bass, pad, lead and counter line their own instruments', () => {
    const at = (layer: 0 | 1 | 2, midi: number): string => instrumentFor({ time: 0, layer, midi, length: 1, velocity: 1 });
    expect(at(0, 36)).toBe('bass');
    expect(at(0, 60)).toBe('pad');
    expect(at(1, 72)).toBe('lead');
    expect(at(2, 36)).toBe('kick');
    expect(at(2, 38)).toBe('snare');
    expect(at(2, 42)).toBe('hat');
    expect(at(2, 84)).toBe('counter');
  });

  it('the win and lose stings are four bars of 2/4 at 112 bpm', () => {
    for (const kind of ['win', 'lose'] as const) {
      const notes = stingNotes(kind, 5);
      expect(notes.length).toBeGreaterThan(4);
      const last = Math.max(...notes.map((n) => n.time));
      expect(last).toBeLessThan(5 + 2 * BAR_SECONDS);
      expect(notes.every((n) => n.time >= 5)).toBe(true);
    }
  });
});

describe('battleIntensity', () => {
  it('is 0 for an empty, healthy match', () => {
    expect(battleIntensity(new Match(defaultConfig(1)).state)).toBe(0);
  });

  it('is 1 for 24 units and a base at 0', () => {
    const m = new Match(defaultConfig(1));
    for (let i = 0; i < 12; i++) spawnUnit(m.state, BALANCE, 'peashooter', i % 5, (i % 8) + 0.5);
    for (let i = 0; i < 12; i++) spawnUnit(m.state, BALANCE, 'brainEater', i % 5, 9.5);
    m.state.baseHp.zombies = 0;
    expect(battleIntensity(m.state)).toBe(1);
  });

  it('weighs units 0.6 and the lower base 0.4, and never leaves 0..1', () => {
    const m = new Match(defaultConfig(1));
    for (let i = 0; i < 12; i++) spawnUnit(m.state, BALANCE, 'brainEater', i % 5, 9.5);
    m.state.baseHp.plants = m.state.baseMaxHp.plants / 2;
    expect(battleIntensity(m.state)).toBeCloseTo(0.5);
    m.state.baseHp.plants = -500;
    for (let i = 0; i < 40; i++) spawnUnit(m.state, BALANCE, 'brainEater', i % 5, 9.5);
    expect(battleIntensity(m.state)).toBe(1);
    m.state.baseHp.plants = Number.NaN;
    expect(battleIntensity(m.state)).toBeLessThanOrEqual(1);
  });
});

describe('playEventSounds', () => {
  function recorder(): { audio: AudioEngine; calls: Array<[SfxName, { pitch?: number; pan?: number; volume?: number } | undefined]> } {
    const calls: Array<[SfxName, { pitch?: number; pan?: number; volume?: number } | undefined]> = [];
    const audio = { play: (name: SfxName, opts?: { pitch?: number; pan?: number; volume?: number }) => calls.push([name, opts]) };
    return { audio: audio as unknown as AudioEngine, calls };
  }
  const names = (calls: Array<[SfxName, unknown]>): SfxName[] => calls.map((c) => c[0]);
  const place: Command = { type: 'place', faction: 'plants', unit: 'peashooter', lane: 1, col: 2 };

  it('maps explosion, merge and the player\'s rejected command', () => {
    const { audio, calls } = recorder();
    playEventSounds(audio, [
      { type: 'explosion', lane: 2, x: 4.5, radius: 1.5, sourceKey: 'walnutBomb' },
      { type: 'unitMerged', unitId: 3, level: 2 },
      { type: 'commandRejected', command: place, reason: 'no-energy' },
    ], 'plants');
    expect(names(calls)).toEqual(['explode', 'merge', 'deny']);
  });

  it('maps every other event as ruled', () => {
    const { audio, calls } = recorder();
    const events: SimEvent[] = [
      { type: 'unitSpawned', unitId: 1, key: 'peashooter', faction: 'plants', lane: 0, x: 0.5 },
      { type: 'unitSpawned', unitId: 2, key: 'brainEater', faction: 'zombies', lane: 0, x: 9.5 },
      { type: 'projectileSpawned', projectileId: 3, kind: 'pea', faction: 'plants', lane: 0, x: 0.5, ownerId: 1 },
      { type: 'projectileSpawned', projectileId: 4, kind: 'brain', faction: 'zombies', lane: 0, x: 3, ownerId: 2 },
      { type: 'projectileHit', projectileId: 3, lane: 0, x: 5, targetId: 2, targetBase: null, blocked: false },
      { type: 'projectileHit', projectileId: 3, lane: 0, x: 5, targetId: 2, targetBase: null, blocked: true },
      { type: 'unitAttacked', unitId: 2, attack: 'melee', targetId: 1, targetBase: null },
      { type: 'unitAttacked', unitId: 1, attack: 'shot', targetId: 2, targetBase: null },
      { type: 'unitDamaged', unitId: 1, amount: 4, hp: 10 },
      { type: 'unitDied', unitId: 1, key: 'peashooter', faction: 'plants', lane: 0, x: 0.5, level: 1, cause: 'damage' },
      { type: 'unitDied', unitId: 5, key: 'sunflower', faction: 'plants', lane: 0, x: 1.5, level: 1, cause: 'shovel' },
      { type: 'baseDamaged', faction: 'plants', amount: 5, hp: 100, lane: 0 },
      { type: 'baseStruck', lane: 0, targetId: 2 },
      { type: 'energyGained', faction: 'plants', amount: 25, source: 'sunflower', unitId: 6, lane: 0, x: 1.5 },
      { type: 'energyGained', faction: 'plants', amount: 20, source: 'bounty', unitId: null, lane: 0, x: 8 },
      { type: 'energyGained', faction: 'zombies', amount: 50, source: 'bounty', unitId: null, lane: 0, x: 2 },
      { type: 'suddenDeath' },
      { type: 'commandRejected', command: { ...place, faction: 'zombies', unit: 'brainEater' }, reason: 'no-energy' },
      { type: 'matchEnded', winner: 'plants' },
    ];
    playEventSounds(audio, events, 'plants');
    expect(names(calls)).toEqual([
      'place', 'spawnZombie', 'pea', 'brainThrow', 'hit', 'block', 'chomp', 'click',
      'baseHit', 'baseStrike', 'sun', 'bounty', 'suddenDeath',
    ]);
  });

  it('plays the zombie player\'s income and rejections, not the plants\'', () => {
    const { audio, calls } = recorder();
    playEventSounds(audio, [
      { type: 'energyGained', faction: 'plants', amount: 25, source: 'sunflower', unitId: 6, lane: 0, x: 1.5 },
      { type: 'energyGained', faction: 'zombies', amount: 50, source: 'bounty', unitId: null, lane: 0, x: 2 },
      { type: 'commandRejected', command: place, reason: 'occupied' },
    ], 'zombies');
    expect(names(calls)).toEqual(['bounty']);
  });

  it('pans by where it happens: x 0..10 maps to -0.6..+0.6, no position is centred', () => {
    expect(panFor(0)).toBeCloseTo(-0.6);
    expect(panFor(5)).toBeCloseTo(0);
    expect(panFor(10)).toBeCloseTo(0.6);
    expect(panFor(-3)).toBeCloseTo(-0.6);
    expect(panFor(Number.NaN)).toBe(0);
    const { audio, calls } = recorder();
    playEventSounds(audio, [
      { type: 'explosion', lane: 2, x: 10, radius: 1.5, sourceKey: 'walnutBomb' },
      { type: 'unitAttacked', unitId: 2, attack: 'melee', targetId: 1, targetBase: null },
      { type: 'baseDamaged', faction: 'zombies', amount: 5, hp: 100, lane: 3 },
    ], 'plants');
    expect(calls[0]![1]?.pan).toBeCloseTo(0.6);
    expect(calls[1]![1]?.pan ?? 0).toBe(0);
    expect(calls[2]![1]?.pan).toBeCloseTo(0.6);
  });

  it('the sudden-death drain plays no baseHit; the suddenDeath sting marks it', () => {
    const { audio, calls } = recorder();
    playEventSounds(audio, [
      { type: 'suddenDeath' },
      { type: 'baseDamaged', faction: 'plants', amount: 5, hp: 100, lane: null },
      { type: 'baseDamaged', faction: 'zombies', amount: 5, hp: 100, lane: null },
    ], 'plants');
    expect(names(calls)).toEqual(['suddenDeath']);
  });

  it('a higher merge level sparkles higher', () => {
    const { audio, calls } = recorder();
    playEventSounds(audio, [{ type: 'unitMerged', unitId: 3, level: 2 }, { type: 'unitMerged', unitId: 3, level: 5 }], 'plants');
    expect(calls[1]![1]!.pitch!).toBeGreaterThan(calls[0]![1]!.pitch!);
  });

  it('plays baseHit at most once per 0.25 s', async () => {
    const { engine, fake } = await unlockedEngine();
    const hit: SimEvent = { type: 'baseDamaged', faction: 'plants', amount: 5, hp: 100, lane: 0 };
    const count = (): number => fake.sources().length;
    const base = count();
    playEventSounds(engine, [hit, hit, hit], 'plants');
    const one = count() - base;
    expect(one).toBeGreaterThan(0);
    fake.advance(0.1);
    playEventSounds(engine, [hit], 'plants');
    expect(count() - base).toBe(one);
    fake.advance(0.16);
    playEventSounds(engine, [hit], 'plants');
    expect(count() - base).toBe(2 * one);
  });
});
