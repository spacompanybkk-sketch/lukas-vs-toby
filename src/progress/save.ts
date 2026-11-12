import type { Skill } from '../ai/bot';
import { ALL_CARDS } from '../data/units';
import type { CardKey, Faction } from '../sim/types';

/** A player's place: `p01` … `p30`. At most 30 players exist (spec 20). */
export type Slot = `p${string}`;

export const SLOTS: readonly Slot[] = Object.freeze(
  Array.from({ length: 30 }, (_, i): Slot => `p${String(i + 1).padStart(2, '0')}`),
);

/** The 20 unit cards, plants then zombies: a player's picture is one of them. */
export const PICTURES: readonly CardKey[] = Object.freeze([...ALL_CARDS.plants, ...ALL_CARDS.zombies]);

/** One side's Adventure progress. Phase 4b fills it. */
export interface SideProgress { stars: Record<string, 0 | 1 | 2 | 3>; unlocked: CardKey[] }

export interface Save {
  v: 1; slot: Slot; name: string; picture: CardKey;
  /** Whole, ≥ 0. */
  coins: number;
  /** Marketplace level per unit, 0..10; a missing unit is level 0. */
  upgrades: Partial<Record<CardKey, number>>;
  plants: SideProgress; zombies: SideProgress;
  bestWave: number; versusWins: number; computerWins: number;
  difficulty: Record<Faction, Skill>;
  /** Whether an old-game save has been carried into this one (it is, at most once). */
  importedOld: boolean;
  /** Milliseconds; set by `touch`. The newer of two copies wins whole. */
  updatedAt: number;
}

const SKILLS: readonly Skill[] = ['easy', 'medium', 'hard'];
const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
const NAME = /^[A-Za-z0-9]{1,10}$/;
/** Level ids are database keys too, so they keep to letters, digits, `-` and `_`. */
const LEVEL_ID = /^[A-Za-z0-9_-]{1,32}$/;
const SAVE_KEYS = [
  'v', 'slot', 'name', 'picture', 'coins', 'upgrades', 'plants', 'zombies',
  'bestWave', 'versusWins', 'computerWins', 'difficulty', 'importedOld', 'updatedAt',
] as const;

export function newSave(slot: Slot, name: string, picture: CardKey, now: number): Save {
  return {
    v: 1, slot, name, picture,
    coins: 0, upgrades: {},
    plants: { stars: {}, unlocked: [] }, zombies: { stars: {}, unlocked: [] },
    bestWave: 0, versusWins: 0, computerWins: 0,
    difficulty: { plants: 'medium', zombies: 'medium' },
    importedOld: false, updatedAt: now,
  };
}

/** A nickname: after trimming, 1–10 letters or digits (A–Z, a–z, 0–9). */
export function validName(name: string): boolean {
  return NAME.test(name.trim());
}

export const isSlot = (v: unknown): v is Slot => typeof v === 'string' && (SLOTS as readonly string[]).includes(v);
export const isPicture = (v: unknown): v is CardKey =>
  typeof v === 'string' && (PICTURES as readonly string[]).includes(v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const hasExactly = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
};

function parseSide(raw: unknown, faction: Faction): SideProgress | null {
  if (!isRecord(raw) || !hasExactly(raw, ['stars', 'unlocked'])) return null;
  const { stars, unlocked } = raw;
  if (!isRecord(stars) || !Array.isArray(unlocked)) return null;
  const outStars: Record<string, 0 | 1 | 2 | 3> = {};
  for (const [id, n] of Object.entries(stars)) {
    if (!LEVEL_ID.test(id) || !(n === 0 || n === 1 || n === 2 || n === 3)) return null;
    outStars[id] = n;
  }
  const own = ALL_CARDS[faction] as readonly unknown[];
  if (!unlocked.every((k) => own.includes(k)) || new Set(unlocked).size !== unlocked.length) return null;
  return { stars: outStars, unlocked: [...unlocked] as CardKey[] };
}

/** Reads a save strictly: any wrong shape, range, type, missing or extra key gives null. */
export function parseSave(raw: unknown): Save | null {
  if (!isRecord(raw) || !hasExactly(raw, SAVE_KEYS)) return null;
  const o = raw;
  if (o.v !== 1 || !isSlot(o.slot) || typeof o.name !== 'string' || !NAME.test(o.name) || !isPicture(o.picture)) {
    return null;
  }
  if (!isCount(o.coins) || !isCount(o.bestWave) || !isCount(o.versusWins) || !isCount(o.computerWins)) return null;
  if (!isCount(o.updatedAt) || typeof o.importedOld !== 'boolean') return null;

  if (!isRecord(o.upgrades)) return null;
  const upgrades: Partial<Record<CardKey, number>> = {};
  for (const [k, n] of Object.entries(o.upgrades)) {
    if (!isPicture(k) || !isCount(n) || n > 10) return null;
    upgrades[k] = n;
  }

  const d = o.difficulty;
  if (!isRecord(d) || !hasExactly(d, FACTIONS)) return null;
  if (!SKILLS.includes(d.plants as Skill) || !SKILLS.includes(d.zombies as Skill)) return null;

  const plants = parseSide(o.plants, 'plants');
  const zombies = parseSide(o.zombies, 'zombies');
  if (!plants || !zombies) return null;

  return {
    v: 1, slot: o.slot, name: o.name, picture: o.picture,
    coins: o.coins, upgrades, plants, zombies,
    bestWave: o.bestWave, versusWins: o.versusWins, computerWins: o.computerWins,
    difficulty: { plants: d.plants as Skill, zombies: d.zombies as Skill },
    importedOld: o.importedOld, updatedAt: o.updatedAt,
  };
}

export function totalStars(s: Save): number {
  let n = 0;
  for (const f of FACTIONS) for (const v of Object.values(s[f].stars)) n += v;
  return n;
}

/**
 * Marks a save as changed at `now`. The stamp always moves forward (at least 1 ms past the
 * previous one), so an edit beats the copy it was made from even when the clock lags.
 */
export function touch(s: Save, now: number): Save {
  return { ...s, updatedAt: Math.max(Math.floor(now), s.updatedAt + 1) };
}
