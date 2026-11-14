import type { Skill } from '../ai/bot';
import { touch } from './save';
import type { Save } from './save';

/** Coins for a battle against the computer. Versus pays none (spec 7). */
export const REWARDS = Object.freeze({
  win: Object.freeze({ easy: 20, medium: 40, hard: 70 } satisfies Record<Skill, number>),
  /** A win keeping at least this share of the base's health earns the bonus. */
  bonusShare: 0.8,
  bonusFactor: 1.5,
  /** The bonus total is rounded to a multiple of this. */
  roundTo: 5,
  loss: 5,
});

export interface BattleResult { won: boolean; skill: Skill; baseHpShare: number }

export function rewardFor(result: BattleResult): number {
  if (!result.won) return REWARDS.loss;
  const base = REWARDS.win[result.skill];
  if (result.baseHpShare < REWARDS.bonusShare) return base;
  return Math.round((base * REWARDS.bonusFactor) / REWARDS.roundTo) * REWARDS.roundTo;
}

/** Versus: no coins, a win counts in `versusWins`. Otherwise: coins, and a win counts in `computerWins`. */
export function applyBattleResult(s: Save, r: BattleResult & { versus: boolean }, now: number): Save {
  const next: Save = r.versus
    ? { ...s, versusWins: s.versusWins + (r.won ? 1 : 0) }
    : { ...s, coins: s.coins + rewardFor(r), computerWins: s.computerWins + (r.won ? 1 : 0) };
  return touch(next, now);
}
