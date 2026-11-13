/**
 * Equal-budget lane duels and the merge value they measure (spec 6.3 and 10: a level-N unit
 * should be worth 1.00 to 1.15 times N separate level-1 units).
 *
 * A duel is one lane, nothing else on the lawn, no income that matters, bases that cannot fall and
 * no sudden death. Plants stand on the back columns of lane 2 (a group of k on columns 0..k-1); the
 * zombies rise together at the graveyard edge and walk in (enemies of a measured plant group rise
 * `ENEMY_SPACING` apart). It ends when one side has nobody
 * standing, or after `DUEL_TICKS`.
 *
 * Merge value of type X at level N against enemy type Y: how many level-1 Ys a group can just
 * hold off, its "break-even count". That count is found by playing the group against 1, 2, 3, ...
 * Ys and interpolating where the score (the group's share of health left minus the enemy's)
 * crosses zero. The merge value is the break-even count of one level-N X divided by that of N
 * level-1 Xs. Both orders are measured: plants as X against each zombie, and zombies as X against
 * Peashooters.
 */

import { BALANCE } from '../data/balance';
import type { Balance } from '../data/balance';
import { factionOf, priceOf } from '../data/units';
import { isStanding, levelScale } from '../sim/lookup';
import { Match, defaultConfig, spawnUnit } from '../sim/match';
import { PLANT_COLS, ZOMBIE_SPAWN_X } from '../sim/types';
import type { Faction, Unit, UnitKey } from '../sim/types';

/**
 * When plants are measured, the level-1 zombies they face arrive this far apart (tiles), one
 * behind the other, as zombies sent one by one do. Rising all on one spot, a single splash would
 * catch every one of them and a Mango-pult would hold off any number.
 */
export const ENEMY_SPACING = 0.5;

/** 3:00: far longer than any of these duels takes. */
export const DUEL_TICKS = 5400;
const LANE = 2;

/** Some units of one type: `count` separate ones at `level`. */
export interface Group { key: UnitKey; level: number; count: number }

export interface DuelResult {
  /** Share of each side's starting health still standing at the end, 0..1. */
  left: Record<Faction, number>;
  ticks: number;
}

/** Raises a freshly spawned unit to `level` exactly as merges would, at full health. */
function raise(b: Balance, u: Unit, level: number): void {
  if (level === 1) return;
  const stats = b.units[u.key];
  if (!stats) throw new Error(`no stats for ${u.key}`);
  u.level = level;
  u.maxHp = Math.round(stats.hp * levelScale(b, u.faction, level, 'hp'));
  u.hp = u.maxHp;
  u.spent = priceOf(u.key) * level;
}

/**
 * Plays one duel. A plant group of more than one unit stands on columns 0..count-1. A single plant
 * stands on `plantFront` (default 0) so that a merged plant can be put where the front of the
 * group it is compared with would be.
 */
export function laneDuel(
  plants: Group, zombies: Group, balance: Balance = BALANCE, plantFront = 0, zombieSpacing = 0,
): DuelResult {
  if (plants.count > PLANT_COLS) throw new RangeError(`at most ${PLANT_COLS} plants fit in a lane`);
  const config = defaultConfig(1, balance);
  config.startEnergy = { plants: 0, zombies: 0 };
  config.baseHp = { plants: 1e9, zombies: 1e9 };
  config.suddenDeath = false;
  const match = new Match(config, balance);
  const s = match.state;
  for (let i = 0; i < plants.count; i++) {
    const col = plants.count === 1 ? plantFront : i;
    raise(balance, spawnUnit(s, balance, plants.key, LANE, col + 0.5), plants.level);
  }
  for (let i = 0; i < zombies.count; i++) {
    raise(balance, spawnUnit(s, balance, zombies.key, LANE, ZOMBIE_SPAWN_X + i * zombieSpacing), zombies.level);
  }
  const total = sideHp(s.units);
  while (s.tick < DUEL_TICKS) {
    match.step();
    const now = sideHp(s.units);
    if (now.plants <= 0 || now.zombies <= 0) break;
  }
  const end = sideHp(s.units);
  return {
    left: { plants: end.plants / total.plants, zombies: end.zombies / total.zombies },
    ticks: s.tick,
  };
}

