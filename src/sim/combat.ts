/**
 * Fighting: attacks, the plant base's defence, projectiles, damage, deaths and blasts.
 *
 * Order: units act in ascending id and projectiles fly in ascending id. Both arrays stay in
 * that order because new entries are appended with ever larger ids (they share `s.nextId`) and
 * removals keep the rest in place. Events are pushed in the order things happen: an attack or a
 * hit before the damage it does, a death before its bounty and its blast.
 *
 * Game rule: a unit at or below 0 hp is out of the fight from that moment. Nothing aims at it,
 * blocks on it or is hit in its place, so a shot meant for it flies on, and a blast skips it. It
 * still finishes its own attack on the tick it falls (it was struck at the same moment), and
 * `resolveDeaths` removes it.
 */

import { seconds } from '../data/balance';
import type { Balance, MeleeStats, ShotStats, UnitStats } from '../data/balance';
import { burnOnHit, grow, grownBite, ignitePea } from './abilities';
import { damageBase, damageUnit, explode } from './damage';
import { payBounty } from './economy';
import { isStanding, levelScale, nearestEnemyAhead, statsFor } from './lookup';
import { nextRandom } from './rng';
import { applyStatus, canAct } from './status';
import { BASE_STOP_X, COLS, LANES, TICKS_PER_SECOND } from './types';
import type { Faction, Hazard, Projectile, SimEvent, SimState, Unit } from './types';

export { damageBase, damageUnit, explode } from './damage'; // where the tests and older callers look for them

/**
 * Step stage 4: units attack, in ascending id. Attack timers are only read and reset here;
 * `tickEconomy` counts them down. A unit that cannot act (stunned or tied, see `canAct`) does
 * neither.
 *
 * - Melee: a blocked zombie with its bite ready hits the plant blocking it, or the plant base it
 *   stands at, for `melee.damage` times the damage level curve (times `grownBite` for a Hot Topic,
 *   which grows when its bite brings a plant to 0, see `grow`).
 * - Shots: a unit with its shot ready fires when it has something to shoot. A plant always has
 *   (it fires down an empty lane at the zombie base). A zombie needs a living plant ahead within
 *   range, or the plant base close enough (`x <= min(range, zombieBaseShotRange)`), and never
 *   shoots while it is blocked: it throws on the approach and only bites once it stands at a plant
 *   or the base. (`blocked` comes from the movement stage, so a zombie whose plant fell earlier
 *   this tick holds both its bite and its shot for that one tick.) The projectile appears at the
 *   shooter's x and first moves on the next tick.
 * - Blind: a blind unit attacks on the same schedule, but each bite or shot is only an
 *   `attackMissed`: no damage, no projectile, no roll of the rng.
 */
export function tickAttacks(s: SimState, b: Balance, events: SimEvent[]): void {
  for (const u of s.units) {
    if (!canAct(u)) continue;
    const stats = statsFor(b, u.key);
    if (stats.melee && u.blocked && u.meleeTimer === 0) bite(s, b, u, stats, stats.melee, events);
    if (stats.shot && !u.blocked && u.shotTimer === 0) shoot(s, b, u, stats.shot, events);
  }
}

function bite(s: SimState, b: Balance, z: Unit, stats: UnitStats, melee: MeleeStats, events: SimEvent[]): void {
  const amount = melee.damage * levelScale(b, z.faction, z.level, 'damage') * grownBite(stats, z);
  const plant = nearestEnemyAhead(s, z.faction, z.lane, z.x, melee.reach);
  if (!plant && z.x > BASE_STOP_X) return; // its plant fell earlier this tick; the bite stays ready for the next one
  z.meleeTimer = seconds(melee.interval);
  if (z.blind > 0) {
    events.push({ type: 'attackMissed', unitId: z.id });
  } else if (plant) {
    events.push({ type: 'unitAttacked', unitId: z.id, attack: 'melee', targetId: plant.id, targetBase: null });
    damageUnit(s, b, plant, amount, events);
    if (stats.grow && !isStanding(plant)) grow(b, z, stats.grow, events); // only a standing plant is bitten
  } else {
    events.push({ type: 'unitAttacked', unitId: z.id, attack: 'melee', targetId: null, targetBase: 'plants' });
    damageBase(s, 'plants', amount, z.lane, events);
  }
}

