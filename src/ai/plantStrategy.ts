/**
 * How the basic computer player plays plants. The plant base strikes zombies that reach it, so a
 * lone zombie that slips through costs a little base health, not the match; what matters is a
 * growing economy and lanes that hold against real pushes. Each think it lists what it would like
 * to do, most urgent first, and `choose` sends the first thing the match accepts. Lanes are taken
 * with the zombie nearest the plant base first.
 *
 * 1. Its first two Sunflowers (fewer if its skill keeps fewer).
 * 2. Cover: a lane with zombies coming and no Peashooter able to hit them gets one on the rearmost
 *    free shooter column (2–4) left of them, or on column 1 or 0 against a weak zombie that is
 *    already past those. It waits for the energy and the card. It leaves a lone weak zombie to the
 *    base, and starts a defence only when it can pay for all of it (`firepowerNeeded` Peashooters):
 *    one Peashooter alone loses to a Brain Eater and pays the zombies a bounty.
 * 3. Reinforce: a lane whose Peashooters fall short of `firepowerNeeded` times its skill's margin
 *    gets a Walnut Bomb (rule 6) if it may have one, then another Peashooter or a merge (rule 7).
 *    It waits for the energy.
 * 4. The rest of its Sunflowers in columns 0–1, replacing any lost; a lane with no plant at all
 *    first, as an empty lane invites a rush. It waits for the energy.
 * 5. Once it has them all, merges its lowest-level Sunflower, up to its skill's level.
 * 6. A Walnut Bomb in column 6 or 5 of a lane that has a Peashooter and a zombie approaching that
 *    tile, unless the lane already has one there.
 * 7. Another Peashooter on the rearmost free column 2–4 of the lane with the fewest, so they spread
 *    evenly and every lane shoots at the zombie base; where a lane's free shooter columns are used
 *    up, it merges the lowest-level Peashooter there instead.
 *
 * Lane ties, Sunflower lanes and Walnut Bomb columns are picked at random, so no two matches play
 * alike.
 */

import { UNIT_INFO } from '../data/units';
import type { Match } from '../sim/match';
import { MAX_LEVEL } from '../sim/types';
import type { Command, Unit } from '../sim/types';
import { randomInt } from '../sim/rng';
import { colOf, mergeCommand, placeCommand, readLawn, shuffledLanes } from './lawn';
import type { BotRng, LaneView } from './lawn';
import { choose } from './wants';
import type { Want } from './wants';

/** Sunflower tiles, back row first. */
const SUN_COLS: readonly number[] = [0, 1];
/** Peashooter tiles. */
const SHOOTER_COLS: readonly number[] = [2, 3, 4];
/** A zombie at or right of this is still in front of every shooter column. */
const FRONT_X = 2.5;
/** Walnut Bomb tiles. */
const WALL_COLS: readonly number[] = [6, 5];
/** Peashooter tiles when a zombie is already past the shooter columns... */
const LAST_DITCH_COLS: readonly number[] = [1, 0];
/** ...and weak enough (in reckoned health) for one Peashooter at point blank to beat. */
const LAST_DITCH_HP = 200;
/** A zombie counts as approaching a wall tile while it is at least this far right of the tile's left edge. */
const WALL_LEAD = 1.5;
/** A Sunflower is not planted in a lane where a zombie is this close to the base. */
const SUN_DANGER_X = 3;
/** Sunflowers it plants before anything but its first defence. */
const FIRST_SUNFLOWERS = 2;
/** Zombies in a lane with no more reckoned health than this are left to the plant base. */
const LONE_LEAK_HP = 200;
/** Zombie health one Peashooter level is reckoned to handle. */
const HP_PER_SHOOTER = 250;
/** A Skeleton Warrior's health counts this much extra for its shield. */
const SHIELD_WEIGHT = 1.25;

export interface PlantPlan {
  /** How many Sunflowers to keep. */
  readonly sunflowers: number;
  /** The level it merges its Sunflowers up to once it has them all (1: no merging). */
  readonly sunflowerLevel: number;
  /** How much more firepower than reckoned it wants in a threatened lane (1: just the reckoning). */
  readonly defenceMargin: number;
}

export function plantMove(match: Match, rng: BotRng, plan: PlantPlan): Command | null {
  const energy = match.state.players.plants.energy;
  return choose(match, plantWants(readLawn(match.state), energy, rng, plan));
}

