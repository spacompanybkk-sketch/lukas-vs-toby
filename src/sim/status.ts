/**
 * Statuses: what can be wrong with a unit, each held on the unit as a count of ticks left.
 *
 * - stun, tied: the unit cannot act (see `canAct`): it does not walk, bite, shoot, pay Sun or use
 *   an ability, and its own attack and ability timers stand still.
 * - blind: it attacks on schedule but every attack misses (`attackMissed`, nothing dealt).
 * - poison, burn: it loses `poisonDps` / `burnDps` health once a second, armor or not.
 *
 * A status of `n` ticks put on a unit during tick T keeps it from acting on ticks T+1 .. T+n-1;
 * it acts again on tick T+n, `n` ticks after the one it was struck on.
 */

import type { Balance } from '../data/balance';
import { damageUnit } from './combat';
import { isStanding } from './lookup';
import { TICKS_PER_SECOND } from './types';
import type { SimEvent, SimState, StatusKind, Unit } from './types';

/** The statuses in the fixed order `tickStatuses` handles them on each unit. */
const KINDS: readonly StatusKind[] = ['stun', 'blind', 'tied', 'poison', 'burn'];

/**
 * Puts `kind` on `u` for `ticks` ticks. A unit already affected keeps the longer of the two
 * durations and the larger damage per second (`dps` only counts for poison and burn). Emits
 * `statusApplied` only when the status starts or is lengthened. A unit that is down gets nothing.
 */
export function applyStatus(
  _s: SimState, u: Unit, kind: StatusKind, ticks: number, dps: number, sourceId: number | null, events: SimEvent[],
): void {
  if (!isStanding(u) || !(ticks > 0)) return;
  const before = u[kind];
  if (kind === 'poison') u.poisonDps = Math.max(u.poisonDps, dps);
  if (kind === 'burn') u.burnDps = Math.max(u.burnDps, dps);
  if (ticks <= before) return;
  u[kind] = ticks;
  events.push({ type: 'statusApplied', unitId: u.id, status: kind, ticks, sourceId });
}

/**
 * Step stage, after projectiles and before deaths: every status on every unit, in ascending id and
 * the order stun, blind, tied, poison, burn, counts down by one, and `statusEnded` is emitted when
 * one reaches 0 (a poison or burn then forgets its dps). Before counting down, a poison or burn
 * deals its dps through `damageUnit`, ignoring armor, on every tick that is a whole second
 * (`tick % 30 === 0`), so `n` seconds of it deal `n` times its dps whenever it was put on. A unit
 * it brings to 0 is removed by `resolveDeaths` like any other: cause `'damage'`, bounty paid.
 */
export function tickStatuses(s: SimState, _b: Balance, events: SimEvent[]): void {
  const wholeSecond = s.tick % TICKS_PER_SECOND === 0;
  for (const u of s.units) {
    if (!isStanding(u)) continue;
    for (const kind of KINDS) {
      if (u[kind] <= 0) continue;
      if (wholeSecond && isStanding(u)) {
        if (kind === 'poison' && u.poisonDps > 0) damageUnit(s, u, u.poisonDps, events, true);
        if (kind === 'burn' && u.burnDps > 0) damageUnit(s, u, u.burnDps, events, true);
      }
      u[kind] -= 1;
      if (u[kind] > 0) continue;
      if (kind === 'poison') u.poisonDps = 0;
      if (kind === 'burn') u.burnDps = 0;
      events.push({ type: 'statusEnded', unitId: u.id, status: kind });
    }
  }
}

/** Whether a unit may act this tick: false while it is stunned or tied. */
export function canAct(u: Unit): boolean {
  return u.stun <= 0 && u.tied <= 0;
}
