import { describe, expect, it } from 'vitest';
import { createBasicBot } from '../../src/ai/basicBot';
import { ALL_CARDS } from '../../src/data/units';
import { hashState } from '../../src/sim/hash';
import { Match, defaultConfig } from '../../src/sim/match';
import type { Faction, MatchConfig } from '../../src/sim/types';

/**
 * Ordinary play, pinned: default battles with no lawn twist, played to the end. Three idle
 * battles (seeds 1–3, through sudden death) and six Medium v Medium bot battles with all ten cards
 * (seeds 1–6). Winner, end tick and both base healths are the values the worlds machinery plan
 * recorded before the twists existed (nine-battle replay, baseline 7d26921) and after each of its
 * tasks; the state hash is `hashState` of the final state, taken from the code when this guard was
 * added. A move in any of them means ordinary play changed.
 */
type Bot = ReturnType<typeof createBasicBot>;

function play(config: MatchConfig, bots: Bot[]): { winner: Faction | 'draw' | null; tick: number; base: [number, number]; hash: number } {
  const m = new Match(config);
  // The plants' bot thinks first, as in the recorded replay.
  const ordered = [...bots].sort((a, b) => (a.faction === 'plants' ? 0 : 1) - (b.faction === 'plants' ? 0 : 1));
  while (m.state.winner === null && m.state.tick < 20000) {
    const cmds = [];
    for (const bot of ordered) cmds.push(...bot.think(m));
    m.step(cmds);
  }
  const s = m.state;
  return { winner: s.winner, tick: s.tick, base: [s.baseHp.plants, s.baseHp.zombies], hash: hashState(s) };
}

const IDLE: [number, ReturnType<typeof play>][] = [
  [1, { winner: 'draw', tick: 13801, base: [-2.0000000000007403, -2.0000000000007403], hash: 2020728915 }],
  [2, { winner: 'draw', tick: 13801, base: [-2.0000000000007403, -2.0000000000007403], hash: 2028365131 }],
  [3, { winner: 'draw', tick: 13801, base: [-2.0000000000007403, -2.0000000000007403], hash: 1548819554 }],
];
const MEDIUM: [number, ReturnType<typeof play>][] = [
  [1, { winner: 'plants', tick: 8276, base: [3925, -6.300000000003195], hash: 276025644 }],
  [2, { winner: 'plants', tick: 8019, base: [4570, -10.13999999997862], hash: 2098631719 }],
  [3, { winner: 'zombies', tick: 8028, base: [-25, 4554.900000000003], hash: 3879090105 }],
  [4, { winner: 'zombies', tick: 8543, base: [-3, 4386.90000000002], hash: 1733615925 }],
  [5, { winner: 'zombies', tick: 6723, base: [-8, 3504.900000000064], hash: 1594394051 }],
  [6, { winner: 'plants', tick: 8529, base: [2285, -2.2499999999620446], hash: 3377408026 }],
];

describe('no-twist replay: ordinary play did not change', () => {
  it('default config has no twist', () => {
    expect(defaultConfig(1).lawn).toEqual({ rocks: [], fog: null, ice: null, lava: null });
  });

  it.each(IDLE)('idle, seed %i', (seed, want) => {
    expect(play(defaultConfig(seed), [])).toEqual(want);
  });

  it.each(MEDIUM)('Medium v Medium, all ten cards, seed %i', (seed, want) => {
    const c = defaultConfig(seed);
    c.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
    expect(play(c, [createBasicBot('plants', 'medium', seed), createBasicBot('zombies', 'medium', seed)])).toEqual(want);
  });
});
