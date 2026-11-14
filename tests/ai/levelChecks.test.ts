import { describe, expect, it } from 'vitest';
import { LEVELS, levelById } from '../../src/adventure/levels';
import type { LevelDef } from '../../src/adventure/types';
import {
  AVERAGE_STARS, BOSS_THREE_STARS, FAVOURITE_COUNT, STAR_LEVEL, averageCoinsOn, averageStarBand, averageUpgrades, averageWinBand,
  beginnerWinMin, campaignIndex, coinsBefore, EXPERT_WIN_MIN, favouritesAt, playIdle, standInSave, worldTwoGate,
} from '../../src/ai/levelChecks';
import { FAVOURITES } from '../../src/ai/levelStandIns';
import { upgradeCost } from '../../src/progress/upgrades';
import type { CardKey, Faction } from '../../src/sim/types';

/** A stand-in level for a campaign that does not exist yet: only what the coin model reads. */
function stub(side: Faction, i: number, unlocks: CardKey | null = null): LevelDef {
  const world = (Math.floor((i - 1) / 8) + 1) as 1 | 2 | 3 | 4 | 5;
  return {
    id: `${side[0]}${world}-${((i - 1) % 8) + 1}`, side, world, n: ((i - 1) % 8) + 1, kind: 'battle', cards: [], opponent: null,
    waves: [], prepared: [], seconds: null, belt: null, boss: null, startEnergy: null, spells: true, unlocks, teaches: null,
  };
}

describe('the campaign index and the curve bands (ruling 11)', () => {
  it('counts eight levels a world: p1-1 is 1, w2-1 is 9, w5-8 is 40', () => {
    expect(campaignIndex(levelById('p1-1')!)).toBe(1);
    expect(campaignIndex(levelById('z1-8')!)).toBe(8);
    expect(campaignIndex({ world: 2, n: 1 })).toBe(9);
    expect(campaignIndex({ world: 5, n: 8 })).toBe(40);
  });

  it('the average band: world 1 wins 90% or more (A18); from level 9, 88 − 48·(i−9)/31 ± 8, a boss 5 lower', () => {
    expect(averageWinBand(1, false)).toEqual({ target: 100, lo: 90, hi: 100 });
    expect(averageWinBand(8, true)).toEqual({ target: 100, lo: 90, hi: 100 });
    expect(averageWinBand(9, false)).toEqual({ target: 88, lo: 80, hi: 96 });
    expect(averageWinBand(40, false)).toEqual({ target: 40, lo: 32, hi: 48 });
    expect(averageWinBand(40, true)).toEqual({ target: 40, lo: 27, hi: 48 });
    const mid = averageWinBand(24, false);
    expect(mid.target).toBeCloseTo(88 - (48 * 15) / 31, 10);
    expect(() => averageWinBand(0, false)).toThrow(RangeError);
    expect(() => averageWinBand(41, false)).toThrow(RangeError);
  });

  it('the expert wins at least 95% everywhere; the beginner on Easy at least 70% through world 2, then none', () => {
    expect(EXPERT_WIN_MIN).toBe(95);
    expect(beginnerWinMin(1)).toBe(70);
    expect(beginnerWinMin(16)).toBe(70);
    expect(beginnerWinMin(17)).toBeNull();
  });
});

