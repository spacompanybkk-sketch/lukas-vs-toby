/**
 * The matchups the balance targets are measured on, shared by the tests (`tests/ai`), the smoke
 * tool (`npm run sim:smoke`) and the tuning tool (`tools/tune.ts`), so all three play exactly the
 * same matches.
 *
 * Every match deals all ten cards a side, has both heroes on and deals two spells a side from its
 * seed, as a battle in the app does (`battleConfig`). Every matchup is played with seeds `first..`
 * (1 unless stated). Bots and stand-ins are seeded with the match seed. `Knobs` bundles everything
 * a tuner may change: the balance table, the computer's skill tables and the difficulty table.
 */

import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { ALL_CARDS } from '../data/units';
import type { Match } from '../sim/match';
import { defaultConfig } from '../sim/match';
import { SPELLS } from '../sim/spells';
import type { CardKey, Faction, MatchConfig, SpellKey } from '../sim/types';
import { SKILLS, createBasicBot } from './basicBot';
import type { SkillTables } from './basicBot';
import type { Bot, Skill } from './bot';
import { DIFFICULTY, battleConfig, computerTable, opponentOf } from './difficulty';
import type { DifficultyTable } from './difficulty';
import { runMatch } from './runMatch';
import type { MatchResult } from './runMatch';
import {
  SLOW_TAP_EVERY, createFortressPlants, createMergeSpamBot, createNewestCardChild, createRandomChild,
  createSpamBot, createSteadyZombies,
} from './standIns';

export interface Knobs {
  readonly balance: Balance;
  readonly skills: SkillTables;
  readonly difficulty: DifficultyTable;
}

/** What the game ships. */
export const SHIPPED: Knobs = { balance: BALANCE, skills: SKILLS, difficulty: DIFFICULTY };

export const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
export const SKILL_NAMES: readonly Skill[] = ['easy', 'medium', 'hard'];

/**
 * One match to play: the setup, a bot for each side, and optionally something done to the fresh
 * match before the first step (the spell checks deal fixed hands this way).
 */
export interface Setup { config: MatchConfig; bots: Bot[]; prepare?: (match: Match) => void }

/** A matchup: how to set up the match for a seed. */
export interface Matchup { title: string; setup: (seed: number, knobs: Knobs) => Setup }

export interface Played extends MatchResult {
  sent: Record<Faction, number>;
  merges: Record<Faction, number>;
  /** Card plays (placements and merges) per card, both sides. */
  picks: Partial<Record<CardKey, number>>;
  /** Hero uses and spell casts per side. */
  powers: Record<Faction, number>;
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

/** The default setup for `seed` with all ten cards a side. */
export function fullConfig(seed: number, balance: Balance): MatchConfig {
  const config = defaultConfig(seed, balance);
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  return config;
}

/** A bot that counts what it plays. */
function counting(bot: Bot, played: Pick<Played, 'sent' | 'merges' | 'picks' | 'powers'>): Bot {
  return {
    faction: bot.faction,
    think(match) {
      const commands = bot.think(match);
      for (const c of commands) {
        if (c.type === 'place') played.sent[c.faction] += 1;
        if (c.type === 'merge') played.merges[c.faction] += 1;
        if (c.type === 'place' || c.type === 'merge') played.picks[c.unit] = (played.picks[c.unit] ?? 0) + 1;
        if (c.type === 'hero' || c.type === 'spell') played.powers[c.faction] += 1;
      }
      return commands;
    },
  };
}

export function playOne(matchup: Matchup, seed: number, knobs: Knobs): Played {
  const { config, bots, prepare } = matchup.setup(seed, knobs);
  const counts = { sent: { plants: 0, zombies: 0 }, merges: { plants: 0, zombies: 0 }, picks: {}, powers: { plants: 0, zombies: 0 } };
  const result = runMatch(config, bots.map((b) => counting(b, counts)), undefined, knobs.balance, prepare);
  return { ...result, ...counts };
}

/** Plays seeds `first`..`first + seeds - 1` of a matchup. */
export function playSeries(matchup: Matchup, seeds: number, knobs: Knobs = SHIPPED, first = 1): SeriesStats {
  const results: Played[] = [];
  for (let seed = first; seed < first + seeds; seed++) results.push(playOne(matchup, seed, knobs));
  return summarise(matchup.title, results, knobs.balance);
}

/** Wins, lengths and sudden deaths of a list of played matches. */
export function summarise(title: string, results: Played[], balance: Balance): SeriesStats {
  const wins = { plants: 0, zombies: 0, draw: 0 };
  for (const r of results) wins[r.winner] += 1;
  const suddenDeathTick = seconds(balance.suddenDeath.startSeconds);
  return {
    title,
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

/** Each card's share of its side's card plays over a series, 0..1. */
export function pickShares(stats: SeriesStats, side: Faction): Record<CardKey, number> {
  const total: Partial<Record<CardKey, number>> = {};
  for (const r of stats.results) for (const [k, n] of Object.entries(r.picks)) total[k as CardKey] = (total[k as CardKey] ?? 0) + n;
  const all = ALL_CARDS[side].reduce((n, k) => n + (total[k] ?? 0), 0);
  const out = {} as Record<CardKey, number>;
  for (const k of ALL_CARDS[side]) out[k] = all === 0 ? 0 : (total[k] ?? 0) / all;
  return out;
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
      const config = fullConfig(seed, knobs.balance);
      if (startEnergyFactor !== 1) {
        const e = Math.round(knobs.balance.startEnergy * startEnergyFactor);
        config.startEnergy = { plants: e, zombies: e };
      }
      return { config, bots: FACTIONS.map((f) => computer(f, skills[f], seed, knobs)) };
    },
  };
}

/**
 * Medium against Medium on the plain setup, with each side's spells fixed to `hands` instead of
 * dealt from the seed (an empty hand: no spells). The deal still draws from the seed as usual, so
 * the rest of the match draws the same numbers whatever the hands.
 */
export function spellsMatchup(hands: Record<Faction, readonly SpellKey[]>): Matchup {
  const name = (h: readonly SpellKey[]): string => (h.length === 0 ? 'none' : h.join('+'));
  return {
    title: `Medium v Medium, spells ${name(hands.plants)} v ${name(hands.zombies)}`,
    setup: (seed, knobs) => ({
      config: fullConfig(seed, knobs.balance),
      bots: FACTIONS.map((f) => computer(f, 'medium', seed, knobs)),
      prepare: (match) => {
        for (const f of FACTIONS) {
          match.state.players[f].spells = hands[f].map((key) => ({ key, timer: seconds(knobs.balance.spells[key].firstReady) }));
        }
      },
    }),
  };
}

/** The ten two-spell hands a side can be dealt. */
export function spellHands(side: Faction): SpellKey[][] {
  const all = SPELLS[side];
  const out: SpellKey[][] = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) out.push([all[i] as SpellKey, all[j] as SpellKey]);
  return out;
}

