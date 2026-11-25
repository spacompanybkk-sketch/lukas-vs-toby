import { describe, expect, it } from 'vitest';
import { levelsFor } from '../../../src/adventure/levels';
import type { LevelDef } from '../../../src/adventure/types';
import {
  EXPERT_WIN_MIN, STAR_LEVEL, averageStarBand, averageWinBand, beginnerWinMin, bossStarBand, campaignIndex, GATED_STAND_INS, levelGate, plantStarBand, playFreePlay, playIdle,
  playLevelSeries, summariseFreePlay, summariseLevel,
} from '../../../src/ai/levelChecks';
import type { FreePlayStats, LevelStats } from '../../../src/ai/levelChecks';
import { LEVEL_STAND_INS } from '../../../src/ai/levelStandIns';
import type { LevelStandIn } from '../../../src/ai/levelStandIns';
import type { Faction } from '../../../src/sim/types';

/**
 * The campaign bands with the level stand-ins, one test file per world (`levels-w1.test.ts` …
 * `levels-w5.test.ts`, both sides each) and one for Free Play (`freePlay.test.ts`): the same
 * numbers as `npx tsx tools/levels.ts` (`--world N`, `--free`). World 1 keeps the Backyard's bands
 * (plan Task 8 of the Backyard plan; the average player's band as ruling A18 replaced it); worlds
 * 2–5 take the curve of ruling 11 (`averageWinBand`). `npm run test:balance` plays one seed block
 * (1..200); `LVT_BLOCKS=3` plays three (1..200, 1001..1200, 2001..2200), required when a world ships.
 *
 * A band holds when every block is inside it or within 1 point of it (the brief's rule), so each
 * block is asserted with that 1-point allowance (`SLACK`) on the percentage bands. A band in
 * `KNOWN_MISSES` is asserted with `it.fails`: it is reported in the Task 8 report with its reason,
 * and the test flips (fails) the day the band is met, so the list stays honest.
 */
export const SEEDS = 200;
/** The brief's "within 1 point" on every percentage band, applied per block. */
const SLACK = 1;
const LONG_MS = 3_600_000;

/** The seed blocks to play: `LVT_BLOCKS` of them (1 to 3; default 1). */
export function blocks(): number[] {
  const n = Number(process.env.LVT_BLOCKS ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 3) throw new RangeError(`LVT_BLOCKS ${String(process.env.LVT_BLOCKS)} must be 1, 2 or 3`);
  return [1, 1001, 2001].slice(0, n);
}

const SHORT_BREAKTHROUGH = 'three stars need the garden broken within the first half of the clock (60 / 75 s), which the 3-star bands ask of most seeds: under 1.5 min by construction';
const SHORT_CONVEYOR = 'the sensible players break the regrowing garden in about 1.25 min; a bigger plant base drops the beginner below the smooth curve (5500: 75%, 7000: 38%)';
const NO_SKILL = 'since the Breakthrough stand-in stacks the lane that gives (Task 8c) the average player and the expert both crack the garden in under a minute on every seed, so the level no longer tells them apart; the z1 levels are not retuned in this task';
const IDLE_P15 = 'worlds plan Task 8c: p1-5 must not be won by an idle player; every setting that makes its waves break an idle base (base 4000-4500, or added waves) costs the average player 3 stars there (68-75%, was 84%), so p1-7 (94%) is more than 15 points above p1-5; only p1-5 may change in this plan';

const BEGINNER_FLOOR = 'the beginner floor (70% on Easy) and the band top collide; ruling 6 keeps the floor. Every lever tried (bases, clocks, flag timing, Easy/Medium income, a bigger plant base) moves the beginner 3-6 points for every point of the average, who wins 97-100% wherever the beginner holds 70%';

const TOBY_FLOOR = 'the zombie levels are the younger player\'s: the beginner floor (70% on Easy) is kept. Wherever the average player drops into his band the beginner wins 28-50%';
const TUNDRA_BELT = 'the sensible players break the 7000 base before the growing garden bites; a 9000 base holds the average player 1.52-1.58 min (on the line) and takes the beginner to 3.4 min and 87.5-89%';

