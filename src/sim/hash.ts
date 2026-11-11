import { PLANT_KEYS, ZOMBIE_KEYS } from '../data/units';
import type { Faction, SimState, UnitKey } from './types';

/**
 * State checksum, snapshot and restore.
 *
 * `hashState` is unsigned 32-bit FNV-1a over every field of the state, in a fixed order
 * written out below (never `Object.keys` order, which depends on how an object was built):
 *   - a number is fed as its 8 IEEE-754 bytes, little-endian, with -0 folded into 0
 *     and every NaN folded into one pattern;
 *   - a boolean is one byte, 0 or 1;
 *   - a string is its length (as a number) then each char code as two bytes, low byte first;
 *   - an array is its length (as a number) then its elements in array order;
 *   - an optional value is a presence byte (0 absent, 1 present) then the value.
 * Two browsers running the same match must therefore print the same checksum.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
/** Every card key, in the fixed order recharge timers are hashed. */
const CARD_KEYS: readonly UnitKey[] = [...PLANT_KEYS, ...ZOMBIE_KEYS];

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

/** Unsigned 32-bit checksum of everything in the state. */
export function hashState(s: SimState): number {
  const f = new Fnv1a();

  f.num(s.tick);
  f.num(s.rng);
  f.num(s.nextId);

  f.num(s.units.length);
  for (const u of s.units) {
    f.num(u.id); f.str(u.key); f.str(u.faction); f.num(u.lane); f.num(u.x); f.num(u.level);
    f.num(u.hp); f.num(u.maxHp); f.num(u.spent); f.num(u.armor);
    f.num(u.meleeTimer); f.num(u.shotTimer); f.num(u.abilityTimer);
    f.bool(u.blocked);
  }

  f.num(s.projectiles.length);
  for (const p of s.projectiles) {
    f.num(p.id); f.str(p.kind); f.str(p.faction); f.num(p.lane); f.num(p.x);
    f.num(p.speed); f.num(p.damage); f.num(p.ownerId); f.num(p.spawnTick);
  }

  for (const faction of FACTIONS) {
    const player = s.players[faction];
    f.num(player.energy);
    f.num(player.carry);
    for (const key of CARD_KEYS) {
      const left = player.recharge[key];
      if (left === undefined) {
        f.byte(0);
      } else {
        f.byte(1);
        f.num(left);
      }
    }
  }

  for (const faction of FACTIONS) f.num(s.baseHp[faction]);
  for (const faction of FACTIONS) f.num(s.baseMaxHp[faction]);

  f.bool(s.suddenDeath);
  if (s.winner === null) {
    f.byte(0);
  } else {
    f.byte(1);
    f.str(s.winner);
  }

  const c = s.config;
  f.num(c.seed);
  for (const faction of FACTIONS) f.num(c.startEnergy[faction]);
  for (const faction of FACTIONS) f.num(c.baseHp[faction]);
  for (const faction of FACTIONS) {
    const cards = c.cards[faction];
    f.num(cards.length);
    for (const card of cards) f.str(card);
  }
  for (const faction of FACTIONS) f.num(c.incomeMultiplier[faction]);
  f.bool(c.suddenDeath);

  return f.digest();
}

/** The whole state as JSON. Every number round-trips exactly. */
export function snapshotState(s: SimState): string {
  return JSON.stringify(s);
}

/** Rebuilds a state from `snapshotState` output, as fresh objects sharing nothing with any other state. */
export function restoreState(json: string): SimState {
  return JSON.parse(json) as SimState;
}
