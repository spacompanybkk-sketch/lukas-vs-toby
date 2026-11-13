import { TICKS_PER_SECOND } from '../sim/types';
import type { Faction, Flight, ProjectileKind, SpellKey, SpellSize, StatusKind, UnitKey } from '../sim/types';

/** A close-range attack. Interval in seconds, reach in tiles. */
export interface MeleeStats { damage: number; interval: number; reach: number }

/**
 * What a shot does to whomever it damages: `kind` for `seconds`, with `dps` damage a second for
 * poison and burn (times the shooter's special level curve). With `chance`, only that share of
 * shots carries it, rolled on the state rng at firing; a shot that does is of kind `altKind`
 * (Kernel-pult butter), and only a shot of that kind carries the status, so `chance` needs `altKind`.
 */
export interface ShotStatus { kind: StatusKind; seconds: number; dps?: number; chance?: number; altKind?: ProjectileKind }

/** A ranged attack. Interval in seconds, range in tiles, speed in tiles per second. */
export interface ShotStats {
  kind: ProjectileKind; damage: number; interval: number; range: number; speed: number;
  flight?: Flight; // default 'straight'
  splash?: number; // lobbed: radius hit at landing (0 = the target only)
  pierce?: number; // piercing: units passed through
  status?: ShotStatus;
  /**
   * Left where a lobbed shot lands, for `seconds`: each enemy standing within `radius` is poisoned
   * at `dps` for at least `poisonSeconds` (so it keeps losing health that long after it steps out).
   */
  puddle?: { seconds: number; radius: number; dps: number; poisonSeconds: number };
}

export interface UnitStats {
  recharge: number; hp: number; armor: number; speed: number; // seconds, tiles/s
  melee?: MeleeStats; shot?: ShotStats;
  /**
   * Makes `amount` energy every `interval` s. Hurt (any damage), it makes none for `pauseSeconds`:
   * its timer stands still that long and then carries on (see `Unit.hurt`).
   */
  sun?: { amount: number; interval: number; pauseSeconds: number };
  deathBlast?: { damage: number; radius: number };
  shield?: { interval: number };
  /**
   * A zombie that holds keeps its distance: while a standing plant is ahead within
   * `holdRange ?? shot.range` it does not walk. It is not `blocked` by that, so it still shoots.
   */
  holds?: boolean; holdRange?: number;
  /**
   * Potato Mine: armed `armSeconds` after it is planted; armed, it goes off when a standing zombie
   * is `reach` ahead in its lane: `damage` (special curve) to every zombie within `radius`.
   */
  mine?: { armSeconds: number; reach: number; damage: number; radius: number };
  /**
   * Torchwood: a plant pea that passes it does `factor` times its damage and sets whom it damages
   * burning, `burnDps` (special curve of the Torchwood's level) for `burnSeconds`.
   */
  ignite?: { factor: number; burnDps: number; burnSeconds: number };
  /** Cherry Bomber: goes off `seconds` after it is planted, `damage` (special curve) within `radius`. */
  fuse?: { seconds: number; damage: number; radius: number };
  /**
   * Pumpkin Squash: when ready, crushes a zombie up to `range` ahead: `damage` (damage curve) to
   * every zombie in the lane within `radius` of it, then `recoverSeconds` until it is ready again.
   */
  leap?: { range: number; damage: number; radius: number; recoverSeconds: number };
  /**
   * Hot Topic: each time its bite brings a plant to 0 it gains a stack, up to `maxStacks`; each
   * stack adds `hpShare` of its level-scaled base health to its health and max, and `damageShare`
   * of its level-scaled base bite to its bite.
   */
  grow?: { hpShare: number; damageShare: number; maxStacks: number };
  /** Cowboy Zombie: every `interval` s it ties the strongest plant up to `range` ahead for `seconds`. */
  lasso?: { interval: number; range: number; seconds: number };
  /**
   * Necromancer: every `interval` s every other standing zombie within `radius` (straight-line,
   * lanes one apart) gains `amount` (special curve) health, never above its max.
   */
  healAura?: { amount: number; interval: number; radius: number };
  /** Necromancer: every `interval` s it raises a `key` at its own level (see `Balance.minionCap`). */
  raise?: { key: 'boneMinion'; interval: number };
}

