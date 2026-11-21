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

/** The battle tag of a Versus match: what `lastBattle` holds once its result is credited (35 characters). */
export const versusBattleId = (matchId: string): string => `vs-${matchId}`;

/**
 * Versus: no coins, a win counts in `versusWins`. Otherwise: coins, and a win counts in `computerWins`.
 * A Versus result with a `battleId` is credited once (spec 9): a save already holding that tag as
 * `lastBattle` comes back as the same object; otherwise the tag becomes `lastBattle`, win or lose.
 */
export function applyBattleResult(s: Save, r: BattleResult & { versus: boolean; battleId?: string }, now: number): Save {
  if (r.versus && r.battleId !== undefined && s.lastBattle === r.battleId) return s;
  const next: Save = r.versus
    ? {
        ...s,
        versusWins: s.versusWins + (r.won ? 1 : 0),
        ...(r.battleId !== undefined ? { lastBattle: r.battleId } : {}),
      }
    : { ...s, coins: s.coins + rewardFor(r), computerWins: s.computerWins + (r.won ? 1 : 0) };
  return touch(next, now);
}
