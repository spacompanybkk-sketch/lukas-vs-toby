import type { Skill } from '../ai/bot';
import { ALL_CARDS } from '../data/units';
import { touch } from '../progress/save';
import type { Save } from '../progress/save';
import type { CardKey } from '../sim/types';
import type { LevelDef } from './types';

export type Stars = 0 | 1 | 2 | 3;

/** Adventure numbers (plan, Global Constraints). */
export const ADVENTURE = Object.freeze({
  /** Each side starts Adventure with this many of its first cards (spec 6.6 order). */
  firstCards: 3,
  /** Stars by the player's base health share: 2 at or above `two`, 3 at or above `three`. */
  baseStars: Object.freeze({ two: 0.5, three: 0.8 }),
  /** Breakthrough (no player base): stars by the share of the clock left. */
  clockStars: Object.freeze({ two: 0.25, three: 0.5 }),
  /** Coins per star earned on a level for the first time. */
  perNewStar: 30,
  /** A win that earns no new star. */
  replayWin: 10,
  loss: 5,
  /** The player's Adventure difficulty multiplies only the player's income. */
  income: Object.freeze({ easy: 1.25, medium: 1, hard: 0.75 } satisfies Record<Skill, number>),
  /** Cards that wait on a conveyor belt at most. */
  beltSlots: 5,
});

/** What a level's second and third stars are measured on, and the share each asks (at or above). */
export interface StarRule { measure: 'base' | 'clock'; two: number; three: number }

/**
 * The star rule of `def`: the player's base health kept, or for Breakthrough (no player base) the
 * share of the clock left. `starsFor` counts by it, and the result screen draws it.
 */
export function starRule(def: LevelDef): StarRule {
  return def.kind === 'breakthrough' ? { measure: 'clock', ...ADVENTURE.clockStars } : { measure: 'base', ...ADVENTURE.baseStars };
}

export function starsFor(
  def: LevelDef, result: { won: boolean; baseHpShare: number; clockShareLeft: number },
): Stars {
  if (!result.won) return 0;
  const t = starRule(def);
  const share = t.measure === 'clock' ? result.clockShareLeft : result.baseHpShare;
  if (share >= t.three) return 3;
  if (share >= t.two) return 2;
  return 1;
}

/**
 * A level's result on the player's save: coins (30 per star earned there for the first time, 10
 * for a win that earns none, 5 for a loss), the level's best stars (never lower), and the level's
 * unlock on a win, once. A result whose `battleId` is the save's `lastBattle` was applied already
 * and changes nothing (a reload on the result screen). Only the LAST battle id is remembered:
 * applying A, then B, then A again pays A twice. Callers must give every battle a fresh id and
 * keep at most one pending result, applied before the next battle starts.
 */
export function applyLevelResult(
  save: Save, def: LevelDef, stars: Stars, now: number, battleId: string,
): { save: Save; coins: number; newStars: number; unlocked: CardKey | null } {
  if (save.lastBattle === battleId) return { save, coins: 0, newStars: 0, unlocked: null };
  const side = save[def.side];
  const before = side.stars[def.id] ?? 0;
  const won = stars > 0;
  const newStars = Math.max(0, stars - before);
  const coins = !won ? ADVENTURE.loss : newStars > 0 ? newStars * ADVENTURE.perNewStar : ADVENTURE.replayWin;
  // Among the first three (always held), already unlocked, or (a data error) not of this side at all.
  const has = (card: CardKey): boolean =>
    ALL_CARDS[def.side].indexOf(card) < ADVENTURE.firstCards || side.unlocked.includes(card);
  const unlocked = won && def.unlocks !== null && !has(def.unlocks) ? def.unlocks : null;
  const next: Save = {
    ...save,
    coins: save.coins + coins,
    [def.side]: {
      stars: newStars > 0 ? { ...side.stars, [def.id]: stars } : { ...side.stars },
      unlocked: unlocked === null ? [...side.unlocked] : [...side.unlocked, unlocked],
    },
    lastBattle: battleId,
  };
  return { save: touch(next, now), coins, newStars, unlocked };
}
