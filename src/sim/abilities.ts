/**
 * Abilities: what a unit does that is neither a bite nor a shot. Each ability is one small
 * function; `tickAbilities` hands every standing unit that can act to the one its stats name.
 *
 * Every ability timer is the unit's `abilityTimer` (a Necromancer's heal has `auraTimer` of its
 * own), counted down by `tickEconomy` (and standing still while the unit cannot act); the
 * functions here only read and reset them. An ability that finds nothing to work on leaves its
 * timer at 0, so it fires the first tick it has something.
 */

import { seconds } from '../data/balance';
import type { Balance, UnitStats } from '../data/balance';
import { damageUnit, distance, explode } from './damage';
import { isStanding, levelScale, nearestEnemyAhead, statsFor, upgradeScale } from './lookup';
import { abilityUsed as used, spawnMinion } from './spawn';
import { applyStatus, canAct } from './status';
import type { Projectile, SimEvent, SimState, Unit } from './types';

type Mine = NonNullable<UnitStats['mine']>;
type Fuse = NonNullable<UnitStats['fuse']>;
type Leap = NonNullable<UnitStats['leap']>;
type Grow = NonNullable<UnitStats['grow']>;
type Lasso = NonNullable<UnitStats['lasso']>;
type HealAura = NonNullable<UnitStats['healAura']>;
type Raise = NonNullable<UnitStats['raise']>;

/**
 * Step stage, after the plant base's defence and before projectiles: every unit that is standing
 * and can act (see `canAct`) uses its abilities, in ascending id; a unit with several (the
 * Necromancer heals, then raises) uses each on its own. A unit that is down when this stage runs
 * does nothing, so a Necromancer felled by a bite or the base's defence this tick raises nothing;
 * one a projectile fells later in the tick has already raised. A unit that is spent by its own
 * ability leaves the field at once (`unitDied`, cause `'spent'`, no bounty) and does nothing
 * more; units it brings to 0 are removed by `resolveDeaths`. A unit raised here first acts next tick.
 */
export function tickAbilities(s: SimState, b: Balance, events: SimEvent[]): void {
  for (const u of [...s.units]) { // a copy: a spent unit leaves `s.units`, a raised one joins it
    if (!isStanding(u) || !canAct(u)) continue;
    const stats = b.units[u.key];
    if (!stats) continue;
    if (stats.mine && potatoMine(s, b, u, stats.mine, events)) continue;
    if (stats.fuse && cherryFuse(s, b, u, stats.fuse, events)) continue;
    if (stats.leap) pumpkinLeap(s, b, u, stats.leap, events);
    if (stats.lasso) lasso(s, u, stats.lasso, events);
    if (stats.healAura) healAura(s, b, u, stats.healAura, events);
    if (stats.raise) raise(s, b, u, stats.raise, events);
  }
}

/**
 * Whether a Potato Mine has armed. The flag is kept in `stacks` (1 once armed), which no plant
 * uses otherwise; read and set it only through `isArmed` and `arm`.
 */
export function isArmed(u: Unit): boolean {
  return u.stacks === 1;
}

function arm(u: Unit): void {
  u.stacks = 1;
}

/**
 * Potato Mine. Its `abilityTimer` counts down from `armSeconds`; the tick it is first at 0 the
 * mine arms (`abilityUsed 'arm'`, see `isArmed`, so it arms only once). Armed, on the
 * first tick a standing zombie is within `reach` ahead in its lane, it goes off: `abilityUsed
 * 'trigger'` with that zombie, a blast of `damage` within `radius`, and the mine is spent.
 */
function potatoMine(s: SimState, b: Balance, u: Unit, mine: Mine, events: SimEvent[]): boolean {
  if (u.abilityTimer > 0) return false;
  if (!isArmed(u)) {
    arm(u);
    used(u, 'arm', null, events);
  }
  const victim = nearestEnemyAhead(s, u.faction, u.lane, u.x, mine.reach);
  if (!victim) return false;
  used(u, 'trigger', victim.id, events);
  explode(s, b, u, mine, events);
  spend(s, u, events);
  return true;
}

/** Cherry Bomber: when its fuse (`abilityTimer`) reaches 0 it blasts `damage` within `radius` and is spent. */
function cherryFuse(s: SimState, b: Balance, u: Unit, fuse: Fuse, events: SimEvent[]): boolean {
  if (u.abilityTimer > 0) return false;
  explode(s, b, u, fuse, events);
  spend(s, u, events);
  return true;
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
    if (Math.abs(z.x - at) <= leap.radius) damageUnit(s, b, z, amount, events);
  }
  u.abilityTimer = seconds(leap.recoverSeconds);
}

