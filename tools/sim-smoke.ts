/**
 * Plays bot-against-bot matches without drawing anything and prints what the balance targets
 * need. Run with `npm run sim:smoke` (well under a minute).
 *
 * - Medium against medium, seeds 1..200 (the first 40 are the ones tests/ai/basicBot.test.ts plays).
 * - The same with `startEnergy` at 0.75× and 1.25× its shipped value, seeds 1..100: is the balance
 *   knife-edged?
 * - Hard against easy, seeds 1..200, once with hard on each side.
 *
 * For each: wins, match length (median and nearest-rank 95th percentile), how many matches went
 * past 6:00 into sudden death, and how many units each side sent in the median match.
 */

import { createBasicBot } from '../src/ai/basicBot';
import type { Bot, Skill } from '../src/ai/bot';
import { runMatch } from '../src/ai/runMatch';
import type { MatchResult } from '../src/ai/runMatch';
import { BALANCE, cloneBalance, seconds } from '../src/data/balance';
import type { Balance } from '../src/data/balance';
import { defaultConfig } from '../src/sim/match';
import { TICKS_PER_SECOND } from '../src/sim/types';
import type { Faction } from '../src/sim/types';

interface Played extends MatchResult { sent: Record<Faction, number>; merges: Record<Faction, number> }

interface Series { title: string; skills: Record<Faction, Skill>; seeds: number; balance: Balance }

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];

/** The shipped balance with `startEnergy` scaled, rounded to a whole number. */
function withStartEnergy(factor: number): Balance {
  const balance = cloneBalance(BALANCE);
  balance.startEnergy = Math.round(BALANCE.startEnergy * factor);
  return balance;
}

const SERIES: readonly Series[] = [
  { title: 'Medium plants vs Medium zombies', skills: { plants: 'medium', zombies: 'medium' }, seeds: 200, balance: BALANCE },
  {
    title: `Medium vs Medium, startEnergy ×0.75 (${withStartEnergy(0.75).startEnergy})`,
    skills: { plants: 'medium', zombies: 'medium' }, seeds: 100, balance: withStartEnergy(0.75),
  },
  {
    title: `Medium vs Medium, startEnergy ×1.25 (${withStartEnergy(1.25).startEnergy})`,
    skills: { plants: 'medium', zombies: 'medium' }, seeds: 100, balance: withStartEnergy(1.25),
  },
  { title: 'Hard plants vs Easy zombies', skills: { plants: 'hard', zombies: 'easy' }, seeds: 200, balance: BALANCE },
  { title: 'Easy plants vs Hard zombies', skills: { plants: 'easy', zombies: 'hard' }, seeds: 200, balance: BALANCE },
];

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

/** The same match `runBotMatch` plays, with the commands counted. */
function play(seed: number, skills: Record<Faction, Skill>, balance: Balance): Played {
  const sent = { plants: 0, zombies: 0 };
  const merges = { plants: 0, zombies: 0 };
  const bots = FACTIONS.map((f) => counting(createBasicBot(f, skills[f], seed), sent, merges));
  return { ...runMatch(defaultConfig(seed, balance), bots, undefined, balance), sent, merges };
}

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

function median(values: readonly number[]): number {
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

function minutes(ticks: number): string {
  const totalSeconds = Math.round(ticks / TICKS_PER_SECOND);
  const clock = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  return `${(ticks / TICKS_PER_SECOND / 60).toFixed(1)} min (${clock})`;
}

function share(n: number, of: number): string {
  return `${n} of ${of} (${Math.round((100 * n) / of)}%)`;
}

function tally(results: readonly Played[]): string {
  const count = (w: MatchResult['winner']): number => results.filter((r) => r.winner === w).length;
  const pct = (n: number): string => `${Math.round((100 * n) / results.length)}%`;
  return `plants ${count('plants')} (${pct(count('plants'))}), zombies ${count('zombies')} ` +
    `(${pct(count('zombies'))}), draws ${count('draw')}`;
}

const suddenDeathTick = seconds(BALANCE.suddenDeath.startSeconds);
let totalTicks = 0;
const started = process.hrtime.bigint();

console.log('Sim smoke: basic bots on the default setup, BALANCE as shipped\n');
for (const series of SERIES) {
  const results: Played[] = [];
  for (let seed = 1; seed <= series.seeds; seed++) results.push(play(seed, series.skills, series.balance));
  const lengths = results.map((r) => r.ticks).sort((a, b) => a - b);
  totalTicks += lengths.reduce((a, b) => a + b, 0);

  console.log(`${series.title}, seeds 1..${series.seeds}`);
  console.log(`  wins          ${tally(results)}`);
  console.log(`                seeds 1..40: ${tally(results.slice(0, 40))}`);
  console.log(`  length        median ${minutes(percentile(lengths, 0.5))}, ` +
    `95th percentile (nearest-rank) ${minutes(percentile(lengths, 0.95))}`);
  console.log(`  sudden death  ${share(results.filter((r) => r.ticks > suddenDeathTick).length, results.length)} went past 6:00`);
  console.log(`  units sent    median match: plants ${median(results.map((r) => r.sent.plants))}, ` +
    `zombies ${median(results.map((r) => r.sent.zombies))}`);
  console.log(`  merges        all matches: plants ${results.reduce((n, r) => n + r.merges.plants, 0)}, ` +
    `zombies ${results.reduce((n, r) => n + r.merges.zombies, 0)}\n`);
}

const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
console.log(`${totalTicks.toLocaleString('en-US')} ticks in ${elapsed.toFixed(1)} s ` +
  `(${Math.round(totalTicks / elapsed).toLocaleString('en-US')} ticks per second)`);