/**
 * Fires one shot. A shot with a `status.chance` rolls the state rng once here; on success the
 * projectile is of kind `status.altKind` and carries the status. A lobbed shot aimed at a unit
 * remembers it (`targetId`, `targetX`); one with no unit to aim at flies on like a pea.
 */
function shoot(s: SimState, b: Balance, u: Unit, shot: ShotStats, events: SimEvent[]): void {
  const target = nearestEnemyAhead(s, u.faction, u.lane, u.x, shot.range);
  let targetBase: Faction | null = null;
  if (!target) {
    if (u.faction === 'plants') targetBase = 'zombies';
    else if (u.x <= Math.min(shot.range, b.zombieBaseShotRange)) targetBase = 'plants';
    else return; // a zombie holds its shot until something is in range
  }
  u.shotTimer = seconds(shot.interval);
  if (u.blind > 0) {
    events.push({ type: 'attackMissed', unitId: u.id });
    return;
  }
  let kind = shot.kind;
  const status = shot.status;
  if (status?.chance !== undefined && nextRandom(s) < status.chance) kind = status.altKind ?? shot.kind;
  const flight = shot.flight ?? 'straight';
  const aimedAt = flight === 'lobbed' ? target : null;
  const p: Projectile = {
    id: s.nextId, kind, faction: u.faction, lane: u.lane, x: u.x,
    speed: shot.speed / TICKS_PER_SECOND, damage: shot.damage * levelScale(b, u.faction, u.level, 'damage'),
    ownerId: u.id, spawnTick: s.tick,
    flight, sourceKey: u.key, level: u.level,
    targetId: aimedAt ? aimedAt.id : null, targetX: aimedAt ? aimedAt.x : null,
    pierceLeft: flight === 'piercing' ? (shot.pierce ?? 1) : 0, hitIds: [],
    burning: false, burnDps: 0, burnTicks: 0,
  };
  s.nextId += 1;
  s.projectiles.push(p);
  events.push({ type: 'unitAttacked', unitId: u.id, attack: 'shot', targetId: target ? target.id : null, targetBase });
  events.push({
    type: 'projectileSpawned', projectileId: p.id, kind: p.kind, faction: p.faction, lane: p.lane, x: p.x, ownerId: u.id,
    flight: p.flight, targetX: p.targetX,
  });
}

/**
 * Step stage 4b, straight after units attack: the plant base strikes zombies that are biting it.
 * (The zombie base has no such defence.)
 *
 * For lanes 0 to 4 in order: if the lane's timer is 0, the base strikes the zombie in that lane
 * with the lowest id that is standing, `blocked` and at the base (x <= BASE_STOP_X): `baseStruck`,
 * then `baseDefense.damage` times the zombie's `hp` level curve through `damageUnit` (armor applies
 * as for any hit; a merged zombie takes as many strikes as a fresh one, so merging never makes a
 * leak last longer, only bite harder while it lasts), and the lane's
 * timer is set to `seconds(baseDefense.interval)`. A lane with nobody to strike keeps its timer at
 * 0. So a zombie held up by a plant is never struck, nor is one still walking, not even on the
 * tick it reaches BASE_STOP_X (it walked that tick, so it is not `blocked` yet). A zombie brought
 * to 0 here (the strike was its killing blow; one already down is never struck) is removed by
 * `resolveDeaths`: with `baseDefense.paysBounty` false, cause `'base'` and no bounty, otherwise like any
 * other, cause `'damage'` and a bounty to the plants. Returns those it felled with `paysBounty`
 * false, for the step to hand to `resolveDeaths` (step-local: nothing outside the state remembers it).
 * Damage 0 switches the stage off: it then changes nothing and emits nothing. The timers are only
 * read and reset here; `tickEconomy` counts them down.
 */
export function tickBaseDefense(s: SimState, b: Balance, events: SimEvent[]): ReadonlySet<Unit> {
  const { damage, interval, paysBounty } = b.baseDefense;
  const felled = new Set<Unit>();
  if (!(damage > 0)) return felled;
  for (let lane = 0; lane < LANES; lane++) {
    if (s.baseDefenseTimers[lane] !== 0) continue;
    const target = biterAtBase(s, lane);
    if (target === null) continue;
    events.push({ type: 'baseStruck', lane, targetId: target.id });
    damageUnit(s, b, target, damage * levelScale(b, target.faction, target.level, 'hp'), events);
    if (!paysBounty && !isStanding(target)) felled.add(target); // this strike was the killing blow
    s.baseDefenseTimers[lane] = seconds(interval);
  }
  return felled;
}

