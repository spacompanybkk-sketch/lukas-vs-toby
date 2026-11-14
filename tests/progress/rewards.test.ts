import { describe, expect, it } from 'vitest';
import { REWARDS, applyBattleResult, rewardFor } from '../../src/progress/rewards';
import { newSave } from '../../src/progress/save';
import type { Skill } from '../../src/ai/bot';

const T0 = 1_762_900_000_000;

describe('REWARDS', () => {
  it('holds the numbers of the plan', () => {
    expect(REWARDS).toEqual({ win: { easy: 20, medium: 40, hard: 70 }, bonusShare: 0.8, bonusFactor: 1.5, roundTo: 5, loss: 5 });
  });
});

describe('rewardFor', () => {
  it.each<[boolean, Skill, number, number]>([
    [true, 'easy', 0.5, 20],
    [true, 'medium', 0.5, 40],
    [true, 'hard', 0.5, 70],
    [true, 'easy', 0.79, 20],
    [true, 'easy', 0.8, 30],
    [true, 'medium', 0.8, 60],
    [true, 'hard', 0.8, 105],
    [true, 'hard', 1, 105],
    [false, 'easy', 0, 5],
    [false, 'hard', 1, 5],
  ])('won %s on %s keeping %s of the base → %i', (won, skill, baseHpShare, coins) => {
    expect(rewardFor({ won, skill, baseHpShare })).toBe(coins);
  });
});

describe('applyBattleResult', () => {
  const s = { ...newSave('p01', 'Lukas', 'peashooter', T0), coins: 10 };

  it('a win against the computer pays coins and counts', () => {
    const t = applyBattleResult(s, { won: true, skill: 'medium', baseHpShare: 0.9, versus: false }, T0 + 1000);
    expect(t.coins).toBe(70);
    expect(t.computerWins).toBe(1);
    expect(t.versusWins).toBe(0);
    expect(t.updatedAt).toBe(T0 + 1000);
    expect(s.coins).toBe(10);
  });

  it('a loss against the computer pays 5 and counts nothing', () => {
    const t = applyBattleResult(s, { won: false, skill: 'hard', baseHpShare: 0, versus: false }, T0 + 1000);
    expect(t.coins).toBe(15);
    expect(t.computerWins).toBe(0);
  });

  it('versus pays no coins; a versus win counts', () => {
    const win = applyBattleResult(s, { won: true, skill: 'hard', baseHpShare: 1, versus: true }, T0 + 1000);
    expect(win.coins).toBe(10);
    expect(win.versusWins).toBe(1);
    expect(win.computerWins).toBe(0);
    const loss = applyBattleResult(s, { won: false, skill: 'hard', baseHpShare: 1, versus: true }, T0 + 1000);
    expect(loss.coins).toBe(10);
    expect(loss.versusWins).toBe(0);
    expect(loss.updatedAt).toBe(T0 + 1000);
  });
});