function* plantWants(
  lawn: readonly LaneView[], energy: number, rng: BotRng, plan: PlantPlan,
): Generator<Want> {
  // Lanes with a zombie some tile can still shoot at, the one nearest the base first.
  const threatened = lanesByNearestZombie(lawn, 0.5);
  // Lanes with a zombie still in front of every shooter column, likewise.
  const front = lanesByNearestZombie(lawn, FRONT_X);

  const owned = sunflowers(lawn).length;
  const sunflowerWant = (): Want | undefined => {
    const tile = sunflowerTile(lawn, rng);
    if (tile === null) return undefined;
    return { cmd: placeCommand('plants', 'sunflower', tile.lane, tile.col), wait: 'energy' };
  };
  if (owned < Math.min(plan.sunflowers, FIRST_SUNFLOWERS)) {
    const want = sunflowerWant();
    if (want !== undefined) yield want;
  }

  for (const view of threatened) {
    const zombie = nearestZombie(view, 0.5);
    if (zombie === undefined || shooters(view).some((p) => p.x <= zombie.x)) continue;
    const threat = laneThreat(view);
    if (threat <= LONE_LEAK_HP) continue; // the base will deal with it
    if (energy < Math.ceil(threat / HP_PER_SHOOTER) * UNIT_INFO.peashooter.price) continue;
    const lastDitch = threatOf(zombie) <= LAST_DITCH_HP ? LAST_DITCH_COLS : [];
    const col = freeColLeftOf(view, SHOOTER_COLS, zombie.x) ?? freeColLeftOf(view, lastDitch, zombie.x);
    if (col !== undefined) yield { cmd: placeCommand('plants', 'peashooter', view.lane, col), wait: 'card' };
  }

  for (const view of front) {
    if (firepower(view) >= firepowerNeeded(view) * plan.defenceMargin) continue;
    const wall = wallWant(view, rng);
    if (wall !== undefined) yield wall;
    const shooter = shooterWant(view);
    if (shooter !== undefined) yield shooter;
  }

  if (owned < plan.sunflowers) {
    const want = sunflowerWant();
    if (want !== undefined) yield want;
  }

  if (owned >= plan.sunflowers) {
    const weakest = lowestLevel(sunflowers(lawn).filter((p) => p.level < plan.sunflowerLevel));
    if (weakest !== undefined) yield { cmd: mergeCommand(weakest), wait: 'energy' };
  }

  for (const view of threatened) {
    const wall = wallWant(view, rng);
    if (wall !== undefined) yield wall;
  }

  for (const view of lanesByFewestShooters(lawn, rng)) {
    const shooter = shooterWant(view);
    if (shooter !== undefined) {
      yield shooter;
      return;
    }
  }
}

/**
 * A Walnut Bomb for a lane with a Peashooter and a zombie approaching column 6 or 5, unless the
 * lane has one there already.
 */
function wallWant(view: LaneView, rng: BotRng): Want | undefined {
  if (shooters(view).length === 0) return undefined;
  if (WALL_COLS.some((c) => view.tiles[c]?.key === 'walnutBomb')) return undefined;
  const approached = (c: number): boolean => view.zombies.some((z) => z.x >= c + WALL_LEAD);
  const col = pick(rng, WALL_COLS.filter((c) => view.tiles[c] === undefined && approached(c)));
  if (col === undefined) return undefined;
  return { cmd: placeCommand('plants', 'walnutBomb', view.lane, col), wait: 'energy' };
}

/**
 * One more Peashooter for a lane: on the rearmost free shooter column left of its nearest zombie
 * (the further back, the longer it shoots before the zombie arrives), or, with no such tile, a
 * merge onto its lowest-level Peashooter in those columns that can hit that zombie.
 */
function shooterWant(view: LaneView): Want | undefined {
  const zombieX = nearestZombie(view, FRONT_X)?.x ?? Infinity;
  const col = freeColLeftOf(view, SHOOTER_COLS, zombieX);
  if (col !== undefined) return { cmd: placeCommand('plants', 'peashooter', view.lane, col), wait: 'energy' };
  const inColumns = shooters(view).filter((p) => SHOOTER_COLS.includes(colOf(p)) && p.x <= zombieX);
  const weakest = lowestLevel(inColumns);
  return weakest === undefined ? undefined : { cmd: mergeCommand(weakest), wait: 'energy' };
}

