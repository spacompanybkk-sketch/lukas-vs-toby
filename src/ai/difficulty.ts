/**
 * The three difficulties a boy picks before a battle against the computer. A difficulty is more
 * than the computer's skill table (`SKILLS` in `basicBot.ts`): it also sets each side's income,
 * so Easy can give a small child a head start and Hard can give the computer one. The match config
 * is built here, from the difficulty and the side the human plays, so the app and the balance
 * checks always play exactly the same match.
 */

import { BALANCE } from '../data/balance';
import type { Balance } from '../data/balance';
import { ALL_CARDS } from '../data/units';
import { defaultConfig } from '../sim/match';
import type { Faction, MatchConfig } from '../sim/types';
import { SKILLS } from './basicBot';
import type { SkillTable, SkillTables } from './basicBot';
import type { Skill } from './bot';

export interface Difficulty {
  /** The computer's skill table. */
  readonly skill: Skill;
  /** Income multipliers (trickle) for the human's side and the computer's side. */
  readonly income: { readonly human: number; readonly computer: number };
  /**
   * The computer's random moves on this difficulty, replacing its skill table's `randomShare`: a
   * computer that sometimes plays a random card leaves a small child openings to find, while an
   * attentive player gains little from them (the income then sets how hard it is overall).
   */
  readonly randomShare: number;
}

/** Per difficulty, per side the human plays. */
export type DifficultyTable = Readonly<Record<Skill, Readonly<Record<Faction, Difficulty>>>>;

export const DIFFICULTY: DifficultyTable = {
  easy: {
    // Lukas on Easy: the Easy zombies, playing at random half the time, and 40% more income.
    plants: { skill: 'easy', income: { human: 1.4, computer: 1.05 }, randomShare: 0.5 },
    // Toby on Easy: plants that build well but play a random card more often than not, and 40%
    // more income for him. (The Easy plant table itself is too slow to give an attentive player
    // any game; this one still loses most matches to a child tapping at random.)
    zombies: { skill: 'hard', income: { human: 1.4, computer: 1 }, randomShare: 0.6 },
  },
  medium: {
    // Medium zombies that sometimes play at random, so a child finds openings, earning a fifth
    // more to make up for it against a player who leaves none.
    plants: { skill: 'medium', income: { human: 1, computer: 1.2 }, randomShare: 0.3 },
    zombies: { skill: 'medium', income: { human: 1, computer: 1 }, randomShare: 0 },
  },
  hard: {
    plants: { skill: 'hard', income: { human: 1, computer: 1.15 }, randomShare: 0 },
    zombies: { skill: 'hard', income: { human: 1, computer: 1.4 }, randomShare: 0 },
  },
};

/** The skill table the computer plays with on `difficulty` against a human on `human`. */
export function computerTable(
  human: Faction, difficulty: Skill, table: DifficultyTable = DIFFICULTY, skills: SkillTables = SKILLS,
): SkillTable {
  const setting = table[difficulty][human];
  return { ...skills[opponentOf(human)][setting.skill], randomShare: setting.randomShare };
}

export function opponentOf(faction: Faction): Faction {
  return faction === 'plants' ? 'zombies' : 'plants';
}

/**
 * The match config for a human on `human` against the computer at `difficulty`: the default setup
 * with all ten cards a side (ruling R52), and the difficulty's income.
 */
export function battleConfig(
  seed: number, human: Faction, difficulty: Skill, balance: Balance = BALANCE,
  table: DifficultyTable = DIFFICULTY,
): MatchConfig {
  const setting = table[difficulty][human];
  const config = defaultConfig(seed, balance);
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  config.incomeMultiplier = {
    ...config.incomeMultiplier,
    [human]: setting.income.human,
    [opponentOf(human)]: setting.income.computer,
  };
  return config;
}