const Z4_EASED = (numbers: string): string => `${numbers}; eased for a five-year-old, Michal 2026-11-25 (worlds-4 Task 10)`;
const TUNDRA_P4_BELT = 'a belt is played alike by the average player and the expert (tuned base 6250: the expert 94.5 / 96 / 97); every density that takes the average player down takes the expert with him (a denser early rush with a 8000 base: expert 69 / 67.5 / 68, average 54 / 59.5 / 54)';
const TUNDRA_P4_BATTLE = 'a battle\'s 3 stars need the plants\' base at 80% when the zombie base falls, which the average player does in 0-6% of his wins whatever the bases (plants 6000-12000, zombies 1200-3000, Medium income ×0.7-1.0: 0-6%)';
const TUNDRA_P4_SURVIVE = 'the expert and the average player hold the same waves (expert 100 on every block): any wave dense enough to beat the average player beats the expert too (hot topics and flags: no gap; with a ramp of Brain Eaters at a 5000 base: expert 77.5, average 70)';
const TUNDRA_P4_SURVIVE_STARS = 'heavier waves cost the average player 3 stars faster than wins (waves 1.3 times as heavy: average 62-72 win, 17-24% three stars, expert 88.5-93.5)';
const TUNDRA_P4_BOSS = 'an idle player must lose, and the plants\' base hit back until it kills the Yeti: with the Yeti at 10000 hp an idle player loses on all 60 seeds up to a 14000 base (2 of 60 win at 17000), and at that base the average player keeps 8-9% three stars (a 28000 base: 40-43%, but an idle player wins 3-8 of 20 at 24000); at 6500 hp 14000 gives 43-52% three stars but an idle player wins 9-17 of 20';
export const KNOWN_MISSES: Readonly<Record<string, string>> = {
  'z1-3 median length, beginner': `about 1.02 min: ${SHORT_BREAKTHROUGH}`,
  'z1-3 median length, average': `about 0.69 min: ${SHORT_BREAKTHROUGH}`,
  'z1-3 median length, expert': `about 0.64 min: ${SHORT_BREAKTHROUGH}`,
  'z1-6 median length, beginner': `about 1.11 min: ${SHORT_BREAKTHROUGH}`,
  'z1-6 median length, average': `about 0.86 min: ${SHORT_BREAKTHROUGH}`,
  'z1-6 median length, expert': `about 0.77 min: ${SHORT_BREAKTHROUGH}`,
  'z1-3 the expert three-stars at least 5 points more often than the average player': `both 100% in about 0.69 / 0.64 min: ${NO_SKILL}`,
  'z1-6 the expert three-stars at least 5 points more often than the average player': `both 100% in about 0.86 / 0.77 min: ${NO_SKILL}`,
  'z1-5 median length, average': `about 1.25 min: ${SHORT_CONVEYOR}`,
  'z1-5 median length, expert': `about 1.12 min: ${SHORT_CONVEYOR}`,
  'plants average 3 stars: no level more than 15 points above the level two before it': `p1-7 v p1-5 about 94 v 73: ${IDLE_P15}`,
  // The Moonlit Meadow (step-2 plan Task 6, ruling 6; numbers: blocks 1 / 1001 / 2001; the beginner
  // plants forward in fog since the Task 6 follow-up, levelStandIns `fogShift`).
  'p2-1 average win': `100 / 100 / 100 (band 80-96): ${BEGINNER_FLOOR} (beginner 82 / 75.5 / 76.5)`,
  'p2-2 average win': `100 / 99.5 / 100 (band 78.5-94.5): ${BEGINNER_FLOOR} (beginner 94.5 / 98 / 95; Easy ×0.9 gives average 97, beginner 59)`,
  'p2-3 average win': `100 / 99.5 / 99.5 (band 76.9-92.9): ${BEGINNER_FLOOR} (beginner 77 / 77.5 / 74.5)`,
  'p2-4 average win': `100 / 100 / 100 (band 75.4-91.4): ${BEGINNER_FLOOR} (beginner 83 / 83 / 86; with the clumps, Medium ×0.45 gives average 98.5-99.5, beginner 14-29)`,
  'p2-5 average win': `100 / 100 / 100 (band 73.8-89.8): ${BEGINNER_FLOOR} (beginner 83.5 / 85 / 85)`,
  'p2-6 average win': `100 / 100 / 100 (band 72.3-88.3): ${BEGINNER_FLOOR} (beginner 88 / 93 / 92; Medium ×0.45 gives average 85.5-88.5, beginner 13.5-31.5)`,
  'p2-7 average win': `100 / 100 / 99.5 (band 70.7-86.7): ${BEGINNER_FLOOR} (beginner 78 / 83 / 75.5)`,
  'p2-8 average win': `100 / 100 / 100 (boss band 64.2-85.2): ${BEGINNER_FLOOR} (beginner 75 / 74 / 76.5; at Howler hp 6200 the average is 87.5-99.5 and the beginner 47-57.5)`,
  // The Frozen Tundra (step-2 plan Task 7, ruling 5; numbers: blocks 1 / 1001 / 2001). The average
  // player wins 100% of z2-1..4, above his win band: the beginner (no stand-in knows a lane is icy
  // but the expert on the belt) falls under his 70% floor long before the average player loses.
  'z2-1 average win': `100 / 100 / 100 (band 80-96): ${TOBY_FLOOR} (no computer: a garden growing every 15 s on a 3000 zombie base gives average 94 with 1% three stars, beginner 34.5)`,
  'z2-2 average win': `100 / 100 / 100 (band 78.5-94.5): ${TOBY_FLOOR} (Medium ×1.6 gives average 94.5, beginner 50.5; ×2.2 average 93, beginner 28)`,
  'z2-3 average win': `100 / 100 / 100 (band 76.9-92.9): ${TOBY_FLOOR} (a 150 s clock with a Peashooter behind every wall gives average 90 with 5% three stars, beginner 40)`,
  'z2-4 average win': `100 / 100 / 100 (band 75.4-91.4): ${TOBY_FLOOR} (Medium ×1.8 gives average 92, beginner 31; Hard ×0.8 average 84, beginner 45)`,
  'z2-3 median length, expert': 'about 1.11 min on every block (average 1.7, beginner 2.15): he stacks the iced lane at once; a base big enough to hold him 1.5 min (9000: 1.42) takes the average player to 2.8 min with 4% three stars',
  'z2-5 median length, average': `about 1.36 / 1.32 / 1.35 min: ${TUNDRA_BELT}`,
  'z2-5 median length, expert': `about 1.12 min on every block: ${TUNDRA_BELT}`,
  // The Desert Canyon (step-3 plan Task 8; numbers: blocks 1 / 1001 / 2001, 200 seeds each; the full
  // table is in the Task 8 report). Misses by level are as the Tasks 6-7 tuning found them. Entries
  // that miss on the default block (1) only, or on two blocks, say so: with LVT_BLOCKS=3 an entry
  // flips (fails) on a block that meets the band.
  'p3-2 average win': '85 / 83 / 82.5 (band 65.1-83.1; trend 74.1): misses on block 1 only, the other blocks sit on the top of the band; beginner 6 / 7.5 / 6.5 (plants have no beginner floor here)',
  'p3-3 average win': '89 / 89 / 90 (trend 72.5, top 81.5): the Cactus-lane garden is a clean level for the sensible player, 57.5 / 58 / 52.5% three stars; expert 96-96.5',
  'p3-6 average win': '77 / 76 / 71 (trend 67.9, top 76.9): misses on block 1 only, by a seed; 3 stars 2 / 2.5 / 1.5%',
  // p3-7 average win passes on block 1 (71) but misses on blocks 2 and 3 (79.5 / 82.5): left unrecorded on purpose.
  'p3-7 median length, beginner': 'about 1.23 min on every block (1.5 minimum): the beginner has lost the 7-garden breakthrough in a minute, at 0% wins',
  'plants world 3: no level harder for the average player than the level two after it': 'p3-1 v p3-3: 79.5 v 88, 74 v 88, 72.5 v 89 (the opening level is the hardest of the three: 72.5-79.5% against 89-90); on blocks 2 and 3 p3-5 v p3-7 (76 v 79.5, 78 v 82.5) misses too',
  'z3-3 median length, expert': 'about 1.42 min on every block (1.5 minimum; average 2.11-2.16, beginner 3.25-3.32 min): he stacks the lane at once',
  'z3-5 the expert three-stars at least 10 points more often than the average player': 'expert 56.5 / 56.5 / 58 v average 56 / 57.5 / 56.5: lead +0.5 / -1 / +1.5 (need +10 within 1): the expert and the average player crack the belt the same way; z3-5 length: average 1.80-1.85 min, expert 1.67-1.68 min (inside the 1.5-4 gate)',
  'z3-6 median length, expert': 'about 1.16 / 1.13 / 1.16 min (1.5 minimum; average 1.98-1.99): he breaks the garden in about a minute',
  'zombies world 3: no level harder for the average player than the level two after it': 'z3-4 v z3-6: 98.5 v 100 and 98.5 v 100 on blocks 1 and 2 (a seed or two: the 1-point slack leaves 99); block 3 is 99 v 100 and holds',
  // The Frozen Tundra, the plants' world 4 (worlds-4 plan Task 6, rulings 1-2; numbers: blocks 1 / 1001 / 2001, 200 seeds
  // each). From p4-4 the win band is the expert floor's to settle (ruling 1), and the 3-star share is held to
  // `plantStarBand`; where neither can be met with the expert at 95% and an idle player losing, the miss is
  // recorded with its numbers. p4-1, p4-2 and p4-4's win band are met.
  'p4-3 average win': `93 / 88.5 / 88.5 (band 52-68): ${TUNDRA_P4_BELT}`,
  'p4-4 average 3 stars': `0 / 0 / 0 (band 43.5-63.5; wins 58 / 58 / 59.5, in the win band): ${TUNDRA_P4_BATTLE}`,
  'p4-5 average win': `100 / 100 / 100 (band 48.9-64.9; 3 stars 58 / 49.5 / 47.5 in the star band, expert 100): ${TUNDRA_P4_SURVIVE}`,
  'p4-6 average win': `70 / 69 / 69 (band 47.4-63.4; expert 94.5 / 95 / 95.5, the floor): the expert floor holds the average player here (a 6300 plant base gave 65.5 / 63.5 / 61 with the expert at 94.5 / 94 / 93.5, under the floor on block 3)`,
  'p4-6 average 3 stars': `1 / 0.5 / 1 (band 41.3-61.3): ${TUNDRA_P4_BATTLE}`,
  'p4-7 average win': `91.5 / 92.5 / 89 (band 45.8-61.8; 3 stars 40 / 42.5 / 43.5 in the star band, expert 99 / 98.5 / 99): ${TUNDRA_P4_SURVIVE_STARS}`,
  'p4-8 average win': `99.5 / 100 / 100 (boss band 39.3-60.3; expert 100): ${TUNDRA_P4_BOSS}`,
  'p4-8 average 3 stars': `8.5 / 9 / 8 (band 34-59; expert 53.5 / 55.5 / 52.5): ${TUNDRA_P4_BOSS}`,
  'plants world 4: no level harder for the average player than the level two after it': 'p4-1 v p4-3: 67 v 93, 66 v 88.5, 71 v 88.5; p4-3 v p4-5: 93 / 88.5 / 88.5 v 100; p4-4 v p4-6: 58 / 58 / 59.5 v 70 / 69 / 69; p4-6 v p4-8: 70 / 69 / 69 v 99.5 / 100 / 100 (the belt and the survive levels take the average player to what the expert gets, and p4-1 sits in the win band, whose top is 71)',
  // The Moonlit Meadow, the zombies' world 4 (worlds-4 plan Task 7, eased by Task 10: eased for a five-year-old, Michal
  // 2026-11-25; numbers: blocks 1 / 1001 / 2001, 200 seeds each). His tap walk lost 12 of 12, so the zombie bases are
  // bigger (2000-6000), the computers' incomes lower and the belt slower and longer; the child stand-in (pace 6) now wins
  // z4-1..z4-3 at 69.5-100 and z4-4, 5, 7 at 43-57% (targets 60 / 40) and the average player and the expert three-star almost always. The
  // star bands and the expert's lead are not met on z4-1, 2, 3, 4, 5 and 7 (z4-3's lead holds) and are recorded here, not loosened.
  'z4-1 average 3 stars': Z4_EASED('average 100 / 100 / 100 (band 46.9-66.9; wins 100, expert 100): plants base 4500 (was 5500) and zombie base 2500 (was 500), so the tap walk (Medium income, random lanes) can win; child 100 / 100 / 100% wins'),
  'z4-1 the expert three-stars at least 10 points more often than the average player': Z4_EASED('expert 100 v average 100 on every block: lead 0 (need +10 within 1)'),
  'z4-2 average 3 stars': Z4_EASED('average 100 / 100 / 100 (band 45.8-65.8; wins 100, expert 100): computer income x1.0 (was x3.6) and zombie base 6000 (was 600), the browser tap walk won 0 of 9 tries here; child 97 / 94.5 / 98% wins'),
  'z4-2 the expert three-stars at least 10 points more often than the average player': Z4_EASED('expert 100 v average 100 on every block: lead 0 (need +10 within 1)'),
  'z4-3 average 3 stars': Z4_EASED('average 88.5 / 90.5 / 89 (band 44.7-64.7; wins 100, expert 100): the 300 s clock (was 240) leaves most of it for the average player; child 80 / 69.5 / 71% wins'),
  'z4-4 average 3 stars': Z4_EASED('average 94.5 / 94 / 96.5 (band 43.5-63.5; wins 100, expert 98 / 99 / 98): computer income x1.8 (was x2.7) and a 2000 zombie base; child 50.5 / 43.5 / 55.5% wins'),
  'z4-4 the expert three-stars at least 10 points more often than the average player': Z4_EASED('expert 98 / 99 / 98 v average 94.5 / 94 / 96.5: lead +3.5 / +5 / +1.5 (need +10 within 1)'),
  'z4-5 average 3 stars': Z4_EASED('average 100 / 100 / 100 (band 42.4-62.4; wins 100, expert 100): plants base 14000 (was 16000), a Peashooter every 24 s (was 12), a 330 s clock (was 270) and a 4000 zombie base; child 45.5 / 57 / 53% wins'),
  'z4-5 the expert three-stars at least 10 points more often than the average player': Z4_EASED('expert 100 v average 100 on every block: lead 0 (need +10 within 1)'),
  'z4-7 average 3 stars': Z4_EASED('average 98.5 / 96.5 / 98.5 (band 40.2-60.2; wins 100, expert 99.5 / 99 / 99.5): computer income x2.0 (was x3.3) and a 2000 zombie base; child 51 / 53.5 / 49.5% wins'),
  'z4-7 the expert three-stars at least 10 points more often than the average player': Z4_EASED('expert 99.5 / 99 / 99.5 v average 98.5 / 96.5 / 98.5: lead +1 / +2.5 / +1 (need +10 within 1)'),
  // Free Play: a graduate holds ten cards a side since worlds 4 (Pumpkin Squash reaches the hand; worlds-4 plan Task 8,
  // blocks 1 / 1001 / 2001, 200 seeds each). Survive is bimodal as in steps 2 and 3: the average player's median is
  // wave 18 / 13.5 / 16 (band 10-20: holds), but 47 / 43 / 44% of his runs pass 20 minutes (was 29 / 24.5 / 24.5 at 9 cards
  // a side); the expert's median is wave 105 / 104 / 105.5 (about 35 min). Not fixed here (content design section 7, risk 6).
  'free play survive: the average player rarely plays over 20 minutes': '47 / 43 / 44% of runs over 20 min (band 0-5; median wave 18 / 13.5 / 16; was 29 / 24.5 / 24.5% at 9 cards a side); the endless budget fix proposed in the step-2 Task 9 report is still not applied',
  // The zombie side of Free Play (Toby's, meant to forgive): the beginner breaks a median 11 gardens on 99.5-100% of seeds
  // (band 5-9) at about 9.75 min; the average player breaks 14 / 15 / 14 (more than the beginner on every block, so the
  // ranking entry that held with nine cards is gone) and the expert 25 (nine cards: beginner 14, average 13 / 14 / 14, expert 24).
  'free play breakthrough beginner': 'median 11 / 11 / 11 gardens (band 5-9; at least one on 100 / 99.5 / 100%, band 70-100 holds) at 9.75 min: ten cards a side let him build most of what the average player builds (14 / 15 / 14)',
};