/** Peashooter levels in the lane that can hit its nearest zombie in front of the shooter columns. */
function firepower(view: LaneView): number {
  const zombieX = nearestZombie(view, FRONT_X)?.x ?? Infinity;
  return shooters(view).reduce((n, p) => (p.x <= zombieX ? n + p.level : n), 0);
}

/**
 * Peashooter levels the lane needs against the zombies in front of its shooter columns: one per
 * `HP_PER_SHOOTER` of their health (shields count extra), one fewer behind a Walnut Bomb.
 */
function firepowerNeeded(view: LaneView): number {
  let hp = 0;
  for (const z of view.zombies) {
    if (z.x >= FRONT_X) hp += threatOf(z);
  }
  const zombieX = nearestZombie(view, FRONT_X)?.x ?? Infinity;
  const walled = view.plants.some((p) => p.key === 'walnutBomb' && p.x <= zombieX);
  return Math.ceil(hp / HP_PER_SHOOTER) - (walled ? 1 : 0);
}

function shooters(view: LaneView): Unit[] {
  return view.plants.filter((p) => p.key === 'peashooter');
}

function sunflowers(lawn: readonly LaneView[]): Unit[] {
  return lawn.flatMap((view) => view.plants.filter((p) => p.key === 'sunflower'));
}

/** The reckoned health of every zombie in the lane that some tile can still shoot at. */
function laneThreat(view: LaneView): number {
  return view.zombies.reduce((n, z) => (z.x >= 0.5 ? n + threatOf(z) : n), 0);
}

/** A zombie's health as a Peashooter sees it: a shield makes it count for more. */
function threatOf(z: Unit): number {
  return z.key === 'skeletonWarrior' ? z.hp * SHIELD_WEIGHT : z.hp;
}

/** The zombie nearest the plant base among those at or right of `minX`. */
function nearestZombie(view: LaneView, minX: number): Unit | undefined {
  let nearest: Unit | undefined;
  for (const z of view.zombies) {
    if (z.x >= minX && (nearest === undefined || z.x < nearest.x)) nearest = z;
  }
  return nearest;
}

/** Lanes holding a zombie at or right of `minX`, the one with the zombie nearest the base first. */
function lanesByNearestZombie(lawn: readonly LaneView[], minX: number): LaneView[] {
  const withZombie = lawn.filter((view) => nearestZombie(view, minX) !== undefined);
  const x = (view: LaneView): number => nearestZombie(view, minX)?.x ?? Infinity;
  return withZombie.sort((a, b) => x(a) - x(b) || a.lane - b.lane);
}

/** Every lane, the one with the fewest Peashooters first; ties in a random order. */
function lanesByFewestShooters(lawn: readonly LaneView[], rng: BotRng): LaneView[] {
  const order = shuffledLanes(rng);
  const rank = (view: LaneView): number => order.indexOf(view.lane);
  return [...lawn].sort((a, b) => shooters(a).length - shooters(b).length || rank(a) - rank(b));
}

/** The first of `cols` that is free and whose plant could hit something at `x`. */
function freeColLeftOf(view: LaneView, cols: readonly number[], x: number): number | undefined {
  return cols.find((c) => view.tiles[c] === undefined && c + 0.5 <= x);
}

function pick(rng: BotRng, items: readonly number[]): number | undefined {
  return items.length === 0 ? undefined : items[randomInt(rng, items.length)];
}

/** The lowest-level unit below the top level; ties go to the lower id. */
function lowestLevel(units: readonly Unit[]): Unit | undefined {
  let best: Unit | undefined;
  for (const u of units) {
    if (u.level < MAX_LEVEL && (best === undefined || u.level < best.level)) best = u;
  }
  return best;
}

/**
 * A free tile in the Sunflower columns of a lane no zombie is about to reach: a lane with no plant
 * at all first (an empty lane invites a rush), then the back row before the front.
 */
function sunflowerTile(lawn: readonly LaneView[], rng: BotRng): { lane: number; col: number } | null {
  const order = shuffledLanes(rng);
  const planted = (view: LaneView): number => (view.plants.length === 0 ? 0 : 1);
  const rank = (view: LaneView): number => order.indexOf(view.lane);
  const lanes = [...lawn].sort((a, b) => planted(a) - planted(b) || rank(a) - rank(b));
  for (const col of SUN_COLS) {
    for (const view of lanes) {
      if (view.tiles[col] !== undefined || view.zombies.some((z) => z.x < SUN_DANGER_X)) continue;
      return { lane: view.lane, col };
    }
  }
  return null;
}
