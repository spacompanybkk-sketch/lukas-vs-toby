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
import { payBounty } from './economy';
import { isStanding, levelScale, nearestEnemyAhead, statsFor } from './lookup';
import { BASE_STOP_X, COLS, LANES, TICKS_PER_SECOND } from './types';
import type { Faction, Projectile, SimEvent, SimState, Unit } from './types';

type DeathBlast = NonNullable<UnitStats['deathBlast']>;

/**
 * Step stage 4: units attack, in ascending id. Attack timers are only read and reset here;
 * `tickEconomy` counts them down.
 *
 * - Melee: a blocked zombie with its bite ready hits the plant blocking it, or the plant base it
 *   stands at, for `melee.damage × levelScale[level]`.
 * - Shots: a unit with its shot ready fires when it has something to shoot. A plant always has
 *   (it fires down an empty lane at the zombie base). A zombie needs a living plant ahead within
 *   range, or the plant base within range (`x <= range`), and never shoots while it is blocked:
 *   it throws on the approach and only bites once it stands at a plant or the base. (`blocked`
 *   comes from the movement stage, so a zombie whose plant fell earlier this tick holds both its
 *   bite and its shot for that one tick.) The projectile appears at the shooter's x and first
 *   moves on the next tick.
 */
export function tickAttacks(s: SimState, b: Balance, events: SimEvent[]): void {
  for (const u of s.units) {
    const stats = statsFor(b, u.key);
    if (stats.melee && u.blocked && u.meleeTimer === 0) bite(s, b, u, stats.melee, events);
    if (stats.shot && !u.blocked && u.shotTimer === 0) shoot(s, b, u, stats.shot, events);
  }
}

function bite(s: SimState, b: Balance, z: Unit, melee: MeleeStats, events: SimEvent[]): void {
  const amount = melee.damage * levelScale(b, z.level);
  const plant = nearestEnemyAhead(s, z.faction, z.lane, z.x, melee.reach);
  if (plant) {
    events.push({ type: 'unitAttacked', unitId: z.id, attack: 'melee', targetId: plant.id, targetBase: null });
    damageUnit(s, plant, amount, events);
  } else if (z.x <= BASE_STOP_X) {
    events.push({ type: 'unitAttacked', unitId: z.id, attack: 'melee', targetId: null, targetBase: 'plants' });
    damageBase(s, 'plants', amount, z.lane, events);
  } else {
    return; // its plant fell earlier this tick; the bite stays ready for the next one
  }
  z.meleeTimer = seconds(melee.interval);
}

function shoot(s: SimState, b: Balance, u: Unit, shot: ShotStats, events: SimEvent[]): void {
  const target = nearestEnemyAhead(s, u.faction, u.lane, u.x, shot.range);
  let targetBase: Faction | null = null;
  if (!target) {
    if (u.faction === 'plants') targetBase = 'zombies';
    else if (u.x <= shot.range) targetBase = 'plants';
    else return; // a zombie holds its shot until something is in range
  }
  const p: Projectile = {
    id: s.nextId, kind: shot.kind, faction: u.faction, lane: u.lane, x: u.x,
    speed: shot.speed / TICKS_PER_SECOND, damage: shot.damage * levelScale(b, u.level),
    ownerId: u.id, spawnTick: s.tick,
  };
  s.nextId += 1;
  s.projectiles.push(p);
  u.shotTimer = seconds(shot.interval);
  events.push({ type: 'unitAttacked', unitId: u.id, attack: 'shot', targetId: target ? target.id : null, targetBase });
  events.push({
    type: 'projectileSpawned', projectileId: p.id, kind: p.kind, faction: p.faction, lane: p.lane, x: p.x, ownerId: u.id,
  });
}

/**
 * Step stage 4b, straight after units attack: the plant base strikes zombies that are biting it.
 * (The zombie base has no such defence.)
 *
 * For lanes 0 to 4 in order: if the lane's timer is 0, the base strikes the zombie in that lane
 * with the lowest id that is standing, `blocked` and at the base (x <= BASE_STOP_X): `baseStruck`,
 * then `baseDefense.damage` through `damageUnit` (armor applies as for any hit), and the lane's
 * timer is set to `seconds(baseDefense.interval)`. A lane with nobody to strike keeps its timer at
 * 0. So a zombie held up by a plant is never struck, nor is one still walking, not even on the
 * tick it reaches BASE_STOP_X (it walked that tick, so it is not `blocked` yet). A zombie brought
 * to 0 here is removed by `resolveDeaths` like any other: cause `'damage'`, bounty to the plants.
 * Damage 0 switches the stage off: it then changes nothing and emits nothing. The timers are only
 * read and reset here; `tickEconomy` counts them down.
 */
