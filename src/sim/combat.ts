import { seconds } from '../data/balance';
import type { Balance, MeleeStats, ShotStats, UnitStats } from '../data/balance';
import { payBounty } from './economy';
import { levelScale, nearestEnemyAhead, statsFor } from './lookup';
import { BASE_STOP_X, COLS, TICKS_PER_SECOND } from './types';
import type { Faction, Projectile, SimEvent, SimState, Unit } from './types';

/**
 * Fighting: attacks, projectiles, damage, deaths and blasts.
 *
 * Order: units act in ascending id and projectiles fly in ascending id. Both arrays stay in
 * that order because new entries are appended with ever larger ids (they share `s.nextId`) and
 * removals keep the rest in place. Events are pushed in the order things happen: an attack or a
 * hit before the damage it does, a death before its bounty and its blast.
 *
 * A unit at or below 0 hp is out of the fight from that moment: nothing aims at it, blocks on
 * it or is hit in its place, so a shot meant for it flies on. It still finishes its own attack
 * on the tick it falls (it was struck at the same moment), and `resolveDeaths` removes it.
 */

type DeathBlast = NonNullable<UnitStats['deathBlast']>;

/**
 * Step stage 4: units attack, in ascending id. Attack timers are only read and reset here;
 * `tickEconomy` counts them down.
 *
 * - Melee: a blocked zombie with its bite ready hits the plant blocking it, or the plant base it
 *   stands at, for `melee.damage × levelScale[level]`.
 * - Shots: a unit with its shot ready fires when it has something to shoot. A plant always has
 *   (it fires down an empty lane at the zombie base). A zombie needs a living plant ahead within
 *   range, or the plant base within range (`x <= range`). The projectile appears at the
 *   shooter's x and first moves on the next tick.
 */
export function tickAttacks(s: SimState, b: Balance, events: SimEvent[]): void {
  for (const u of s.units) {
    const stats = statsFor(b, u.key);
    if (stats.melee && u.blocked && u.meleeTimer === 0) bite(s, b, u, stats.melee, events);
    if (stats.shot && u.shotTimer === 0) shoot(s, b, u, stats.shot, events);
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
 * Step stage 6: every unit at or below 0 hp is removed, in ascending id, with `unitDied` and then
 * its bounty. A dying unit with a death blast then explodes, damaging every living enemy within
 * its radius. Repeats until nobody is at or below 0, so blasts can chain within one step.
 */
export function resolveDeaths(s: SimState, b: Balance, events: SimEvent[]): void {
  // Units already down when this stage starts fell to attacks or projectiles. Blasts are the only
  // damage dealt in here and they skip units already down, so everyone who falls in a later round
  // took their last damage from a blast.
  let cause: 'damage' | 'blast' = 'damage';
  for (;;) {
    const dying = s.units.filter((u) => u.hp <= 0);
    if (dying.length === 0) return;
    s.units = s.units.filter((u) => u.hp > 0);
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

function explode(s: SimState, b: Balance, source: Unit, blast: DeathBlast, events: SimEvent[]): void {
  events.push({ type: 'explosion', lane: source.lane, x: source.x, radius: blast.radius, sourceKey: source.key });
  const amount = blast.damage * levelScale(b, source.level);
  for (const u of s.units) {
    if (u.faction === source.faction || u.hp <= 0) continue;
    const dx = u.x - source.x;
    const dLane = u.lane - source.lane;
    if (Math.sqrt(dx * dx + dLane * dLane) <= blast.radius) damageUnit(s, u, amount, events);
  }
}
