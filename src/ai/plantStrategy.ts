/**
 * How the basic computer player plays plants, with all ten cards. The plant base strikes zombies
 * that reach it, but a strike kill pays no bounty, and a Sunflower that is hurt makes no Sun; so
 * what matters is a protected economy (Sunflowers at the back of lanes that are covered and quiet),
 * a shooter in every lane early, and lanes that hold against real pushes. Each think it lists what
 * it would like to do, most urgent first, and `choose` sends the first thing the match accepts
 * right now. It reckons each lane's fight with `reckonLane` (src/ai/laneModel.ts).
 *
 * 1. Cherry Bomber on the heaviest stack within its blast, when the stack is worth it.
 * 2. In the opening (the first 20 s) its first Sunflowers (two, fewer if its skill keeps fewer),
 *    in lanes with no zombie. A Sunflower lost later is replaced only by rule 5, behind cover.
 * 3. Hold: lanes whose plants are reckoned to lose, zombies nearest the base first: a wall in
 *    front when the lane already has two shooters to protect, else a Potato Mine where it will arm
 *    in time and the push is small, else a shooter on the rearmost free column
 *    1-4 left of the zombie (column 0 as a last ditch) or a merge, else a wall in front. Not when
 *    only a lone leak gets through a lane with no plant (the base deals with it; with plants, even
 *    a lone leak would eat them, Sunflowers first), and not when the lane is lost even
 *    with that help: a plant thrown into a lost lane only feeds the zombies its bounty (a Potato
 *    Mine in the zombies' path is the one exception: it costs little and pays nothing when spent).
 * 4. Cover: a lane with no shooter gets a Peashooter.
 * 5. Its Sunflowers: first each one merged up to its skill's floor (a level-2 Sunflower outlives a
 *    Bone Storm), then the rest of them on column 0 then 1 of a lane that has a shooter and no
 *    zombie on the lawn; then it merges its lowest-level Sunflower up to its skill's level.
 * 6. Margin: a lane under its skill's margin gets another shooter, then a wall.
 * 7. Build-up, from what is left above its reserve: a Torchwood just in front of two or more
 *    Peashooters; a Potato Mine at the front of a quiet lane (two on the lawn at most); a wall in front of two shooters (an
 *    Avocado Bunker where a Torchwood is worth guarding, else a Walnut Bomb), then a Pumpkin Squash
 *    behind that wall; then another shooter in the lane with the fewest (merging where the
 *    columns are used up).
 *
 * Which shooter: a Kernel-pult against shields (its lobs ignore them, its butter stuns), a
 * Mango-pult against two or more zombies (its splash), otherwise a Peashooter (a Torchwood doubles its peas).
 * Which wall: a Pumpkin Squash against two or more zombies when it can afford one, an Avocado Bunker against heavy or
 * fast-biting zombies (its armor shaves every bite), otherwise a Walnut Bomb.
 *
 * Lane ties, Sunflower lanes and wall columns are picked at random, so no two matches play alike.
 */

import type { Balance } from '../data/balance';
import { UNIT_INFO } from '../data/units';
import type { Match } from '../sim/match';
import { randomInt } from '../sim/rng';
import { MAX_LEVEL, PLANT_COLS } from '../sim/types';
import type { CardKey, Command, Unit } from '../sim/types';
import { reckonLane } from './laneModel';
import { mergeCommand, placeCommand, readLawn, shuffledLanes } from './lawn';
import type { BotRng, LaneView } from './lawn';
import { choose } from './wants';
import type { Want } from './wants';

