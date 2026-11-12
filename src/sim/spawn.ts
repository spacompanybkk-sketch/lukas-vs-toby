/**
 * Putting units on the lawn: a card played from the hand (through `Match.place`), a scene a test
 * sets, a Bone Minion an ability or a spell raises. Imports no step stage, so every stage may use it.
 */

import { seconds } from '../data/balance';
import type { Balance, UnitStats } from '../data/balance';
import { factionOf, priceOf } from '../data/units';
import { statsFor } from './lookup';
import type { AbilityName, SimEvent, SimState, Unit, UnitKey } from './types';

/** The `abilityTimer` a unit is placed with: its Sun interval, a mine's arming time, a fuse. */
export function abilityTimerAtSpawn(stats: UnitStats): number {
  if (stats.sun) return seconds(stats.sun.interval);
  if (stats.mine) return seconds(stats.mine.armSeconds);
  if (stats.fuse) return seconds(stats.fuse.seconds);
  return 0; // a shield, a leap: ready from the start
}

/** What a unit announces the moment it is placed: a Cherry Bomber lights its fuse. */
export function announceSpawn(u: Unit, stats: UnitStats, events: SimEvent[]): void {
  if (stats.fuse) abilityUsed(u, 'fuse', null, events);
}

/**
 * Creates a level-1 unit and adds it to the state. It checks no placement rule and charges
 * nobody: `Match.place` does both of those first, and tests use this to set a scene. A card's
 * `spent` is its price; a unit that is not a card (the Bone Minion) has spent nothing. It starts
 * with no status, no stacks and no owner.
 */
export function spawnUnit(
  s: SimState, b: Balance, key: UnitKey, lane: number, x: number, events?: SimEvent[],
): Unit {
  const stats = statsFor(b, key);
  const faction = factionOf(key);
  const unit: Unit = {
    id: s.nextId, key, faction, lane, x, level: 1,
    hp: stats.hp, maxHp: stats.hp, spent: priceOf(key), armor: stats.armor,
    meleeTimer: stats.melee ? seconds(stats.melee.interval) : 0,
    shotTimer: stats.shot ? seconds(stats.shot.interval) : 0,
    abilityTimer: abilityTimerAtSpawn(stats),
    blocked: false,
    stun: 0, blind: 0, tied: 0, poison: 0, poisonDps: 0, burn: 0, burnDps: 0,
    stacks: 0, ownerId: null,
  };
  s.nextId += 1;
  s.units.push(unit);
  if (events) {
    events.push({ type: 'unitSpawned', unitId: unit.id, key, faction, lane, x });
    announceSpawn(unit, stats, events);
  }
  return unit;
}


/** Reports that `u` used `ability` (on `targetId`, or on nobody). */
export function abilityUsed(u: Unit, ability: AbilityName, targetId: number | null, events: SimEvent[]): void {
  events.push({ type: 'abilityUsed', unitId: u.id, ability, lane: u.lane, x: u.x, targetId });
}