/**
 * The recorded miss for `name` on the seed block starting at `first`: the key `${name} @${first}`
 * (that block only) or else the plain `name` (every block, as the world 1-3 entries are).
 */
export function knownMiss(name: string, first: number, table: Readonly<Record<string, string>> = KNOWN_MISSES): string | undefined {
  return table[`${name} @${first}`] ?? table[name];
}

/** One test, or `it.fails` when the band is a known miss on this block. */
export function band(name: string, check: () => Promise<void>, first: number): void {
  const miss = knownMiss(name, first);
  if (miss !== undefined) it.fails(`${name} (known miss: ${miss})`, check, LONG_MS);
  else it(name, check, LONG_MS);
}

const within = (v: number, lo: number, hi: number, what: string, slack = SLACK): void => {
  expect(v, what).toBeGreaterThanOrEqual(lo - slack);
  expect(v, what).toBeLessThanOrEqual(hi + slack);
};

/** Every band of `world`'s levels on every seed block (`blocks`); a world without levels yet is a todo. */
export function worldBandTests(world: 1 | 2 | 3 | 4 | 5): void {
  const sides = (['plants', 'zombies'] as const).filter((side) => levelsFor(side, world).length > 0);
  if (sides.length === 0) {
    it.todo(`world ${world} has no levels yet`);
    return;
  }
  for (const first of blocks()) {
    if (world === 1) backyardBandTests(first);
    else curveBandTests(world, sides, first);
  }
}