/** Sunflower tiles, back row first. */
const SUN_COLS: readonly number[] = [0, 1];
/** Shooter tiles, the rearmost (longest walk for a zombie) first. */
const SHOOTER_COLS: readonly number[] = [1, 2, 3, 4];
/** Shooter tile when a zombie is already past the shooter columns. */
const LAST_DITCH_COLS: readonly number[] = [0];
/** Wall tiles. */
const WALL_COLS: readonly number[] = [6, 5];
/** Pumpkin Squash tiles: in front of the shooters, behind the wall. */
const PUMPKIN_COLS: readonly number[] = [4, 5, 3];
/** Potato Mine tiles at the front of a quiet lane. */
const MINE_COLS: readonly number[] = [7, 6];
/** A zombie counts as approaching a wall tile while it is at least this far right of the tile's left edge. */
const WALL_LEAD = 1.5;
/** Sunflowers it plants before anything but its first defence, in the opening. */
const FIRST_SUNFLOWERS = 2;
/** The opening: the first 20 s, before zombies reach the plants. Later Sunflowers need cover. */
const OPENING_TICKS = 600;
/** Zombie health left over, in a lane with no plant, that the plant base is trusted to deal with. */
const LONE_LEAK_HP = 200;
/** Potato Mines it keeps planted ahead of quiet lanes, at most. */
const QUIET_MINES = 2;
/** A Potato Mine is the help for a push of at most this much zombie health. */
const MINE_PUSH_HP = 500;
/** Cherry Bomber: the zombie health its blast must catch (each zombie counted up to the blast). */
const CHERRY_MIN = 450;

const SHOOTERS: ReadonlySet<CardKey> = new Set(['peashooter', 'kernelPult', 'mangoPult']);
const WALLS: ReadonlySet<CardKey> = new Set(['walnutBomb', 'avocadoBunker', 'pumpkinSquash']);
/** Zombies whose bites an Avocado Bunker's armor shaves most. */
const FAST_BITERS: ReadonlySet<string> = new Set(['hotTopic', 'veryFastWalker', 'boneMinion']);

export interface PlantPlan {
  /** How many Sunflowers to keep. */
  readonly sunflowers: number;
  /** The level it merges its Sunflowers up to once it has them all (1: no merging). */
  readonly sunflowerLevel: number;
  /**
   * The level it merges each Sunflower up to before it plants another (1: none). A level-2
   * Sunflower has twice the health, enough to outlive a Bone Storm or a Meteor.
   */
  readonly sunflowerFloor: number;
  /** How much more stopping power than the zombies' health it wants in a lane (rule 6). */
  readonly defenceMargin: number;
  /**
   * Energy it keeps back for emergencies: rules 5 and 7 only spend what is left above it, and it
   * saves up rather than go below.
   */
  readonly reserve: number;
}

export function plantMove(match: Match, rng: BotRng, plan: PlantPlan): Command | null {
  const s = match.state;
  return choose(match, plantWants(match.balance, readLawn(s), s.players.plants.energy, rng, plan, s.tick < OPENING_TICKS));
}

