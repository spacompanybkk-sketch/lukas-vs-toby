/**
 * How the basic computer player plays zombies. It keeps the pressure on and spends its energy as
 * it comes. Each think it lists what it would like to do, most urgent first, and `choose` sends
 * the first thing the match accepts:
 *
 * 1. Hard only: above its energy line, a merge onto a walking zombie, the push's leader first.
 * 2. A Very Fast Walker down a lane with no plant and none of its zombies.
 * 3. A new push, when none of its Skeleton Warriors in the push lane still has a plant in front of
 *    it: a Skeleton Warrior first, into the lane with the least plant health, which becomes the
 *    push lane. It waits for the energy rather than spend it on anything else.
 * 4. Brain Eaters follow, each into the lane with the least plant health at that moment, so they
 *    press wherever the plants are thinnest. It waits for the energy.
 *
 * Lane ties are broken at random, so no two matches play alike.
 */

import type { Match } from '../sim/match';
import { MAX_LEVEL } from '../sim/types';
import type { Command, Unit } from '../sim/types';
import { choose, laneOf, mergeCommand, readLawn, sendCommand, shuffledLanes } from './lawn';
import type { BotRng, LaneView, Want } from './lawn';

export interface ZombiePlan {
  /** Merge a walking zombie whenever energy is above this; null: never merge. */
  readonly mergeAbove: number | null;
}

/** What a zombie bot remembers between thinks. */
export interface ZombieMemory {
  /** The lane the last Skeleton Warrior was sent down, or null before the first. */
  pushLane: number | null;
}

export function newZombieMemory(): ZombieMemory {
  return { pushLane: null };
}

export function zombieMove(match: Match, rng: BotRng, plan: ZombiePlan, memory: ZombieMemory): Command | null {
  return choose(match, zombieWants(match, readLawn(match.state), rng, plan, memory));
}

function* zombieWants(
  match: Match, lawn: readonly LaneView[], rng: BotRng, plan: ZombiePlan, memory: ZombieMemory,
): Generator<Want> {
  const push = memory.pushLane === null ? null : laneOf(lawn, memory.pushLane);
  const pushGoing = push !== null && push.zombies.some((z) => z.key === 'skeletonWarrior' && hasPlantAhead(push, z));

  if (plan.mergeAbove !== null && match.state.players.zombies.energy > plan.mergeAbove) {
    const target = mergeTarget(lawn, push);
    if (target !== undefined) yield { cmd: mergeCommand(target) };
  }

  for (const lane of shuffledLanes(rng)) {
    const view = laneOf(lawn, lane);
    if (view.plants.length === 0 && view.zombies.length === 0) yield { cmd: sendCommand('veryFastWalker', lane) };
  }

  if (!pushGoing) {
    const lane = weakestLane(lawn, rng);
    yield { cmd: sendCommand('skeletonWarrior', lane), wait: 'energy', onChosen: () => { memory.pushLane = lane; } };
  }
  yield { cmd: sendCommand('brainEater', weakestLane(lawn, rng)), wait: 'energy' };
}

/** Whether a plant still stands between this zombie and the plant base. */
function hasPlantAhead(view: LaneView, z: Unit): boolean {
  return view.plants.some((p) => p.x <= z.x);
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

/** A walking zombie below the top level to merge onto: the push lane's leader, else the leader anywhere. */
function mergeTarget(lawn: readonly LaneView[], push: LaneView | null): Unit | undefined {
  const walking = (view: LaneView): Unit[] => view.zombies.filter((z) => !z.blocked && z.level < MAX_LEVEL);
  const leader = (units: readonly Unit[]): Unit | undefined =>
    units.reduce<Unit | undefined>((best, z) => (best === undefined || z.x < best.x ? z : best), undefined);
  return (push === null ? undefined : leader(walking(push))) ?? leader(lawn.flatMap(walking));
}
