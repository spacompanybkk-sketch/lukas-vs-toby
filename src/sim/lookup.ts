/** Read-only lookups shared by the step stages. None of them changes the state. */

import type { Balance, UnitStats } from '../data/balance';
import type { Faction, SimState, Unit, UnitKey } from './types';

/** A unit type's numbers. A key the table has no numbers for is an error, never a silent zero. */
export function statsFor(b: Balance, key: UnitKey): UnitStats {
  const stats = b.units[key];
  if (!stats) throw new Error(`The balance table has no numbers for "${key}"`);
  return stats;
}

/** What damage and other special values are multiplied by at `level`. */
export function levelScale(b: Balance, level: number): number {
  const scale = b.levelScale[level];
  if (scale === undefined) throw new RangeError(`No levelScale entry for level ${level}`);
  return scale;
}

/**
 * Whether a unit is still in the fight. Anything but a positive hp counts as down, NaN included,
 * so a broken number can neither keep a unit alive nor make it vanish without a `unitDied`.
 */
export function isStanding(u: Unit): boolean {
  return u.hp > 0;
}

/**
 * The nearest standing unit of the side opposite `faction` in `lane` that is ahead of `x` by at
 * most `reach` tiles. Ahead means towards larger x for plants and towards smaller x for zombies;
 * a unit standing exactly at `x` counts. Ties go to the lower id (`s.units` is kept in ascending
 * id order).
 *
 * Game rule: a unit that is down (see `isStanding`) never counts. Within a tick, a unit brought
 * to 0 hp is out of the fight at once: a projectile passes through it to the next enemy or the
 * base, a zombie is not held up by it, and (in `combat.ts`) a blast skips it. `resolveDeaths`
 * removes it at the end of the tick.
 */
export function nearestEnemyAhead(
  s: SimState, faction: Faction, lane: number, x: number, reach: number,
): Unit | null {
  let nearest: Unit | null = null;
  let nearestDistance = 0;
  for (const u of s.units) {
    if (u.faction === faction || u.lane !== lane || !isStanding(u)) continue;
    const distance = faction === 'plants' ? u.x - x : x - u.x;
    if (distance < 0 || distance > reach) continue;
    if (nearest === null || distance < nearestDistance) {
      nearest = u;
      nearestDistance = distance;
    }
  }
  return nearest;
}