/** A cache of one level series per level and stand-in on seeds `first`..`first + SEEDS - 1`. */
function levelStats(first: number): (def: LevelDef, who: LevelStandIn) => Promise<LevelStats> {
  const cache = new Map<string, Promise<LevelStats>>();
  return (def, who) => {
    const key = `${def.id}:${who}`;
    let p = cache.get(key);
    if (p === undefined) {
      p = Promise.resolve().then(() => summariseLevel(playLevelSeries(def, who, first, SEEDS)));
      cache.set(key, p);
    }
    return p;
  };
}

/** Seeds the idle-player check plays per level (as `backyard.test.ts`). */
export const IDLE_SEEDS = 20;

/**
 * Worlds 2-5 (ruling 11; step-2 plan rulings 5-6 and step-3 rulings 1-4, `levelGate`): the expert
 * wins at least 95% everywhere and the beginner on Easy at least `beginnerWinMin` (70% through
 * world 2; Toby's 60 / 50% on z3 / z4-z5; none for the plants later); the average player is held to
 * the win band (the plants on every level, z2-1..4), the star band (the other zombie levels: his
 * 3-star share in `averageStarBand`, the expert at least 10 points above it, and he still wins
 * 85%), or the world's boss band (a zombie boss: 3 stars in `bossStarBand`); no level is harder for
 * him (a lower win rate) than the level two after it; an idle player loses every level; every seed
 * ends; median lengths 1.5-4 minutes (a boss up to 5; Toby's "2-3 min" on z3 is a tuning target,
 * recorded, not a gate). Win %, 2*+, 3* and length of every level and stand-in are printed either
 * way (`record`).
 */
