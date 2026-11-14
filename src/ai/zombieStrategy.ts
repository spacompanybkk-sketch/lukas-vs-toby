/**
 * How the basic computer player plays zombies, with all ten cards: steady pressure where the plants
 * are thinnest, and the card that answers what it sees there. It reckons each lane's fight with
 * `reckonLane` (src/ai/laneModel.ts). Each think it lists what it would like to do, most urgent
 * first, and `choose` sends the first thing the match accepts:
 *
 * 1. Hard only: when its energy is worth more than its line in seconds of income, a merge onto the
 *    healthiest walking zombie in the lane it last sent to.
 * 2. From energy beyond its next real card (`RUSH_RESERVE`), a Very Fast Walker down a lane with no
 *    shooter and none of its own zombies: it eats the Sunflowers there, or runs to the base for a chip.
 * 3. Once no lane is open (every lane has a plant), every 30 s at most, a siege zombie (Trident,
 *    Brain Rot, Archer in turn) against the lane with the most plants (four or more) when none of
 *    its siege zombies is there yet: a stack is worn down from range. It waits for the energy.
 * 4. One zombie into the lane where a fresh Brain Eater would get furthest past the plants' fire,
 *    skipping lanes its zombies are already reckoned to break (they are taken care of), waiting
 *    for the energy.
 *
 * Which zombie (the first that is not recharging; it waits for the energy for it):
 * - a Necromancer behind a tank already walking the lane (its heal and minions back the tank up);
 * - a Cowboy Zombie when the lane holds a merged plant (level 2 or more: its lasso ties the strongest);
 * - siege against a row (2 or more plants): Trident Zombie, Brain Rot, Skeleton Archer in
 *   turn, which hit from range or through several plants;
 * - a Skeleton Warrior or Desert Zombie to lead into a lane that shoots, when no tank walks there
 *   yet: the shield first where Peashooters are as many as the pults (it blocks peas), the
 *   blinding sand first where pults are more (their lobs ignore shields);
 * - a Hot Topic against a thin lane (one or two plants: it grows on each one it eats);
 * - otherwise a Brain Eater.
 *
 * Lane ties and the order among equals are drawn at random, so no two matches play alike.
 */

import type { Balance } from '../data/balance';
import { UNIT_INFO, isCard } from '../data/units';
import type { Match } from '../sim/match';
import { randomInt } from '../sim/rng';
import { MAX_LEVEL } from '../sim/types';
import type { CardKey, Command, Unit } from '../sim/types';
import { reckonLane } from './laneModel';
import { laneOf, mergeCommand, readLawn, sendCommand, shuffledLanes } from './lawn';
import type { BotRng, LaneView } from './lawn';
import { choose } from './wants';
import type { Want } from './wants';

export interface ZombiePlan {
  /**
   * Merge a walking zombie whenever energy is worth more than this many seconds of the zombies'
   * trickle income; 0: never merge.
   */
  readonly mergeSpareSeconds: number;
  /** Peashooter levels in the target lane from which it sends a Skeleton Warrior. */
  readonly tankAt: number;
}

/** What a zombie bot remembers between thinks. */
export interface ZombieMemory {
  /** The lane it last sent a zombie into, or null before the first. */
  lastLane: number | null;
  /** The tick it last sent a siege zombie against a stack, or null. */
  siegeTick: number | null;
  /** Siege zombies sent so far: they take turns, so the dearer ones get their go too. */
  sieges: number;
}

export function newZombieMemory(): ZombieMemory {
  return { lastLane: null, siegeTick: null, sieges: 0 };
}

/**
 * A lane where the zombies already in it are reckoned to break through by this much health counts
 * as taken care of: the next zombie goes elsewhere.
 */
