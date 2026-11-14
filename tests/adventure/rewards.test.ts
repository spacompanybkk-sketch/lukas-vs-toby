import { describe, expect, it } from 'vitest';
import { applyLevelResult, starsFor } from '../../src/adventure/rewards';
import type { LevelDef } from '../../src/adventure/types';
import { newSave, parseSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { SAMPLE_BATTLE, SAMPLE_SURVIVE } from './sampleLevels';

const T0 = 1_762_900_000_000;
const fresh = (): Save => newSave('p01', 'Lukas', 'peashooter', T0);
const BREAKTHROUGH: LevelDef = { ...SAMPLE_BATTLE, id: 'z1-4', side: 'zombies', kind: 'breakthrough', seconds: 120 };

describe('starsFor', () => {
  it.each<[number, 0 | 1 | 2 | 3]>([
    [0, 1], [0.499, 1], [0.4999, 1], [0.5, 2], [0.799, 2], [0.7999, 2], [0.8, 3], [1, 3],
  ])('a won battle with %f of the base left gives %i', (share, stars) => {
    expect(starsFor(SAMPLE_BATTLE, { won: true, baseHpShare: share, clockShareLeft: 0 })).toBe(stars);
    expect(starsFor(SAMPLE_SURVIVE, { won: true, baseHpShare: share, clockShareLeft: 1 })).toBe(stars);
  });

  it.each<[number, 0 | 1 | 2 | 3]>([
    [0, 1], [0.249, 1], [0.25, 2], [0.499, 2], [0.5, 3], [1, 3],
  ])('a won Breakthrough with %f of the clock left gives %i (base health does not count)', (left, stars) => {
    expect(starsFor(BREAKTHROUGH, { won: true, baseHpShare: 1, clockShareLeft: left })).toBe(stars);
    expect(starsFor(BREAKTHROUGH, { won: true, baseHpShare: 0.1, clockShareLeft: left })).toBe(stars);
  });

  it('a loss gives no star, whatever is left', () => {
    expect(starsFor(SAMPLE_BATTLE, { won: false, baseHpShare: 1, clockShareLeft: 1 })).toBe(0);
    expect(starsFor(BREAKTHROUGH, { won: false, baseHpShare: 1, clockShareLeft: 1 })).toBe(0);
  });
});

describe('applyLevelResult: coins', () => {
  it.each<[0 | 1 | 2 | 3, number]>([[1, 30], [2, 60], [3, 90]])(
    'the first win with %i stars pays %i coins', (stars, coins) => {
      const r = applyLevelResult(fresh(), SAMPLE_BATTLE, stars, T0 + 10, 'b1');
      expect(r.coins).toBe(coins);
      expect(r.newStars).toBe(stars);
      expect(r.save.coins).toBe(coins);
      expect(r.save.plants.stars).toEqual({ 'p1-1': stars });
    },
  );

  it.each<[0 | 1 | 2 | 3, 0 | 1 | 2 | 3, number, number, 0 | 1 | 2 | 3]>([
    // before, now, coins, new stars, stored
    [1, 3, 60, 2, 3],
    [2, 3, 30, 1, 3],
    [1, 2, 30, 1, 2],
    [3, 3, 10, 0, 3],
    [2, 2, 10, 0, 2],
    [3, 1, 10, 0, 3],
    [2, 1, 10, 0, 2],
  ])('a level at %i stars won with %i pays %i (%i new) and keeps %i', (before, now, coins, newStars, stored) => {
    const s: Save = { ...fresh(), coins: 100, plants: { stars: { 'p1-1': before }, unlocked: [] } };
    const r = applyLevelResult(s, SAMPLE_BATTLE, now, T0 + 10, 'b2');
    expect(r.coins).toBe(coins);
    expect(r.newStars).toBe(newStars);
    expect(r.save.coins).toBe(100 + coins);
    expect(r.save.plants.stars['p1-1']).toBe(stored);
  });

  it.each<[0 | 1 | 2 | 3 | undefined]>([[undefined], [0], [2], [3]])('a loss pays 5 and leaves the stars (%s) alone', (before) => {
    const stars: Save['plants']['stars'] = before === undefined ? {} : { 'p1-1': before };
    const s: Save = { ...fresh(), plants: { stars, unlocked: [] } };
    const r = applyLevelResult(s, SAMPLE_BATTLE, 0, T0 + 10, 'b3');
    expect(r).toMatchObject({ coins: 5, newStars: 0, unlocked: null });
    expect(r.save.coins).toBe(5);
    expect(r.save.plants.stars).toEqual(stars);
    expect(r.save.lastBattle).toBe('b3');
  });

  it('a second 3-star win pays 10 and changes nothing else', () => {
    const first = applyLevelResult(fresh(), SAMPLE_SURVIVE, 3, T0 + 10, 'b1').save;
    const second = applyLevelResult(first, SAMPLE_SURVIVE, 3, T0 + 20, 'b2');
    expect(second.coins).toBe(10);
    expect(second.newStars).toBe(0);
    expect(second.unlocked).toBeNull();
    const { coins: c1, lastBattle: l1, updatedAt: u1, ...rest1 } = first;
    const { coins: c2, lastBattle: l2, updatedAt: u2, ...rest2 } = second.save;
    expect(rest2).toEqual(rest1);
    expect([c1, c2, l1, l2]).toEqual([90, 100, 'b1', 'b2']);
    expect(u2).toBeGreaterThan(u1);
  });

  it('stars of the other side are not touched', () => {
    const s: Save = { ...fresh(), zombies: { stars: { 'p1-1': 1 }, unlocked: [] } };
    const r = applyLevelResult(s, SAMPLE_BATTLE, 3, T0 + 10, 'b1');
    expect(r.save.zombies).toEqual({ stars: { 'p1-1': 1 }, unlocked: [] });
    expect(r.save.plants.stars).toEqual({ 'p1-1': 3 });
  });
});

describe('applyLevelResult: unlocks', () => {
  it('the first win on an unlock level grants its card once', () => {
    const r1 = applyLevelResult(fresh(), SAMPLE_SURVIVE, 1, T0 + 10, 'b1');
    expect(r1.unlocked).toBe('potatoMine');
    expect(r1.save.plants.unlocked).toEqual(['potatoMine']);
    const r2 = applyLevelResult(r1.save, SAMPLE_SURVIVE, 3, T0 + 20, 'b2');
    expect(r2.unlocked).toBeNull();
    expect(r2.save.plants.unlocked).toEqual(['potatoMine']);
  });

  it('a loss unlocks nothing', () => {
    const r = applyLevelResult(fresh(), SAMPLE_SURVIVE, 0, T0 + 10, 'b1');
    expect(r.unlocked).toBeNull();
    expect(r.save.plants.unlocked).toEqual([]);
  });

  it('a card already unlocked (merged from another device) is not granted again', () => {
    const s: Save = { ...fresh(), plants: { stars: {}, unlocked: ['kernelPult', 'potatoMine'] } };
    const r = applyLevelResult(s, SAMPLE_SURVIVE, 2, T0 + 10, 'b1');
    expect(r.unlocked).toBeNull();
    expect(r.save.plants.unlocked).toEqual(['kernelPult', 'potatoMine']);
  });

  it('a card among the first three is never stored as an unlock', () => {
    const r = applyLevelResult(fresh(), { ...SAMPLE_SURVIVE, unlocks: 'sunflower' }, 2, T0 + 10, 'b1');
    expect(r.unlocked).toBeNull();
    expect(r.save.plants.unlocked).toEqual([]);
  });
});

describe('applyLevelResult: exactly once per battle (review-focus 4)', () => {
  it('applying the same battle id again changes nothing and pays nothing', () => {
    const r1 = applyLevelResult(fresh(), SAMPLE_SURVIVE, 3, T0 + 10, 'battle-7');
    expect(r1.save.lastBattle).toBe('battle-7');
    const r2 = applyLevelResult(r1.save, SAMPLE_SURVIVE, 3, T0 + 20, 'battle-7');
    expect(r2.save).toBe(r1.save);
    expect(r2).toEqual({ save: r1.save, coins: 0, newStars: 0, unlocked: null });
    const lost = applyLevelResult(r1.save, SAMPLE_SURVIVE, 0, T0 + 20, 'battle-7');
    expect(lost.save).toBe(r1.save);
  });

  it('remembers only the LAST battle id: A, B, then A again pays A twice (callers use fresh ids)', () => {
    const a = applyLevelResult(fresh(), SAMPLE_BATTLE, 3, T0 + 10, 'A');
    const b = applyLevelResult(a.save, SAMPLE_BATTLE, 3, T0 + 20, 'B');
    const a2 = applyLevelResult(b.save, SAMPLE_BATTLE, 3, T0 + 30, 'A');
    expect([a.coins, b.coins, a2.coins]).toEqual([90, 10, 10]);
    expect(a2.save.coins).toBe(110);
    expect(a2.save.lastBattle).toBe('A');
  });

  it('survives a trip through the wire format (a reload on the result screen)', () => {
    const r1 = applyLevelResult(fresh(), SAMPLE_BATTLE, 2, T0 + 10, 'battle-8');
    const reloaded = parseSave(JSON.parse(JSON.stringify(r1.save)))!;
    expect(applyLevelResult(reloaded, SAMPLE_BATTLE, 2, T0 + 20, 'battle-8').save).toBe(reloaded);
  });

  it('touches the save, leaves its input unchanged and stays a valid save', () => {
    const s = fresh();
    const before = JSON.stringify(s);
    const r = applyLevelResult(s, SAMPLE_SURVIVE, 2, T0 + 10, 'b1');
    expect(JSON.stringify(s)).toBe(before);
    expect(r.save.updatedAt).toBe(T0 + 10);
    expect(parseSave(r.save)).toEqual(r.save);
  });
});
