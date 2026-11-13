/**
 * Plays bot-against-bot and stand-in matches without drawing anything and prints what the balance
 * targets need. Run with `npm run sim:smoke` (about a minute). The matchups are the ones in
 * `src/ai/balanceChecks.ts`, so this prints exactly what the tests in `tests/ai` assert.
 *
 * 1. Computer against computer: Medium v Medium (200 seeds), the same with `startEnergy` ×0.75 and
 *    ×1.25 (100 seeds each), Hard v Easy with Hard on each side (200 seeds). For each: wins, match
 *    length (median and nearest-rank 95th percentile), how many went into sudden death, units sent
 *    and merges.
 * 2. Spam: all twenty cards, played alone (spam) and merged into one unit (merge-spam), against
 *    the Medium computer, 100 seeds. Target: the stand-in wins at most 60%.
 * 3. Difficulty: the stand-in humans on each side against each difficulty, on that difficulty's
 *    setup, 100 seeds: the random child (Easy 55-85%, Medium 15-45%, Hard under 15%), the
 *    newest-card child and the slow tapper (Easy), the attentive player (reported only), and the
 *    adults who play as Michal did, fortressPlants (Hard 15-40%) and steadyZombies (Hard 15-40%,
 *    Medium 40-65%).
 * 4. Merge value: equal-budget lane duels, a level-N unit against N level-1 units (see
 *    `src/ai/duels.ts`), every unit that fights. Target 0.95-1.25 (mean over N = 2..5).
 *
 * Every band, with its exact seed counts and on any seed block, is `npx tsx tools/tune.ts`.
 *
 * `--seeds N` plays N seeds everywhere instead (quicker for a look, noisier).
 */

import {
  FACTIONS, SHIPPED, SKILL_NAMES, allSpamMatchups, botMatchup, humanMatchup, percentile, playSeries,
} from '../src/ai/balanceChecks';
import type { HumanStandIn, Matchup, SeriesStats } from '../src/ai/balanceChecks';
import { FIGHTERS, unitMergeValue } from '../src/ai/duels';
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

console.log(`2. Spam against the Medium computer, seeds 1..${seedsFor(100)}: share the stand-in wins (target at most 60%)\n`);
console.log('  stand-in                                        wins   median length');
for (const matchup of allSpamMatchups()) {
  const s = play(matchup, 100);
  const side: Faction = matchup.title.includes('(plants)') ? 'plants' : 'zombies';
  const flag = s.wins[side] / s.results.length > 0.6 ? '  <-- over 60%' : '';
  console.log(`  ${matchup.title.padEnd(46)} ${pct(s.wins[side], s.results.length).padStart(5)}   ` +
    `${clock(percentile(s.lengths, 0.5))}${flag}`);
}

console.log(`\n3. Difficulty, seeds 1..${seedsFor(100)}: share the stand-in human wins (bands: tools/tune.ts)\n`);
console.log('  stand-in                      easy   medium   hard   median length (e/m/h)');
const STAND_INS: Array<[HumanStandIn, Faction[]]> = [
  ['child', ['plants', 'zombies']], ['newest', ['plants', 'zombies']], ['slow', ['plants', 'zombies']],
  ['attentive', ['plants', 'zombies']], ['fortress', ['plants']], ['steady', ['zombies']],
];
for (const [standIn, sides] of STAND_INS) {
  for (const human of sides) {
    const cells: string[] = [];
    const lengths: string[] = [];
    for (const difficulty of SKILL_NAMES) {
      const s = play(humanMatchup(standIn, human, difficulty), 100);
      cells.push(pct(s.wins[human], s.results.length).padStart(6));
      lengths.push(clock(percentile(s.lengths, 0.5)));
    }
    console.log(`  ${`${standIn} as ${human}`.padEnd(28)}${cells.join('   ')}   ${lengths.join(' / ')}`);
  }
}

console.log('\n4. Merge value: break-even enemy count of one level-N unit / of N level-1 units (target 0.95-1.25, mean)\n');
console.log('  unit vs enemy                     N=2    N=3    N=4    N=5    mean');
for (const unit of FIGHTERS) {
  const v = unitMergeValue(unit, SHIPPED.balance);
  console.log(`  ${`${unit} vs ${v.enemy}`.padEnd(32)}${v.values.map((x) => x.toFixed(2).padStart(5)).join('  ')}  ${v.mean.toFixed(2).padStart(5)}`);
}

const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
console.log(`\n${totalTicks.toLocaleString('en-US')} match ticks (duels not counted) in ${elapsed.toFixed(1)} s`);
