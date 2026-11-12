/**
 * Putting units on the lawn: a card played from the hand (through `Match.place`), a scene a test
 * sets, a Bone Minion an ability or a spell raises. Imports no step stage, so every stage may use it.
 */

import { seconds } from '../data/balance';
import type { Balance, UnitStats } from '../data/balance';
import { factionOf, priceOf } from '../data/units';
import { levelScale, statsFor } from './lookup';
import type { AbilityName, SimEvent, SimState, Unit, UnitKey } from './types';

/**
 * The `abilityTimer` a unit is placed with: its Sun interval, a mine's arming time, a fuse, a
 * Necromancer's first raise. No shipped unit has two of these; a shield, a
 * leap and a lasso are ready from the start, and so is a heal (`auraTimer` starts at 0).
 */
export function abilityTimerAtSpawn(stats: UnitStats): number {
  if (stats.sun) return seconds(stats.sun.interval);
  if (stats.mine) return seconds(stats.mine.armSeconds);
  if (stats.fuse) return seconds(stats.fuse.seconds);
  if (stats.raise) return seconds(stats.raise.interval);
  return 0;
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
    abilityTimer: abilityTimerAtSpawn(stats), auraTimer: 0,
    blocked: false,
    stun: 0, blind: 0, tied: 0, poison: 0, poisonDps: 0, burn: 0, burnDps: 0,
    stacks: 0, ownerId: null,
    expires: 0, haste: 0, hasteCarry: 0, hurt: 0,
  };
  s.nextId += 1;
  s.units.push(unit);
  if (events) {
    events.push({ type: 'unitSpawned', unitId: unit.id, key, faction, lane, x });
    announceSpawn(unit, stats, events);
  }
  return unit;
}

/**
 * A Bone Minion at `level`, raised at `lane` and `x`: its health and max are its base health times
 * the zombies' `hp` level curve, rounded; it has spent nothing (so it pays no bounty) and belongs
 * to `ownerId` (a Necromancer, or null for one no Necromancer raised). Emits `unitSpawned`.
 */
export function spawnMinion(
  s: SimState, b: Balance, lane: number, x: number, level: number, ownerId: number | null, events: SimEvent[],
): Unit {
  const minion = spawnUnit(s, b, 'boneMinion', lane, x, events);
  minion.level = level;
  minion.maxHp = Math.round(minion.maxHp * levelScale(b, minion.faction, level, 'hp'));
  minion.hp = minion.maxHp;
  minion.spent = 0;
  minion.ownerId = ownerId;
  return minion;
}

/** Reports that `u` used `ability` (on `targetId`, or on nobody). */
export function abilityUsed(u: Unit, ability: AbilityName, targetId: number | null, events: SimEvent[]): void {
  events.push({ type: 'abilityUsed', unitId: u.id, ability, lane: u.lane, x: u.x, targetId });
}
