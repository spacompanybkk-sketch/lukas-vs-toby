import { describe, expect, it } from 'vitest';
import type { AudioEngine, PlayOptions, SfxName } from '../../src/audio/AudioEngine';
import { panFor, playEventSounds } from '../../src/audio/bindings';
import type { SimEvent, SpellKey } from '../../src/sim/types';

// Wiring B: the hero powers' and spells' events to their sounds.

function recorder(): { audio: AudioEngine; calls: Array<[SfxName, PlayOptions | undefined]> } {
  const calls: Array<[SfxName, PlayOptions | undefined]> = [];
  const audio = { play: (name: SfxName, opts?: PlayOptions) => calls.push([name, opts]) };
  return { audio: audio as unknown as AudioEngine, calls };
}
const names = (calls: Array<[SfxName, unknown]>): SfxName[] => calls.map((c) => c[0]);

const SPELLS: [SpellKey, 'plants' | 'zombies', number][] = [
  ['thunderbolt', 'plants', 2], ['vines', 'plants', 2], ['sunShower', 'plants', 0], ['healingRain', 'plants', 3],
  ['rockWall', 'plants', 1], ['meteor', 'zombies', 2], ['fog', 'zombies', 2], ['brainFeast', 'zombies', 0],
  ['frenzy', 'zombies', 3], ['graveRise', 'zombies', 1],
];

describe('playEventSounds for hero powers and spells', () => {
  it('each side\'s hero power plays its own sound, whoever used it', () => {
    const { audio, calls } = recorder();
    playEventSounds(audio, [{ type: 'heroUsed', faction: 'plants', lane: 1 }, { type: 'heroUsed', faction: 'zombies', lane: 3 }], 'plants');
    expect(names(calls)).toEqual(['megaMower', 'boneStorm']);
  });

  it('heroReady and spellReady call only the player who owns them', () => {
    const { audio, calls } = recorder();
    const events: SimEvent[] = [
      { type: 'heroReady', faction: 'zombies' }, { type: 'spellReady', faction: 'zombies', spell: 'fog' },
      { type: 'heroReady', faction: 'plants' }, { type: 'spellReady', faction: 'plants', spell: 'vines' },
    ];
    playEventSounds(audio, events, 'plants');
    expect(names(calls)).toEqual(['heroReady', 'spellReady']);
  });

  for (const [spell, faction, size] of SPELLS) {
    it(`${spell} plays its own sound, panned where it lands`, () => {
      const { audio, calls } = recorder();
      playEventSounds(audio, [{ type: 'spellCast', faction, spell, lane: 2, col: 8, size: size as 0 | 1 | 2 | 3 }], 'zombies');
      expect(names(calls)).toEqual([spell]);
      const pan = calls[0]?.[1]?.pan ?? 0;
      if (size > 0) expect(pan).toBeCloseTo(panFor(8.5), 9);
      else expect(pan).toBe(0);
    });
  }

  it('a spell\'s income is not heard as a bounty or a Sunflower: its spell already rang', () => {
    const { audio, calls } = recorder();
    playEventSounds(audio, [
      { type: 'spellCast', faction: 'plants', spell: 'sunShower', lane: 0, col: 0, size: 0 },
      { type: 'energyGained', faction: 'plants', amount: 150, source: 'spell', unitId: null, lane: 2, x: 0 },
    ], 'plants');
    expect(names(calls)).toEqual(['sunShower']);
  });

  it('the Rock Wall\'s rock coming up is heard as the spell, not as a plant being placed', () => {
    const { audio, calls } = recorder();
    playEventSounds(audio, [
      { type: 'spellCast', faction: 'plants', spell: 'rockWall', lane: 1, col: 3, size: 1 },
      { type: 'unitSpawned', unitId: 9, key: 'rock', faction: 'plants', lane: 1, x: 3.5 },
    ], 'plants');
    expect(names(calls)).toEqual(['rockWall']);
  });
});
