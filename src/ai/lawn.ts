/**
 * What the computer players share: a per-lane reading of the lawn, command builders, and the
 * random legal move that Easy sometimes makes instead. Everything here only reads the match.
 */

import { isCard } from '../data/units';
import type { Match } from '../sim/match';
import { isStanding } from '../sim/lookup';
import { randomInt } from '../sim/rng';
import { COLS, LANES, PLANT_COLS } from '../sim/types';
import type { CardKey, Command, Faction, SimState, Unit, UnitKey } from '../sim/types';

/** A bot's private random numbers: the same shape as the match's, never the match's own. */
export type BotRng = { rng: number };

/** One lane as a bot sees it. The units are the match's own objects: read them, never write. */
export interface LaneView {
  readonly lane: number;
  /** Standing plants and zombies in this lane, in ascending id. */
  readonly plants: readonly Unit[];
  readonly zombies: readonly Unit[];
  /** The plant standing on each column 0..7, if any. */
  readonly tiles: readonly (Unit | undefined)[];
  /** The health of every plant in the lane, added up. */
  readonly plantHp: number;
}

/** The column a plant stands on. */
export function colOf(u: Unit): number {
  return Math.floor(u.x);
}

/** The lawn lane by lane, lanes 0..4 in order. */
export function readLawn(s: SimState): LaneView[] {
  const lanes = Array.from({ length: LANES }, (_, lane) => ({
    lane,
    plants: [] as Unit[],
    zombies: [] as Unit[],
    tiles: Array.from({ length: PLANT_COLS }, (): Unit | undefined => undefined),
    plantHp: 0,
  }));
  for (const u of s.units) {
    const view = lanes[u.lane];
    if (view === undefined || !isStanding(u)) continue;
    if (u.faction === 'plants') {
      view.plants.push(u);
      view.tiles[colOf(u)] = u;
      view.plantHp += u.hp;
    } else {
      view.zombies.push(u);
    }
  }
  return lanes;
}

/** Lane `i` of a lawn reading. */
export function laneOf(lawn: readonly LaneView[], i: number): LaneView {
  const view = lawn[i];
  if (view === undefined) throw new RangeError(`No lane ${i}`);
  return view;
}

/** Lanes 0..4 in a random order. */
export function shuffledLanes(rng: BotRng): number[] {
  const lanes = Array.from({ length: LANES }, (_, i) => i);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const a = lanes[i] as number;
    lanes[i] = lanes[j] as number;
    lanes[j] = a;
  }
  return lanes;
}

export function placeCommand(faction: Faction, unit: CardKey, lane: number, col: number): Command {
  return { type: 'place', faction, unit, lane, col };
}

/** Sending a zombie: the column plays no part, so it names the graveyard column. */
export function sendCommand(unit: CardKey, lane: number): Command {
  return placeCommand('zombies', unit, lane, COLS - 1);
}

/** A merge onto `target` with its own card. Only a card can be merged into (never a Bone Minion). */
export function mergeCommand(target: Unit): Command {
  const key = target.key;
  if (!isCard(key)) throw new Error(`${key} is not a card and cannot be merged into`);
  return { type: 'merge', faction: target.faction, unit: key, targetId: target.id };
}

/**
 * Any one card play the side could make right now, picked at random: a placement on any tile (any
 * lane for zombies) or a merge onto any of its own units. Null when it can afford nothing. The
 * shovel is never part of a bot's play.
 */
export function randomLegal(match: Match, faction: Faction, rng: BotRng): Command | null {
  const s = match.state;
  const legal: Command[] = [];
  const offer = (cmd: Command): void => {
    if (match.check(cmd) === null) legal.push(cmd);
  };
  for (const unit of s.config.cards[faction]) {
    for (let lane = 0; lane < LANES; lane++) {
      if (faction === 'zombies') offer(sendCommand(unit, lane));
      else for (let col = 0; col < PLANT_COLS; col++) offer(placeCommand(faction, unit, lane, col));
    }
  }
  for (const u of s.units) {
    if (u.faction === faction && isStanding(u) && isCard(u.key)) offer(mergeCommand(u));
  }
  return legal.length === 0 ? null : (legal[randomInt(rng, legal.length)] ?? null);
}