function curveBandTests(world: 2 | 3 | 4 | 5, sides: readonly Faction[], first: number): void {
  const bandIn = (name: string, check: () => Promise<void>): void => band(name, check, first);
  const stats = levelStats(first);
  for (const side of sides) {
    const levels = levelsFor(side, world);
    describe(`world ${world} as the ${side} (seeds ${first}..${first + SEEDS - 1})`, () => {
      for (const def of levels) {
        const boss = def.kind === 'boss';
        const i = campaignIndex(def);
        const gate = levelGate(def);
        bandIn(`${def.id} expert win`, async () => within((await stats(def, 'expert')).win, EXPERT_WIN_MIN, 100, def.id));
        const floor = beginnerWinMin(i, side);
        if (floor !== null) bandIn(`${def.id} beginner win`, async () => within((await stats(def, 'beginner')).win, floor, 100, def.id));
        if (gate === 'win') {
          const avg = averageWinBand(i, boss);
          bandIn(`${def.id} average win`, async () => within((await stats(def, 'average')).win, avg.lo, avg.hi, `${def.id} (trend ${avg.target.toFixed(1)})`));
          const plantStar = plantStarBand(def);
          if (plantStar !== null) {
            bandIn(`${def.id} average 3 stars`, async () => within((await stats(def, 'average')).threeStars, plantStar.lo, plantStar.hi, `${def.id} (trend ${plantStar.target.toFixed(1)})`));
          }
        } else if (gate === 'stars') {
          const star = averageStarBand(i);
          bandIn(`${def.id} average 3 stars`, async () => within((await stats(def, 'average')).threeStars, star.lo, star.hi, `${def.id} (trend ${star.target.toFixed(1)})`));
          bandIn(`${def.id} average win`, async () => within((await stats(def, 'average')).win, STAR_LEVEL.averageWinMin, 100, def.id));
          bandIn(`${def.id} the expert three-stars at least ${STAR_LEVEL.expertLead} points more often than the average player`, async () => {
            const lead = (await stats(def, 'expert')).threeStars - (await stats(def, 'average')).threeStars;
            expect(lead, def.id).toBeGreaterThanOrEqual(STAR_LEVEL.expertLead - SLACK);
          });
        } else {
          const boss3 = bossStarBand(world);
          bandIn(`${def.id} boss: average 3 stars`, async () => within((await stats(def, 'average')).threeStars, boss3.lo, boss3.hi, def.id));
        }
        bandIn(`${def.id} an idle player loses (${IDLE_SEEDS} seeds)`, async () => {
          const won = Array.from({ length: IDLE_SEEDS }, (_, k) => playIdle(def, first + k)).filter((r) => r.won).length;
          expect(won, def.id).toBe(0);
        });
        bandIn(`${def.id} every seed ends (clock, base or boss)`, async () => {
          for (const who of GATED_STAND_INS) expect((await stats(def, who)).ends.none, who).toBe(0);
        });
        for (const who of GATED_STAND_INS) {
          bandIn(`${def.id} median length, ${who}`, async () => within((await stats(def, who)).minutes, 1.5, boss ? 5 : 4, def.id, 0));
        }
      }
      bandIn(`${side} world ${world}: no level harder for the average player than the level two after it`, async () => {
        const w = await Promise.all(levels.map(async (d) => (await stats(d, 'average')).win));
        for (let n = 0; n + 2 < w.length; n++) expect(w[n]!, `${levels[n]!.id} v ${levels[n + 2]!.id}`).toBeGreaterThanOrEqual(w[n + 2]! - SLACK);
      });
      it(`${side} world ${world}: the record (win %, 2★+, 3★, median minutes)`, async () => {
        // stdout, not console: the test config keeps console quiet, and this table is wanted either way.
        process.stdout.write(`${await record(levels, stats, `world ${world} as the ${side}, seeds ${first}..${first + SEEDS - 1}`)}\n`);
      }, LONG_MS);
    });
  }
}

