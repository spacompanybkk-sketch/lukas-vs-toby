import { BALANCE, cloneBalance } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { defaultConfig } from '../../src/sim/match';
import type { CardKey, Command, Faction, MatchConfig, SimEvent } from '../../src/sim/types';

/**
 * The numbers the rules tests were written for (the phase 1 table before the final balance wave),
 * whatever the tuner does to `BALANCE` afterwards: the six units as first set, linear level
 * curves (×level for health, damage and specials, both sides), incomes 1.8 and 6, base shots at
 * half damage. A rules test that works out exact figures uses this, so retuning never touches it.
 * Every call returns a fresh, unfrozen copy.
 */
export function classicBalance(): Balance {
  const b = cloneBalance(BALANCE);
  b.units = {
    peashooter: {
      recharge: 5, hp: 300, armor: 0, speed: 0,
      shot: { kind: 'pea', damage: 20, interval: 1.5, range: 10, speed: 6 },
    },
    sunflower: {
      recharge: 5, hp: 200, armor: 0, speed: 0,
      sun: { amount: 25, interval: 10 },
    },
    walnutBomb: {
      recharge: 15, hp: 1200, armor: 0, speed: 0,
      deathBlast: { damage: 150, radius: 1.5 },
    },
    brainEater: {
      recharge: 5, hp: 400, armor: 0, speed: 0.35,
      melee: { damage: 40, interval: 1.0, reach: 0.6 },
      shot: { kind: 'brain', damage: 15, interval: 2.0, range: 3.5, speed: 4 },
    },
    veryFastWalker: {
      recharge: 3, hp: 180, armor: 0, speed: 0.9,
      melee: { damage: 15, interval: 0.7, reach: 0.6 },
    },
    skeletonWarrior: {
      recharge: 10, hp: 700, armor: 0, speed: 0.3,
      melee: { damage: 45, interval: 1.2, reach: 0.6 },
      shield: { interval: 4 },
    },
  };
  const linear = [0, 1, 2, 3, 4, 5];
  b.levelCurves = {
    hp: { plants: [...linear], zombies: [...linear] },
    damage: { plants: [...linear], zombies: [...linear] },
    special: [...linear],
  };
  b.trickle = { plants: 1.8, zombies: 6 };
  b.bountyShare = { plants: 0.2, zombies: 0.5 };
  b.baseShotFactor = 0.5;
  b.hitRadius = 0.35;
  b.startEnergy = 190;
  b.baseHp = 7000;
  b.baseDefense = { damage: 100, interval: 2 };
  b.zombieBaseShotRange = 3.5; // phase 2: what the base-shot rule read before it had a number of its own (the Brain Eater's range)
  b.suddenDeath = { startSeconds: 360, baseRate: 0.005, growthPerSecond: 0.0001 };
  return b;
}

/**
 * The classic balance (see `classicBalance`) with the plant base's defence set: `damage` per
 * strike, at most one strike per lane every `interval` seconds; damage 0 switches it off.
 */
export function withBaseDefense(damage = 60, interval = 1): Balance {
  const balance = classicBalance();
  balance.baseDefense = { damage, interval };
  return balance;
}

/**
 * The default setup with the energy and base health these tests were written for, 200 and 3000 a
 * side, so a test of the rules keeps testing them whatever the tuner does to the shipped starting
 * values in `BALANCE`; and, as in phase 1, with no hero powers.
 */
export function classicConfig(seed: number, balance: Balance = classicBalance()): MatchConfig {
  const config = defaultConfig(seed, balance);
  config.startEnergy = { plants: 200, zombies: 200 };
  config.baseHp = { plants: 3000, zombies: 3000 };
  config.heroes = { plants: false, zombies: false };
  return config;
}

export type PlaceCommand = Extract<Command, { type: 'place' }>;
export type MergeCommand = Extract<Command, { type: 'merge' }>;
export type RemoveCommand = Extract<Command, { type: 'remove' }>;

export function place(faction: Faction, unit: CardKey, lane: number, col: number): PlaceCommand {
  return { type: 'place', faction, unit, lane, col };
}

export function merge(faction: Faction, unit: CardKey, targetId: number): MergeCommand {
  return { type: 'merge', faction, unit, targetId };
}

export function remove(faction: Faction, targetId: number): RemoveCommand {
  return { type: 'remove', faction, targetId };
}

/** The events of one type, narrowed to that type. */
export function eventsOf<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Array<Extract<SimEvent, { type: T }>> {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}
