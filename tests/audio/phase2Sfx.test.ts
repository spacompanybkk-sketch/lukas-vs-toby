import { describe, expect, it } from 'vitest';
import { SFX, SFX_NAMES } from '../../src/audio/sfx';
import type { SfxName } from '../../src/audio/sfx';
import { Voice, makeNoise } from '../../src/audio/synth';
import { FakeAudioContext } from './fakeAudioContext';

const PHASE1: SfxName[] = [
  'place', 'spawnZombie', 'pea', 'brainThrow', 'hit', 'chomp', 'block', 'explode', 'merge', 'sun', 'bounty',
  'baseHit', 'click', 'deny', 'suddenDeath', 'win', 'lose', 'collapse', 'baseStrike',
];
const SHORT: SfxName[] = [
  'kernel', 'butter', 'mango', 'sand', 'arrow', 'bullet', 'trident', 'rot', 'stun', 'blind', 'lasso', 'poison',
  'burn', 'heal', 'raise', 'mineArm', 'mineBoom', 'fuse', 'cherryBoom', 'squash', 'grow', 'miss', 'heroReady',
  'spellReady', 'vines', 'sunShower', 'healingRain', 'rockWall', 'fog', 'brainFeast', 'frenzy', 'graveRise',
];
const LONG: SfxName[] = ['megaMower', 'boneStorm', 'thunderbolt', 'meteor'];

interface Render { length: number; peak: number; sources: number }

/** Runs a recipe in the fake context at t = 1 and measures it. */
function render(name: SfxName, pitch = 1): Render {
  const ctx = new FakeAudioContext();
  const v = new Voice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeNoise(ctx as unknown as BaseAudioContext));
  const start = 1;
  SFX[name](v, start, pitch);
  // envelopes only: gains that start and end at 0 (a vibrato's depth gain is in Hz, not a level)
  const envelopes = ctx.params.filter((p) => p.name === 'gain' && p.events.length >= 3 && p.finalValue === 0);
  const peak = Math.max(0, ...envelopes.flatMap((p) => p.events.map((e) => e.value)));
  expect(ctx.allProblems(), name).toEqual([]);
  return { length: v.end - start, peak, sources: ctx.sources().length };
}

describe('phase 2 sound effects', () => {
  it('the name list is exactly the phase 1 names plus the new ones', () => {
    expect([...SFX_NAMES].sort()).toEqual([...PHASE1, ...SHORT, ...LONG].sort());
    expect(new Set(SFX_NAMES).size).toBe(SFX_NAMES.length);
    expect(SHORT).toHaveLength(32);
  });

  it.each([...SHORT, ...LONG])('%s renders, schedules sources, stays short, is audible and does not clip', (name) => {
    const r = render(name);
    console.info(`[sfx] ${name.padEnd(12)} ${r.length.toFixed(3)} s  peak ${r.peak.toFixed(2)}  sources ${r.sources}`);
    expect(r.sources).toBeGreaterThanOrEqual(1);
    expect(r.length).toBeGreaterThan(0.03);
    expect(r.length).toBeLessThan(LONG.includes(name) ? 1.5 : 0.6);
    expect(r.peak).toBeGreaterThan(0.04); // not silent
    expect(r.peak).toBeLessThanOrEqual(0.6); // every single envelope leaves headroom
  });

  it('renders at other pitches too', () => {
    for (const name of [...SHORT, ...LONG]) {
      expect(render(name, 0.94).sources, name).toBeGreaterThan(0);
      expect(render(name, 1.06).sources, name).toBeGreaterThan(0);
    }
  });

  it('heroReady and spellReady are different two-note calls', () => {
    const notes = (name: SfxName): number[] => {
      const ctx = new FakeAudioContext();
      const v = new Voice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeNoise(ctx as unknown as BaseAudioContext));
      SFX[name](v, 1, 1);
      const starts = ctx.sources().filter((s) => s.kind === 'oscillator').map((s) => s.startTime!);
      return [...new Set(starts.map((s) => s.toFixed(3)))].map(Number);
    };
    expect(notes('heroReady')).toHaveLength(2);
    expect(notes('spellReady')).toHaveLength(2);
    const freqs = (name: SfxName): number[] => {
      const ctx = new FakeAudioContext();
      const v = new Voice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeNoise(ctx as unknown as BaseAudioContext));
      SFX[name](v, 1, 1);
      return ctx.params.filter((p) => p.name === 'frequency').map((p) => p.events[0]!.value);
    };
    expect(Math.min(...freqs('spellReady'))).toBeGreaterThan(Math.max(...freqs('heroReady')));
  });
});
