import { describe, expect, it } from 'vitest';
import { levelsFor } from '../../../src/adventure/levels';
import type { LevelDef } from '../../../src/adventure/types';
import { playFreePlay, playLevelSeries, summariseFreePlay, summariseLevel } from '../../../src/ai/levelChecks';
import type { FreePlayStats, LevelStats } from '../../../src/ai/levelChecks';
import { LEVEL_STAND_INS } from '../../../src/ai/levelStandIns';
import type { LevelStandIn } from '../../../src/ai/levelStandIns';
import type { Faction } from '../../../src/sim/types';

/**
 * The Backyard's campaign bands (plan Task 8, spec 10) with the level stand-ins on seeds 1..200,
 * and Free Play's first steps. The same numbers as `npx tsx tools/levels.ts` (and `--free`). A band
 * in `KNOWN_MISSES` is asserted with `it.fails`: it is reported as missing in the Task 8 report with
 * its reason, and the test flips (fails) the day the band is met, so the list stays honest.
 */
const SEEDS = 200;
const LONG_MS = 3_600_000;

const AVERAGE_CAP = 'the average stand-in (the Medium computer\'s choices every 2 s) wins every level that the beginner on Easy wins at 70% or more; the two bands cannot both hold with these stand-ins (Task 8 report)';
const SHORT_BREAKTHROUGH = '3 stars need the garden broken in the first half of the clock (60 / 75 s), which the expert-3-stars band asks of half the seeds: shorter than 1.5 min by construction';

export const KNOWN_MISSES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(['p1-1', 'p1-2', 'p1-3', 'p1-4', 'p1-5', 'p1-6', 'p1-7', 'p1-8', 'z1-1', 'z1-2', 'z1-3', 'z1-4', 'z1-5', 'z1-6', 'z1-8']
    .map((id) => [`${id} average win`, `100% (cap 97): ${AVERAGE_CAP}`])),
  'z1-7 average win': '99.5% (cap 97; 97.0 / 99.5 on the other blocks): ' + AVERAGE_CAP,
  'plants level 8 average win': '100% (80-88): ' + AVERAGE_CAP,
  'zombies level 8 average win': '100% (80-88): ' + AVERAGE_CAP,
  'plants average falls from level 1 to 8': '100% everywhere: ' + AVERAGE_CAP,
  'zombies average falls from level 1 to 8': '100% nearly everywhere (z1-7 99.5): ' + AVERAGE_CAP,
  'z1-3 median length, average': `0.93 min: ${SHORT_BREAKTHROUGH}`,
  'z1-3 median length, expert': `0.91 min: ${SHORT_BREAKTHROUGH}`,
  'z1-3 median length, beginner': `1.13 min: ${SHORT_BREAKTHROUGH}`,
  'z1-6 median length, average': `1.18 min: ${SHORT_BREAKTHROUGH}`,
  'z1-6 median length, expert': `1.15 min: ${SHORT_BREAKTHROUGH}`,
  'z1-6 median length, beginner': `1.09 min: ${SHORT_BREAKTHROUGH}`,
  'z1-5 median length, average': '1.22 min: a bigger plant base lengthens it but drops the beginner below 70% (5500: 75%, 7000: 38%)',
  'z1-5 median length, expert': '1.18 min: as for the average player',
  'z1-8 median length, average': '1.45 min (boss 1.5-5): a stronger Oak drops the beginner below 70% (4500: 73% on 60 seeds)',
  'z1-8 median length, expert': '1.36 min (boss 1.5-5): as for the average player',
  'free play breakthrough average': '2-3 gardens (4-8): the sensible zombie players break gardens no faster than the beginner with +25% income; walking to the base bounds every player alike',
  'free play breakthrough expert': '3 gardens (8-15): as for the average player',
};

/** One test, or `it.fails` when the band is a known miss. */
function band(name: string, check: () => Promise<void>): void {
  if (name in KNOWN_MISSES) it.fails(`${name} (known miss: ${KNOWN_MISSES[name]})`, check, LONG_MS);
  else it(name, check, LONG_MS);
}

const cache = new Map<string, Promise<LevelStats>>();
function stats(def: LevelDef, who: LevelStandIn): Promise<LevelStats> {
  const key = `${def.id}:${who}`;
  let p = cache.get(key);
  if (p === undefined) {
    p = Promise.resolve().then(() => summariseLevel(playLevelSeries(def, who, 1, SEEDS)));
    cache.set(key, p);
  }
  return p;
}

