/**
 * Stand-in players: small, seeded, deliberately simple players that the balance checks put in a
 * human's seat. They are not opponents for the boys; they ask "what if somebody plays like this?"
 *
 * - `createSpamBot`: one card only, played whenever it can be, into a random lane (a plant on the
 *   rearmost free tile of that lane). Spec 10's "only this unit" spammer.
 * - `createMergeSpamBot`: one card only, and every copy it can afford goes into the same unit. A
 *   zombie is merged while it walks (until it is past the middle of the lawn or at the top level,
 *   then a new one is sent); a plant is merged where it stands up to the top level, then a new one
 *   is planted.
 * - `createRandomChild`: a small child. Every so often (2 s as zombies, 3 s as plants) it taps a
 *   random card it can afford and a random lane (or tile). It never merges and never waits.
 *
 * Like the basic bot, each is a pure function of the match it is shown and its own private random
 * numbers (never the match's), its schedule follows `match.state.tick`, and it only returns
 * commands `match.check` accepts at that moment. Make one per match.
 */

import { isStanding } from '../sim/lookup';
import type { Match } from '../sim/match';
import { randomInt } from '../sim/rng';
import { LANES, MAX_LEVEL, PLANT_COLS } from '../sim/types';
import type { Command, Faction, CardKey } from '../sim/types';
import type { Bot } from './bot';
import { mergeCommand, placeCommand, sendCommand } from './lawn';
import type { BotRng } from './lawn';

/** Keeps stand-ins of different kinds made with one seed from drawing the same numbers. */
const SALT = { spam: 0x5a11_0001, merge: 0x5a11_0002, child: 0x5a11_0003 } as const;

/** How often a spammer looks (ticks): twice a second, quicker than any card recharges. */
export const SPAM_EVERY = 15;
/** How often the random child taps (ticks): every 2 s as zombies, every 3 s as plants. */
export const CHILD_EVERY: Readonly<Record<Faction, number>> = { zombies: 60, plants: 90 };
/** A walking zombie past this x is left to walk on; the merge spammer starts a new one. */
const MERGE_WALK_MIN_X = 5;

function rngFor(seed: number, salt: number, faction: Faction): BotRng {
  return { rng: (seed ^ salt ^ (faction === 'plants' ? 0x0100_0000 : 0x0200_0000)) >>> 0 };
}

/** One placement of `unit` into `lane`: zombies are sent, a plant goes on the rearmost free tile. */
function placeIn(match: Match, faction: Faction, unit: CardKey, lane: number): Command | null {
  if (faction === 'zombies') return sendCommand(unit, lane);
  for (let col = 0; col < PLANT_COLS; col++) {
    const cmd = placeCommand(faction, unit, lane, col);
    if (match.check(cmd) !== 'occupied') return cmd;
  }
  return null;
}

/** The first lane, from a random start, where `unit` can be placed right now. */
function placeAnywhere(match: Match, faction: Faction, unit: CardKey, rng: BotRng): Command | null {
  const start = randomInt(rng, LANES);
  for (let i = 0; i < LANES; i++) {
    const cmd = placeIn(match, faction, unit, (start + i) % LANES);
    if (cmd !== null && match.check(cmd) === null) return cmd;
  }
  return null;
}

/** Plays `unit` whenever it can, into a random lane. */
export function createSpamBot(faction: Faction, unit: CardKey, seed: number, every = SPAM_EVERY): Bot {
  const rng = rngFor(seed, SALT.spam, faction);
  return {
    faction,
    think(match) {
      if (match.state.winner !== null || match.state.tick % every !== 0) return [];
      const cmd = placeAnywhere(match, faction, unit, rng);
      return cmd === null ? [] : [cmd];
    },
  };
}

/** Puts every copy of `unit` it can afford into one unit (see the note at the top). */
export function createMergeSpamBot(faction: Faction, unit: CardKey, seed: number, every = SPAM_EVERY): Bot {
  const rng = rngFor(seed, SALT.merge, faction);
  return {
    faction,
    think(match) {
      const s = match.state;
      if (s.winner !== null || s.tick % every !== 0) return [];
      const growing = s.units.find((u) =>
        u.faction === faction && u.key === unit && isStanding(u) && u.level < MAX_LEVEL &&
        (faction === 'plants' || u.x > MERGE_WALK_MIN_X));
      if (growing !== undefined) {
        const cmd = mergeCommand(growing);
        return match.check(cmd) === null ? [cmd] : []; // saves up for the next merge
      }
      const cmd = placeAnywhere(match, faction, unit, rng);
      return cmd === null ? [] : [cmd];
    },
  };
}

/** A small child: a random affordable card into a random lane or tile, every so often. */
export function createRandomChild(faction: Faction, seed: number, every = CHILD_EVERY[faction]): Bot {
  const rng = rngFor(seed, SALT.child, faction);
  return {
    faction,
    think(match) {
      const s = match.state;
      if (s.winner !== null || s.tick % every !== 0) return [];
      const legal: Command[] = [];
      for (const unit of s.config.cards[faction]) {
        for (let lane = 0; lane < LANES; lane++) {
          if (faction === 'zombies') {
            const cmd = sendCommand(unit, lane);
            if (match.check(cmd) === null) legal.push(cmd);
          } else {
            for (let col = 0; col < PLANT_COLS; col++) {
              const cmd = placeCommand(faction, unit, lane, col);
              if (match.check(cmd) === null) legal.push(cmd);
            }
          }
        }
      }
      if (legal.length === 0) return [];
      return [legal[randomInt(rng, legal.length)] as Command];
    },
  };
}
