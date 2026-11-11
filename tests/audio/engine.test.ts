import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import type { SfxName } from '../../src/audio/AudioEngine';
import { BAR_SECONDS } from '../../src/audio/music';
import { SFX_NAMES } from '../../src/audio/sfx';
import { FakeAudioContext } from './fakeAudioContext';
import type { FakeSource } from './fakeAudioContext';

/** The audio clock and the timers move together, as they do in a browser tab. */
function run(fake: FakeAudioContext, seconds: number, stepMs = 100): void {
  for (let t = 0; t < seconds * 1000 - 1e-6; t += stepMs) {
    fake.advance(stepMs / 1000);
    vi.advanceTimersByTime(stepMs);
  }
}

async function setup(): Promise<{ engine: AudioEngine; fake: FakeAudioContext; graph: number }> {
  const fake = new FakeAudioContext();
  const engine = new AudioEngine(() => fake as unknown as AudioContext);
  await engine.unlock();
  fake.advance(0.5); // the unlock blip ends
  return { engine, fake, graph: fake.nodes.length };
}

/** Each source with the audio time at which the engine created it. */
function track(fake: FakeAudioContext): Map<FakeSource, number> {
  const seen = new Map<FakeSource, number>();
  const original = fake.createOscillator.bind(fake);
  fake.createOscillator = () => {
    const o = original();
    seen.set(o, fake.currentTime);
    return o;
  };
  const originalBuffer = fake.createBufferSource.bind(fake);
  fake.createBufferSource = () => {
    const b = originalBuffer();
    seen.set(b, fake.currentTime);
    return b;
  };
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('music scheduler', () => {
  it('schedules notes on the audio clock, never more than one bar ahead', async () => {
    const { engine, fake } = await setup();
    const created = track(fake);
    engine.startMusic('backyard');
    run(fake, 10);
    expect(created.size).toBeGreaterThan(20);
    for (const [source, madeAt] of created) {
      expect(source.startTime!).toBeGreaterThanOrEqual(madeAt);
      expect(source.startTime! - madeAt).toBeLessThanOrEqual(BAR_SECONDS + 1e-9);
    }
    engine.stopMusic(0.1);
  });

  it('plays more layers once the intensity has risen', async () => {
    const { engine, fake } = await setup();
    engine.startMusic('backyard');
    const before = fake.sources().length;
    run(fake, 4 * BAR_SECONDS);
    const calm = fake.sources().length - before;

    engine.setIntensity(1);
    run(fake, 2 * BAR_SECONDS); // the 2 s ease and the next bar line
    const mid = fake.sources().length;
    run(fake, 4 * BAR_SECONDS);
    const busy = fake.sources().length - mid;
    expect(busy).toBeGreaterThan(calm * 1.5);
    engine.stopMusic(0.1);
  });

  it('catches up after a late timer without doubling, bunching or playing the past', async () => {
    /** Sources per (bar of the loop, start within the bar in ms) for an engine started at `origin`. */
    const perSlot = (sources: Iterable<FakeSource>, origin: number): Map<string, number> => {
      const slots = new Map<string, number>();
      for (const s of sources) {
        const sinceStart = s.startTime! - origin;
        const bar = Math.floor(sinceStart / BAR_SECONDS + 1e-9);
        const key = `${bar % 8}:${Math.round((sinceStart - bar * BAR_SECONDS) * 1000)}`;
        slots.set(key, (slots.get(key) ?? 0) + 1);
      }
      return slots;
    };

    // reference: the same music with the timer never late
    const ref = await setup();
    const refMade = track(ref.fake);
    const refOrigin = ref.fake.currentTime + 0.1;
    ref.engine.startMusic('backyard');
    ref.engine.setIntensity(1);
    run(ref.fake, 20);
    ref.engine.stopMusic(0.1);
    const reference = perSlot(refMade.keys(), refOrigin);

    const { engine, fake } = await setup();
    const created = track(fake);
    const origin = fake.currentTime + 0.1;
    engine.startMusic('backyard');
    engine.setIntensity(1);
    run(fake, 3);

    // a hidden tab: the clock runs on 9 s while no timer fires, then one fires late
    fake.advance(9);
    const wokeAt = fake.currentTime;
    const sizeBefore = created.size;
    vi.advanceTimersByTime(100);
    const late = [...created.keys()].slice(sizeBefore);
    expect(late.length).toBeGreaterThan(0);
    for (const s of late) expect(s.startTime!).toBeGreaterThanOrEqual(wokeAt);

    // then the timer fires only once a second for a while
    for (let i = 0; i < 6; i++) {
      fake.advance(1);
      vi.advanceTimersByTime(1000);
    }
    const afterWake = [...created.keys()].slice(sizeBefore);
    // every note lands where the loop puts it, at most once: per slot never more than the reference
    for (const [slot, count] of perSlot(afterWake, origin)) {
      expect(reference.has(slot), slot).toBe(true);
      expect(count, slot).toBeLessThanOrEqual(reference.get(slot)!);
    }
    // and the music has no gap longer than a beat
    const starts = afterWake.map((s) => s.startTime!).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeLessThan(0.6);
    engine.stopMusic(0.1);
  });

  it('keeps the melody playing when the intensity dips just under 0.35', async () => {
    const window = async (first: number): Promise<number> => {
      const { engine, fake } = await setup();
      engine.setIntensity(first);
      engine.startMusic('backyard');
      run(fake, 2 * BAR_SECONDS);
      engine.setIntensity(0.32);
      run(fake, 3);
      const before = fake.sources().length;
      run(fake, 2 * BAR_SECONDS);
      engine.stopMusic(0.1);
      return fake.sources().length - before;
    };
    const wasPlaying = await window(0.4);
    const neverOn = await window(0.32);
    expect(wasPlaying).toBeGreaterThan(neverOn);
  });

  it('keeps an intensity set before the unlock or before startMusic', async () => {
    const fake = new FakeAudioContext();
    const engine = new AudioEngine(() => fake as unknown as AudioContext);
    engine.setIntensity(1);
    await engine.unlock();
    const calm = await setup();
    calm.engine.startMusic('backyard');
    engine.startMusic('backyard');
    run(fake, BAR_SECONDS);
    run(calm.fake, BAR_SECONDS);
    // full layers from the first bar, against bass and pad alone
    expect(fake.sources().length).toBeGreaterThan(calm.fake.sources().length * 1.5);
    engine.stopMusic(0.1);
    calm.engine.stopMusic(0.1);
  });

  it('stopMusic fades out and leaves nothing sounding or scheduled', async () => {
    const { engine, fake, graph } = await setup();
    engine.startMusic('backyard');
    engine.setIntensity(1);
    run(fake, 5);
    const stoppedAt = fake.currentTime;
    engine.stopMusic(0.5);
    for (const s of fake.sources()) {
      if (s.ended) continue;
      expect(s.stopTime!).toBeLessThanOrEqual(stoppedAt + 0.5 + 0.02);
    }
    const count = fake.sources().length;
    run(fake, 5);
    expect(fake.sources().length).toBe(count);
    expect(fake.nodes.slice(graph).filter((n) => !n.disconnected)).toEqual([]);
    expect(fake.allProblems()).toEqual([]);
  });

  it('switching themes crossfades without a jump', async () => {
    const { engine, fake } = await setup();
    engine.startMusic('menu');
    run(fake, 3);
    engine.startMusic('menu'); // same theme: carries on
    engine.startMusic('backyard');
    run(fake, 3);
    expect(fake.allProblems()).toEqual([]);
    engine.stopMusic(0.1);
  });

  it('creates no notes while muted and picks up again when unmuted', async () => {
    const { engine, fake } = await setup();
    engine.startMusic('backyard');
    run(fake, 1);
    engine.setMuted(true);
    run(fake, 0.3);
    const count = fake.sources().length;
    run(fake, 5);
    expect(fake.sources().length).toBe(count);
    engine.setMuted(false);
    run(fake, 3);
    expect(fake.sources().length).toBeGreaterThan(count);
    engine.stopMusic(0.1);
  });
});

describe('a ten-minute match', () => {
  it('leaks no nodes and never steps a gain', async () => {
    const errors = vi.spyOn(console, 'error');
    const { engine, fake, graph } = await setup();
    const names: SfxName[] = SFX_NAMES;
    engine.startMusic('backyard');
    let maxVoices = 0;
    for (let step = 0; step < 6000; step++) {
      engine.setIntensity((step % 600) / 600);
      // a busy battle: a few effects every 100 ms, the same ones often
      engine.play(names[step % names.length]!, { pan: ((step % 11) - 5) / 10 });
      engine.play('pea');
      engine.play('hit');
      maxVoices = Math.max(maxVoices, engine.voiceCount);
      fake.advance(0.1);
      vi.advanceTimersByTime(100);
    }
    engine.stopMusic(1);
    run(fake, 6);

    expect(errors).not.toHaveBeenCalled();
    expect(maxVoices).toBeLessThanOrEqual(24);
    expect(engine.voiceCount).toBe(0);
    expect(fake.pending.size).toBe(0);
    const made = fake.nodes.slice(graph);
    expect(made.length).toBeGreaterThan(10000);
    expect(made.filter((n) => !n.disconnected).length).toBe(0);
    expect(fake.allProblems()).toEqual([]);
  });
});
