import type { CardKey } from '../sim/types';
import { touch } from './save';
import type { Save } from './save';

export const MAX_UPGRADE = 10;

/** Coins to reach `nextLevel` (1..10) from the level below: 100 × nextLevel, as in the old game. */
export function upgradeCost(nextLevel: number): number {
  if (!Number.isInteger(nextLevel) || nextLevel < 1 || nextLevel > MAX_UPGRADE) {
    throw new RangeError(`no upgrade level ${nextLevel}`);
  }
  return 100 * nextLevel;
}

/** One Marketplace level for `unit`, or why not. The save passed in is never changed. */
export function buyUpgrade(s: Save, unit: CardKey, now: number): Save | 'max' | 'no-coins' {
  const level = s.upgrades[unit] ?? 0;
  if (level >= MAX_UPGRADE) return 'max';
  const cost = upgradeCost(level + 1);
  if (s.coins < cost) return 'no-coins';
  return touch({ ...s, coins: s.coins - cost, upgrades: { ...s.upgrades, [unit]: level + 1 } }, now);
}
