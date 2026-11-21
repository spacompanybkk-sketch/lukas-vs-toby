import { describe, expect, it } from 'vitest';
import { REWARDS, applyBattleResult, rewardFor, versusBattleId } from '../../src/progress/rewards';
import { newSave, parseSave } from '../../src/progress/save';
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

describe('a Versus result is credited once per match', () => {
  const s = { ...newSave('p01', 'Lukas', 'peashooter', T0), coins: 10 };
  const tag = 'vs-3f9c0a1e5b7d24c68e0f1a2b3c4d5e6f';
  const vs = { skill: 'hard', baseHpShare: 1, versus: true, battleId: tag } as const;

  it('names the battle after the match', () => {
    expect(versusBattleId('3f9c0a1e5b7d24c68e0f1a2b3c4d5e6f')).toBe(tag);
    expect(tag).toHaveLength(35);
  });

  it('the winner gains one Versus win and holds the tag', () => {
    const t = applyBattleResult(s, { ...vs, won: true }, T0 + 1000);
    expect(t.versusWins).toBe(1);
    expect(t.lastBattle).toBe(tag);
    expect(t.coins).toBe(10);
    expect(t.computerWins).toBe(0);
    expect(t.updatedAt).toBe(T0 + 1000);
  });

  it('the same tag again changes nothing: the same object comes back', () => {
    const once = applyBattleResult(s, { ...vs, won: true }, T0 + 1000);
    const twice = applyBattleResult(once, { ...vs, won: true }, T0 + 2000);
    expect(twice).toBe(once);
    expect(twice.versusWins).toBe(1);
  });

  it('the loser gains no win but holds the tag', () => {
    const t = applyBattleResult(s, { ...vs, won: false }, T0 + 1000);
    expect(t.versusWins).toBe(0);
    expect(t.lastBattle).toBe(tag);
    expect(t.updatedAt).toBe(T0 + 1000);
  });

  it('a Quick Battle result is as before: coins, computerWins, no lastBattle', () => {
    const held = { ...s, lastBattle: tag };
    const t = applyBattleResult(held, { won: true, skill: 'medium', baseHpShare: 0.9, versus: false }, T0 + 1000);
    expect(t.coins).toBe(70);
    expect(t.computerWins).toBe(1);
    expect(t.versusWins).toBe(0);
    expect(t.lastBattle).toBe(tag);
    expect(applyBattleResult(s, { won: true, skill: 'medium', baseHpShare: 0.9, versus: false }, T0 + 1000).lastBattle).toBeNull();
  });

  it('a Versus result without a tag leaves lastBattle alone', () => {
    const t = applyBattleResult({ ...s, lastBattle: 'b-17' }, { skill: 'hard', baseHpShare: 1, versus: true, won: true }, T0 + 1000);
    expect(t.versusWins).toBe(1);
    expect(t.lastBattle).toBe('b-17');
  });

  it('a save holding a Versus tag reads back', () => {
    const t = applyBattleResult(s, { ...vs, won: true }, T0 + 1000);
    expect(parseSave(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });
});
