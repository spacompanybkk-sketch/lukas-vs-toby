import { describe, expect, it } from 'vitest';
import type { AudioEngine, PlayOptions, SfxName } from '../../src/audio/AudioEngine';
import { playEventSounds } from '../../src/audio/bindings';
import { SFX } from '../../src/audio/sfx';
import { Voice, makeNoise } from '../../src/audio/synth';
import { bossDemoMatch } from '../../src/scenes/bossScript';
import type { SimEvent } from '../../src/sim/types';
import { FakeAudioContext } from './fakeAudioContext';

// Phase 3 Task 3: the bosses' two sounds each, synthesised and bound to their events.

const BOSS_SOUNDS: SfxName[] = ['titanRoar', 'titanDefeat', 'oakCreak', 'oakDefeat'];

function render(name: SfxName, pitch = 1): { length: number; peak: number; layered: number; sources: number } {
  const ctx = new FakeAudioContext();
  const v = new Voice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeNoise(ctx as unknown as BaseAudioContext));
  SFX[name](v, 1, pitch);
  const envelopes = ctx.params.filter((p) => p.name === 'gain' && p.events.length >= 3 && p.finalValue === 0);
  const peak = Math.max(0, ...envelopes.flatMap((p) => p.events.map((e) => e.value)));
  const spans = envelopes.map((p) => ({
    from: p.events[0]!.time, to: p.events[p.events.length - 1]!.time, peak: Math.max(...p.events.map((e) => e.value)),
  }));
  const layered = Math.max(0, ...spans.map((s) => spans.filter((o) => o.from <= s.from && o.to > s.from).reduce((a, o) => a + o.peak, 0)));
  expect(ctx.allProblems(), name).toEqual([]);
  return { length: v.end - 1, peak, layered, sources: ctx.sources().length };
}

function recorder(): { audio: AudioEngine; calls: SfxName[] } {
  const calls: SfxName[] = [];
  const audio = { play: (name: SfxName, _opts?: PlayOptions) => calls.push(name) };
  return { audio: audio as unknown as AudioEngine, calls };
}

describe('the bosses\' sounds', () => {
  it.each(BOSS_SOUNDS)('%s renders, is audible, under 1.5 s, with headroom, at any pitch', (name) => {
    for (const pitch of [0.94, 1, 1.06]) {
      const r = render(name, pitch);
      expect(r.sources).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeGreaterThan(0.3);
      expect(r.length).toBeLessThan(1.5);
      expect(r.peak).toBeGreaterThan(0.04);
      expect(r.peak).toBeLessThanOrEqual(0.6);
      expect(r.layered).toBeLessThanOrEqual(1.5);
    }
  });

  it.each([['brainTitan', 'titanRoar', 'titanDefeat'], ['elderOak', 'oakCreak', 'oakDefeat']] as const)(
    '%s: its call on coming on and on each pattern, a thump on a slam\'s blow, its sting when beaten', (key, call, sting) => {
      const m = bossDemoMatch(key, 1);
      const heard: SfxName[] = [];
      const patterns: SimEvent[] = [];
      while (m.state.winner === null) {
        const events = m.step();
        const { audio, calls } = recorder();
        playEventSounds(audio, events, key === 'brainTitan' ? 'plants' : 'zombies', { state: m.state });
        const boss = events.filter((e) => e.type === 'bossPattern' || e.type === 'bossDefeated' || (e.type === 'unitSpawned' && e.key === key));
        if (boss.length > 0) {
          patterns.push(...boss);
          heard.push(...calls.filter((c) => BOSS_SOUNDS.includes(c) || c === 'explode'));
        }
      }
      const expected = patterns.map((e) => {
        if (e.type === 'bossDefeated') return sting;
        if (e.type === 'bossPattern' && e.kind === 'slam' && !e.windup) return 'explode';
        return call;
      });
      expect(heard).toEqual(expected);
      expect(heard).toContain(sting);
      expect(heard.filter((c) => c === call).length).toBeGreaterThanOrEqual(3);
    });
});
