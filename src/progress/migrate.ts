import { MAX_UPGRADE } from './upgrades';
import { isPicture, touch } from './save';
import type { Save } from './save';

/**
 * Where the old game kept each boy's save (tag `old-game-final`, src/game/SaveManager.ts). It wrote
 * `JSON.stringify({ tobyDollars: number, currentLevel: number, upgrades: Record<unitKey, 0..10> })`,
 * and its unit keys are the new game's `CardKey`s unchanged.
 */
export const OLD_SAVE_KEYS = Object.freeze({ lukas: 'lpvtz_save_lukas', toby: 'lpvtz_save_toby' });

/** What `n` old upgrade levels cost: 100 + 200 + … + 100n = 100 × n(n+1)/2. */
export function refund(n: number): number {
  return (100 * n * (n + 1)) / 2;
}

/** Whole, non-negative coins the old save carries, or null when there is nothing usable in it. */
function oldValue(raw: string): number | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
  const { tobyDollars, upgrades } = o as Record<string, unknown>;
  let coins = 0;
  let found = false;
  if (typeof tobyDollars === 'number' && Number.isFinite(tobyDollars)) {
    coins += Math.max(0, Math.floor(tobyDollars));
    found = true;
  }
  if (typeof upgrades === 'object' && upgrades !== null && !Array.isArray(upgrades)) {
    for (const [unit, level] of Object.entries(upgrades)) {
      if (!isPicture(unit) || typeof level !== 'number' || !Number.isFinite(level)) continue;
      coins += refund(Math.min(MAX_UPGRADE, Math.max(0, Math.floor(level))));
      found = true;
    }
  }
  return found ? coins : null;
}

/**
 * Carries an old-game save into `s`, at most once: its coins, plus every upgrade refunded at what
 * it cost (the new Marketplace is bought again from level 0). A missing old save (`raw` null)
 * changes nothing, so the device that does hold it can still import later; an unreadable one
 * marks the import done and adds nothing.
 */
export function importOldSave(s: Save, raw: string | null, now: number): Save {
  if (s.importedOld || raw === null) return s;
  const coins = oldValue(raw) ?? 0;
  return touch({ ...s, coins: s.coins + coins, importedOld: true }, now);
}
