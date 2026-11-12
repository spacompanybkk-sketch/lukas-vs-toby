/**
 * The basic computer player, for either side at three skills. The strategies themselves live in
 * `plantStrategy.ts` and `zombieStrategy.ts`; this file holds what the skills change and the
 * think schedule.
 *
 * A bot is a pure function of the match state it is shown and its own private state: its random
 * numbers (seeded, never the match's) and what the zombie strategy remembers about its push. Its
 * schedule follows `match.state.tick`, never a clock. Because that private state carries on from
 * one think to the next, make one bot object per match and do not reuse it in another.
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
  /** Plants: the level it merges its Sunflowers up to once it has them all (1: no merging). */
  readonly sunflowerLevel: number;
  /** Plants: how much more stopping power than the zombies' health it wants in a lane. */
  readonly defenceMargin: number;
  /** Plants: energy kept back for emergencies before it buys economy or spare Peashooters. */
  readonly reserve: number;
  /**
   * Zombies: merge a walking zombie whenever its energy is worth more than this many seconds of
   * trickle income (25 s is 150 energy at a trickle of 6); 0: never merge.
   */
  readonly mergeSpareSeconds: number;
  /** Zombies: Peashooter levels in the target lane from which it sends a Skeleton Warrior. */
  readonly tankAt: number;
}

/** Everything the skills change, and nothing else: per side, per skill. */
export type SkillTables = Readonly<Record<Faction, Readonly<Record<Skill, SkillTable>>>>;

/** The fields a side does not use, filled in so every table has the same shape. */
const UNUSED = { sunflowers: 0, sunflowerLevel: 1, defenceMargin: 1, reserve: 0, mergeSpareSeconds: 0, tankAt: 0 };

export const SKILLS: SkillTables = {
  plants: {
    easy: { ...UNUSED, thinkEvery: 210, randomShare: 0.2, sunflowers: 1, sunflowerLevel: 1, defenceMargin: 1 },
    medium: { ...UNUSED, thinkEvery: 30, randomShare: 0, sunflowers: 4, sunflowerLevel: 3, defenceMargin: 1 },
    hard: { ...UNUSED, thinkEvery: 30, randomShare: 0, sunflowers: 5, sunflowerLevel: 4, defenceMargin: 2 },
  },
  zombies: {
    easy: { ...UNUSED, thinkEvery: 60, randomShare: 0.6, mergeSpareSeconds: 0, tankAt: 2 },
    medium: { ...UNUSED, thinkEvery: 30, randomShare: 0, mergeSpareSeconds: 0, tankAt: 2 },
    hard: { ...UNUSED, thinkEvery: 15, randomShare: 0, mergeSpareSeconds: 15, tankAt: 2 },
  },
};

/** Keeps a plants bot and a zombies bot made with the same seed from drawing the same numbers. */
const SEED_SALT: Record<Faction, number> = { plants: 0x5eed_0001, zombies: 0x5eed_0002 };

/**
 * A basic bot for one side of one match (see the note at the top on reuse). `table` replaces the
 * skill's shipped table; the tuning tool uses it to try other numbers.
 */
export function createBasicBot(
  faction: Faction, skill: Skill, seed: number, table: SkillTable = SKILLS[faction][skill],
): Bot {
  const rng: BotRng = { rng: (seed ^ SEED_SALT[faction]) >>> 0 };
  const memory = newZombieMemory();
  // Which tick of each interval it acts on: a seeded phase, so two bots rarely move in lockstep.
  const phase = randomInt(rng, table.thinkEvery);

  const decide = (match: Match): Command | null => {
    if (table.randomShare > 0 && nextRandom(rng) < table.randomShare) return randomLegal(match, faction, rng);
    if (faction === 'plants') return plantMove(match, rng, table);
    return zombieMove(match, rng, table, memory);
  };

  return {
    faction,
    think(match: Match): Command[] {
      const s = match.state;
      // A finished match gets no thought at all, so it draws no random numbers either.
      if (s.winner !== null || s.tick % table.thinkEvery !== phase) return [];
      const cmd = decide(match);
      return cmd === null ? [] : [cmd];
    },
  };
}
