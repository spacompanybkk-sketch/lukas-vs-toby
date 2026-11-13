/**
 * Level modes, part 2: the card belt of a conveyor level (`MatchConfig.belt`). Cards arrive on
 * their own; the belt's side plays them for nothing, with no recharge, by the `belt` command.
 */

import type { Balance } from '../data/balance';
import { UNIT_INFO, isCard } from '../data/units';
import { levelUp } from './levelUp';
import { inLane, isStanding } from './lookup';
import { randomInt } from './rng';
import { spawnUnit } from './spawn';
import { COLS, LANES, MAX_LEVEL, PLANT_COLS, ZOMBIE_SPAWN_X } from './types';
import type { BeltConfig, Command, CommandRejection, SimEvent, SimState, Unit } from './types';

export type BeltCommand = Extract<Command, { type: 'belt' }>;

/**
 * A zombie card played on a tile merges into the side's own zombie of that type standing this near
 * the tile's middle along the lane: the app's tap rule (`ZOMBIE_MERGE_REACH` in BattleController).
 */
export const BELT_ZOMBIE_MERGE_REACH = 0.75;

/**
 * Refuses a belt that makes no sense, with a `RangeError`: `side` a side; `cards` not empty, each a
 * card of that side the balance table has numbers for; `everyTicks` and `slots` whole and at least 1.
 */
export function checkBeltConfig(belt: BeltConfig, b: Balance): void {
  if (belt.side !== 'plants' && belt.side !== 'zombies') throw new RangeError(`belt side "${String(belt.side)}" is no side`);
  if (belt.cards.length === 0) throw new RangeError('the belt has no cards to draw from');
  for (const card of belt.cards) {
    if (!isCard(card) || UNIT_INFO[card].faction !== belt.side || b.units[card] === undefined) {
      throw new RangeError(`belt card "${String(card)}" is no ${belt.side} card the balance table has numbers for`);
    }
  }
  if (!(Number.isInteger(belt.everyTicks) && belt.everyTicks >= 1)) throw new RangeError(`belt everyTicks ${belt.everyTicks} is not a whole number from 1`);
  if (!(Number.isInteger(belt.slots) && belt.slots >= 1)) throw new RangeError(`belt slots ${belt.slots} is not a whole number from 1`);
}

/**
 * Step stage 0b, after the script and before the commands: on every tick that is a multiple of
 * `everyTicks` (tick 0 included, so the first card is there from the start) one card is drawn from
 * `cards` with `randomInt` on the state rng and joins the end of the belt (`beltCard`). With `slots`
 * cards already waiting the arrival is skipped and the rng is not drawn: the cards that come later
 * depend on when the player made room, as they would on a real belt.
 */
export function tickBelt(s: SimState, events: SimEvent[]): void {
  const belt = s.config.belt;
  if (belt === null || s.tick % belt.everyTicks !== 0 || s.belt.length >= belt.slots) return;
  const card = belt.cards[randomInt(s, belt.cards.length)]!;
  s.belt.push(card);
  events.push({ type: 'beltCard', card });
}

/**
 * Why a belt command would be refused, or null: `no-belt` (no belt, or it is the other side's),
 * `bad-slot` (no card waits there), `bad-lane`; a plant card: `bad-column` (not a plant column),
 * then on the tile a plant of the card's type at `MAX_LEVEL` is `max-level` and any other plant
 * `occupied`; a zombie card: `bad-column` (not a lawn column, 0..9; it only aims a merge).
 * Energy and recharge play no part.
 */
export function checkBelt(s: SimState, cmd: BeltCommand): CommandRejection | null {
  if (s.config.belt === null || s.config.belt.side !== cmd.faction) return 'no-belt';
  if (!(Number.isInteger(cmd.slot) && cmd.slot >= 0 && cmd.slot < s.belt.length)) return 'bad-slot';
  if (!isWholeBetween(cmd.lane, 0, LANES - 1)) return 'bad-lane';
  if (cmd.faction === 'zombies') return isWholeBetween(cmd.col, 0, COLS - 1) ? null : 'bad-column';
  if (!isWholeBetween(cmd.col, 0, PLANT_COLS - 1)) return 'bad-column';
  const there = plantAt(s, cmd.lane, cmd.col);
  if (there === undefined) return null;
  if (there.key !== s.belt[cmd.slot]) return 'occupied';
  return there.level >= MAX_LEVEL ? 'max-level' : null;
}

/**
 * Carries out a belt command that `checkBelt` has passed: the card leaves its slot (the later ones
 * move down) with `beltUsed`, then a plant goes on the empty tile or merges into the plant of its
 * type there; a zombie merges into the side's own zombie of its type below `MAX_LEVEL` standing
 * nearest the tile's middle (`col + 0.5`) along the lane within `BELT_ZOMBIE_MERGE_REACH` (on a
 * tie the later one, as the app picks), or else walks on at `ZOMBIE_SPAWN_X`. A merge is the usual
 * level up (`levelUp`). Nothing is paid and no recharge starts.
 */
export function playBelt(s: SimState, b: Balance, cmd: BeltCommand, events: SimEvent[]): void {
  const card = s.belt.splice(cmd.slot, 1)[0];
  if (card === undefined) throw new Error(`belt command passed check but slot ${cmd.slot} is empty`);
  events.push({ type: 'beltUsed', slot: cmd.slot });
  const target = cmd.faction === 'plants' ? plantAt(s, cmd.lane, cmd.col) : zombieNear(s, cmd.lane, cmd.col, card);
  if (target !== undefined) {
    levelUp(s, b, target, events);
    return;
  }
  spawnUnit(s, b, card, cmd.lane, cmd.faction === 'plants' ? cmd.col + 0.5 : ZOMBIE_SPAWN_X, events);
}

/** The standing plant on the tile, if any (a plant already down counts as gone, as for a hand merge). */
export function plantAt(s: SimState, lane: number, col: number): Unit | undefined {
  return s.units.find((u) => u.faction === 'plants' && isStanding(u) && inLane(u, lane) && Math.floor(u.x) === col);
}

function zombieNear(s: SimState, lane: number, col: number, key: Unit['key']): Unit | undefined {
  const middle = col + 0.5;
  let best: Unit | undefined;
  let bestD = BELT_ZOMBIE_MERGE_REACH;
  for (const u of s.units) {
    if (u.faction !== 'zombies' || u.key !== key || u.lane !== lane || u.level >= MAX_LEVEL || !isStanding(u)) continue;
    const d = Math.abs(u.x - middle);
    if (d <= bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

function isWholeBetween(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}