/** No unit felled by the plant base this step (the default for `resolveDeaths`). */
const NONE_FELLED: ReadonlySet<Unit> = new Set();

/** The lowest-id zombie in `lane` that is biting the plant base: standing, blocked, at BASE_STOP_X. */
function biterAtBase(s: SimState, lane: number): Unit | null {
  for (const u of s.units) { // ascending id order, so the first one found has the lowest id
    if (u.faction === 'zombies' && u.lane === lane && isStanding(u) && u.blocked && u.x <= BASE_STOP_X) return u;
  }
  return null;
}

/**
 * Step stage 5: projectiles fly and hit, in ascending id. One fired this tick waits for the next.
 * Each moves `speed` tiles (plants' right, zombies' left), then by its flight:
 *
 * - straight: the stretch it swept, widened by `hitRadius` past where it ended but never behind
 *   where it started, is searched for the living enemy in its lane nearest its starting point. A
 *   Skeleton Warrior (any unit with a shield) whose shield is ready blocks a pea and the shield
 *   recharges; any other hit deals the projectile's damage. Failing a unit, a plant projectile
 *   reaching x >= COLS hits the zombie base for `damage × baseShotFactor` and a zombie projectile
 *   reaching x <= 0 hits the plant base for its full damage. A projectile that hits anything is
 *   removed.
 * - lobbed at a unit: while its target stands, `targetX` follows the target's x. Once its own x
 *   reaches `targetX` it lands there: it damages the target, or if the target fell, the standing
 *   enemy in the lane nearest the landing point within `hitRadius`, and every other standing enemy
 *   in the lane within the shot's `splash` of it. It is never blocked by a shield. A lobbed shot
 *   fired with no unit to aim at flies like a straight one, and lands the same way on what it meets.
 * - piercing: every living enemy in the swept stretch (as for straight) that it has not hit yet
 *   takes its damage, nearest first, until it has hit `pierce` units; then it vanishes. Its
 *   `hitIds` keep it from hitting a unit twice. One with hits left hits a base as a straight one does.
 *
 * Whoever a shot damages also gets the status of the shot that fired it, if it carries one (see
 * `ShotStatus`).
 */
export function tickProjectiles(s: SimState, b: Balance, events: SimEvent[]): void {
  const flying: Projectile[] = [];
  for (const p of s.projectiles) {
    if (p.spawnTick === s.tick) flying.push(p); // fired this tick: it starts moving on the next
    else if (!fly(s, b, p, events)) flying.push(p);
  }
  s.projectiles = flying;
}

/** Moves one projectile and resolves what it hits. Returns true when it is spent. */
function fly(s: SimState, b: Balance, p: Projectile, events: SimEvent[]): boolean {
  switch (p.flight) {
    case 'straight':
      return flyStraight(s, b, p, events);
    case 'lobbed':
      return p.targetId === null ? flyStraight(s, b, p, events) : flyLobbed(s, b, p, p.targetId, events);
    case 'piercing':
      return flyPiercing(s, b, p, events);
    default: {
      const unhandled: never = p.flight;
      throw new Error(`Unhandled flight ${String(unhandled)}`);
    }
  }
}

function advance(p: Projectile): number {
  const from = p.x;
  p.x = p.faction === 'plants' ? from + p.speed : from - p.speed;
  return from;
}

function flyStraight(s: SimState, b: Balance, p: Projectile, events: SimEvent[]): boolean {
  const from = advance(p);
  const target = nearestEnemyAhead(s, p.faction, p.lane, from, p.speed + b.hitRadius);
  ignitePea(s, b, p, from, target ? target.x : p.x, events); // it leaves alone all but a straight plant pea
  if (target) {
    if (p.flight === 'lobbed') {
      p.x = target.x; // it comes down on the enemy it met, so the view draws it there
      land(s, b, p, target, target.x, events);
    } else {
      hitUnit(s, b, p, target, events);
    }
    return true;
  }
  return reachBase(s, b, p, events);
}

