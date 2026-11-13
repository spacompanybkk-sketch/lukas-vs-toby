import { BALANCE } from '../data/balance';
import type { Balance } from '../data/balance';
import { ALL_CARDS } from '../data/units';
import { Match, defaultConfig } from '../sim/match';
import type { Command, Faction, MatchConfig } from '../sim/types';
import { createBasicBot } from './basicBot';
import type { Bot, Skill } from './bot';

export interface MatchResult {
  winner: Faction | 'draw';
  /** Steps played: the tick the match ended on, plus one. */
  ticks: number;
  baseHp: Record<Faction, number>;
}

/** 8:00, the latest a match with sudden death can last. */
export const MAX_MATCH_TICKS = 14_400;

/**
 * Plays a whole match between bots without drawing anything. Pass one bot per side, each made for
 * this match (bots keep private state). Every tick each bot is asked for its commands, plants'
 * bots first, then zombies', whatever order they are passed in, and the commands go to the match
 * in that order in one `step`. Stops when a base falls or after `maxTicks` steps; a match still
 * going then is a draw. `prepare` may change the fresh match before the first step (the balance
 * checks use it to deal fixed spells).
 */
export function runMatch(
  config: MatchConfig, bots: readonly Bot[], maxTicks: number = MAX_MATCH_TICKS,
  balance: Balance = BALANCE, prepare?: (match: Match) => void,
): MatchResult {
  const match = new Match(config, balance);
  prepare?.(match);
  const plantsFirst = (faction: Faction): number => (faction === 'plants' ? 0 : 1);
  const ordered = [...bots].sort((a, b) => plantsFirst(a.faction) - plantsFirst(b.faction));
  while (match.state.winner === null && match.state.tick < maxTicks) {
    const commands: Command[] = [];
    for (const bot of ordered) commands.push(...bot.think(match));
    match.step(commands);
  }
  return { winner: match.state.winner ?? 'draw', ticks: match.state.tick, baseHp: { ...match.state.baseHp } };
}

/**
 * The standard bot-against-bot match the tests and the smoke tool play: the default setup for
 * `seed` with all ten cards a side, and a basic bot on each side at the given skill, both seeded
 * with `seed`.
 */
export function runBotMatch(
  seed: number, skills: Record<Faction, Skill>, maxTicks: number = MAX_MATCH_TICKS,
  balance: Balance = BALANCE,
): MatchResult {
  const bots = [
    createBasicBot('plants', skills.plants, seed),
    createBasicBot('zombies', skills.zombies, seed),
  ];
  const config = defaultConfig(seed, balance);
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  return runMatch(config, bots, maxTicks, balance);
}
