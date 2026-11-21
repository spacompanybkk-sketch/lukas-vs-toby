import { PLANT_KEYS, ZOMBIE_KEYS } from '../data/units';
import { SPELLS } from '../sim/spells';
import type { CardKey, Command, Faction, SpellKey } from '../sim/types';

/**
 * Turn records of two-device Versus (spec 6.3). A turn is 6 ticks; each seat writes one JSON string
 * per turn at `turns/<seat>/t<k>`: `{"c":[[offset, type, …fields]], "h":[tick, hash]}`, both keys
 * optional (an empty turn is `{}`). Commands carry no faction: the reader adds the seat's.
 * Everything here is pure and identical on both devices, so a malformed record has the same
 * effect (none) on both screens.
 */
export const TURN_TICKS = 6;
export const MAX_TURN_COMMANDS = 8;
export const MAX_TURN_CHARS = 400;
export const MAX_TURN = 9000; // t009000 = 30 minutes
export const EMPTY_TURN = '{}';

export interface TurnCommand { at: number /* 0..5 within the turn */; cmd: Command /* never 'belt' */ }
export interface Turn { commands: TurnCommand[]; hash: readonly [tick: number, hash: number] | null }

const KEY = /^t(\d{6})$/;

/** The database key of turn `k`: 120 → `t000120`. Throws outside 0..MAX_TURN. */
export function turnKey(k: number): string {
  if (!Number.isInteger(k) || k < 0 || k > MAX_TURN) throw new RangeError(`turn ${k} outside 0..${MAX_TURN}`);
  return `t${String(k).padStart(6, '0')}`;
}

/** The turn index of a key written by `turnKey`, else null. */
export function parseTurnKey(key: string): number | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const k = Number(m[1]);
  return k <= MAX_TURN ? k : null;
}

type Wire = (string | number)[];

function toWire(at: number, cmd: Command): Wire {
  switch (cmd.type) {
    case 'place': return [at, 'place', cmd.unit, cmd.lane, cmd.col];
    case 'merge': return [at, 'merge', cmd.unit, cmd.targetId];
    case 'remove': return [at, 'remove', cmd.targetId];
    case 'hero': return [at, 'hero', cmd.lane];
    case 'spell': return [at, 'spell', cmd.spell, cmd.lane, cmd.col];
    case 'belt': throw new RangeError('a belt command is never sent');
  }
}

/** The record string of a turn. Throws RangeError on > 8 commands, > 400 characters, a belt, or an offset outside 0..5. */
export function encodeTurn(turn: Turn): string {
  if (turn.commands.length > MAX_TURN_COMMANDS) throw new RangeError(`${turn.commands.length} commands in one turn`);
  const out: { c?: Wire[]; h?: [number, number] } = {};
  if (turn.commands.length > 0) {
    out.c = turn.commands.map(({ at, cmd }) => {
      if (!isOffset(at)) throw new RangeError(`offset ${at} outside 0..${TURN_TICKS - 1}`);
      return toWire(at, cmd);
    });
  }
  if (turn.hash) out.h = [turn.hash[0], turn.hash[1]];
  const raw = JSON.stringify(out);
  if (raw.length > MAX_TURN_CHARS) throw new RangeError(`turn record of ${raw.length} characters`);
  return raw;
}

const CARDS: ReadonlySet<string> = new Set<CardKey>([...PLANT_KEYS, ...ZOMBIE_KEYS]);
const SPELL_KEYS: ReadonlySet<string> = new Set<SpellKey>([...SPELLS.plants, ...SPELLS.zombies]);

const isOffset = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < TURN_TICKS;
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isCard = (v: unknown): v is CardKey => typeof v === 'string' && CARDS.has(v);
const isSpell = (v: unknown): v is SpellKey => typeof v === 'string' && SPELL_KEYS.has(v);

function fromWire(w: unknown, faction: Faction): TurnCommand | null {
  if (!Array.isArray(w)) return null;
  const [at, type, a, b, c] = w as unknown[];
  if (!isOffset(at)) return null;
  const n = w.length;
  switch (type) {
    case 'place':
      return n === 5 && isCard(a) && isInt(b) && isInt(c) ? { at, cmd: { type, faction, unit: a, lane: b, col: c } } : null;
    case 'merge':
      return n === 4 && isCard(a) && isInt(b) ? { at, cmd: { type, faction, unit: a, targetId: b } } : null;
    case 'remove':
      return n === 3 && isInt(a) ? { at, cmd: { type, faction, targetId: a } } : null;
    case 'hero':
      return n === 3 && isInt(a) ? { at, cmd: { type, faction, lane: a } } : null;
    case 'spell':
      return n === 5 && isSpell(a) && isInt(b) && isInt(c) ? { at, cmd: { type, faction, spell: a, lane: b, col: c } } : null;
    default:
      return null; // belt and anything unknown
  }
}

const NOTHING = (): Turn => ({ commands: [], hash: null });

/**
 * The turn in a record read from `seat`'s log, every command given that seat's faction. Any
 * malformed part (not a string, over 400 characters, bad JSON, an unknown key, a bad command or
 * hash) makes the whole record read as `{ commands: [], hash: null }`.
 */
export function decodeTurn(raw: unknown, seat: Faction): Turn {
  if (typeof raw !== 'string' || raw.length > MAX_TURN_CHARS) return NOTHING();
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return NOTHING(); }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return NOTHING();
  const rec = o as Record<string, unknown>;
  if (Object.keys(rec).some((k) => k !== 'c' && k !== 'h')) return NOTHING();
  const commands: TurnCommand[] = [];
  if ('c' in rec) {
    if (!Array.isArray(rec.c) || rec.c.length > MAX_TURN_COMMANDS) return NOTHING();
    for (const w of rec.c) {
      const tc = fromWire(w, seat);
      if (!tc) return NOTHING();
      commands.push(tc);
    }
  }
  let hash: Turn['hash'] = null;
  if ('h' in rec) {
    const h = rec.h;
    if (!Array.isArray(h) || h.length !== 2 || !h.every((x) => isInt(x) && x >= 0)) return NOTHING();
    hash = [h[0] as number, h[1] as number];
  }
  return { commands, hash };
}
