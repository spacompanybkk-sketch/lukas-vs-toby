import { TICKS_PER_SECOND } from '../sim/types';
import type { Faction, ProjectileKind, UnitKey } from '../sim/types';

/** A close-range attack. Interval in seconds, reach in tiles. */
export interface MeleeStats { damage: number; interval: number; reach: number }

/** A ranged attack. Interval in seconds, range in tiles, speed in tiles per second. */
export interface ShotStats { kind: ProjectileKind; damage: number; interval: number; range: number; speed: number }

export interface UnitStats {
  recharge: number; hp: number; armor: number; speed: number; // seconds, tiles/s
  melee?: MeleeStats; shot?: ShotStats;
  sun?: { amount: number; interval: number };
  deathBlast?: { damage: number; radius: number };
  shield?: { interval: number };
}

/** Every tunable number of the game. The simulation reads these and nothing else. */
export interface Balance {
  units: Partial<Record<UnitKey, UnitStats>>;
  trickle: Record<Faction, number>; // energy per second
  bountyShare: Record<Faction, number>; // share of the victim's `spent` paid to this side
  baseShotFactor: number; // plant shots reaching the zombie base
  hitRadius: number; // projectile vs unit, tiles
  levelScale: readonly number[]; // index = level
  suddenDeath: { startSeconds: number; baseRate: number; growthPerSecond: number };
  startEnergy: number; baseHp: number;
  /**
   * The plant base strikes a zombie biting it: `damage` per strike, at most one strike per lane
   * every `interval` seconds. Damage 0 switches it off.
   */
  baseDefense: { damage: number; interval: number };
}

/** `T` with every property, nested ones and array elements included, read-only. */
export type DeepReadonly<T> =
  T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepCopy(item)) as T;
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) copy[key] = deepCopy(child);
    return copy as T;
  }
  return value;
}

/** A plain, unfrozen deep copy of a balance table: the way a test (or a tuning tool) gets numbers of its own. */
export function cloneBalance(b: Balance): Balance {
  return deepCopy(b);
}

/** The shipped numbers. Deeply frozen: change them here, or `cloneBalance` for a variant. */
export const BALANCE: DeepReadonly<Balance> = deepFreeze<Balance>({
  units: {
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
  },
  trickle: { plants: 1.8, zombies: 6 },
  bountyShare: { plants: 0.2, zombies: 0.5 },
  baseShotFactor: 0.5,
  hitRadius: 0.35,
  levelScale: [0, 1, 2, 3, 4, 5],
  suddenDeath: { startSeconds: 360, baseRate: 0.005, growthPerSecond: 0.0001 },
  startEnergy: 190,
  baseHp: 7000,
  baseDefense: { damage: 100, interval: 2 },
});

/** Seconds to whole ticks. */
export function seconds(s: number): number {
  return Math.round(s * TICKS_PER_SECOND);
}
