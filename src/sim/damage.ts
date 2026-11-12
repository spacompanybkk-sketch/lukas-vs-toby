/**
 * Damage itself: to a unit, to a base, and a blast. Every stage that hurts something comes through
 * here (attacks and projectiles, abilities, statuses, the endgame), so this module imports none of
 * them.
 */

import { seconds } from '../data/balance';
import type { Balance, UnitStats } from '../data/balance';
import { isStanding, levelScale } from './lookup';
import type { Faction, SimEvent, SimState, Unit } from './types';

/** A blast: a death blast, a Potato Mine or a Cherry Bomber going off. */
export type Blast = Pick<NonNullable<UnitStats['deathBlast']>, 'damage' | 'radius'>;

/**
 * Takes `amount` less the unit's armor off its health, at least 1, and reports it. With
 * `ignoreArmor` (poison, burn, a hero, a spell) the armor takes nothing off. A unit that makes Sun
 * is hurt for its `sun.pauseSeconds` (see `Unit.hurt`): it makes no Sun for that long.
 */
export function damageUnit(
  s: SimState, b: Balance, u: Unit, amount: number, events: SimEvent[], ignoreArmor = false,
): void {
  const dealt = Math.max(1, amount - (ignoreArmor ? 0 : u.armor));
  u.hp -= dealt;
  events.push({ type: 'unitDamaged', unitId: u.id, amount: dealt, hp: u.hp });
  const pause = b.units[u.key]?.sun?.pauseSeconds ?? 0;
  if (pause > 0) u.hurt = Math.max(u.hurt, seconds(pause));
}

/** Takes `amount` off a base and reports it. The health may go below zero; the endgame reads it. */
export function damageBase(s: SimState, side: Faction, amount: number, lane: number | null, events: SimEvent[]): void {
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
    if (distance(u, source) <= blast.radius) damageUnit(s, b, u, amount, events);
  }
}

/** Straight-line distance between two units, lanes one tile apart. */
export function distance(a: Unit, c: Unit): number {
  const dx = a.x - c.x;
  const dLane = a.lane - c.lane;
  return Math.sqrt(dx * dx + dLane * dLane);
}