/**
 * A spell's numbers (spec 21): `cooldown` seconds after each cast until it is ready again, ready
 * `firstReady` seconds into the match, covering an area of `size` (see `SpellSize`). What else it
 * has depends on the spell: `damage` (Thunderbolt, Meteor), `seconds` of a status or of a rock's
 * life (Vines, Fog, Frenzy, Rock Wall), `amount` of energy or healing (Sun Shower, Brain Feast,
 * Healing Rain), Frenzy's speed `factor`, Grave Rise's `count` of minions.
 * `minCol`: an aimed spell may not be cast on a column below it (Grave Rise, kept away from the
 * plant base).
 */
export interface SpellStats {
  cooldown: number; firstReady: number; size: SpellSize;
  damage?: number; seconds?: number; amount?: number; factor?: number; count?: number;
  minCol?: number;
}

/** Every tunable number of the game. The simulation reads these and nothing else. */
export interface Balance {
  units: Partial<Record<UnitKey, UnitStats>>;
  trickle: Record<Faction, number>; // energy per second
  bountyShare: Record<Faction, number>; // share of the victim's `spent` paid to this side
  baseShotFactor: number; // plant shots reaching the zombie base
  hitRadius: number; // projectile vs unit, tiles
  /**
   * What a merged unit's numbers are multiplied by, index = level (index 0 unused, level 1 is 1):
   * `hp` for its health and `damage` for its bites and shots, each per side, and `special` for
   * what is not a fight (Sun output, blast damage). A merged unit gains health and damage at once
   * and keeps its whole bite or volley until it falls, so equal multipliers would make a level-N
   * unit worth well over N separate ones; the curves are set so that it is worth about N (spec
   * 6.3: 1.00-1.15 × N, measured by `src/ai/duels.ts`). They differ per side because the two
   * sides fight differently: a stack of zombies loses bites as each one falls, a row of plants
   * makes each zombie walk on to the next.
   */
  levelCurves: {
    hp: Record<Faction, readonly number[]>;
    damage: Record<Faction, readonly number[]>;
    special: readonly number[];
  };
  suddenDeath: { startSeconds: number; baseRate: number; growthPerSecond: number };
  startEnergy: number; baseHp: number;
  /**
   * The plant base strikes a zombie biting it: `damage` per strike, at most one strike per lane
   * every `interval` seconds. Damage 0 switches it off.
   */
  /**
   * `paysBounty`: whether the plants get a bounty for a zombie the strike itself brings to 0 (a
   * zombie that got past the defences should not pay the defender; when false it dies with cause
   * `'base'` and pays nothing).
   */
  baseDefense: { damage: number; interval: number; paysBounty: boolean };
  /** A zombie shoots the plant base only from this close (x <= this), whatever its shot's range. */
  zombieBaseShotRange: number;
  /** At most this many of a Necromancer's raised minions stand at once. */
  minionCap: number;
  /**
   * Each side's hero power (Mega Mower, Bone Storm): `damage` to every standing enemy unit in the
   * lane it is aimed at, armor and shields ignored; ready `firstChargeSeconds` into the match and
   * `chargeSeconds` after each use.
   */
  hero: Record<Faction, { damage: number; chargeSeconds: number; firstChargeSeconds: number }>;
  spells: Record<SpellKey, SpellStats>;
  /**
   * What one Marketplace level adds (spec 9), per side: a unit at upgrade level n has `1 + hp × n`
   * times its health and `1 + damage × n` times its bite and shot damage (see `upgradeScale`).
   */
  upgradeStep: Record<Faction, { hp: number; damage: number }>;
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
      shot: { kind: 'pea', damage: 25, interval: 1.5, range: 10, speed: 6 },
    },
    sunflower: {
      recharge: 5, hp: 200, armor: 0, speed: 0,
      sun: { amount: 25, interval: 10, pauseSeconds: 2 },
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
      recharge: 3, hp: 180, armor: 0, speed: 1.3,
      melee: { damage: 15, interval: 0.7, reach: 0.6 },
    },
    skeletonWarrior: {
      recharge: 10, hp: 800, armor: 0, speed: 0.3,
      melee: { damage: 45, interval: 1.2, reach: 0.6 },
      shield: { interval: 4 },
    },
    // Phase 2 plants: starting numbers, tuned in phase 3.
    potatoMine: {
      recharge: 20, hp: 150, armor: 0, speed: 0,
      mine: { armSeconds: 12, reach: 0.6, damage: 450, radius: 0.75 },
    },
    kernelPult: {
      recharge: 5, hp: 300, armor: 0, speed: 0,
      shot: {
        kind: 'kernel', damage: 13, interval: 1.0, range: 10, speed: 7, flight: 'lobbed',
        status: { kind: 'stun', seconds: 2, chance: 0.3, altKind: 'butter' },
      },
    },
    mangoPult: {
      recharge: 7, hp: 300, armor: 0, speed: 0,
      shot: { kind: 'mango', damage: 45, interval: 3.0, range: 10, speed: 5, flight: 'lobbed', splash: 0.75 },
    },
    avocadoBunker: {
      recharge: 20, hp: 2000, armor: 8, speed: 0,
    },
    torchwood: {
      recharge: 10, hp: 500, armor: 0, speed: 0,
      ignite: { factor: 2, burnDps: 10, burnSeconds: 3 },
    },
    cherryBomber: {
      recharge: 30, hp: 300, armor: 0, speed: 0,
      fuse: { seconds: 1, damage: 600, radius: 1.6 },
    },
    pumpkinSquash: {
      recharge: 15, hp: 900, armor: 0, speed: 0,
      leap: { range: 3, damage: 350, radius: 0.5, recoverSeconds: 6 },
    },
    // Phase 2 zombies: starting numbers, tuned in phase 3.
    desertZombie: {
      recharge: 6, hp: 380, armor: 0, speed: 0.35,
      melee: { damage: 30, interval: 1.0, reach: 0.6 },
      shot: { kind: 'sand', damage: 10, interval: 2.5, range: 4, speed: 5, status: { kind: 'blind', seconds: 2 } },
    },
    skeletonArcher: {
      recharge: 6, hp: 220, armor: 0, speed: 0.4,
      melee: { damage: 15, interval: 1.0, reach: 0.6 },
      shot: { kind: 'arrow', damage: 28, interval: 1.6, range: 6, speed: 8 },
      holds: true,
    },
    hotTopic: {
      recharge: 6, hp: 300, armor: 0, speed: 0.5,
      melee: { damage: 25, interval: 0.5, reach: 0.6 },
      grow: { hpShare: 0.03, damageShare: 0.2, maxStacks: 5 },
    },
    cowboyZombie: {
      recharge: 10, hp: 450, armor: 0, speed: 0.35,
      melee: { damage: 30, interval: 1.0, reach: 0.6 },
      shot: { kind: 'bullet', damage: 22, interval: 1.5, range: 4.5, speed: 10 },
      lasso: { interval: 9, range: 5, seconds: 3 },
    },
    necromancer: {
      recharge: 15, hp: 400, armor: 0, speed: 0.3,
      melee: { damage: 15, interval: 1.2, reach: 0.6 },
      holds: true, holdRange: 4,
      healAura: { amount: 40, interval: 2, radius: 1.5 },
      raise: { key: 'boneMinion', interval: 10 },
    },
    tridentZombie: {
      recharge: 12, hp: 400, armor: 0, speed: 0.2,
      melee: { damage: 40, interval: 1.2, reach: 0.6 },
      shot: { kind: 'trident', damage: 40, interval: 4, range: 10, speed: 6, flight: 'piercing', pierce: 3 },
    },
    brainRot: {
      recharge: 15, hp: 450, armor: 0, speed: 0.25,
      melee: { damage: 20, interval: 1.2, reach: 0.6 },
      shot: {
        kind: 'rot', damage: 30, interval: 4, range: 6, speed: 4, flight: 'lobbed',
        puddle: { seconds: 4, radius: 0.75, dps: 15, poisonSeconds: 1 },
      },
      holds: true,
    },
    // Never a card, so never played: its recharge is a placeholder that nothing reads.
    boneMinion: {
      recharge: 1, hp: 150, armor: 0, speed: 0.6,
      melee: { damage: 20, interval: 0.8, reach: 0.6 },
    },
    // Rock Wall's rock: never a card. Its health is set here and nowhere else; it only stands.
    rock: { recharge: 1, hp: 1500, armor: 0, speed: 0 },
  },
  trickle: { plants: 2.5, zombies: 14.5 },
  bountyShare: { plants: 0.5, zombies: 0.5 },
  baseShotFactor: 0.3,
  hitRadius: 0.35,
  levelCurves: {
    hp: { plants: [0, 1, 2, 3, 4, 5], zombies: [0, 1, 1.87, 2.69, 3.48, 4.26] },
    damage: { plants: [0, 1, 2.1, 3.2, 4.3, 5.4], zombies: [0, 1, 1.87, 2.69, 3.48, 4.26] },
    special: [0, 1, 2, 3, 4, 5],
  },
  suddenDeath: { startSeconds: 360, baseRate: 0.005, growthPerSecond: 0.0001 },
  startEnergy: 190,
  baseHp: 6000,
  baseDefense: { damage: 100, interval: 2, paysBounty: false },
  zombieBaseShotRange: 3.5,
  minionCap: 3,
  hero: {
    plants: { damage: 400, chargeSeconds: 60, firstChargeSeconds: 45 }, // Mega Mower
    zombies: { damage: 250, chargeSeconds: 60, firstChargeSeconds: 45 }, // Bone Storm
  },
  spells: {
    // Task 8b: felt and equal. Each one, alone against a side with none, gives its side about +12
    // points of Medium v Medium (band 8-16, 600 seeds); rarer and big rather than frequent and tiny.
    thunderbolt: { cooldown: 90, firstReady: 45, size: 2, damage: 300 },
    vines: { cooldown: 60, firstReady: 45, size: 2, seconds: 8 },
    sunShower: { cooldown: 120, firstReady: 45, size: 0, amount: 50 },
    healingRain: { cooldown: 90, firstReady: 45, size: 3, amount: 125 },
    rockWall: { cooldown: 90, firstReady: 45, size: 1, seconds: 12 }, // the rock's health: units.rock
    meteor: { cooldown: 90, firstReady: 45, size: 2, damage: 200 },
    fog: { cooldown: 90, firstReady: 45, size: 2, seconds: 6 },
    brainFeast: { cooldown: 90, firstReady: 45, size: 0, amount: 75 },
    frenzy: { cooldown: 60, firstReady: 45, size: 3, seconds: 10, factor: 2.5 },
    graveRise: { cooldown: 90, firstReady: 45, size: 1, count: 2, minCol: 4 },
  },
  // Task 5 follow-up, measured (200 seeds, every unit at the level, the adult stand-ins v Hard; at
  // level 0 they win 22% / 29%). A step per side, because the sides answer differently. Any health
  // step adds a whole extra hit to units whose health the attacks divide exactly (400 / 25 a pea),
  // a cliff at level 1, so the zombies (which it helps most) get none.
  //   plants  +0.5% health, +5% damage: fortress plants v Hard 49.5% / 70.5% at levels 5 / 10
  //   zombies +3% damage:                steady zombies v Hard 45.5% / 60%   at levels 5 / 10
  upgradeStep: {
    plants: { hp: 0.005, damage: 0.05 },
    zombies: { hp: 0, damage: 0.03 },
  },
});

/** Seconds to whole ticks. */
export function seconds(s: number): number {
  return Math.round(s * TICKS_PER_SECOND);
}