function flyLobbed(s: SimState, b: Balance, p: Projectile, targetId: number, events: SimEvent[]): boolean {
  const target = s.units.find((u) => u.id === targetId && isStanding(u)) ?? null;
  if (target) p.targetX = target.x;
  const landAt = p.targetX ?? p.x;
  advance(p);
  const arrived = p.faction === 'plants' ? p.x >= landAt : p.x <= landAt;
  if (!arrived) return false;
  p.x = landAt;
  land(s, b, p, target ?? nearestTo(s, p, landAt, b.hitRadius), landAt, events);
  return true;
}

function flyPiercing(s: SimState, b: Balance, p: Projectile, events: SimEvent[]): boolean {
  const from = advance(p);
  const reach = p.speed + b.hitRadius;
  const met = s.units
    .filter((u) => u.faction !== p.faction && u.lane === p.lane && isStanding(u) && !p.hitIds.includes(u.id))
    .map((u) => ({ u, distance: p.faction === 'plants' ? u.x - from : from - u.x }))
    .filter(({ distance }) => distance >= 0 && distance <= reach)
    .sort((a, c) => a.distance - c.distance || a.u.id - c.u.id);
  for (const { u } of met) {
    hitUnit(s, b, p, u, events);
    p.hitIds.push(u.id);
    p.pierceLeft -= 1;
    if (p.pierceLeft <= 0) return true;
  }
  return reachBase(s, b, p, events);
}

/** A projectile past the far edge hits that side's base. Returns true when it did. */
function reachBase(s: SimState, b: Balance, p: Projectile, events: SimEvent[]): boolean {
  if (p.faction === 'plants' && p.x >= COLS) {
    hitBase(s, p, 'zombies', COLS, p.damage * b.baseShotFactor, events);
    return true;
  }
  if (p.faction === 'zombies' && p.x <= 0) {
    hitBase(s, p, 'plants', 0, p.damage, events);
    return true;
  }
  return false;
}