/** A stand-in on `faction` against the Medium computer on the plain setup. */
function againstMedium(title: string, faction: Faction, make: (seed: number) => Bot): Matchup {
  return {
    title,
    setup: (seed, knobs) => ({
      config: fullConfig(seed, knobs.balance),
      bots: [make(seed), computer(opponentOf(faction), 'medium', seed, knobs)],
    }),
  };
}

/** Spam of one card against the Medium computer. */
export function spamMatchup(faction: Faction, unit: CardKey): Matchup {
  return againstMedium(`${unit} spam (${faction}) vs Medium`, faction, (seed) => createSpamBot(faction, unit, seed));
}

/** Merge-spam of one card against the Medium computer. */
export function mergeSpamMatchup(faction: Faction, unit: CardKey): Matchup {
  return againstMedium(`${unit} merge-spam (${faction}) vs Medium`, faction, (seed) => createMergeSpamBot(faction, unit, seed));
}

/** Every spam and merge-spam matchup, all twenty cards. */
export function allSpamMatchups(): Matchup[] {
  return FACTIONS.flatMap((f) => ALL_CARDS[f].flatMap((unit) => [spamMatchup(f, unit), mergeSpamMatchup(f, unit)]));
}

/**
 * The stand-in humans: the random child, the attentive player (plays like the Medium computer),
 * the newest-card child, the slow tapper (the random child every 6 s), and the two adults who play
 * the way Michal did: `fortress` (plants only) and `steady` (zombies only).
 */
export type HumanStandIn = 'child' | 'attentive' | 'newest' | 'slow' | 'fortress' | 'steady';

const STAND_IN_NAMES: Record<HumanStandIn, string> = {
  child: 'random child', attentive: 'attentive player', newest: 'newest-card child', slow: 'slow tapper',
  fortress: 'fortress plants', steady: 'steady zombies',
};

function standIn(kind: HumanStandIn, human: Faction, seed: number, knobs: Knobs): Bot {
  switch (kind) {
    case 'child': return createRandomChild(human, seed);
    case 'attentive': return computer(human, 'medium', seed, knobs);
    case 'newest': return createNewestCardChild(human, seed);
    case 'slow': return createRandomChild(human, seed, SLOW_TAP_EVERY);
    case 'fortress':
      if (human !== 'plants') throw new Error('the fortress stand-in plays plants');
      return createFortressPlants(seed);
    case 'steady':
      if (human !== 'zombies') throw new Error('the steady stand-in plays zombies');
      return createSteadyZombies(seed);
    default: {
      const unhandled: never = kind;
      throw new Error(`no stand-in ${String(unhandled)}`);
    }
  }
}

/** A stand-in human on `human` against the computer at `difficulty`, on that difficulty's setup. */
export function humanMatchup(kind: HumanStandIn, human: Faction, difficulty: Skill): Matchup {
  return {
    title: `${STAND_IN_NAMES[kind]} (${human}) vs ${difficulty}`,
    setup: (seed, knobs) => {
      const skill = knobs.difficulty[difficulty][human].skill;
      const table = computerTable(human, difficulty, knobs.difficulty, knobs.skills);
      return {
        config: battleConfig(seed, human, difficulty, knobs.balance, knobs.difficulty),
        bots: [standIn(kind, human, seed, knobs), createBasicBot(opponentOf(human), skill, seed, table)],
      };
    },
  };
}
