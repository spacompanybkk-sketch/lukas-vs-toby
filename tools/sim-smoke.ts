/**
 * Plays bot-against-bot and stand-in matches without drawing anything and prints what the balance
 * targets need. Run with `npm run sim:smoke` (about a minute). The matchups are the ones in
 * `src/ai/balanceChecks.ts`, so this prints exactly what the tests in `tests/ai` assert.
 *
 * 1. Computer against computer: Medium v Medium (200 seeds), the same with `startEnergy` ×0.75 and
 *    ×1.25 (100 seeds each), Hard v Easy with Hard on each side (200 seeds). For each: wins, match
 *    length (median and nearest-rank 95th percentile), how many went into sudden death, units sent
 *    and merges.
 * 2. Spam: every card of both sides, played alone (spam) and merged into one unit (merge-spam),
 *    against the Medium computer, 100 seeds. Target: the stand-in wins at most 55%.
 * 3. Difficulty: the random child and the attentive player on each side against each difficulty,
 *    on that difficulty's setup, 100 seeds. Targets: child Easy 55-85%, Medium 15-45%, Hard under
 *    15%; attentive Easy 85-95%, Medium 40-60%, Hard 15-35%.
 * 4. Merge value: equal-budget lane duels, a level-N unit against N level-1 units (see
 *    `src/ai/duels.ts`). Target 1.00-1.15.
 *
 * `--seeds N` plays N seeds everywhere instead (quicker for a look, noisier).
 */

import {
  FACTIONS, SHIPPED, SKILL_NAMES, allSpamMatchups, botMatchup, humanMatchup, percentile, playSeries,
} from '../src/ai/balanceChecks';
import type { Matchup, SeriesStats } from '../src/ai/balanceChecks';
import { MERGE_PAIRS, mergeValue } from '../src/ai/duels';
import { TICKS_PER_SECOND } from '../src/sim/types';
import type { Faction } from '../src/sim/types';

const seedsArg = process.argv.indexOf('--seeds');
const SEEDS_OVERRIDE = seedsArg >= 0 ? Number(process.argv[seedsArg + 1]) : null;
const seedsFor = (n: number): number => SEEDS_OVERRIDE ?? n;

let totalTicks = 0;
const started = process.hrtime.bigint();

function play(matchup: Matchup, seeds: number): SeriesStats {
  const stats = playSeries(matchup, seedsFor(seeds), SHIPPED);
  totalTicks += stats.lengths.reduce((a, b) => a + b, 0);
  return stats;
}

function clock(ticks: number): string {
  const s = Math.round(ticks / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function pct(n: number, of: number): string {
  return `${Math.round((100 * n) / of)}%`;
}

function median(values: readonly number[]): number {
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

console.log('Sim smoke: BALANCE, SKILLS and DIFFICULTY as shipped\n');

console.log('1. Computer against computer\n');
const botSeries: Array<[Matchup, number]> = [
  [botMatchup({ plants: 'medium', zombies: 'medium' }), 200],
  [botMatchup({ plants: 'medium', zombies: 'medium' }, 0.75), 100],
  [botMatchup({ plants: 'medium', zombies: 'medium' }, 1.25), 100],
  [botMatchup({ plants: 'hard', zombies: 'easy' }), 200],
  [botMatchup({ plants: 'easy', zombies: 'hard' }), 200],
];
for (const [matchup, seeds] of botSeries) {
  const s = play(matchup, seeds);
  const n = s.results.length;
  console.log(`${s.title}, seeds 1..${n}`);
  console.log(`  wins          plants ${s.wins.plants} (${pct(s.wins.plants, n)}), zombies ${s.wins.zombies} ` +
    `(${pct(s.wins.zombies, n)}), draws ${s.wins.draw}`);
  console.log(`  length        median ${clock(percentile(s.lengths, 0.5))}, 95th percentile (nearest-rank) ` +
    `${clock(percentile(s.lengths, 0.95))}, shortest ${clock(s.lengths[0] ?? 0)}`);
  console.log(`  sudden death  ${s.suddenDeath} of ${n} (${pct(s.suddenDeath, n)}) went past 6:00`);
  console.log(`  units sent    median match: plants ${median(s.results.map((r) => r.sent.plants))}, ` +
    `zombies ${median(s.results.map((r) => r.sent.zombies))}`);
  console.log(`  merges        median match: plants ${median(s.results.map((r) => r.merges.plants))}, ` +
    `zombies ${median(s.results.map((r) => r.merges.zombies))}\n`);
}

console.log(`2. Spam against the Medium computer, seeds 1..${seedsFor(100)}: share the stand-in wins (target at most 55%)\n`);
console.log('  stand-in                                        wins   median length');
for (const matchup of allSpamMatchups()) {
  const s = play(matchup, 100);
  const side: Faction = matchup.title.includes('(plants)') ? 'plants' : 'zombies';
  const flag = s.wins[side] / s.results.length > 0.55 ? '  <-- over 55%' : '';
  console.log(`  ${matchup.title.padEnd(46)} ${pct(s.wins[side], s.results.length).padStart(5)}   ` +
    `${clock(percentile(s.lengths, 0.5))}${flag}`);
}

console.log(`\n3. Difficulty, seeds 1..${seedsFor(100)}: share the stand-in human wins`);
console.log('   (targets: child Easy 55-85%, Medium 15-45%, Hard <15%; attentive Easy 85-95%, Medium 40-60%, Hard 15-35%)\n');
console.log('  stand-in                      easy   medium   hard   median length (e/m/h)');
for (const standIn of ['child', 'attentive'] as const) {
  for (const human of FACTIONS) {
    const cells: string[] = [];
    const lengths: string[] = [];
    for (const difficulty of SKILL_NAMES) {
      const s = play(humanMatchup(standIn, human, difficulty), 100);
      cells.push(pct(s.wins[human], s.results.length).padStart(6));
      lengths.push(clock(percentile(s.lengths, 0.5)));
    }
    const label = `${standIn === 'child' ? 'random child' : 'attentive player'} as ${human}`;
    console.log(`  ${label.padEnd(28)}${cells.join('   ')}   ${lengths.join(' / ')}`);
  }
}

console.log('\n4. Merge value: break-even enemy count of one level-N unit / of N level-1 units (target 1.00-1.15)\n');
console.log('  unit vs enemy                     N=2    N=3    N=4    N=5');
for (const [unit, enemy] of MERGE_PAIRS) {
  const cells: string[] = [];
  for (let level = 2; level <= 5; level++) cells.push(mergeValue(unit, enemy, level, SHIPPED.balance).value.toFixed(2).padStart(5));
  console.log(`  ${`${unit} vs ${enemy}`.padEnd(32)}${cells.join('  ')}`);
}

const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
console.log(`\n${totalTicks.toLocaleString('en-US')} match ticks (duels not counted) in ${elapsed.toFixed(1)} s`);
