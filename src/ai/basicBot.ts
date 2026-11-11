/**
 * The basic computer player, for either side at three skills. The strategies themselves live in
 * `plantStrategy.ts` and `zombieStrategy.ts`; this file holds what the skills change and the
 * think schedule.
 *
 * A bot is a pure function of the match state it is shown and its own private state: its random
 * numbers (seeded, never the match's) and what the zombie strategy remembers about its push. Its
 * schedule follows `match.state.tick`, never a clock.
 */

import type { Match } from '../sim/match';
import { nextRandom, randomInt } from '../sim/rng';
import type { Command, Faction } from '../sim/types';
import type { Bot, Skill } from './bot';
import { randomLegal } from './lawn';
import type { BotRng } from './lawn';
import { plantMove } from './plantStrategy';
import { newZombieMemory, zombieMove } from './zombieStrategy';

export interface SkillTable {
  /** Ticks between decisions (30 ticks = 1 s). */
  readonly thinkEvery: number;
  /** Share of decisions that are a random legal card play instead of the strategy's choice. */
  readonly randomShare: number;
  /** Plants: Sunflowers to keep. */
  readonly sunflowers: number;
  /** Zombies: merge a walking zombie whenever energy is above this; null: never merge. */
  readonly mergeAbove: number | null;
}

export const SKILLS: Readonly<Record<Skill, SkillTable>> = {
  easy: { thinkEvery: 60, randomShare: 0.4, sunflowers: 2, mergeAbove: null },
  medium: { thinkEvery: 30, randomShare: 0, sunflowers: 4, mergeAbove: null },
  hard: { thinkEvery: 15, randomShare: 0, sunflowers: 5, mergeAbove: 300 },
};

/** Keeps a plants bot and a zombies bot made with the same seed from drawing the same numbers. */
const SEED_SALT: Record<Faction, number> = { plants: 0x5eed_0001, zombies: 0x5eed_0002 };

export function createBasicBot(faction: Faction, skill: Skill, seed: number): Bot {
  const table = SKILLS[skill];
  const rng: BotRng = { rng: (seed ^ SEED_SALT[faction]) >>> 0 };
  const memory = newZombieMemory();
  // Which tick of each interval it acts on: a seeded phase, so two bots rarely move in lockstep.
  const phase = randomInt(rng, table.thinkEvery);

  const decide = (match: Match): Command | null => {
    if (table.randomShare > 0 && nextRandom(rng) < table.randomShare) return randomLegal(match, faction, rng);
    return faction === 'plants' ? plantMove(match, rng, table) : zombieMove(match, rng, table, memory);
  };

  return {
    faction,
    think(match: Match): Command[] {
      const s = match.state;
      if (s.winner !== null || s.tick % table.thinkEvery !== phase) return [];
      const cmd = decide(match);
      return cmd === null ? [] : [cmd];
    },
  };
}
