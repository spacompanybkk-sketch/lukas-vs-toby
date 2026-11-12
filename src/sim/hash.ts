import { ALL_CARDS } from '../data/units';
import { LANES } from './types';
import type {
  CardKey, Faction, Hazard, MatchConfig, PlayerState, Projectile, SimState, Unit,
} from './types';

/**
 * State checksum, snapshot and restore.
 *
 * `hashState` is unsigned 32-bit FNV-1a over every field of the state, in a fixed order
 * written out below (never `Object.keys` order of the state, which depends on how an object was
 * built; the field tables below are literals, so their order is the order they are written in):
 *   - a number is fed as its 8 IEEE-754 bytes, little-endian, with -0 folded into 0
 *     and every NaN folded into one pattern;
 *   - a boolean is one byte, 0 or 1;
 *   - a string is its length (as a number) then each char code as two bytes, low byte first;
 *   - an array is its length (as a number) then its elements in array order;
 *   - an optional or nullable value is a presence byte (0 absent or null, 1 present) then the value.
 * Two browsers running the same match must therefore print the same checksum.
 *
 * Every table is typed as a record over all the keys of what it hashes, so a field added to the
 * state and left out of the hash does not compile.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
/** Every card key, in the fixed order recharge timers are hashed. */
const CARD_KEYS: readonly CardKey[] = [...ALL_CARDS.plants, ...ALL_CARDS.zombies];

class Fnv1a {
  private h = FNV_OFFSET | 0;
  private readonly view = new DataView(new ArrayBuffer(8));

  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), FNV_PRIME);
  }

  bool(v: boolean): void {
    this.byte(v ? 1 : 0);
  }

  num(v: number): void {
    const view = this.view;
    if (v === 0) {
      v = 0; // -0 hashes as 0, which is what a JSON snapshot gives back
    }
    if (v !== v) {
      view.setUint32(0, 0, true); // canonical quiet NaN, 0x7ff8000000000000
      view.setUint32(4, 0x7ff80000, true);
    } else {
      view.setFloat64(0, v, true);
    }
    for (let i = 0; i < 8; i++) this.byte(view.getUint8(i));
  }

  str(v: string): void {
    this.num(v.length);
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      this.byte(c);
      this.byte(c >>> 8);
    }
  }

  /** The finished checksum as an unsigned 32-bit integer. */
  digest(): number {
    return this.h >>> 0;
  }
}

type Write<V> = (f: Fnv1a, v: V) => void;
/** How each field of a `T` is hashed, one entry per key: missing one is a compile error. */
type Fields<T> = { readonly [K in keyof T]-?: Write<T[K]> };

const num: Write<number> = (f, v) => f.num(v);
const str: Write<string> = (f, v) => f.str(v);
const bool: Write<boolean> = (f, v) => f.bool(v);
const nullableNum: Write<number | null> = (f, v) => {
  if (v === null) {
    f.byte(0);
  } else {
    f.byte(1);
    f.num(v);
  }
};
const nums: Write<readonly number[]> = (f, v) => {
  f.num(v.length);
  for (const n of v) f.num(n);
};
const perFaction = <V>(write: Write<V>): Write<Record<Faction, V>> => (f, v) => {
  for (const faction of FACTIONS) write(f, v[faction]);
};
const list = <T>(fields: Fields<T>): Write<readonly T[]> => (f, items) => {
  f.num(items.length);
  for (const item of items) record(f, fields, item);
};

function record<T>(f: Fnv1a, fields: Fields<T>, value: T): void {
  for (const key of Object.keys(fields) as Array<keyof T>) fields[key](f, value[key]);
}

const UNIT: Fields<Unit> = {
  id: num, key: str, faction: str, lane: num, x: num, level: num,
  hp: num, maxHp: num, spent: num, armor: num,
  meleeTimer: num, shotTimer: num, abilityTimer: num, auraTimer: num,
  blocked: bool,
  stun: num, blind: num, tied: num, poison: num, poisonDps: num, burn: num, burnDps: num,
  stacks: num, ownerId: nullableNum,
};

const PROJECTILE: Fields<Projectile> = {
  id: num, kind: str, faction: str, lane: num, x: num,
  speed: num, damage: num, ownerId: num, spawnTick: num,
  flight: str, sourceKey: str, level: num,
  targetId: nullableNum, targetX: nullableNum,
  pierceLeft: num, hitIds: nums,
  burning: bool, burnDps: num, burnTicks: num,
};

const HAZARD: Fields<Hazard> = {
  id: num, kind: str, faction: str, lane: num, x: num, radius: num, ticksLeft: num, dps: num, poisonTicks: num,
};

const PLAYER: Fields<PlayerState> = {
  energy: num,
  carry: num,
  recharge: (f, recharge) => {
    for (const key of CARD_KEYS) {
      const left = recharge[key];
      if (left === undefined) {
        f.byte(0);
      } else {
        f.byte(1);
        f.num(left);
      }
    }
  },
  heroTimer: num,
};

const CONFIG: Fields<MatchConfig> = {
  seed: num,
  startEnergy: perFaction(num),
  baseHp: perFaction(num),
  cards: perFaction((f, cards: readonly string[]) => {
    f.num(cards.length);
    for (const card of cards) f.str(card);
  }),
  incomeMultiplier: perFaction(num),
  suddenDeath: bool,
  heroes: perFaction(bool),
};

const STATE: Fields<SimState> = {
  tick: num, rng: num, nextId: num,
  units: list(UNIT),
  projectiles: list(PROJECTILE),
  hazards: list(HAZARD),
  players: perFaction((f, player: PlayerState) => record(f, PLAYER, player)),
  baseHp: perFaction(num),
  baseMaxHp: perFaction(num),
  baseDefenseTimers: nums, // lane order
  suddenDeath: bool,
  winner: (f, winner) => {
    if (winner === null) {
      f.byte(0);
    } else {
      f.byte(1);
      f.str(winner);
    }
  },
  config: (f, config) => record(f, CONFIG, config),
};

/** Unsigned 32-bit checksum of everything in the state. */
export function hashState(s: SimState): number {
  const f = new Fnv1a();
  record(f, STATE, s);
  return f.digest();
}

/** The whole state as JSON. Every number round-trips exactly. */
export function snapshotState(s: SimState): string {
  return JSON.stringify(s);
}

/**
 * Rebuilds a state from `snapshotState` output, as fresh objects sharing nothing with any other
 * state. A snapshot missing any top-level key of the state is refused with an error, with one
 * exception: a snapshot made before the plant base had a defence has no `baseDefenseTimers`; it
 * gets one timer per lane, all at 0, which is what the timers read whenever the defence is off.
 */
export function restoreState(json: string): SimState {
  const s = JSON.parse(json) as SimState;
  s.baseDefenseTimers ??= new Array<number>(LANES).fill(0);
  const missing = Object.keys(STATE).filter((key) => !Object.hasOwn(s, key));
  if (missing.length > 0) throw new Error(`The snapshot has no ${missing.join(', ')}`);
  return s;
}
