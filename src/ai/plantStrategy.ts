/**
 * How the basic computer player plays plants. The plant base strikes zombies that reach it, so a
 * lone zombie that slips through costs a little base health, not the match; what matters is a
 * growing economy, a Peashooter in every lane early (zombies go wherever the lawn is thinnest) and
 * lanes that hold against real pushes. Each think it lists what it would like to do, most urgent
 * first, and `choose` sends the first thing the match accepts right now. It reckons each lane's
 * fight with `reckonLane` (src/ai/laneModel.ts): its plants' firepower against the zombies coming.
 *
 * 1. Its first two Sunflowers (fewer if its skill keeps fewer).
 * 2. Hold: lanes whose plants are reckoned to lose (the zombies nearest the base first) get
 *    another Peashooter on the rearmost free column 1-4 left of the zombie (column 0 as a last
 *    ditch), or failing that a merge onto one there, or a Walnut Bomb in front. It waits for the
 *    energy. Not when what would get through is no more than a lone leak the base deals with, and
 *    not when the lane is lost even with that help: a Peashooter thrown into a lost lane only
 *    feeds the zombies its bounty, so the base takes that push instead.
 * 3. Cover: a lane with no Peashooter gets one, on its rearmost free column 1-4. It waits.
 * 4. The rest of its Sunflowers on column 0 (then 1), replacing any lost; a lane with no plant at
 *    all first. It waits.
 * 5. Once it has them all, merges its lowest-level Sunflower, up to its skill's level.
 * 6. Margin: a lane whose reckoned stopping power is under its skill's margin times the zombies
 *    in it gets another Peashooter or a merge, then a Walnut Bomb (column 6 or 5) if it has none.
 * 7. Another Peashooter on the rearmost free column of the lane with the fewest, so they spread
 *    evenly and every lane shoots at the zombie base; where a lane's columns are used up, it
 *    merges the lowest-level Peashooter there instead.
 *
 * Lane ties, Sunflower lanes and Walnut Bomb columns are picked at random, so no two matches play
 * alike.
 */

import type { Balance } from '../data/balance';
import { UNIT_INFO } from '../data/units';
import type { Match } from '../sim/match';
import { randomInt } from '../sim/rng';
import { MAX_LEVEL } from '../sim/types';
import type { Command, Unit } from '../sim/types';
import { reckonLane } from './laneModel';
import { mergeCommand, placeCommand, readLawn, shuffledLanes } from './lawn';
import type { BotRng, LaneView } from './lawn';
import { choose } from './wants';
import type { Want } from './wants';

/** Sunflower tiles, back row first. */
const SUN_COLS: readonly number[] = [0, 1];
/** Peashooter tiles, the rearmost (longest walk for a zombie) first. */
const SHOOTER_COLS: readonly number[] = [1, 2, 3, 4];
/** Peashooter tile when a zombie is already past the shooter columns. */
const LAST_DITCH_COLS: readonly number[] = [0];
/** Walnut Bomb tiles. */
const WALL_COLS: readonly number[] = [6, 5];
/** A zombie counts as approaching a wall tile while it is at least this far right of the tile's left edge. */
const WALL_LEAD = 1.5;
/** A Sunflower is not planted in a lane where a zombie is this close to the base. */
const SUN_DANGER_X = 3;
/** Sunflowers it plants before anything but its first defence. */
const FIRST_SUNFLOWERS = 2;
/** Zombie health left over that the plant base is trusted to deal with. */
const LONE_LEAK_HP = 200;

export interface PlantPlan {
  /** How many Sunflowers to keep. */
  readonly sunflowers: number;
  /** The level it merges its Sunflowers up to once it has them all (1: no merging). */
  readonly sunflowerLevel: number;
  /** How much more stopping power than the zombies' health it wants in a lane (rule 6). */
  readonly defenceMargin: number;
  /**
   * Energy it keeps back for emergencies: rules 4, 5 and 7 (more Sunflowers, Sunflower merges,
   * spare Peashooters) only spend what is left above it, and it saves up rather than go below.
   */
  readonly reserve: number;
}