const BREAKING_HP = 150;
/** Energy it keeps for its next real card before it spends any on a Very Fast Walker. */
const RUSH_RESERVE = 125;
/** Plants in a lane from which it counts as a deep row. */
const DEEP_ROW = 2;
/** Plants in a lane from which it counts as a stack worth a siege zombie of its own. */
const STACK_ROW = 4;
/** Ticks between siege zombies sent against stacks (30 s). */
const SIEGE_EVERY = 900;
/** A plant level from which the Cowboy's lasso is worth it (a merged plant). */
const COWBOY_LEVEL = 2;
/** Zombies that count as a tank a Necromancer can hang back behind. */
const TANKS: ReadonlySet<string> = new Set(['skeletonWarrior', 'brainEater', 'hotTopic', 'cowboyZombie', 'desertZombie']);
const SIEGE: readonly CardKey[] = ['tridentZombie', 'brainRot', 'skeletonArcher'];
/** Plants that shoot down the lane, which a shield or blinding sand answers. */
const SHOOTERS: ReadonlySet<string> = new Set(['peashooter', 'kernelPult', 'mangoPult']);

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

  if (plan.mergeSpareSeconds > 0) {
    const income = match.balance.trickle.zombies * s.config.incomeMultiplier.zombies;
    const target = mergeTarget(memory.lastLane === null ? null : laneOf(lawn, memory.lastLane));
    if (energy > plan.mergeSpareSeconds * income && target !== undefined) yield { cmd: mergeCommand(target) };
  }

  const rush = energy >= RUSH_RESERVE + UNIT_INFO.veryFastWalker.price ? rushLane(lawn, rng) : undefined;
  if (rush !== undefined) yield { cmd: sendCommand('veryFastWalker', rush), onChosen: () => { memory.lastLane = rush; } };

  // Open lanes come first: while any lane has no plant at all, every zombie goes to press it.
  const open = lawn.some((view) => view.plants.length === 0);
  const stack = open || (memory.siegeTick !== null && s.tick - memory.siegeTick < SIEGE_EVERY) ? undefined : stackLane(lawn);
  if (stack !== undefined) {
    const card = SIEGE[memory.sieges % SIEGE.length] as CardKey;
    yield {
      cmd: sendCommand(card, stack.lane), wait: 'energy',
      onChosen: () => { memory.lastLane = stack.lane; memory.siegeTick = s.tick; memory.sieges += 1; },
    };
  }

  const view = weakestLane(match.balance, lawn, rng);
  for (const card of cardsFor(view, plan, rng, memory)) {
    yield {
      cmd: sendCommand(card, view.lane), wait: 'energy',
      onChosen: () => { memory.lastLane = view.lane; if (SIEGE.includes(card)) memory.sieges += 1; },
    };
  }
}

/** Peashooter levels in a lane. */
function shooterLevels(view: LaneView): number {
  return view.plants.reduce((n, p) => (p.key === 'peashooter' ? n + p.level : n), 0);
}

/**
 * How much more health the zombies in a lane (plus one fresh Brain Eater) bring than the plants are
 * reckoned to stop: positive means the lane breaks.
 */
export function laneSurplus(b: Balance, view: LaneView, withProbe: boolean): number {
  const be = b.units.brainEater;
  const probe = withProbe && be !== undefined && view.zombies.length === 0
    ? { speed: be.speed, bite: be.melee ? be.melee.damage / be.melee.interval : 0, shield: false }
    : undefined;
  const r = reckonLane(b, view, 0.5, undefined, probe);
  const probeHp = withProbe ? (be?.hp ?? 0) : 0;
  return r.zombieHp + probeHp - r.stopping;
}

/**
 * The lane to send the next zombie into: among lanes not already breaking, the one where a fresh
 * Brain Eater gets furthest (the largest surplus); if every lane is breaking, the one breaking
 * least. Ties in a random order.
 */
