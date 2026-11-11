/**
 * How the basic computer player plays zombies. The plant base strikes zombies that reach it one
 * at a time, so a lone zombie that slips through is only a chip; what wins is a push that breaks
 * a lane and arrives together. So it saves up for a push, then sends it, one card after another.
 * Each think it lists what it would like to do, most urgent first, and `choose` sends the first
 * thing the match accepts:
 *
 * 1. Hard only: when its spare energy (beyond what the current push still needs) is worth more
 *    than its line in seconds of income, a merge onto the push's healthiest walking zombie.
 * 2. The current push's Brain Eaters, into the push lane behind its Skeleton Warrior, while any
 *    zombie of the push is still on its way to the plant base. It waits for the energy.
 * 3. A new push, once it has saved enough for the whole of it: a Skeleton Warrior first, into the
 *    lane with the least plant health, which becomes the push lane, to be followed by a random
 *    number of Brain Eaters.
 * 4. From energy beyond that, a Very Fast Walker down a lane with no plant and none of its zombies.
 *
 * Lane ties and push sizes are drawn at random, so no two matches play alike.
 */

import { UNIT_INFO } from '../data/units';
import type { Match } from '../sim/match';
import { randomInt } from '../sim/rng';
import { BASE_STOP_X, MAX_LEVEL } from '../sim/types';
import type { Command, Unit } from '../sim/types';
import { laneOf, mergeCommand, readLawn, sendCommand, shuffledLanes } from './lawn';
import type { BotRng, LaneView } from './lawn';
import { choose } from './wants';
import type { Want } from './wants';

export interface ZombiePlan {
  /**
   * Merge a walking zombie of the push whenever spare energy (beyond what the push still needs) is
   * worth more than this many seconds of the zombies' trickle income; null: never merge.
   */
  readonly mergeSpareSeconds: number | null;
  /** Each push brings between `min` and `max` Brain Eaters behind its Skeleton Warrior. */
  readonly pushBrainEaters: { readonly min: number; readonly max: number };
}

/** What a zombie bot remembers between thinks. */
export interface ZombieMemory {
  /** The lane of the current (or last) push, or null before the first. */
  pushLane: number | null;
  /** Brain Eaters the current push still has to send. */
  owed: number;
  /** Brain Eaters the next push will bring, or null until drawn. */
  nextPush: number | null;
}

export function newZombieMemory(): ZombieMemory {
  return { pushLane: null, owed: 0, nextPush: null };
}

const PRICE = {
  brainEater: UNIT_INFO.brainEater.price,
  veryFastWalker: UNIT_INFO.veryFastWalker.price,
  skeletonWarrior: UNIT_INFO.skeletonWarrior.price,
};

export function zombieMove(
  match: Match, rng: BotRng, plan: ZombiePlan, memory: ZombieMemory,
): Command | null {
  return choose(match, zombieWants(match, readLawn(match.state), rng, plan, memory));
}

function* zombieWants(
  match: Match, lawn: readonly LaneView[], rng: BotRng, plan: ZombiePlan, memory: ZombieMemory,
): Generator<Want> {
  const s = match.state;
  const energy = s.players.zombies.energy;
  const push = memory.pushLane === null ? null : laneOf(lawn, memory.pushLane);
  // A push goes on while one of its zombies is still on its way to the plant base.
  const pushGoing = push !== null && push.zombies.some((z) => z.x > BASE_STOP_X);
  if (!pushGoing) memory.owed = 0;
  const owing = memory.owed * PRICE.brainEater;
  const spare = energy - owing;

  if (plan.mergeSpareSeconds !== null) {
    const income = match.balance.trickle.zombies * s.config.incomeMultiplier.zombies;
    const target = mergeTarget(push);
    if (spare > plan.mergeSpareSeconds * income && target !== undefined) yield { cmd: mergeCommand(target) };
  }

  if (push !== null && memory.owed > 0) {
    const sent = (): void => { memory.owed -= 1; };
    yield { cmd: sendCommand('brainEater', push.lane), wait: 'energy', onChosen: sent };
  }

  const { min, max } = plan.pushBrainEaters;
  const size = (memory.nextPush ??= min + randomInt(rng, max - min + 1));
  const pushCost = PRICE.skeletonWarrior + size * PRICE.brainEater;
  if (spare >= pushCost) {
    const lane = weakestLane(lawn, rng);
    yield {
      cmd: sendCommand('skeletonWarrior', lane),
      onChosen: () => {
        memory.pushLane = lane;
        memory.owed = size;
        memory.nextPush = null;
      },
    };
  }

  if (spare >= pushCost + PRICE.veryFastWalker) {
    for (const lane of shuffledLanes(rng)) {
      const view = laneOf(lawn, lane);
      if (view.plants.length > 0 || view.zombies.length > 0) continue;
      yield { cmd: sendCommand('veryFastWalker', lane) };
    }
  }
}

/** The lane with the least plant health; ties in a random order. */
function weakestLane(lawn: readonly LaneView[], rng: BotRng): number {
  const order = shuffledLanes(rng);
  let best = order[0] as number;
  for (const lane of order) {
    if (laneOf(lawn, lane).plantHp < laneOf(lawn, best).plantHp) best = lane;
  }
  return best;
}

/**
 * A walking zombie of the push, below the top level, to merge onto: the one with the most of its
 * health left (a merge keeps the share of health, so a fresh zombie gains the most), ties to the
 * lower id. None when no push is going.
 */
function mergeTarget(push: LaneView | null): Unit | undefined {
  if (push === null) return undefined;
  let best: Unit | undefined;
  for (const z of push.zombies) {
    if (z.blocked || z.level >= MAX_LEVEL) continue;
    if (best === undefined || z.hp / z.maxHp > best.hp / best.maxHp) best = z;
  }
  return best;
}