/** A table of every level and stand-in: win %, 2★+ %, 3★ %, median minutes. */
async function record(levels: readonly LevelDef[], stats: (def: LevelDef, who: LevelStandIn) => Promise<LevelStats>, title: string): Promise<string> {
  const rows = [`${title}`, `level  ${LEVEL_STAND_INS.map((w) => `${w.padEnd(8)}  win   2+    3*    min`).join(' | ')}`];
  for (const def of levels) {
    const cells = await Promise.all(LEVEL_STAND_INS.map(async (who) => {
      const s = await stats(def, who);
      return `${''.padEnd(8)}${s.win.toFixed(1).padStart(5)} ${s.twoPlus.toFixed(1).padStart(5)} ${s.threeStars.toFixed(1).padStart(5)} ${s.minutes.toFixed(2).padStart(5)}`;
    }));
    rows.push(`${def.id.padEnd(6)} ${cells.join(' | ')}`);
  }
  return rows.join('\n');
}

/** The Backyard's bands on seeds `first`..`first + SEEDS - 1`. */
function backyardBandTests(first: number): void {
  const bandIn = (name: string, check: () => Promise<void>): void => band(name, check, first);
  const stats = levelStats(first);

  for (const side of ['plants', 'zombies'] as const satisfies readonly Faction[]) {
    const levels = levelsFor(side, 1);
    describe(`the Backyard as the ${side} (seeds ${first}..${first + SEEDS - 1})`, () => {
      for (const def of levels) {
        const boss = def.kind === 'boss';
        bandIn(`${def.id} expert win`, async () => within((await stats(def, 'expert')).win, 95, 100, def.id));
        // The average player's band for world 1 (coordinator, after the first review): he wins
        // every level at 90% or more; his challenge here is the stars (below).
        bandIn(`${def.id} average win`, async () => within((await stats(def, 'average')).win, 90, 100, def.id));
        bandIn(`${def.id} beginner win`, async () => within((await stats(def, 'beginner')).win, 70, 100, def.id));
        bandIn(`${def.id} every seed ends (clock, base or boss)`, async () => {
          for (const who of GATED_STAND_INS) expect((await stats(def, who)).ends.none, who).toBe(0);
        });
        for (const who of GATED_STAND_INS) {
          bandIn(`${def.id} median length, ${who}`, async () => within((await stats(def, who)).minutes, 1.5, boss ? 5 : 4, def.id, 0));
        }
        bandIn(`${def.id} expert 3 stars`, async () => within((await stats(def, 'expert')).threeStars, 50, 100, def.id));
        bandIn(`${def.id} average 3 stars`, async () => within((await stats(def, 'average')).threeStars, 20, 100, def.id));
        if (def.kind === 'breakthrough') {
          // Skill shows (Task 8 review): the expert breaks the garden in time more often than the average player.
          bandIn(`${def.id} the expert three-stars at least 5 points more often than the average player`, async () => {
            expect((await stats(def, 'expert')).threeStars - (await stats(def, 'average')).threeStars).toBeGreaterThanOrEqual(5);
          });
        }
      }
      const all = (who: LevelStandIn, read: (s: LevelStats) => number): Promise<number[]> =>
        Promise.all(levels.map(async (d) => read(await stats(d, who))));
      bandIn(`${side} boss: average 3 stars`, async () => within((await all('average', (s) => s.threeStars))[7]!, 35, 60, 'level 8'));
      // The trend of the average player's 3 stars, in two parts so each holds or misses on its own.
      bandIn(`${side} average 3 stars: the second half three-starred less often than the first`, async () => {
        const w = await all('average', (s) => s.threeStars);
        const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
        expect(mean(w.slice(4)), 'second half').toBeLessThan(mean(w.slice(0, 4)));
      });
      bandIn(`${side} average 3 stars: no level more than 15 points above the level two before it`, async () => {
        const w = await all('average', (s) => s.threeStars);
        for (let n = 2; n < w.length; n++) expect(w[n]!, `level ${n + 1} v ${n - 1}`).toBeLessThanOrEqual(w[n - 2]! + 15);
      });
      bandIn(`${side} no level harder for the average player than the level two after it`, async () => {
        // Harder = a lower win rate. The 1-point allowance (the brief's "within 1 point") lets equal
        // levels differ by a seed or two.
        const w = await all('average', (s) => s.win);
        for (let n = 0; n + 2 < w.length; n++) expect(w[n]!, `level ${n + 1} v ${n + 3}`).toBeGreaterThanOrEqual(w[n + 2]! - SLACK);
      });
      bandIn(`${side} the beginner's curve: neighbours within 10 points`, async () => {
        const w = await all('beginner', (s) => s.win);
        for (let n = 0; n + 1 < w.length; n++) expect(Math.abs(w[n + 1]! - w[n]!), `level ${n + 1} v ${n + 2}`).toBeLessThanOrEqual(10 + SLACK);
      });
    });
  }
}