function weakestLane(b: Balance, lawn: readonly LaneView[], rng: BotRng): LaneView {
  const order = shuffledLanes(rng);
  let best: LaneView | undefined;
  let bestScore = -Infinity;
  let fallback = laneOf(lawn, order[0] as number);
  let fallbackSurplus = Infinity;
  for (const lane of order) {
    const view = laneOf(lawn, lane);
    const already = view.zombies.length > 0 ? laneSurplus(b, view, false) : -Infinity;
    if (already >= BREAKING_HP) {
      if (already < fallbackSurplus) {
        fallback = view;
        fallbackSurplus = already;
      }
      continue;
    }
    const score = laneSurplus(b, view, true);
    if (score > bestScore) {
      best = view;
      bestScore = score;
    }
  }
  return best ?? fallback;
}

/** The zombies to try for a lane, best answer first, a Brain Eater last (see the note at the top). */
export function cardsFor(view: LaneView, plan: ZombiePlan, rng: BotRng, memory: ZombieMemory): CardKey[] {
  const out: CardKey[] = [];
  const plants = view.plants.filter((p) => isCard(p.key));
  const tank = view.zombies.some((z) => TANKS.has(z.key) && z.x > 2 && z.hp >= 250);
  if (tank && !view.zombies.some((z) => z.key === 'necromancer')) out.push('necromancer');
  if (plants.some((p) => p.level >= COWBOY_LEVEL)) out.push('cowboyZombie');
  if (plants.length >= DEEP_ROW) out.push(...SIEGE.map((_, i) => SIEGE[(memory.sieges + i) % SIEGE.length] as CardKey));
  const shooting = plants.some((p) => SHOOTERS.has(p.key));
  if (!tank && (shooting || shooterLevels(view) >= plan.tankAt)) {
    // A shield blocks peas; lobs ignore it, so against more pults than Peashooters the sand leads.
    const count = (keys: readonly string[]): number => plants.filter((p) => keys.includes(p.key)).length;
    const peas = count(['peashooter']) >= count(['kernelPult', 'mangoPult']);
    out.push(...(peas ? ['skeletonWarrior', 'desertZombie'] as const : ['desertZombie', 'skeletonWarrior'] as const));
  }
  if (plants.length >= 1 && plants.length <= 2) out.push('hotTopic');
  out.push('brainEater');
  return out;
}

/**
 * The lane with the most plants, when it holds at least `STACK_ROW` and none of its own siege
 * zombies: a fortress lane is worn down from range while the rest of the lawn is pressed.
 */
function stackLane(lawn: readonly LaneView[]): LaneView | undefined {
  let best: LaneView | undefined;
  for (const view of lawn) {
    const plants = view.plants.filter((p) => isCard(p.key)).length;
    if (plants < STACK_ROW || view.zombies.some((z) => SIEGE.includes(z.key as CardKey))) continue;
    if (best === undefined || plants > best.plants.length) best = view;
  }
  return best;
}

/** `items` from a random start, wrapping round. */
function rotated(items: readonly CardKey[], rng: BotRng): CardKey[] {
  const start = randomInt(rng, items.length);
  return items.map((_, i) => items[(start + i) % items.length] as CardKey);
}

/**
 * A Very Fast Walker down a lane with no shooter (at most Sunflowers, which it eats), nobody of
 * its own and no lava, ties in a random order.
 */
function rushLane(lawn: readonly LaneView[], rng: BotRng): number | undefined {
  return shuffledLanes(rng).find((lane) => {
    const view = laneOf(lawn, lane);
    // Not through lava: a Very Fast Walker is too frail to cross it.
    return view.zombies.length === 0 && !view.plants.some((p) => SHOOTERS.has(p.key)) && view.lava === null;
  });
}

/**
 * A walking zombie in `view`, below the top level, to merge onto: the one with the most of its
 * health left (a merge keeps the share of health, so a fresh zombie gains the most), ties to the
 * lower id. None when there is no lane yet.
 */
function mergeTarget(view: LaneView | null): Unit | undefined {
  if (view === null) return undefined;
  let best: Unit | undefined;
  for (const z of view.zombies) {
    if (z.blocked || z.level >= MAX_LEVEL || !isCard(z.key)) continue; // a Bone Minion is no card
    if (best === undefined || z.hp / z.maxHp > best.hp / best.maxHp) best = z;
  }
  return best;
}