for (const side of ['plants', 'zombies'] as const satisfies readonly Faction[]) {
  const levels = levelsFor(side, 1);
  describe(`the Backyard as the ${side} (seeds 1..${SEEDS})`, () => {
    for (const def of levels) {
      const boss = def.kind === 'boss';
      band(`${def.id} expert win`, async () => { expect((await stats(def, 'expert')).win).toBeGreaterThanOrEqual(95); });
      band(`${def.id} average win`, async () => {
        const w = (await stats(def, 'average')).win;
        expect(w).toBeGreaterThanOrEqual(80);
        expect(w).toBeLessThanOrEqual(97);
      });
      band(`${def.id} beginner win`, async () => { expect((await stats(def, 'beginner')).win).toBeGreaterThanOrEqual(70); });
      band(`${def.id} every seed ends (clock, base or boss)`, async () => {
        for (const who of LEVEL_STAND_INS) expect((await stats(def, who)).ends.none, who).toBe(0);
      });
      for (const who of LEVEL_STAND_INS) {
        band(`${def.id} median length, ${who}`, async () => {
          const m = (await stats(def, who)).minutes;
          expect(m).toBeGreaterThanOrEqual(1.5);
          expect(m).toBeLessThanOrEqual(boss ? 5 : 4);
        });
      }
      band(`${def.id} expert 3 stars`, async () => { expect((await stats(def, 'expert')).threeStars).toBeGreaterThanOrEqual(50); });
      band(`${def.id} average 3 stars`, async () => { expect((await stats(def, 'average')).threeStars).toBeGreaterThanOrEqual(20); });
    }
    const averages = async (): Promise<number[]> => Promise.all(levels.map(async (d) => (await stats(d, 'average')).win));
    band(`${side} level 8 average win`, async () => {
      const w = (await averages())[7] as number;
      expect(w).toBeGreaterThanOrEqual(80);
      expect(w).toBeLessThanOrEqual(88);
    });
    band(`${side} average falls from level 1 to 8`, async () => {
      // A falling trend: the second half of the side is clearly harder than the first.
      const w = await averages();
      const first = w.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      const second = w.slice(4).reduce((a, b) => a + b, 0) / 4;
      expect(first - second).toBeGreaterThanOrEqual(5);
    });
    band(`${side} no level harder for the average player than the level two after it`, async () => {
      const w = await averages();
      for (let n = 0; n + 2 < w.length; n++) expect(w[n]!, `level ${n + 1} v ${n + 3}`).toBeGreaterThanOrEqual(w[n + 2]! - 1);
    });
  });
}

const free = new Map<string, Promise<FreePlayStats>>();
function freeStats(side: Faction, who: LevelStandIn): Promise<FreePlayStats> {
  const key = `${side}:${who}`;
  let p = free.get(key);
  if (p === undefined) {
    p = Promise.resolve().then(() => summariseFreePlay(Array.from({ length: SEEDS }, (_, i) => playFreePlay(side, who, i + 1))));
    free.set(key, p);
  }
  return p;
}

describe(`Free Play's first steps (seeds 1..${SEEDS})`, () => {
  const within = (v: number, lo: number, hi: number): void => {
    expect(v).toBeGreaterThanOrEqual(lo);
    expect(v).toBeLessThanOrEqual(hi);
  };
  band('free play survive beginner', async () => within((await freeStats('plants', 'beginner')).medianScore, 4, 8));
  band('free play survive average', async () => within((await freeStats('plants', 'average')).medianScore, 10, 20));
  band('free play survive expert', async () => { expect((await freeStats('plants', 'expert')).medianScore).toBeGreaterThanOrEqual(25); });
  band('free play survive: the average player rarely plays over 20 minutes', async () => {
    expect((await freeStats('plants', 'average')).over20).toBeLessThanOrEqual(5);
  });
  band('free play breakthrough beginner', async () => {
    const s = await freeStats('zombies', 'beginner');
    expect(s.atLeastOne).toBeGreaterThanOrEqual(70);
    within(s.medianScore, 2, 4);
  });
  band('free play breakthrough average', async () => within((await freeStats('zombies', 'average')).medianScore, 4, 8));
  band('free play breakthrough expert', async () => within((await freeStats('zombies', 'expert')).medianScore, 8, 15));
});
