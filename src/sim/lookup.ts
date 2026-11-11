import type { Balance, UnitStats } from '../data/balance';
import type { Faction, SimState, Unit, UnitKey } from './types';

/** Read-only lookups shared by the step stages. None of them changes the state. */

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
 * The nearest living unit of the side opposite `faction` in `lane` that is ahead of `x` by at
 * most `reach` tiles. Ahead means towards larger x for plants and towards smaller x for zombies;
 * a unit standing exactly at `x` counts. Ties go to the lower id (`s.units` is kept in ascending
 * id order). A unit at or below 0 hp is already out of the fight and never counts.
 */
export function nearestEnemyAhead(
  s: SimState, faction: Faction, lane: number, x: number, reach: number,
): Unit | null {
  let nearest: Unit | null = null;
  let nearestDistance = 0;
  for (const u of s.units) {
    if (u.faction === faction || u.lane !== lane || u.hp <= 0) continue;
    const distance = faction === 'plants' ? u.x - x : x - u.x;
    if (distance < 0 || distance > reach) continue;
    if (nearest === null || distance < nearestDistance) {
      nearest = u;
      nearestDistance = distance;
    }
  }
  return nearest;
}