/** The standing enemy of `p` in its lane nearest `x`, within `radius`; ties go to the lower id. */
function nearestTo(s: SimState, p: Projectile, x: number, radius: number): Unit | null {
  let nearest: Unit | null = null;
  let nearestDistance = 0;
  for (const u of s.units) {
    if (u.faction === p.faction || u.lane !== p.lane || !isStanding(u)) continue;
    const distance = Math.abs(u.x - x);
    if (distance > radius) continue;
    if (nearest === null || distance < nearestDistance) {
      nearest = u;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** A lobbed shot comes down at `x` on `primary` (or on nobody) and splashes the rest of the lane. */
function land(s: SimState, b: Balance, p: Projectile, primary: Unit | null, x: number, events: SimEvent[]): void {
  events.push({
    type: 'projectileHit', projectileId: p.id, lane: p.lane, x,
    targetId: primary ? primary.id : null, targetBase: null, blocked: false, burning: p.burning,
  });
  if (primary) wound(s, b, p, primary, events);
  const shot = b.units[p.sourceKey]?.shot;
  const splash = shot?.splash ?? 0;
  if (splash > 0) {
    for (const u of s.units) {
      if (u === primary || u.faction === p.faction || u.lane !== p.lane || !isStanding(u)) continue;
      if (Math.abs(u.x - x) <= splash) wound(s, b, p, u, events);
    }
  }
  if (shot?.puddle) leavePuddle(s, b, p, x, shot.puddle, events);
}

/**
 * A Brain Rot lands: a `Hazard` of its side at `x` in its lane, for `seconds`, hurting the other
 * side with `dps` times the special level curve of the thrower's level (see `tickHazards`).
 */
function leavePuddle(
  s: SimState, b: Balance, p: Projectile, x: number, puddle: NonNullable<ShotStats['puddle']>, events: SimEvent[],
): void {
  const h: Hazard = {
    id: s.nextId, kind: 'rot', faction: p.faction, lane: p.lane, x, radius: puddle.radius,
    ticksLeft: seconds(puddle.seconds), dps: puddle.dps * levelScale(b, p.faction, p.level, 'special'),
    poisonTicks: seconds(puddle.poisonSeconds),
  };
  s.nextId += 1;
  s.hazards.push(h);
  events.push({ type: 'hazardSpawned', hazardId: h.id, kind: h.kind, lane: h.lane, x, radius: h.radius, ticks: h.ticksLeft });
}

/**
 * Step stage, after projectiles and before statuses: every hazard, in ascending id. Each standing
 * unit of the other side in its lane within `radius` of its x is poisoned for at least the
 * hazard's `poisonTicks` at its `dps` (the larger dps wins), through `applyStatus`. Only the start of
 * the poison is reported (`statusApplied`, no source); topping it up each tick a unit stands in the
 * puddle is silent. Then the hazard counts down; the tick it was laid counts as its first, and on reaching 0
 * it ends (`hazardEnded`) and leaves the lawn.
 */
export function tickHazards(s: SimState, _b: Balance, events: SimEvent[]): void {
  if (s.hazards.length === 0) return;
  const left: Hazard[] = [];
  for (const h of s.hazards) {
    for (const u of s.units) {
      if (u.faction === h.faction || u.lane !== h.lane || !isStanding(u) || Math.abs(u.x - h.x) > h.radius) continue;
      applyStatus(s, u, 'poison', h.poisonTicks, h.dps, null, events, true);
    }
    h.ticksLeft -= 1;
    if (h.ticksLeft > 0) left.push(h);
    else events.push({ type: 'hazardEnded', hazardId: h.id });
  }
  s.hazards = left;
}

function hitUnit(s: SimState, b: Balance, p: Projectile, target: Unit, events: SimEvent[]): void {
  const shield = statsFor(b, target.key).shield;
  const blocked = shield !== undefined && p.kind === 'pea' && target.abilityTimer === 0;
  events.push({
    type: 'projectileHit', projectileId: p.id, lane: p.lane, x: target.x,
    targetId: target.id, targetBase: null, blocked, burning: p.burning,
  });
  if (blocked) target.abilityTimer = seconds(shield.interval);
  else wound(s, b, p, target, events);
}

/**
 * The projectile's damage, then the burn a Torchwood gave it (see `ignitePea`), then the status its
 * shot carries, if any (see `ShotStatus`).
 */
function wound(s: SimState, b: Balance, p: Projectile, u: Unit, events: SimEvent[]): void {
  damageUnit(s, b, u, p.damage, events);
  burnOnHit(s, p, u, events);
  const status = b.units[p.sourceKey]?.shot?.status;
  if (!status) return;
  if (status.chance !== undefined && p.kind !== status.altKind) return; // this one did not roll it
  const dps = (status.dps ?? 0) * levelScale(b, p.faction, p.level, 'special');
  applyStatus(s, u, status.kind, seconds(status.seconds), dps, p.ownerId, events);
}

function hitBase(s: SimState, p: Projectile, side: Faction, x: number, amount: number, events: SimEvent[]): void {
  events.push({
    type: 'projectileHit', projectileId: p.id, lane: p.lane, x, targetId: null, targetBase: side, blocked: false,
    burning: p.burning,
  });
  damageBase(s, side, amount, p.lane, events);
}

/**
 * Step stage 6: every unit that is down (hp not above 0, see `isStanding`) is removed, in
 * ascending id, with `unitDied` and then its bounty (none for one the plant base's strike felled
 * while `baseDefense.paysBounty` is false: cause `'base'`, see `tickBaseDefense`). A dying unit with a death blast then
 * explodes, damaging every standing enemy within its radius. Repeats until everyone left is
 * standing, so blasts can chain within one step.
 */
export function resolveDeaths(
  s: SimState, b: Balance, events: SimEvent[], felledByBase: ReadonlySet<Unit> = NONE_FELLED,
): void {
  // Units already down when this stage starts fell to attacks or projectiles. Blasts are the only
  // damage dealt in here and they skip units already down, so everyone who falls in a later round
  // took their last damage from a blast.
  let cause: 'damage' | 'blast' = 'damage';
  while (!s.units.every(isStanding)) { // nothing is allocated on the usual tick where nobody falls
    const standing: Unit[] = [];
    const dying: Unit[] = [];
    for (const u of s.units) {
      if (isStanding(u)) standing.push(u);
      else dying.push(u);
    }
    s.units = standing;
    for (const u of dying) {
      const byBase = felledByBase.has(u);
      events.push({
        type: 'unitDied', unitId: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level,
        cause: byBase ? 'base' : cause,
      });
      if (!byBase) payBounty(s, b, u, events);
      const blast = statsFor(b, u.key).deathBlast;
      if (blast) explode(s, b, u, blast, events);
    }
    cause = 'blast';
  }
}
