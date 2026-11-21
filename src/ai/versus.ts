import { BALANCE } from '../data/balance';
import type { Balance } from '../data/balance';
import { ALL_CARDS } from '../data/units';
import type { Slot } from '../progress/save';
import { defaultConfig } from '../sim/match';
import type { Faction, MatchConfig } from '../sim/types';

/** How big the younger boy's head start is: 0 (none) to 5, shown as that many sun or brain pictures. */
export type HeadStep = 0 | 1 | 2 | 3 | 4 | 5;

/** A head start belongs to the boy (his slot), not the side, so it follows him through a rematch. */
export interface HeadStart { slot: Slot; step: HeadStep }

/** Everything that makes a Versus match: both devices build the same `MatchConfig` from it. */
export interface VersusSetup {
  /** The match seed, a uint32 (it also deals the spells). */
  seed: number;
  /** Who sits on which side: two different slots. */
  seats: Record<Faction, Slot>;
  /** The head start, or null; its slot is one of `seats`. */
  head: HeadStart | null;
  /** Test matches only (`meta.test`): both bases' health, whole 1..500, so a match ends quickly. */
  testBaseHp?: number;
}

/** Each head-start step adds this much starting energy and this much to the trickle's multiplier. */
export const HEAD_START_PER_STEP = Object.freeze({ energy: 50, income: 0.1 } as const);

/** The step used until the sweep had measured one (spec §3). */
export const PLACEHOLDER_HEAD_STEP: HeadStep = 3;

/**
 * The default step for Toby, by the side he plays: the smallest step at which a random-tapping
 * child stand-in wins at least 40% against the adult stand-in (or 5 if none does), measured by
 * `tests/ai/long/versusHeadStart.test.ts` on seeds 1..200. Zombies reach 42.5% at step 3; plants
 * reach no more than 0.5% at any step, so theirs is the 5 of "none does".
 */
export const DEFAULT_HEAD_STEP: Readonly<Record<Faction, HeadStep>> = Object.freeze({
  plants: 5, zombies: 3,
});

/** The slot that gets a head start by default (Toby, almost 5). */
const YOUNGEST: Slot = 'p02';

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];

function checkSetup(setup: VersusSetup): void {
  const { seed, seats, head, testBaseHp } = setup;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new RangeError(`versus seed ${seed} is not a uint32`);
  if (seats.plants === seats.zombies) throw new RangeError(`versus seats are both ${seats.plants}`);
  if (head !== null) {
    if (head.slot !== seats.plants && head.slot !== seats.zombies) throw new RangeError(`head start for ${head.slot}, who is not seated`);
    if (!Number.isInteger(head.step) || head.step < 0 || head.step > 5) throw new RangeError(`head start step ${head.step} is not 0..5`);
  }
  if (testBaseHp !== undefined && (!Number.isInteger(testBaseHp) || testBaseHp < 1 || testBaseHp > 500)) {
    throw new RangeError(`test base health ${testBaseHp} is not a whole 1..500`);
  }
}

/** The side `slot` sits on; throws when he is not seated. */
export function seatOf(setup: VersusSetup, slot: Slot): Faction {
  const side = FACTIONS.find((f) => setup.seats[f] === slot);
  if (side === undefined) throw new RangeError(`${slot} is not seated`);
  return side;
}

/**
 * The Versus match config (spec §3): the default setup for the seed (heroes on, two spells a side,
 * sudden death, `NO_TWIST`), all ten cards a side, no upgrades. The head start's side starts with
 * `HEAD_START_PER_STEP.energy` more energy per step and a trickle of `(10 + step) / 10`.
 */
export function versusConfig(setup: VersusSetup, balance: Balance = BALANCE): MatchConfig {
  checkSetup(setup);
  const config = defaultConfig(setup.seed, balance);
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  config.upgrades = { plants: {}, zombies: {} };
  if (setup.head !== null && setup.head.step > 0) {
    const side = seatOf(setup, setup.head.slot);
    const { step } = setup.head;
    config.startEnergy[side] = balance.startEnergy + HEAD_START_PER_STEP.energy * step;
    // Tenths, not 1 + 0.1 · step, so that step 3 is exactly 1.3.
    config.incomeMultiplier[side] = (10 + step) / 10;
  }
  if (setup.testBaseHp !== undefined) config.baseHp = { plants: setup.testBaseHp, zombies: setup.testBaseHp };
  return config;
}

/** The default head start for these seats: Toby (`p02`) at his side's measured step, nobody else. */
export function defaultHeadStart(seats: Record<Faction, Slot>): HeadStart | null {
  const side = FACTIONS.find((f) => seats[f] === YOUNGEST);
  return side === undefined ? null : { slot: YOUNGEST, step: DEFAULT_HEAD_STEP[side] };
}

/** The rematch: the same two boys on swapped sides, a new seed, the same head start (it follows its boy). */
export function rematchSetup(prev: VersusSetup, seed: number): VersusSetup {
  const next: VersusSetup = {
    seed,
    seats: { plants: prev.seats.zombies, zombies: prev.seats.plants },
    head: prev.head === null ? null : { ...prev.head },
  };
  if (prev.testBaseHp !== undefined) next.testBaseHp = prev.testBaseHp;
  return next;
}
