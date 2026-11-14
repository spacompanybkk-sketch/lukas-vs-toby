/** Read-only lookups shared by the step stages. None of them changes the state. */

import type { Balance, BossPattern, BossStats, UnitStats } from '../data/balance';
import { BOSS_HALF_WIDTH } from './types';
import type { BossKey, CardKey, Faction, MatchConfig, SimState, Unit, UnitKey } from './types';

/**
 * A unit type's numbers (a boss's from `Balance.bosses`). A key the table has no numbers for is an
 * error, never a silent zero.
 */
export function statsFor(b: Balance, key: UnitKey): UnitStats {
  const stats = isBoss(key) ? b.bosses[key] : b.units[key];
  if (!stats) throw new Error(`The balance table has no numbers for "${key}"`);
  return stats;
}

/** Whether a key is one of the bosses. */
export function isBoss(key: UnitKey): key is BossKey {
  return Object.hasOwn(BOSS_HALF_WIDTH, key);
}

/** A boss's numbers. */
export function bossStats(b: Balance, key: BossKey): BossStats {
  return b.bosses[key];
}

/** A boss's shield pattern, if it has one. */
export function shieldOf(b: Balance, key: BossKey): Extract<BossPattern, { kind: 'shield' }> | undefined {
  for (const p of b.bosses[key].patterns) if (p.kind === 'shield') return p;
  return undefined;
}

/**
 * Whether a unit stands in `lane`: its own, or for a boss as wide as several, any of those
 * (`BOSS_HALF_WIDTH`). Everything that looks for a unit in a lane asks this.
 */
export function inLane(u: Unit, lane: number): boolean {
  if (u.lane === lane) return true;
  return isBoss(u.key) && Math.abs(u.lane - lane) <= BOSS_HALF_WIDTH[u.key];
}

/** Which of the balance table's level curves a number follows (see `Balance.levelCurves`). */
export type LevelCurve = 'hp' | 'damage' | 'special';

/**
 * What a unit of `faction` has its health, damage or special values multiplied by at `level`
 * (`special` is the same for both sides).
 */
export function levelScale(b: Balance, faction: Faction, level: number, curve: LevelCurve): number {
  const table = curve === 'special' ? b.levelCurves.special : b.levelCurves[curve][faction];
  const scale = table[level];
  if (scale === undefined) throw new RangeError(`No ${curve} level curve entry for level ${level}`);
  return scale;
}

/** Which Marketplace multiplier a number takes (see `Balance.upgradeStep`). */
export type UpgradeCurve = 'hp' | 'damage';

/**
 * What a unit's health (`hp`) or its bite and shot damage (`damage`) is multiplied by for its
 * side's Marketplace level of its type: `1 + step × level`, with its side's step (`Balance.upgradeStep`); exactly 1 at level 0.
 * The one place an upgrade enters the rules. A unit that is no card (a Bone
 * Minion, a rock) has no level, so 1. What takes it (see the callers):
 * - `hp`: the health a card is placed with (`spawnUnit`), its max on a merge, a Hot Topic's growth,
 *   and the plant base's strike on a zombie (so an upgraded zombie takes as many strikes as a plain one);
 * - `damage`: a bite and a shot (the projectile carries it; a Torchwood multiplies what it carries).
 * Not: blasts (Walnut Bomb, Potato Mine, Cherry Bomber), the Pumpkin's leap, burn, poison and the
 * rot puddle, Sun, heals, lasso and statuses, hero powers, spells.
 */
export function upgradeScale(
  b: Balance, config: MatchConfig, unit: Pick<Unit, 'key' | 'faction'>, what: UpgradeCurve,
): number {
  const level = config.upgrades[unit.faction][unit.key as CardKey] ?? 0;
  return level === 0 ? 1 : 1 + b.upgradeStep[unit.faction][what] * level;
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
 * a unit standing exactly at `x` counts; a wide boss counts in each lane it stands in (`inLane`). Ties go to the lower id (`s.units` is kept in ascending
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
    if (u.faction === faction || !inLane(u, lane) || !isStanding(u)) continue;
    const distance = faction === 'plants' ? u.x - x : x - u.x;
    if (distance < 0 || distance > reach) continue;
    if (nearest === null || distance < nearestDistance) {
      nearest = u;
      nearestDistance = distance;
    }
  }
  return nearest;
}
