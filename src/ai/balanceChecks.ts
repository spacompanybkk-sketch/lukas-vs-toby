/**
 * The matchups the balance targets are measured on, shared by the tests (`tests/ai`), the smoke
 * tool (`npm run sim:smoke`) and the tuning tool (`tools/tune.ts`), so all three play exactly the
 * same matches.
 *
 * Every matchup is played with the same seeds 1..n. Bots and stand-ins are seeded with the match
 * seed. `Knobs` bundles everything a tuner may change: the balance table, the computer's skill
 * tables and the difficulty table.
 */

import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { PHASE1_CARDS } from '../data/units';
import { defaultConfig } from '../sim/match';
import type { Faction, MatchConfig, UnitKey } from '../sim/types';
import { SKILLS, createBasicBot } from './basicBot';
import type { SkillTables } from './basicBot';
import type { Bot, Skill } from './bot';
import { DIFFICULTY, battleConfig, computerTable, opponentOf } from './difficulty';
import type { DifficultyTable } from './difficulty';
import { runMatch } from './runMatch';
import type { MatchResult } from './runMatch';
import { createMergeSpamBot, createRandomChild, createSpamBot } from './standIns';

export interface Knobs {
  readonly balance: Balance;
  readonly skills: SkillTables;
  readonly difficulty: DifficultyTable;
}

/** What the game ships. */
export const SHIPPED: Knobs = { balance: BALANCE, skills: SKILLS, difficulty: DIFFICULTY };

export const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
export const SKILL_NAMES: readonly Skill[] = ['easy', 'medium', 'hard'];

/** One match to play: the setup and a bot for each side. */
export interface Setup { config: MatchConfig; bots: Bot[] }

/** A matchup: how to set up the match for a seed. */
export interface Matchup { title: string; setup: (seed: number, knobs: Knobs) => Setup }

export interface Played extends MatchResult {
  sent: Record<Faction, number>;
  merges: Record<Faction, number>;
}

export interface SeriesStats {
  title: string;
  results: Played[];
  wins: Record<Faction | 'draw', number>;
  /** Match lengths in ticks, ascending. */
  lengths: number[];
  /** Matches still going when sudden death started. */
  suddenDeath: number;
}

/** A bot that counts the units it sends and the merges it makes. */
function counting(bot: Bot, sent: Record<Faction, number>, merges: Record<Faction, number>): Bot {
  return {
    faction: bot.faction,
    think(match) {
      const commands = bot.think(match);
      for (const c of commands) {
        if (c.type === 'place') sent[c.faction] += 1;
        if (c.type === 'merge') merges[c.faction] += 1;
      }
      return commands;
    },
  };
}

export function playOne(matchup: Matchup, seed: number, knobs: Knobs): Played {
  const { config, bots } = matchup.setup(seed, knobs);
  const sent = { plants: 0, zombies: 0 };
  const merges = { plants: 0, zombies: 0 };
  const result = runMatch(config, bots.map((b) => counting(b, sent, merges)), undefined, knobs.balance);
  return { ...result, sent, merges };
}

/** Plays seeds 1..`seeds` of a matchup. */
export function playSeries(matchup: Matchup, seeds: number, knobs: Knobs = SHIPPED): SeriesStats {
  const results: Played[] = [];
  for (let seed = 1; seed <= seeds; seed++) results.push(playOne(matchup, seed, knobs));
  const wins = { plants: 0, zombies: 0, draw: 0 };
  for (const r of results) wins[r.winner] += 1;
  const suddenDeathTick = seconds(knobs.balance.suddenDeath.startSeconds);
  return {
    title: matchup.title,
    results,
    wins,
    lengths: results.map((r) => r.ticks).sort((a, b) => a - b),
    suddenDeath: results.filter((r) => r.ticks > suddenDeathTick).length,
  };
}

/** Share of matches `side` won, 0..1. */
export function winShare(stats: SeriesStats, side: Faction): number {
  return stats.wins[side] / stats.results.length;
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

function capitalised(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function computer(faction: Faction, skill: Skill, seed: number, knobs: Knobs): Bot {
  return createBasicBot(faction, skill, seed, knobs.skills[faction][skill]);
}

/** Computer against computer on the plain setup (no difficulty income). */
export function botMatchup(skills: Record<Faction, Skill>, startEnergyFactor = 1): Matchup {
  const energy = startEnergyFactor === 1 ? '' : `, startEnergy ×${startEnergyFactor}`;
  return {
    title: `${capitalised(skills.plants)} plants vs ${capitalised(skills.zombies)} zombies${energy}`,
    setup: (seed, knobs) => {
      const config = defaultConfig(seed, knobs.balance);
      if (startEnergyFactor !== 1) {
        const e = Math.round(knobs.balance.startEnergy * startEnergyFactor);
        config.startEnergy = { plants: e, zombies: e };
      }
      return { config, bots: FACTIONS.map((f) => computer(f, skills[f], seed, knobs)) };
    },
  };
}

/** A stand-in on `faction` against the Medium computer on the plain setup. */
function againstMedium(title: string, faction: Faction, make: (seed: number) => Bot): Matchup {
  return {
    title,
    setup: (seed, knobs) => ({
      config: defaultConfig(seed, knobs.balance),
      bots: [make(seed), computer(opponentOf(faction), 'medium', seed, knobs)],
    }),
  };
}

/** Spam of one card against the Medium computer. */
export function spamMatchup(faction: Faction, unit: UnitKey): Matchup {
  return againstMedium(`${unit} spam (${faction}) vs Medium`, faction, (seed) => createSpamBot(faction, unit, seed));
}

/** Merge-spam of one card against the Medium computer. */
export function mergeSpamMatchup(faction: Faction, unit: UnitKey): Matchup {
  return againstMedium(`${unit} merge-spam (${faction}) vs Medium`, faction, (seed) => createMergeSpamBot(faction, unit, seed));
}

/** Every spam and merge-spam matchup of phase 1, both sides. */
export function allSpamMatchups(): Matchup[] {
  return FACTIONS.flatMap((f) => PHASE1_CARDS[f].flatMap((unit) => [spamMatchup(f, unit), mergeSpamMatchup(f, unit)]));
}

export type HumanStandIn = 'child' | 'attentive';

/**
 * A stand-in human on `human` against the computer at `difficulty`, on that difficulty's setup:
 * the random child, or the attentive player (who plays like the Medium computer).
 */
export function humanMatchup(standIn: HumanStandIn, human: Faction, difficulty: Skill): Matchup {
  return {
    title: `${standIn === 'child' ? 'random child' : 'attentive player'} (${human}) vs ${difficulty}`,
    setup: (seed, knobs) => {
      const player = standIn === 'child' ? createRandomChild(human, seed) : computer(human, 'medium', seed, knobs);
      const skill = knobs.difficulty[difficulty][human].skill;
      const table = computerTable(human, difficulty, knobs.difficulty, knobs.skills);
      return {
        config: battleConfig(seed, human, difficulty, knobs.balance, knobs.difficulty),
        bots: [player, createBasicBot(opponentOf(human), skill, seed, table)],
      };
    },
  };
}
