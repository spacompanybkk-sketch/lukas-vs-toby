/**
 * How the basic computer player plays plants. Each think it lists what it would like to do, most
 * urgent first, and `choose` sends the first thing the match accepts. Lanes are taken with the
 * zombie nearest the plant base first.
 *
 * 1. Cover: a lane with a zombie coming and no Peashooter able to hit it gets one, on a free
 *    shooter column (2–4) left of the zombie; with none left, and a zombie weak enough for one
 *    Peashooter, on column 1 or 0 as a last ditch. It waits for the energy and the card.
 * 2. Reinforce: a lane whose Peashooters fall short of the zombies in front of them (see
 *    `firepowerNeeded`) gets a Walnut Bomb (rule 4) if it may have one, then another Peashooter
 *    (rule 5). It waits for the energy.
 * 3. Sunflowers in columns 0–1 until it owns its skill's number of them, replacing any lost; a lane
 *    with no plant at all first, as an empty lane invites a rush. It waits for the energy.
 * 4. A Walnut Bomb in column 6 or 5 of a lane that has a Peashooter and a zombie approaching that
 *    tile, unless the lane already has one there.
 * 5. Another Peashooter in columns 2–4 of the lane whose nearest zombie is closest to the base (on
 *    an empty lawn: the lane with the fewest, so they spread evenly); once that lane has no free
 *    shooter column left of its zombie, it merges the lowest-level Peashooter there instead.
 *
 * Where several tiles would do, it picks one at random, so no two matches play alike.
 */

import type { Match } from '../sim/match';
import { MAX_LEVEL } from '../sim/types';
import type { Command, Unit } from '../sim/types';
import { randomInt } from '../sim/rng';
import { choose, colOf, mergeCommand, placeCommand, readLawn, shuffledLanes } from './lawn';
import type { BotRng, LaneView, Want } from './lawn';

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
/** Zombie health one Peashooter level is reckoned to handle. */
const HP_PER_SHOOTER = 250;
/** A Skeleton Warrior's health counts this much extra for its shield. */
const SHIELD_WEIGHT = 1.25;

export interface PlantPlan {
  /** How many Sunflowers to keep. */
  readonly sunflowers: number;
}

export function plantMove(match: Match, rng: BotRng, plan: PlantPlan): Command | null {
  return choose(match, plantWants(readLawn(match.state), rng, plan));
}

function* plantWants(lawn: readonly LaneView[], rng: BotRng, plan: PlantPlan): Generator<Want> {
  // Lanes with a zombie some tile can still shoot at, the one nearest the base first.
  const threatened = lanesByNearestZombie(lawn, 0.5);
  // Lanes with a zombie still in front of every shooter column, likewise.
  const front = lanesByNearestZombie(lawn, FRONT_X);

  for (const view of threatened) {
    const zombie = nearestZombie(view, 0.5);
    if (zombie === undefined || shooters(view).some((p) => p.x <= zombie.x)) continue;
    const weak = threatOf(zombie) <= LAST_DITCH_HP;
    const col = freeColLeftOf(view, SHOOTER_COLS, zombie.x, rng) ?? (weak ? freeColLeftOf(view, LAST_DITCH_COLS, zombie.x, rng) : undefined);
    if (col !== undefined) yield { cmd: placeCommand('plants', 'peashooter', view.lane, col), wait: 'card' };
  }

  for (const view of front) {
    if (firepower(view) >= firepowerNeeded(view)) continue;
    const wall = wallWant(view, rng);
    if (wall !== undefined) yield wall;
    const shooter = shooterWant(view, rng);
    if (shooter !== undefined) yield shooter;
  }

  const owned = lawn.reduce((n, view) => n + view.plants.filter((p) => p.key === 'sunflower').length, 0);
  if (owned < plan.sunflowers) {
    const tile = sunflowerTile(lawn, rng);
    if (tile !== null) yield { cmd: placeCommand('plants', 'sunflower', tile.lane, tile.col), wait: 'energy' };
  }

  for (const view of threatened) {
    const wall = wallWant(view, rng);
    if (wall !== undefined) yield wall;
  }

  const targets = front.length > 0 ? front : lanesByFewestShooters(lawn, rng);
  for (const view of targets) {
    const shooter = shooterWant(view, rng);
    if (shooter !== undefined) {
      yield shooter;
      return;
    }
  }
}

/** A Walnut Bomb for a lane with a Peashooter and a zombie approaching column 6 or 5, unless it has one there. */
function wallWant(view: LaneView, rng: BotRng): Want | undefined {
  if (shooters(view).length === 0 || WALL_COLS.some((c) => view.tiles[c]?.key === 'walnutBomb')) return undefined;
  const col = pick(rng, WALL_COLS.filter((c) => view.tiles[c] === undefined && view.zombies.some((z) => z.x >= c + WALL_LEAD)));
  return col === undefined ? undefined : { cmd: placeCommand('plants', 'walnutBomb', view.lane, col), wait: 'energy' };
}

/**
 * One more Peashooter for a lane: on a free shooter column left of its nearest zombie, or, with no
 * such tile, a merge onto its lowest-level Peashooter in those columns that can hit it.
 */
function shooterWant(view: LaneView, rng: BotRng): Want | undefined {
  const zombieX = nearestZombie(view, FRONT_X)?.x ?? Infinity;
  const col = freeColLeftOf(view, SHOOTER_COLS, zombieX, rng);
  if (col !== undefined) return { cmd: placeCommand('plants', 'peashooter', view.lane, col), wait: 'energy' };
  const weakest = lowestLevel(shooters(view).filter((p) => SHOOTER_COLS.includes(colOf(p)) && p.x <= zombieX));
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

/** One of `cols`, at random, that is free and whose plant could hit something at `x`. */
function freeColLeftOf(view: LaneView, cols: readonly number[], x: number, rng: BotRng): number | undefined {
  return pick(rng, cols.filter((c) => view.tiles[c] === undefined && c + 0.5 <= x));
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
  const lanes = [...lawn].sort((a, b) => planted(a) - planted(b) || order.indexOf(a.lane) - order.indexOf(b.lane));
  for (const col of SUN_COLS) {
    for (const view of lanes) {
      if (view.tiles[col] !== undefined || view.zombies.some((z) => z.x < SUN_DANGER_X)) continue;
      return { lane: view.lane, col };
    }
  }
  return null;
}
