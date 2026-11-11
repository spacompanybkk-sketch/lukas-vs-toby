/**
 * Plays bot-against-bot matches without drawing anything and prints who won and how long the
 * matches took. Run with `npm run sim:smoke`.
 *
 * - Medium against medium, seeds 1..100 (the first 40 are the ones tests/ai/basicBot.test.ts plays).
 * - Hard against easy, seeds 1..40, once with hard on each side.
 */

import { runBotMatch } from '../src/ai/runMatch';
import type { MatchResult } from '../src/ai/runMatch';
import type { Skill } from '../src/ai/bot';
import { BALANCE } from '../src/data/balance';
import { TICKS_PER_SECOND } from '../src/sim/types';
import type { Faction } from '../src/sim/types';

const SUDDEN_DEATH_TICK = BALANCE.suddenDeath.startSeconds * TICKS_PER_SECOND;

interface Series { title: string; skills: Record<Faction, Skill>; seeds: number }

const SERIES: readonly Series[] = [
  { title: 'Medium plants vs Medium zombies', skills: { plants: 'medium', zombies: 'medium' }, seeds: 100 },
  { title: 'Hard plants vs Easy zombies', skills: { plants: 'hard', zombies: 'easy' }, seeds: 40 },
  { title: 'Easy plants vs Hard zombies', skills: { plants: 'easy', zombies: 'hard' }, seeds: 40 },
];

function minutes(ticks: number): string {
  const totalSeconds = Math.round(ticks / TICKS_PER_SECOND);
  const m = Math.floor(totalSeconds / 60);
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${(ticks / TICKS_PER_SECOND / 60).toFixed(1)} min (${m}:${s})`;
}

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

function tally(results: readonly MatchResult[]): string {
  const count = (w: MatchResult['winner']): number => results.filter((r) => r.winner === w).length;
  return `plants ${count('plants')}, zombies ${count('zombies')}, draws ${count('draw')}`;
}

let totalTicks = 0;
const started = process.hrtime.bigint();

console.log('Sim smoke: basic bots on the default setup, BALANCE as shipped\n');
for (const series of SERIES) {
  const results: MatchResult[] = [];
  for (let seed = 1; seed <= series.seeds; seed++) results.push(runBotMatch(seed, series.skills));
  const lengths = results.map((r) => r.ticks).sort((a, b) => a - b);
  totalTicks += lengths.reduce((a, b) => a + b, 0);
  const suddenDeath = results.filter((r) => r.ticks > SUDDEN_DEATH_TICK).length;

  console.log(`${series.title}, seeds 1..${series.seeds}`);
  console.log(`  wins     ${tally(results)}`);
  if (series.seeds > 40) console.log(`           seeds 1..40: ${tally(results.slice(0, 40))}`);
  console.log(`  length   median ${minutes(percentile(lengths, 0.5))}, 95th percentile ${minutes(percentile(lengths, 0.95))}`);
  console.log(`           ${suddenDeath} of ${results.length} reached sudden death (6:00)\n`);
}

const seconds = Number(process.hrtime.bigint() - started) / 1e9;
console.log(`${totalTicks.toLocaleString('en-US')} ticks in ${seconds.toFixed(1)} s ` +
  `(${Math.round(totalTicks / seconds).toLocaleString('en-US')} ticks per second)`);