export function plantMove(match: Match, rng: BotRng, plan: PlantPlan): Command | null {
  return choose(match, plantWants(match.balance, readLawn(match.state), match.state.players.plants.energy, rng, plan));
}

function* plantWants(
  b: Balance, lawn: readonly LaneView[], energy: number, rng: BotRng, plan: PlantPlan,
): Generator<Want> {
  /** Whether spending `price` leaves the reserve untouched (rules 4, 5 and 7). */
  const spare = (price: number): boolean => energy - price >= plan.reserve;
  const threatened = lanesByNearestZombie(lawn, 0.5);
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
    const r = reckonLane(b, view, 0.5);
    if (r.zombieHp - r.stopping <= LONE_LEAK_HP) continue;
    const helped = reckonLane(b, view, 0.5, oneMoreShooter(b));
    if (helped.zombieHp > helped.stopping) continue; // lost even with help: leave it to the base
    const help = shooterWant(view, true) ?? wallWant(view, rng);
    if (help !== undefined) yield help;
  }

  for (const view of lanesByFewestShooters(lawn, rng)) {
    if (shooters(view).length > 0) break;
    const want = shooterWant(view, false);
    if (want !== undefined) yield want;
  }

  if (owned < plan.sunflowers) {
    const want = sunflowerWant();
    if (want !== undefined) {
      if (!spare(UNIT_INFO.sunflower.price)) return;
      yield want;
    }
  }

  if (owned >= plan.sunflowers) {
    const weakest = lowestLevel(sunflowers(lawn).filter((p) => p.level < plan.sunflowerLevel));
    if (weakest !== undefined) {
      if (!spare(UNIT_INFO.sunflower.price)) return;
      yield { cmd: mergeCommand(weakest), wait: 'energy' };
    }
  }

  for (const view of threatened) {
    const r = reckonLane(b, view, 0.5);
    if (r.stopping >= r.zombieHp * plan.defenceMargin) continue;
    const shooter = shooterWant(view, false);
    if (shooter !== undefined) yield shooter;
    const wall = wallWant(view, rng);
    if (wall !== undefined) yield wall;
  }

  if (!spare(UNIT_INFO.peashooter.price)) return;
  for (const view of lanesByFewestShooters(lawn, rng)) {
    const shooter = shooterWant(view, false);
    if (shooter !== undefined) {
      yield shooter;
      return;
    }
  }
}

/** A fresh level-1 Peashooter as `reckonLane` adds it to a lane. */
function oneMoreShooter(b: Balance): { dps: number; rate: number; hp: number } {
  const pea = b.units.peashooter;
  const shot = pea?.shot;
  if (pea === undefined || shot === undefined) return { dps: 0, rate: 0, hp: 0 };
  return { dps: shot.damage / shot.interval, rate: 1 / shot.interval, hp: pea.hp };
}

/**
 * One more Peashooter for a lane: on the rearmost free shooter column left of its nearest zombie
 * (the further back, the longer it shoots before the zombie arrives), on column 0 as a last ditch
 * when `urgent`, or else a merge onto its lowest-level Peashooter that can hit that zombie.
 */
function shooterWant(view: LaneView, urgent: boolean): Want | undefined {
  const zombieX = nearestZombie(view, 0.5)?.x ?? Infinity;
  const col = freeColLeftOf(view, SHOOTER_COLS, zombieX) ?? (urgent ? freeColLeftOf(view, LAST_DITCH_COLS, zombieX) : undefined);
  if (col !== undefined) return { cmd: placeCommand('plants', 'peashooter', view.lane, col), wait: 'energy' };
  const weakest = lowestLevel(shooters(view).filter((p) => p.x <= zombieX));
  return weakest === undefined ? undefined : { cmd: mergeCommand(weakest), wait: 'energy' };
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

function shooters(view: LaneView): Unit[] {
  return view.plants.filter((p) => p.key === 'peashooter');
}

function sunflowers(lawn: readonly LaneView[]): Unit[] {
  return lawn.flatMap((view) => view.plants.filter((p) => p.key === 'sunflower'));
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
