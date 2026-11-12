/**
 * Abilities: what a unit does that is neither a bite nor a shot. Each ability is one small
 * function; `tickAbilities` hands every standing unit that can act to the one its stats name.
 *
 * Every ability timer is the unit's `abilityTimer`, counted down by `tickEconomy` (and standing
 * still while the unit cannot act); the functions here only read and reset it.
 */

import { seconds } from '../data/balance';
import type { Balance, UnitStats } from '../data/balance';
import { damageUnit, explode } from './combat';
import { isStanding, levelScale, nearestEnemyAhead } from './lookup';
import { applyStatus, canAct } from './status';
import type { AbilityName, Projectile, SimEvent, SimState, Unit } from './types';

type Mine = NonNullable<UnitStats['mine']>;
type Fuse = NonNullable<UnitStats['fuse']>;
type Leap = NonNullable<UnitStats['leap']>;

/** The `abilityTimer` a unit is placed with: its Sun interval, a mine's arming time, a fuse. */
export function abilityTimerAtSpawn(stats: UnitStats): number {
  if (stats.sun) return seconds(stats.sun.interval);
  if (stats.mine) return seconds(stats.mine.armSeconds);
  if (stats.fuse) return seconds(stats.fuse.seconds);
  return 0; // a shield, a leap: ready from the start
}

/** What a unit announces the moment it is placed: a Cherry Bomber lights its fuse. */
export function announceSpawn(u: Unit, stats: UnitStats, events: SimEvent[]): void {
  if (stats.fuse) used(u, 'fuse', null, events);
}

/**
 * Step stage, after the plant base's defence and before projectiles: every unit that is standing
 * and can act (see `canAct`) uses its ability, in ascending id. A unit that is spent by its own
 * ability leaves the field at once (`unitDied`, cause `'spent'`, no bounty); units it brings to 0
 * are removed by `resolveDeaths`.
 */
export function tickAbilities(s: SimState, b: Balance, events: SimEvent[]): void {
  for (const u of [...s.units]) { // a copy: a spent unit leaves `s.units` while this runs
    if (!isStanding(u) || !canAct(u)) continue;
    const stats = b.units[u.key];
    if (!stats) continue;
    if (stats.mine) potatoMine(s, b, u, stats.mine, events);
    else if (stats.fuse) cherryFuse(s, b, u, stats.fuse, events);
    else if (stats.leap) pumpkinLeap(s, b, u, stats.leap, events);
  }
}

/**
 * Potato Mine. Its `abilityTimer` counts down from `armSeconds`; the tick it is first at 0 the
 * mine arms (`abilityUsed 'arm'`, and `stacks` becomes 1, so it arms only once). Armed, on the
 * first tick a standing zombie is within `reach` ahead in its lane, it goes off: `abilityUsed
 * 'trigger'` with that zombie, a blast of `damage` within `radius`, and the mine is spent.
 */
function potatoMine(s: SimState, b: Balance, u: Unit, mine: Mine, events: SimEvent[]): void {
  if (u.abilityTimer > 0) return;
  if (u.stacks === 0) {
    u.stacks = 1;
    used(u, 'arm', null, events);
  }
  const victim = nearestEnemyAhead(s, u.faction, u.lane, u.x, mine.reach);
  if (!victim) return;
  used(u, 'trigger', victim.id, events);
  explode(s, b, u, mine, events);
  spend(s, u, events);
}

/** Cherry Bomber: when its fuse (`abilityTimer`) reaches 0 it blasts `damage` within `radius` and is spent. */
function cherryFuse(s: SimState, b: Balance, u: Unit, fuse: Fuse, events: SimEvent[]): void {
  if (u.abilityTimer > 0) return;
  explode(s, b, u, fuse, events);
  spend(s, u, events);
}

/**
 * Pumpkin Squash: when ready and a standing zombie is within `range` ahead, it crushes the nearest
 * one (`abilityUsed 'leap'` with it): every standing zombie in the lane within `radius` of the
 * target's x takes `damage` times the damage level curve, in id order, and it needs
 * `recoverSeconds` to be ready again. The Pumpkin itself does not move.
 */
function pumpkinLeap(s: SimState, b: Balance, u: Unit, leap: Leap, events: SimEvent[]): void {
  if (u.abilityTimer > 0) return;
  const target = nearestEnemyAhead(s, u.faction, u.lane, u.x, leap.range);
  if (!target) return;
  used(u, 'leap', target.id, events);
  const amount = leap.damage * levelScale(b, u.faction, u.level, 'damage');
  const at = target.x;
  for (const z of s.units) {
    if (z.faction === u.faction || z.lane !== u.lane || !isStanding(z)) continue;
    if (Math.abs(z.x - at) <= leap.radius) damageUnit(s, z, amount, events);
  }
  u.abilityTimer = seconds(leap.recoverSeconds);
}

/**
 * Torchwood, called by a straight projectile as it flies from `from` to `to` (the point it hits, or
 * where it ends the tick). A plant `pea` that is not yet burning and crosses the x of a standing
 * Torchwood in its lane (`from < x <= to`, so one fired from in front of it never does) is set
 * alight by the nearest such Torchwood: `abilityUsed 'ignite'`, its damage times `factor`, and it
 * carries a burn of `burnDps` times that Torchwood's special level curve for `burnSeconds`.
 */
export function ignitePea(
  s: SimState, b: Balance, p: Projectile, from: number, to: number, events: SimEvent[],
): void {
  if (p.burning || p.kind !== 'pea' || p.flight !== 'straight' || p.faction !== 'plants') return;
  let torch: Unit | null = null;
  for (const u of s.units) {
    if (u.faction !== p.faction || u.lane !== p.lane || !isStanding(u) || !b.units[u.key]?.ignite) continue;
    if (u.x <= from || u.x > to) continue;
    if (torch === null || u.x < torch.x) torch = u;
  }
  const ignite = torch ? b.units[torch.key]?.ignite : undefined;
  if (!torch || !ignite) return;
  p.burning = true;
  p.damage *= ignite.factor;
  p.burnDps = ignite.burnDps * levelScale(b, torch.faction, torch.level, 'special');
  p.burnTicks = seconds(ignite.burnSeconds);
  used(torch, 'ignite', null, events);
}

/** A burning projectile sets whom it damages burning (see `ignitePea`). */
export function burnOnHit(s: SimState, p: Projectile, u: Unit, events: SimEvent[]): void {
  if (!p.burning || !(p.burnTicks > 0)) return;
  applyStatus(s, u, 'burn', p.burnTicks, p.burnDps, p.ownerId, events);
}

function used(u: Unit, ability: AbilityName, targetId: number | null, events: SimEvent[]): void {
  events.push({ type: 'abilityUsed', unitId: u.id, ability, lane: u.lane, x: u.x, targetId });
}

/**
 * A unit used up by its own ability leaves the field at once: `unitDied` with cause `'spent'`.
 * It does not go through `resolveDeaths`, so it pays no bounty and sets off no death blast.
 */
function spend(s: SimState, u: Unit, events: SimEvent[]): void {
  s.units.splice(s.units.indexOf(u), 1); // the rest keep their ascending id order
  events.push({
    type: 'unitDied', unitId: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level, cause: 'spent',
  });
}