function* plantWants(
  b: Balance, lawn: readonly LaneView[], energy: number, rng: BotRng, plan: PlantPlan, opening: boolean,
): Generator<Want> {
  /** Whether spending `price` leaves the reserve untouched (rules 5 and 7). */
  const spare = (price: number): boolean => energy - price >= plan.reserve;
  const threatened = lanesByNearestZombie(lawn, 0.5);
  const owned = sunflowers(lawn).length;
  const sunflowerWant = (opening: boolean): Want | undefined => {
    const tile = sunflowerTile(lawn, rng, opening);
    if (tile === null) return undefined;
    return { cmd: placeCommand('plants', 'sunflower', tile.lane, tile.col), wait: 'energy' };
  };

  const cherry = cherryWant(b, lawn);
  if (cherry !== undefined) yield cherry;

  if (opening && owned < Math.min(plan.sunflowers, FIRST_SUNFLOWERS)) {
    const want = sunflowerWant(true);
    if (want !== undefined) yield want;
  }

  for (const view of threatened) {
    const r = reckonLane(b, view, 0.5);
    // A lone leak down a lane with no plant costs a little base health; one with plants eats them.
    if (r.zombieHp - r.stopping <= (view.plants.length === 0 ? LONE_LEAK_HP : 0)) continue;
    const helped = reckonLane(b, view, 0.5, oneMoreShooter(b));
    if (helped.zombieHp > helped.stopping) {
      // Lost even with another shooter: only a cheap Potato Mine in its path, else the base takes it.
      const mine = mineWant(b, view, false);
      if (mine !== undefined) yield mine;
      continue;
    }
    // A wall in front protects two shooters from biters; against zombies that shoot it only soaks.
    const biters = view.zombies.every((z) => (b.units[z.key]?.shot?.range ?? 0) < 4);
    const walled = biters && shooters(view).length >= 2 ? wallWant(view, rng, energy) : undefined;
    const help = walled ?? (r.zombieHp <= MINE_PUSH_HP ? mineWant(b, view, false) : undefined)
      ?? shooterWant(view, true, rng) ?? wallWant(view, rng, energy);
    if (help !== undefined) yield help;
  }

  for (const view of lanesByFewestShooters(lawn, rng)) {
    if (shooters(view).length > 0) break;
    const want = shooterWant(view, false, rng, 'peashooter');
    if (want !== undefined) yield want;
  }

  const unripe = lowestLevel(sunflowers(lawn).filter((p) => p.level < plan.sunflowerFloor && p.hurt === 0));
  if (unripe !== undefined) {
    if (!spare(UNIT_INFO.sunflower.price)) return;
    yield { cmd: mergeCommand(unripe), wait: 'energy' };
  }

  if (owned < plan.sunflowers) {
    const want = sunflowerWant(false);
    if (want !== undefined) {
      if (!spare(UNIT_INFO.sunflower.price)) return;
      yield want;
    }
  }

  if (owned >= plan.sunflowers) {
    const weakest = lowestLevel(sunflowers(lawn).filter((p) => p.level < plan.sunflowerLevel && p.hurt === 0));
    if (weakest !== undefined) {
      if (!spare(UNIT_INFO.sunflower.price)) return;
      yield { cmd: mergeCommand(weakest), wait: 'energy' };
    }
  }

  for (const view of threatened) {
    const r = reckonLane(b, view, 0.5);
    if (r.stopping >= r.zombieHp * plan.defenceMargin) continue;
    const shooter = shooterWant(view, false, rng);
    if (shooter !== undefined) yield shooter;
    const wall = wallWant(view, rng, energy);
    if (wall !== undefined) yield wall;
  }

  if (!spare(UNIT_INFO.torchwood.price)) return;
  const torch = torchWant(lawn);
  if (torch !== undefined) yield torch;
  const mines = lawn.reduce((n, view) => n + view.plants.filter((p) => p.key === 'potatoMine').length, 0);
  for (const view of mines >= QUIET_MINES ? [] : shuffledLanes(rng).map((lane) => lawn[lane] as LaneView)) {
    const mine = view.zombies.length === 0 && shooters(view).length > 0 ? mineWant(b, view, true) : undefined;
    if (mine !== undefined) {
      yield mine;
      break;
    }
  }
  const built = buildUpWant(lawn, rng);
  if (built !== undefined) yield built;
  for (const view of lanesByFewestShooters(lawn, rng)) {
    const shooter = shooterWant(view, false, rng);
    if (shooter !== undefined) {
      yield shooter;
      return;
    }
  }
}

/**
 * Building a lane up before the zombies come: a lane with two shooters and no wall gets one on
 * column 6 or 5 (an Avocado Bunker where a Torchwood stands behind it, worth guarding, else a
 * Walnut Bomb); a walled lane with two shooters and no Pumpkin Squash gets one in front of them.
 */
function buildUpWant(lawn: readonly LaneView[], rng: BotRng): Want | undefined {
  for (const lane of shuffledLanes(rng)) {
    const view = lawn[lane] as LaneView;
    const n = shooters(view).length;
    if (n >= 2 && !view.plants.some((p) => WALLS.has(p.key as CardKey))) {
      const col = WALL_COLS.find((c) => view.tiles[c] === undefined);
      const kind: CardKey = view.plants.some((p) => p.key === 'torchwood') ? 'avocadoBunker' : 'walnutBomb';
      if (col !== undefined) return { cmd: placeCommand('plants', kind, lane, col), wait: 'energy' };
    }
    if (n >= 2 && view.plants.some((p) => WALLS.has(p.key as CardKey) && p.key !== 'pumpkinSquash')
      && !view.plants.some((p) => p.key === 'pumpkinSquash')) {
      const col = PUMPKIN_COLS.find((c) => view.tiles[c] === undefined);
      if (col !== undefined) return { cmd: placeCommand('plants', 'pumpkinSquash', lane, col), wait: 'energy' };
    }
  }
  return undefined;
}