/**
 * Cowboy Zombie: when ready and a standing plant is within `range` ahead in its lane, it ties the
 * strongest such plant (highest level, then highest `maxHp`, then lowest id) for `seconds`:
 * `abilityUsed 'lasso'` with it, then the status, and `interval` until it is ready again.
 */
function lasso(s: SimState, u: Unit, rope: Lasso, events: SimEvent[]): void {
  if (u.abilityTimer > 0) return;
  let target: Unit | null = null;
  for (const p of s.units) { // ascending id: a later one must be strictly stronger to win
    if (p.faction === u.faction || p.lane !== u.lane || !isStanding(p)) continue;
    const ahead = u.faction === 'zombies' ? u.x - p.x : p.x - u.x;
    if (ahead < 0 || ahead > rope.range) continue;
    if (target === null || p.level > target.level || (p.level === target.level && p.maxHp > target.maxHp)) target = p;
  }
  if (!target) return;
  used(u, 'lasso', target.id, events);
  applyStatus(s, target, 'tied', seconds(rope.seconds), 0, u.id, events);
  u.abilityTimer = seconds(rope.interval);
}

/**
 * Necromancer's heal, on `auraTimer`: when ready and any other standing unit of its side within
 * `radius` (straight-line, lanes one apart) is hurt, `abilityUsed 'heal'`, and each of those, in
 * id order, gains `amount` times the special level curve, never above its `maxHp` (`unitHealed`
 * with what it really gained); then `interval` until it is ready again.
 */
function healAura(s: SimState, b: Balance, u: Unit, aura: HealAura, events: SimEvent[]): void {
  if (u.auraTimer > 0) return;
  const hurt = s.units.filter((z) =>
    z !== u && z.faction === u.faction && isStanding(z) && z.hp < z.maxHp && distance(z, u) <= aura.radius);
  if (hurt.length === 0) return;
  used(u, 'heal', null, events);
  const amount = aura.amount * levelScale(b, u.faction, u.level, 'special');
  for (const z of hurt) {
    const hp = Math.min(z.maxHp, z.hp + amount);
    const gained = hp - z.hp;
    z.hp = hp;
    events.push({ type: 'unitHealed', unitId: z.id, amount: gained, hp });
  }
  u.auraTimer = seconds(aura.interval);
}

/**
 * Necromancer's raise, on `abilityTimer`: when ready and fewer than `Balance.minionCap` of the
 * minions it raised stand, `abilityUsed 'raise'` (with the new minion's id), then a minion at its
 * own lane, x and level (see `spawnMinion`), and `interval` until it is ready again. At the cap it
 * waits, ready, until one of them falls.
 */
function raise(s: SimState, b: Balance, u: Unit, rise: Raise, events: SimEvent[]): void {
  if (u.abilityTimer > 0) return;
  let mine = 0;
  for (const m of s.units) if (m.ownerId === u.id && m.key === rise.key && isStanding(m)) mine += 1;
  if (mine >= b.minionCap) return;
  const spawned: SimEvent[] = [];
  const minion = spawnMinion(s, b, u.lane, u.x, u.level, u.id, spawned);
  used(u, 'raise', minion.id, events); // reported before the minion's own unitSpawned
  events.push(...spawned);
  u.abilityTimer = seconds(rise.interval);
}

/**
 * Hot Topic, called by its bite when the bite brought a plant to 0: below `maxStacks` it gains a
 * stack (`abilityUsed 'grow'`), and its health and max each rise by `hpShare` of its base health
 * times its `hp` level curve and its Marketplace `hp` multiplier, rounded. Its bite grows through `grownBite`.
 */
export function grow(s: SimState, b: Balance, u: Unit, g: Grow, events: SimEvent[]): void {
  if (u.stacks >= g.maxStacks) return;
  u.stacks += 1;
  const gain = Math.round(g.hpShare * statsFor(b, u.key).hp * levelScale(b, u.faction, u.level, 'hp') * upgradeScale(b, s.config, u, 'hp'));
  u.maxHp += gain;
  u.hp += gain;
  used(u, 'grow', null, events);
}

/** What a unit's stacks multiply its bite by: `1 + damageShare × stacks` for a Hot Topic, else 1. */
export function grownBite(stats: UnitStats, u: Unit): number {
  return stats.grow ? 1 + stats.grow.damageShare * u.stacks : 1;
}

/** What a unit's stacks multiply its max health by on a merge: `1 + hpShare × stacks` for a Hot Topic, else 1. */
export function grownHealth(stats: UnitStats, u: Unit): number {
  return stats.grow ? 1 + stats.grow.hpShare * u.stacks : 1;
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
  if (!p.burning || p.burnTicks <= 0) return;
  applyStatus(s, u, 'burn', p.burnTicks, p.burnDps, p.ownerId, events);
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