describe('the average player\'s coins and upgrades (real Marketplace prices)', () => {
  it('coins on a level the first time: his stars at 30 each, plus 5 for every loss he is reckoned to take first', () => {
    expect(averageCoinsOn(1)).toBeCloseTo(AVERAGE_STARS.backyard * 30, 10);
    // Level 9: two stars, and 0.12 / 0.88 losses before the win.
    expect(averageCoinsOn(9)).toBeCloseTo(AVERAGE_STARS.later * 30 + 5 * (0.12 / 0.88), 10);
    expect(averageCoinsOn(40)).toBeCloseTo(AVERAGE_STARS.later * 30 + 5 * (0.6 / 0.4), 10);
  });

  it('coinsBefore counts the earlier levels of the side only, at that rate', () => {
    expect(coinsBefore(levelById('p1-1')!)).toBe(0);
    expect(coinsBefore(levelById('z1-1')!)).toBe(0);
    expect(coinsBefore(levelById('p1-8')!)).toBe(Math.floor(7 * averageCoinsOn(1)));
  });

  it('his favourites: the three he starts with, then also the two newest unlocks', () => {
    expect(FAVOURITE_COUNT).toBe(5);
    expect(favouritesAt('plants', [])).toEqual(FAVOURITES.plants);
    expect(favouritesAt('plants', ['potatoMine', 'kernelPult'])).toEqual([...FAVOURITES.plants, 'potatoMine', 'kernelPult']);
    expect(favouritesAt('plants', ['potatoMine', 'kernelPult', 'mangoPult'])).toEqual([...FAVOURITES.plants, 'kernelPult', 'mangoPult']);
  });

  it('buys, after every level, the cheapest next level among his favourites while the coins last', () => {
    for (const def of LEVELS) {
      const ups = averageUpgrades(def, LEVELS);
      const spent = Object.values(ups).reduce((n, lv) => n + Array.from({ length: lv }, (_, k) => upgradeCost(k + 1)).reduce((a, c) => a + c, 0), 0);
      expect(spent, def.id).toBeLessThanOrEqual(coinsBefore(def));
      for (const key of Object.keys(ups)) expect(FAVOURITES[def.side].includes(key as CardKey) || LEVELS.some((l) => l.unlocks === key), def.id).toBe(true);
    }
    // The Backyard's boss: 567 coins buy level 1 on five favourites (500).
    const p8 = levelById('p1-8')!;
    expect(averageUpgrades(p8, LEVELS)).toEqual({ peashooter: 1, sunflower: 1, walnutBomb: 1, potatoMine: 1, kernelPult: 1 });
    expect(standInSave('average', p8).upgrades).toEqual(averageUpgrades(p8, LEVELS));
    expect(standInSave('expert', p8).upgrades).toEqual({});
    expect(standInSave('beginner', p8).upgrades).toEqual({});
  });

  it('by campaign level 40 (unlocks at 3, 6, 11, 14, 19, 22, 27) he holds level 2–3 upgrades', () => {
    const order: CardKey[] = ['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash'];
    const at = [3, 6, 11, 14, 19, 22, 27];
    const levels = Array.from({ length: 40 }, (_, k) => stub('plants', k + 1, at.includes(k + 1) ? order[at.indexOf(k + 1)]! : null));
    const last = levels[39]!;
    const ups = averageUpgrades(last, levels);
    const coins = coinsBefore(last, levels);
    expect(coins).toBeGreaterThan(2400);
    expect(coins).toBeLessThan(2800);
    expect(Math.max(...Object.values(ups))).toBeLessThanOrEqual(3);
    expect(ups.peashooter).toBeGreaterThanOrEqual(2);
    expect(standInSave('average', last, levels).plants.unlocked).toEqual(order);
  });
});

describe('world 2\'s bands (step-2 plan rulings 5-6)', () => {
  it('the win band at i = 9, 13, 16: 88 − 48·(i−9)/31 ± 8, the boss 5 lower', () => {
    expect(averageWinBand(9, false)).toEqual({ target: 88, lo: 80, hi: 96 });
    const at13 = averageWinBand(13, false);
    expect(at13.target).toBeCloseTo(81.806, 3);
    expect([at13.lo, at13.hi].map((v) => Number(v.toFixed(1)))).toEqual([73.8, 89.8]);
    const at16 = averageWinBand(16, true);
    expect(at16.target).toBeCloseTo(77.161, 3);
    expect([at16.lo, at16.hi].map((v) => Number(v.toFixed(1)))).toEqual([64.2, 85.2]);
  });

  it('the star band at i = 9, 13, 16: 75 − 35·(i−9)/31 ± 10 (content design §4: z2-5 60.5-80.5, z2-7 58.2-78.2)', () => {
    expect(averageStarBand(9)).toEqual({ target: 75, lo: 65, hi: 85 });
    const at13 = averageStarBand(13);
    expect([at13.target, at13.lo, at13.hi].map((v) => Number(v.toFixed(1)))).toEqual([70.5, 60.5, 80.5]);
    expect(Number(averageStarBand(15).lo.toFixed(1))).toBe(58.2);
    const at16 = averageStarBand(16);
    expect(at16.target).toBeCloseTo(75 - (35 * 7) / 31, 10);
    expect(at16.hi - at16.lo).toBe(20);
    expect(averageStarBand(40)).toEqual({ target: 40, lo: 30, hi: 50 });
    expect(() => averageStarBand(8)).toThrow(RangeError);
    expect(() => averageStarBand(41)).toThrow(RangeError);
  });

  it('the gate: plants the win band on all eight; zombies the win band on 1-4, the star band on 5-7, world 1\'s boss band on 8', () => {
    for (let n = 1; n <= 8; n++) expect(worldTwoGate({ side: 'plants', n, kind: n === 8 ? 'boss' : 'battle' })).toBe('win');
    const zombies = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => worldTwoGate({ side: 'zombies', n, kind: n === 8 ? 'boss' : 'battle' }));
    expect(zombies).toEqual(['win', 'win', 'win', 'win', 'stars', 'stars', 'stars', 'boss']);
    expect(STAR_LEVEL).toEqual({ averageWinMin: 85, expertLead: 10 });
    expect(BOSS_THREE_STARS).toEqual({ lo: 35, hi: 60 });
    expect(beginnerWinMin(16)).toBe(70);
  });

  it('the idle-player hook: nobody in the seat loses a battle and wins p1-3, the hold-out where waiting is the point', () => {
    expect(playIdle(levelById('p1-1')!, 1).won).toBe(false);
    expect(playIdle(levelById('z1-2')!, 1).won).toBe(false);
    expect(playIdle(levelById('p1-3')!, 1).won).toBe(true);
  });
});