/** A fresh level-1 Peashooter as `reckonLane` adds it to a lane. */
function oneMoreShooter(b: Balance): { dps: number; rate: number; hp: number } {
  const pea = b.units.peashooter;
  const shot = pea?.shot;
  if (pea === undefined || shot === undefined) return { dps: 0, rate: 0, hp: 0 };
  return { dps: shot.damage / shot.interval, rate: 1 / shot.interval, hp: pea.hp };
}

/**
 * Which shooter a lane gets next: a Kernel-pult against a shield, a Mango-pult against a crowd,
 * a Peashooter while it has fewer than two (a Torchwood doubles peas), then whichever pult it has
 * fewer of.
 */
function shooterKind(view: LaneView, rng: BotRng): CardKey {
  if (view.zombies.some((z) => z.key === 'skeletonWarrior')) return 'kernelPult';
  if (view.zombies.length >= 2) return 'mangoPult';
  const count = (key: CardKey): number => view.plants.filter((p) => p.key === key).length;
  if (count('peashooter') < 2) return 'peashooter';
  const kernels = count('kernelPult');
  const mangos = count('mangoPult');
  if (kernels !== mangos) return kernels < mangos ? 'kernelPult' : 'mangoPult';
  return randomInt(rng, 2) === 0 ? 'kernelPult' : 'mangoPult';
}

/**
 * One more shooter for a lane: on the rearmost free shooter column left of its nearest zombie
 * (the further back, the longer it shoots before the zombie arrives), on column 0 as a last ditch
 * when `urgent`, or else a merge onto its lowest-level shooter of that kind that can hit that
 * zombie (any kind when there is none).
 */
function shooterWant(view: LaneView, urgent: boolean, rng: BotRng, kind?: CardKey): Want | undefined {
  const unit = kind ?? shooterKind(view, rng);
  const zombieX = nearestZombie(view, 0.5)?.x ?? Infinity;
  const col = freeColLeftOf(view, SHOOTER_COLS, zombieX) ?? (urgent ? freeColLeftOf(view, LAST_DITCH_COLS, zombieX) : undefined);
  if (col !== undefined) return { cmd: placeCommand('plants', unit, view.lane, col), wait: 'energy' };
  const reachable = shooters(view).filter((p) => p.x <= zombieX);
  const weakest = lowestLevel(reachable.filter((p) => p.key === unit)) ?? lowestLevel(reachable);
  return weakest === undefined ? undefined : { cmd: mergeCommand(weakest), wait: 'energy' };
}

/** Which wall a lane gets (see the note at the top). */
function wallKind(view: LaneView, energy: number): CardKey {
  const hp = view.zombies.reduce((n, z) => n + z.hp, 0);
  if (view.zombies.length >= 2 && energy >= UNIT_INFO.pumpkinSquash.price) return 'pumpkinSquash';
  if (hp >= 600 || view.zombies.some((z) => FAST_BITERS.has(z.key))) return 'avocadoBunker';
  return 'walnutBomb';
}

/**
 * A wall for a lane with a shooter and a zombie approaching column 6 or 5, unless the lane has a
 * wall there already.
 */
function wallWant(view: LaneView, rng: BotRng, energy: number): Want | undefined {
  if (shooters(view).length === 0) return undefined;
  if (WALL_COLS.some((c) => { const k = view.tiles[c]?.key; return k !== undefined && WALLS.has(k as CardKey); })) return undefined;
  const approached = (c: number): boolean => view.zombies.some((z) => z.x >= c + WALL_LEAD);
  const col = pick(rng, WALL_COLS.filter((c) => view.tiles[c] === undefined && approached(c)));
  if (col === undefined) return undefined;
  return { cmd: placeCommand('plants', wallKind(view, energy), view.lane, col), wait: 'energy' };
}

/**
 * A Potato Mine in a lane with none: in front of its nearest zombie on a free column that zombie
 * reaches only after the mine has armed, or (`quiet`, no zombie) on a front column.
 */