function sideHp(units: readonly Unit[]): Record<Faction, number> {
  const hp = { plants: 0, zombies: 0 };
  for (const u of units) if (isStanding(u)) hp[u.faction] += u.hp;
  return hp;
}

/**
 * How many level-1 `enemy` units `group` just holds off: the interpolated count where the score
 * (the group's share of health left minus the enemy's) crosses zero, searched up to `maxCount`.
 * A plant enemy is capped by the columns of a lane.
 */
export function breakEven(group: Group, enemy: UnitKey, balance: Balance = BALANCE, plantFront = 0): number {
  const groupIsPlants = factionOf(group.key) === 'plants';
  const maxCount = groupIsPlants ? 40 : PLANT_COLS;
  const score = (m: number): number => {
    const other: Group = { key: enemy, level: 1, count: m };
    const r = groupIsPlants ? laneDuel(group, other, balance, plantFront, ENEMY_SPACING) : laneDuel(other, group, balance);
    const mine: Faction = groupIsPlants ? 'plants' : 'zombies';
    const theirs: Faction = groupIsPlants ? 'zombies' : 'plants';
    return r.left[mine] - r.left[theirs];
  };
  let prev = 1; // against nobody the group keeps everything
  for (let m = 1; m <= maxCount; m++) {
    const now = score(m);
    if (now <= 0) return m - 1 + prev / (prev - now);
    prev = now;
  }
  return maxCount;
}

export interface MergeValue { unit: UnitKey; enemy: UnitKey; level: number; separate: number; merged: number; value: number }

/**
 * The merge value of `unit` at `level` against `enemy` (see the note at the top). A merged plant
 * stands where the front of the separate group would be, so both face the same walk.
 */
export function mergeValue(unit: UnitKey, enemy: UnitKey, level: number, balance: Balance = BALANCE): MergeValue {
  const separate = breakEven({ key: unit, level: 1, count: level }, enemy, balance);
  const merged = breakEven({ key: unit, level, count: 1 }, enemy, balance, level - 1);
  return { unit, enemy, level, separate, merged, value: merged / separate };
}

/** The pairs the merge value is measured on: every fighting unit of phase 1, both orders. */
export const MERGE_PAIRS: ReadonlyArray<readonly [UnitKey, UnitKey]> = [
  ['peashooter', 'brainEater'], ['peashooter', 'veryFastWalker'], ['peashooter', 'skeletonWarrior'],
  ['brainEater', 'peashooter'], ['veryFastWalker', 'peashooter'], ['skeletonWarrior', 'peashooter'],
];

/**
 * The units that fight on their own (spec 10): their merge value is measured. Each plant against
 * Brain Eaters, each zombie against Peashooters. Walls, mines, the Cherry, the Torchwood, the
 * Sunflower and the Necromancer are judged otherwise.
 */
export const FIGHTERS: readonly UnitKey[] = [
  'peashooter', 'kernelPult', 'mangoPult', 'pumpkinSquash',
  'brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'hotTopic',
  'cowboyZombie', 'tridentZombie', 'brainRot',
];

/** A fighter's merge value at N = 2..5 against its standard enemy, and their mean. */
export function unitMergeValue(unit: UnitKey, balance: Balance = BALANCE): { enemy: UnitKey; values: number[]; mean: number } {
  const enemy: UnitKey = factionOf(unit) === 'plants' ? 'brainEater' : 'peashooter';
  const values: number[] = [];
  for (let level = 2; level <= 5; level++) values.push(mergeValue(unit, enemy, level, balance).value);
  return { enemy, values, mean: values.reduce((a, b) => a + b, 0) / values.length };
}