export function tickBaseDefense(s: SimState, b: Balance, events: SimEvent[]): void {
  const { damage, interval } = b.baseDefense;
  if (!(damage > 0)) return;
  for (let lane = 0; lane < LANES; lane++) {
    if (s.baseDefenseTimers[lane] !== 0) continue;
    const target = biterAtBase(s, lane);
    if (target === null) continue;
    events.push({ type: 'baseStruck', lane, targetId: target.id });
    damageUnit(s, target, damage, events);
    s.baseDefenseTimers[lane] = seconds(interval);
  }
}

/** The lowest-id zombie in `lane` that is biting the plant base: standing, blocked, at BASE_STOP_X. */
function biterAtBase(s: SimState, lane: number): Unit | null {
  for (const u of s.units) { // ascending id order, so the first one found has the lowest id
    if (u.faction === 'zombies' && u.lane === lane && isStanding(u) && u.blocked && u.x <= BASE_STOP_X) return u;
  }
  return null;
}

/**
 * Step stage 5: projectiles fly and hit, in ascending id. One fired this tick waits for the next.
 *
 * A projectile moves `speed` tiles (plants' right, zombies' left). The stretch it swept, widened
 * by `hitRadius` past where it ended but never behind where it started, is searched for the
 * living enemy in its lane nearest its starting point. A Skeleton Warrior (any unit with a
 * shield) whose shield is ready blocks a pea and the shield recharges; any other hit deals the
 * projectile's damage. Failing a unit, a plant projectile reaching x >= COLS hits the zombie base
 * for `damage × baseShotFactor` and a zombie projectile reaching x <= 0 hits the plant base for
 * its full damage. A projectile that hits anything is removed.
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
  const from = p.x;
  p.x = p.faction === 'plants' ? from + p.speed : from - p.speed;
  const target = nearestEnemyAhead(s, p.faction, p.lane, from, p.speed + b.hitRadius);
  if (target) {
    hitUnit(s, b, p, target, events);
    return true;
  }
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

function hitUnit(s: SimState, b: Balance, p: Projectile, target: Unit, events: SimEvent[]): void {
  const shield = statsFor(b, target.key).shield;
  const blocked = shield !== undefined && p.kind === 'pea' && target.abilityTimer === 0;
  events.push({
    type: 'projectileHit', projectileId: p.id, lane: p.lane, x: target.x,
    targetId: target.id, targetBase: null, blocked,
  });
  if (blocked) target.abilityTimer = seconds(shield.interval);
  else damageUnit(s, target, p.damage, events);
}

function hitBase(s: SimState, p: Projectile, side: Faction, x: number, amount: number, events: SimEvent[]): void {
  events.push({ type: 'projectileHit', projectileId: p.id, lane: p.lane, x, targetId: null, targetBase: side, blocked: false });
  damageBase(s, side, amount, p.lane, events);
}

/** Takes `amount` less the unit's armor off its health, at least 1, and reports it. */
export function damageUnit(s: SimState, u: Unit, amount: number, events: SimEvent[]): void {
  const dealt = Math.max(1, amount - u.armor);
  u.hp -= dealt;
  events.push({ type: 'unitDamaged', unitId: u.id, amount: dealt, hp: u.hp });
}

/** Takes `amount` off a base and reports it. The health may go below zero; the endgame reads it. */
export function damageBase(s: SimState, side: Faction, amount: number, lane: number | null, events: SimEvent[]): void {
  s.baseHp[side] -= amount;
  events.push({ type: 'baseDamaged', faction: side, amount, hp: s.baseHp[side], lane });
}

/**
 * Step stage 6: every unit that is down (hp not above 0, see `isStanding`) is removed, in
 * ascending id, with `unitDied` and then its bounty. A dying unit with a death blast then
 * explodes, damaging every standing enemy within its radius. Repeats until everyone left is
 * standing, so blasts can chain within one step.
 */
export function resolveDeaths(s: SimState, b: Balance, events: SimEvent[]): void {
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
      events.push({
        type: 'unitDied', unitId: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level, cause,
      });
      payBounty(s, b, u, events);
      const blast = statsFor(b, u.key).deathBlast;
      if (blast) explode(s, b, u, blast, events);
    }
    cause = 'blast';
  }
}

/**
 * A death blast: every standing enemy within `radius` (straight-line distance, lanes one tile
 * apart) takes `damage × levelScale[level]`. Game rule: a unit already down is skipped, as it is
 * for every other attack (see `nearestEnemyAhead`).
 */
function explode(s: SimState, b: Balance, source: Unit, blast: DeathBlast, events: SimEvent[]): void {
  events.push({ type: 'explosion', lane: source.lane, x: source.x, radius: blast.radius, sourceKey: source.key });
  const amount = blast.damage * levelScale(b, source.level);
  for (const u of s.units) {
    if (u.faction === source.faction || !isStanding(u)) continue;
    const dx = u.x - source.x;
    const dLane = u.lane - source.lane;
    if (Math.sqrt(dx * dx + dLane * dLane) <= blast.radius) damageUnit(s, u, amount, events);
  }
}
