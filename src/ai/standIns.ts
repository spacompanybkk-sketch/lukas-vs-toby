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
 *   random card it can afford and a random lane (or tile). It never merges and never waits. With a
 *   longer interval (`SLOW_TAP_EVERY`, 6 s) it is the slow tapper.
 * - `createNewestCardChild`: the same child, but it always taps the most expensive card it can
 *   afford (the newest, shiniest one), into a random lane or tile.
 * - `createFortressPlants`: an adult as plants the way Michal first played: one lane built up
 *   first (Sunflowers at the back, Peashooters, a Walnut Bomb in front), then the next lane out,
 *   and so on; then more Peashooters. It rebuilds what it loses in the same order, fires its hero
 *   and casts its spells where they pay (as the computer aims them), and ignores lanes it has not
 *   reached.
 * - `createSteadyZombies`: an adult as zombies with no tricks: mixed waves of three (a tank, a
 *   fighter, a shooter) into the lane whose plants shoot least, one wave after the other. It waits
 *   for the energy, sends a Brain Eater when the next card is recharging, never merges, and fires
 *   its hero and casts its spells where they pay (as the computer aims them: big buttons, no tricks).
 *
 * Like the basic bot, each is a pure function of the match it is shown and its own private random
 * numbers (never the match's), its schedule follows `match.state.tick`, and it only returns
 * commands `match.check` accepts at that moment. Make one per match.
 */

import { UNIT_INFO } from '../data/units';
import { isStanding } from '../sim/lookup';
import type { Match } from '../sim/match';
import { randomInt } from '../sim/rng';
import { LANES, MAX_LEVEL, PLANT_COLS } from '../sim/types';
import type { CardKey, Command, Faction, Unit } from '../sim/types';
import type { Bot } from './bot';
import { shotDps } from './laneModel';
import { mergeCommand, placeCommand, readLawn, sendCommand } from './lawn';
import type { BotRng } from './lawn';
import { powerMove } from './powers';

/** Keeps stand-ins of different kinds made with one seed from drawing the same numbers. */
const SALT = {
  spam: 0x5a11_0001, merge: 0x5a11_0002, child: 0x5a11_0003, newest: 0x5a11_0004, fortress: 0x5a11_0005, steady: 0x5a11_0006,
} as const;

/** How often a spammer looks (ticks): twice a second, quicker than any card recharges. */
export const SPAM_EVERY = 15;
/** How often the random child taps (ticks): every 2 s as zombies, every 3 s as plants. */
export const CHILD_EVERY: Readonly<Record<Faction, number>> = { zombies: 60, plants: 90 };
/** The slow tapper: the random child tapping once every 6 s. */
export const SLOW_TAP_EVERY = 180;
/** How often the adult stand-ins look (ticks): once a second. */
export const ADULT_EVERY = 30;
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

/** Every card play `faction` could make right now with `unit` (placements only, never a merge). */
function placements(match: Match, faction: Faction, unit: CardKey): Command[] {
  const legal: Command[] = [];
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
  return legal;
}

/** A small child: a random affordable card into a random lane or tile, every so often. */
export function createRandomChild(faction: Faction, seed: number, every = CHILD_EVERY[faction]): Bot {
  const rng = rngFor(seed, SALT.child, faction);
  return {
    faction,
    think(match) {
      const s = match.state;
      if (s.winner !== null || s.tick % every !== 0) return [];
      const legal = s.config.cards[faction].flatMap((unit) => placements(match, faction, unit));
      if (legal.length === 0) return [];
      return [legal[randomInt(rng, legal.length)] as Command];
    },
  };
}

/** A small child who always taps the most expensive card it can afford, into a random lane or tile. */
export function createNewestCardChild(faction: Faction, seed: number, every = CHILD_EVERY[faction]): Bot {
  const rng = rngFor(seed, SALT.newest, faction);
  return {
    faction,
    think(match) {
      const s = match.state;
      if (s.winner !== null || s.tick % every !== 0) return [];
      let legal: Command[] = [];
      let price = -1;
      for (const unit of s.config.cards[faction]) {
        const p = UNIT_INFO[unit].price;
        if (p < price) continue;
        const here = placements(match, faction, unit);
        if (here.length === 0) continue;
        if (p > price) {
          legal = [];
          price = p;
        }
        legal.push(...here);
      }
      if (legal.length === 0) return [];
      return [legal[randomInt(rng, legal.length)] as Command];
    },
  };
}

/** What the fortress builds in each lane, in order: column and card. */
const FORTRESS_LANE: ReadonlyArray<readonly [number, CardKey]> = [
  [0, 'sunflower'], [2, 'peashooter'], [1, 'sunflower'], [3, 'peashooter'], [5, 'walnutBomb'],
];
/** After every lane is built: one more Peashooter per lane, then merges. */
const FORTRESS_EXTRA: readonly [number, CardKey] = [4, 'peashooter'];

/** An adult who builds one lane at a time (see the note at the top). */
export function createFortressPlants(seed: number, every = ADULT_EVERY): Bot {
  const rng = rngFor(seed, SALT.fortress, 'plants');
  const first = randomInt(rng, LANES);
  // The first lane, then its neighbours outwards, alternating sides.
  const lanes: number[] = [first];
  for (let d = 1; lanes.length < LANES; d++) {
    for (const l of [first - d, first + d]) if (l >= 0 && l < LANES) lanes.push(l);
  }
  return {
    faction: 'plants',
    think(match) {
      const s = match.state;
      if (s.winner !== null || s.tick % every !== 0) return [];
      const power = powerMove(match, 'plants');
      if (power !== null) return [power];
      const lawn = readLawn(s);
      const next = (): Command | null => {
        for (const lane of lanes) {
          const view = lawn[lane];
          if (view === undefined) continue;
          for (const [col, unit] of FORTRESS_LANE) {
            const plant = view.tiles[col];
            if (plant === undefined) return placeCommand('plants', unit, lane, col);
          }
        }
        for (const lane of lanes) {
          if (lawn[lane]?.tiles[FORTRESS_EXTRA[0]] === undefined) return placeCommand('plants', FORTRESS_EXTRA[1], lane, FORTRESS_EXTRA[0]);
        }
        let weakest: Unit | undefined;
        for (const u of s.units) {
          if (u.faction === 'plants' && u.key === 'peashooter' && isStanding(u) && u.level < MAX_LEVEL
            && (weakest === undefined || u.level < weakest.level)) weakest = u;
        }
        return weakest === undefined ? null : mergeCommand(weakest);
      };
      const cmd = next();
      // A tile taken by something else, or a card still recharging: it waits for the next look.
      return cmd !== null && match.check(cmd) === null ? [cmd] : [];
    },
  };
}

/** The steady player's waves, in turn: a tank, a fighter, a shooter. */
const STEADY_WAVES: ReadonlyArray<readonly CardKey[]> = [
  ['skeletonWarrior', 'brainEater', 'skeletonArcher'],
  ['brainEater', 'desertZombie', 'hotTopic'],
  ['cowboyZombie', 'brainEater', 'tridentZombie'],
  ['skeletonWarrior', 'necromancer', 'brainRot'],
];

/** An adult as zombies sending mixed waves at the weakest lane (see the note at the top). */
export function createSteadyZombies(seed: number, every = ADULT_EVERY): Bot {
  const rng = rngFor(seed, SALT.steady, 'zombies');
  let wave = randomInt(rng, STEADY_WAVES.length);
  let sent = 0;
  let lane = -1;
  return {
    faction: 'zombies',
    think(match) {
      const s = match.state;
      if (s.winner !== null || s.tick % every !== 0) return [];
      const power = powerMove(match, 'zombies');
      if (power !== null) return [power];
      if (lane < 0) {
        // The lane whose plants shoot least, then hold least; ties in a random order.
        const lawn = readLawn(s);
        const start = randomInt(rng, LANES);
        let best = Infinity;
        for (let i = 0; i < LANES; i++) {
          const view = lawn[(start + i) % LANES];
          if (view === undefined) continue;
          const score = view.plants.reduce((n, p) => n + shotDps(match.balance, p) * 100 + p.hp, 0);
          if (score < best) {
            best = score;
            lane = view.lane;
          }
        }
      }
      const card = STEADY_WAVES[wave]?.[sent] ?? 'brainEater';
      let cmd = sendCommand(card, lane);
      if (match.check(cmd) === 'recharging') cmd = sendCommand('brainEater', lane);
      if (match.check(cmd) !== null) return []; // saving up
      sent += 1;
      if (sent >= (STEADY_WAVES[wave]?.length ?? 0)) {
        wave = (wave + 1) % STEADY_WAVES.length;
        sent = 0;
        lane = -1;
      }
      return [cmd];
    },
  };
}
