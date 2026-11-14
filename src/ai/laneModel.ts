/**
 * A quick reckoning of how a fight in one lane will go, shared by both computer players: the
 * plants' firepower against the zombies coming, the time the zombies spend walking into it, and
 * how long the plants' health holds them once they bite. It is a rough model, not a simulation:
 * good enough to tell "this lane holds" from "this lane falls" and to rank lanes.
 */

import type { Balance } from '../data/balance';
import { levelScale } from '../sim/lookup';
import type { Unit } from '../sim/types';
import type { LaneView } from './lawn';

/** Damage per second a plant deals with its shots at its level, before any shield. */
export function shotDps(b: Balance, u: Unit): number {
  const shot = b.units[u.key]?.shot;
  return shot === undefined ? 0 : (shot.damage * levelScale(b, u.faction, u.level, 'damage')) / shot.interval;
}

/** Damage per second a zombie bites for at its level. */
export function biteDps(b: Balance, u: Unit): number {
  const melee = b.units[u.key]?.melee;
  return melee === undefined ? 0 : (melee.damage * levelScale(b, u.faction, u.level, 'damage')) / melee.interval;
}

/** Shots per second of the plants in `plants`. */
function shotRate(b: Balance, plants: readonly Unit[]): number {
  let rate = 0;
  for (const p of plants) {
    const shot = b.units[p.key]?.shot;
    if (shot !== undefined) rate += 1 / shot.interval;
  }
  return rate;
}

/**
 * The plants' firepower against the lane's front zombie, damage per second: their shots, less what
 * a shield blocks (one shot every shield interval when the front zombie has one).
 */
export function firepowerAgainst(b: Balance, plants: readonly Unit[], front: Unit | undefined, extraDps = 0, extraRate = 0): number {
  let dps = extraDps;
  for (const p of plants) dps += shotDps(b, p);
  const shield = front === undefined ? undefined : b.units[front.key]?.shield;
  if (shield === undefined || dps <= 0) return dps;
  const rate = shotRate(b, plants) + extraRate;
  const blocked = Math.min(1, 1 / shield.interval / rate);
  return dps * (1 - blocked);
}

export interface LaneReckoning {
  /** Zombie health the plants are reckoned to take off before the zombies eat through them. */
  readonly stopping: number;
  /** Health of the zombies in the lane that are still to be stopped (x at or right of `minX`). */
  readonly zombieHp: number;
}

/** Damage per second a zombie's shot deals to each plant it reaches, at its level (pierce counts once per plant). */
export function zombieShotDps(b: Balance, u: Unit): number {
  const shot = b.units[u.key]?.shot;
  if (shot === undefined) return 0;
  const puddle = shot.puddle === undefined ? 0 : shot.puddle.dps;
  return (shot.damage * levelScale(b, u.faction, u.level, 'damage')) / shot.interval + puddle;
}

/**
 * Reckons the fight in a lane between its plants (plus `extra`, a hypothetical Peashooter-like
 * plant: its dps, shot rate and health) and its zombies at or right of `minX`.
 *
 * stopping = firepower × (walk time of the nearest zombie to the front plant + time the zombies
 * need to bite through every plant). Plants hold the lane when `stopping` covers `zombieHp`.
 * With no zombie, the walk is reckoned from the graveyard edge for a zombie of `probeSpeed`.
 * Zombies that shoot wear the plants down from range: their shots count with their bites once
 * the zombies arrive, and those that reach the front plant from where they stand (a Trident, an
 * Archer, a Brain Rot) already shoot during the walk, so the plants have less health to chew.
 *
 * The lawn's twists (all no-ops without one): on ice the zombies walk `view.ice` times as fast, so
 * the walk is shorter; in fog every shot reaches only `view.fog` tiles, so the plants start firing
 * later and the zombies snipe from nearer; lava burns each zombie on its way to the front plant
 * (`lavaCost`), which counts as stopping.
 */
export function reckonLane(
  b: Balance, view: LaneView, minX: number,
  extra: { dps: number; rate: number; hp: number } = { dps: 0, rate: 0, hp: 0 },
  probe?: { speed: number; bite: number; shield: boolean },
): LaneReckoning {
  let front: Unit | undefined;
  let zombieHp = 0;
  let bite = 0;
  for (const z of view.zombies) {
    if (z.x < minX) continue;
    zombieHp += z.hp;
    bite += biteDps(b, z) + zombieShotDps(b, z);
    if (front === undefined || z.x < front.x) front = z;
  }
  const shooting = view.plants.filter((p) => front === undefined || p.x <= front.x);
  let dps = firepowerAgainst(b, shooting, front, extra.dps, extra.rate);
  if (front === undefined && probe !== undefined && probe.shield) {
    const rate = shotRate(b, shooting) + extra.rate;
    if (rate > 0) dps *= 1 - Math.min(1, 1 / 4 / rate);
  }
  let plantHp = extra.hp;
  let frontPlantX = extra.hp > 0 ? 1.5 : 0;
  for (const p of view.plants) {
    if (front !== undefined && p.x > front.x) continue;
    plantHp += p.hp;
    frontPlantX = Math.max(frontPlantX, p.x);
  }
  const speed = (front !== undefined ? (b.units[front.key]?.speed ?? 1) : (probe?.speed ?? 1)) * view.ice;
  const startX = front !== undefined ? front.x : 9.5;
  const from = view.fog === null ? startX : Math.min(startX, frontPlantX + view.fog);
  const walk = Math.max(0, from - frontPlantX - 0.6) / speed;
  let sniping = 0;
  let burning = 0;
  for (const z of view.zombies) {
    const shot = b.units[z.key]?.shot?.range ?? 0;
    const range = view.fog === null ? shot : Math.min(shot, view.fog);
    if (z.x >= minX && z.x - frontPlantX <= range) sniping += zombieShotDps(b, z);
    if (z.x >= minX && view.lava !== null) burning += Math.min(z.hp, lavaCost(view, z.x, frontPlantX, (b.units[z.key]?.speed ?? 1) * view.ice));
  }
  if (front === undefined && probe !== undefined && view.lava !== null) burning += lavaCost(view, startX, frontPlantX, speed);
  const biting = probe !== undefined && front === undefined ? probe.bite : bite;
  const left = Math.max(0, plantHp - sniping * walk);
  const chew = biting > 0 ? left / biting : 0;
  const lasts = sniping > 0 ? Math.min(walk, plantHp / sniping) : walk;
  const stopping = dps * (lasts + chew);
  return { stopping: view.lava === null ? stopping : stopping + burning, zombieHp };
}

/**
 * The health lava takes off a zombie walking from `x` to the front plant at `frontX` at `speed`:
 * the lava's dps for the time it stands on each lava tile in between, plus one burn after the last.
 */
export function lavaCost(view: LaneView, x: number, frontX: number, speed: number): number {
  const lava = view.lava;
  if (lava === null || speed <= 0) return 0;
  let tiles = 0;
  for (let col = Math.max(0, Math.floor(frontX + 0.6)); col < lava.cols.length && col <= Math.floor(x); col++) if (lava.cols[col] === true) tiles += 1;
  return tiles === 0 ? 0 : lava.dps * (tiles / speed + lava.burnSeconds);
}
