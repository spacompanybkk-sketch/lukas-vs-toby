/**
 * Damage itself: to a unit, to a base, and a blast. Every stage that hurts something comes through
 * here (attacks and projectiles, abilities, statuses, the endgame), so this module imports none of
 * them.
 */

import { seconds } from '../data/balance';
import type { Balance, UnitStats } from '../data/balance';
import { isBoss, isStanding, levelScale, shieldOf } from './lookup';
import type { Faction, SimEvent, SimState, Unit } from './types';

/** A blast: a death blast, a Potato Mine or a Cherry Bomber going off. */
export type Blast = Pick<NonNullable<UnitStats['deathBlast']>, 'damage' | 'radius'>;

/**
 * Takes `amount` less the unit's armor off its health, at least 1, and reports it. With
 * `ignoreArmor` (poison, burn, a hero, a spell) the armor takes nothing off. A unit that makes Sun
 * is hurt for its `sun.pauseSeconds` (see `Unit.hurt`): it makes no Sun for that long. A boss behind
 * its shield (`shieldLeft`) takes the shield's `damageFactor` of the amount, whatever hit it.
 */
export function damageUnit(
  s: SimState, b: Balance, u: Unit, amount: number, events: SimEvent[], ignoreArmor = false,
): void {
  if (u.shieldLeft > 0 && isBoss(u.key)) amount *= shieldOf(b, u.key)?.damageFactor ?? 1;
  const dealt = Math.max(1, amount - (ignoreArmor ? 0 : u.armor));
  u.hp -= dealt;
  events.push({ type: 'unitDamaged', unitId: u.id, amount: dealt, hp: u.hp });
  const pause = b.units[u.key]?.sun?.pauseSeconds ?? 0;
  if (pause > 0) u.hurt = Math.max(u.hurt, seconds(pause));
}

/**
 * Takes `amount` off a base and reports it. The health may go below zero; the endgame reads it.
 * The level's `invulnerableBase` takes nothing and nothing is reported (what hit it is spent as usual).
 * While a boss of that side that guards its base stands (the Elder Oak), the base takes nothing
 * either: the boss takes `amount × guardFactor` instead, armor ignored (zombies biting its roots).
 */
export function damageBase(
  s: SimState, b: Balance, side: Faction, amount: number, lane: number | null, events: SimEvent[],
): void {
  if (s.config.invulnerableBase === side) return;
  const guard = guardOf(s, b, side);
  if (guard !== null) {
    damageUnit(s, b, guard.unit, amount * guard.factor, events, true);
    return;
  }
  s.baseHp[side] -= amount;
  events.push({ type: 'baseDamaged', faction: side, amount, hp: s.baseHp[side], lane });
}

/**
 * A blast (a death blast, a mine, a cherry): `explosion`, then every standing enemy within `radius`
 * (straight-line distance, lanes one tile apart) takes `damage` times the source's special level
 * curve, in id order. Game rule: a unit already down is skipped, as it is for every other attack
 * (see `nearestEnemyAhead`).
 */
export function explode(s: SimState, b: Balance, source: Unit, blast: Blast, events: SimEvent[]): void {
  events.push({ type: 'explosion', lane: source.lane, x: source.x, radius: blast.radius, sourceKey: source.key });
  const amount = blast.damage * levelScale(b, source.faction, source.level, 'special');
  for (const u of s.units) {
    if (u.faction === source.faction || !isStanding(u)) continue;
    if (distance(u, source) <= blast.radius) damageUnit(s, b, u, capHit(b, u, amount), events);
  }
}

/**
 * What a hero power, a blast (a blast spell, a mine, a Cherry, a Walnut) or a Pumpkin's leap may take
 * off `u` in one hit: all of `amount`, but a boss at most its `hitCap` share of its max health.
 */
export function capHit(b: Balance, u: Unit, amount: number): number {
  return isBoss(u.key) ? Math.min(amount, u.maxHp * b.bosses[u.key].hitCap) : amount;
}

/** The standing boss of `side` that guards its base, and its `guardFactor`, or null. */
export function guardOf(s: SimState, b: Balance, side: Faction): { unit: Unit; factor: number } | null {
  for (const u of s.units) {
    if (u.faction !== side || !isBoss(u.key) || !isStanding(u)) continue;
    const factor = b.bosses[u.key].guardFactor;
    if (factor !== undefined) return { unit: u, factor };
  }
  return null;
}

/** Straight-line distance between two units, lanes one tile apart. */
export function distance(a: Unit, c: Unit): number {
  const dx = a.x - c.x;
  const dLane = a.lane - c.lane;
  return Math.sqrt(dx * dx + dLane * dLane);
}