/** Free Play's bands on every seed block (`blocks`). */
export function freePlayBandTests(): void {
  for (const first of blocks()) freePlayBlock(first);
}

function freePlayBlock(first: number): void {
  const bandIn = (name: string, check: () => Promise<void>): void => band(name, check, first);
  const free = new Map<string, Promise<FreePlayStats>>();
  const freeStats = (side: Faction, who: LevelStandIn): Promise<FreePlayStats> => {
    const key = `${side}:${who}`;
    let p = free.get(key);
    if (p === undefined) {
      p = Promise.resolve().then(() => summariseFreePlay(Array.from({ length: SEEDS }, (_, i) => playFreePlay(side, who, first + i))));
      free.set(key, p);
    }
    return p;
  };

  describe(`Free Play's first steps (seeds ${first}..${first + SEEDS - 1})`, () => {
    bandIn('free play survive beginner', async () => within((await freeStats('plants', 'beginner')).medianScore, 4, 8, 'waves', 0));
    bandIn('free play survive average', async () => within((await freeStats('plants', 'average')).medianScore, 10, 20, 'waves', 0));
    bandIn('free play survive expert', async () => within((await freeStats('plants', 'expert')).medianScore, 25, Infinity, 'waves', 0));
    bandIn('free play survive: the average player rarely plays over 20 minutes', async () => {
      within((await freeStats('plants', 'average')).over20, 0, 5, 'share over 20 min');
    });
    // The coordinator's fair reading after the clock bonus went to 45 s: the beginner breaks 3-6
    // gardens (at least one on 70% of seeds); a ranking by skill is recorded, not tuned for.
    // Re-banded in step-2 Task 9: since the gardens carry the Meadow's Mango-pult and Avocado Bunker
    // (dearer plants, fewer of them a garden) the beginner breaks a median 7 / 7 / 8 (blocks 1 / 1001
    // / 2001; at least one on 97.5-98.5%), the average 10 and the expert 17-18: the same width of
    // band (4) round where he now is, 5-9. The zombie side is Toby's and meant to forgive; the
    // ranking checks below are unchanged.
    bandIn('free play breakthrough beginner', async () => {
      const s = await freeStats('zombies', 'beginner');
      within(s.atLeastOne, 70, 100, 'share with a garden');
      within(s.medianScore, 5, 9, 'gardens', 0);
    });
    bandIn('free play breakthrough: the average player breaks more gardens than the beginner', async () => {
      expect((await freeStats('zombies', 'average')).medianScore).toBeGreaterThan((await freeStats('zombies', 'beginner')).medianScore);
    });
    bandIn('free play breakthrough: the expert breaks more gardens than the average player and the beginner', async () => {
      const e = (await freeStats('zombies', 'expert')).medianScore;
      expect(e).toBeGreaterThan((await freeStats('zombies', 'average')).medianScore);
      expect(e).toBeGreaterThan((await freeStats('zombies', 'beginner')).medianScore);
    });
  });
}
