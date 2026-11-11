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
  levelScale: number[]; // index = level
  suddenDeath: { startSeconds: number; baseRate: number; growthPerSecond: number };
  startEnergy: number; baseHp: number;
}

export const BALANCE: Balance = {
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
  trickle: { plants: 2, zombies: 5 },
  bountyShare: { plants: 0.2, zombies: 0.5 },
  baseShotFactor: 0.5,
  hitRadius: 0.35,
  levelScale: [0, 1, 2, 3, 4, 5],
  suddenDeath: { startSeconds: 360, baseRate: 0.005, growthPerSecond: 0.0001 },
  startEnergy: 200,
  baseHp: 3000,
};

/** Seconds to whole ticks. */
export function seconds(s: number): number {
  return Math.round(s * TICKS_PER_SECOND);
}