function mineWant(b: Balance, view: LaneView, quiet: boolean): Want | undefined {
  const stats = b.units.potatoMine?.mine;
  if (stats === undefined || view.plants.some((p) => p.key === 'potatoMine')) return undefined;
  const front = nearestZombie(view, 0.5);
  let col: number | undefined;
  if (front === undefined) {
    if (!quiet) return undefined;
    col = MINE_COLS.find((c) => view.tiles[c] === undefined);
  } else {
    const speed = b.units[front.key]?.speed ?? 0.35;
    const reach = front.x - stats.armSeconds * speed - stats.reach; // where it will be once armed
    for (let c = Math.min(PLANT_COLS - 1, Math.floor(reach - 0.5)); c >= 1; c--) {
      if (view.tiles[c] === undefined) {
        col = c;
        break;
      }
    }
  }
  if (col === undefined) return undefined;
  return { cmd: placeCommand('plants', 'potatoMine', view.lane, col), wait: 'energy' };
}

/**
 * A Torchwood in the lane with the most Peashooter levels (two or more) and none yet, on the first
 * free column just in front of its front Peashooter, so every pea passes it.
 */
function torchWant(lawn: readonly LaneView[]): Want | undefined {
  let best: { view: LaneView; levels: number } | undefined;
  for (const view of lawn) {
    if (view.plants.some((p) => p.key === 'torchwood')) continue;
    const levels = view.plants.reduce((n, p) => (p.key === 'peashooter' ? n + p.level : n), 0);
    if (levels >= 2 && (best === undefined || levels > best.levels)) best = { view, levels };
  }
  if (best === undefined) return undefined;
  const view = best.view;
  const frontPea = Math.max(...view.plants.filter((p) => p.key === 'peashooter').map((p) => p.x));
  const zombieX = nearestZombie(view, 0.5)?.x ?? Infinity;
  for (let c = Math.floor(frontPea) + 1; c < PLANT_COLS; c++) {
    if (c + 0.5 >= zombieX) break;
    if (view.tiles[c] === undefined) return { cmd: placeCommand('plants', 'torchwood', view.lane, c), wait: 'energy' };
  }
  return undefined;
}

/**
 * A Cherry Bomber on the free tile whose blast catches the most zombie health (each zombie counted
 * up to the blast's damage, lanes one apart as the blast measures them), when that clears
 * `CHERRY_MIN`.
 */
function cherryWant(b: Balance, lawn: readonly LaneView[]): Want | undefined {
  const fuse = b.units.cherryBomber?.fuse;
  if (fuse === undefined) return undefined;
  const zombies = lawn.flatMap((view) => view.zombies);
  if (zombies.length < 2) return undefined;
  let best: { lane: number; col: number; caught: number } | undefined;
  for (const view of lawn) {
    for (let col = 0; col < PLANT_COLS; col++) {
      if (view.tiles[col] !== undefined) continue;
      let caught = 0;
      for (const z of zombies) {
        const dl = z.lane - view.lane;
        const dx = z.x - (col + 0.5);
        if (dl * dl + dx * dx <= fuse.radius * fuse.radius) caught += Math.min(z.hp, fuse.damage);
      }
      if (caught >= CHERRY_MIN && (best === undefined || caught > best.caught)) best = { lane: view.lane, col, caught };
    }
  }
  return best === undefined ? undefined : { cmd: placeCommand('plants', 'cherryBomber', best.lane, best.col) };
}

function shooters(view: LaneView): Unit[] {
  return view.plants.filter((p) => SHOOTERS.has(p.key as CardKey));
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

/** Every lane, the one with the fewest shooters first; ties in a random order. */
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
 * A free tile in the Sunflower columns, back row first, of a lane no zombie is in. Outside the
 * `opening` (the first Sunflowers, before any lane is covered) the lane must also have a shooter,
 * so the Sunflower stands behind cover. Lanes with the most shooters first, ties at random.
 */
function sunflowerTile(lawn: readonly LaneView[], rng: BotRng, opening: boolean): { lane: number; col: number } | null {
  const order = shuffledLanes(rng);
  const rank = (view: LaneView): number => order.indexOf(view.lane);
  const lanes = lawn
    .filter((view) => view.zombies.length === 0 && (opening || shooters(view).length > 0))
    .sort((a, b) => shooters(b).length - shooters(a).length || rank(a) - rank(b));
  for (const col of SUN_COLS) {
    for (const view of lanes) {
      if (view.tiles[col] === undefined) return { lane: view.lane, col };
    }
  }
  return null;
}
