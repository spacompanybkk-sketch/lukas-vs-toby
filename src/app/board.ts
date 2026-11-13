import { defaultCloud } from '../cloud/restClient';
import type { BoardRow, Cloud } from '../cloud/types';
import { isPicture, isSlot, totalStars } from '../progress/save';
import type { Save, Slot } from '../progress/save';

/** The four leaderboard tables: Adventure stars, best Free Play wave, Versus wins, wins against the computer. */
export type Table = 'stars' | 'wave' | 'versus' | 'computer';
export const TABLES: readonly Table[] = Object.freeze(['stars', 'wave', 'versus', 'computer']);

/** The last board fetched on this device, for when there is no connection. */
export const BOARD_KEY = 'lvt2_board';

export function scoreOf(row: BoardRow, table: Table): number {
  switch (table) {
    case 'stars': return row.stars;
    case 'wave': return row.wave;
    case 'versus': return row.versusWins;
    case 'computer': return row.computerWins;
  }
}

export interface Ranked { row: BoardRow; rank: number }

/**
 * One table: players with a number above 0, highest first. Ties share a rank (1, 2, 2, 4), and
 * within a tie whoever got there first (earlier `updatedAt`) stands first.
 */
export function rankTable(rows: readonly BoardRow[], table: Table): Ranked[] {
  const on = rows.filter((r) => scoreOf(r, table) > 0);
  on.sort((a, b) => scoreOf(b, table) - scoreOf(a, table) || a.updatedAt - b.updatedAt || a.slot.localeCompare(b.slot));
  const out: Ranked[] = [];
  on.forEach((row, i) => {
    const prev = out[i - 1];
    const rank = prev !== undefined && scoreOf(prev.row, table) === scoreOf(row, table) ? prev.rank : i + 1;
    out.push({ row, rank });
  });
  return out;
}

/** A player's rank in a table, or null when they are not on it (nothing yet). */
export function placeOf(rows: readonly BoardRow[], table: Table, slot: Slot): number | null {
  return rankTable(rows, table).find((r) => r.row.slot === slot)?.rank ?? null;
}

/** The board row a save stands for (the same numbers the cloud publishes). */
export function rowOf(s: Save, updatedAt: number): BoardRow {
  return {
    slot: s.slot, name: s.name, picture: s.picture,
    stars: totalStars(s), wave: s.bestWave, versusWins: s.versusWins, computerWins: s.computerWins, updatedAt,
  };
}

export interface RankUp { table: Table; rank: number }

/**
 * After a battle: the player's best move up in any table, comparing their place on `base` with
 * their row as it was (`before`) and as it is now (`after`); the others' rows stay as on `base`.
 * Entering a table counts as coming from below everyone. Null when nothing moved up, or when
 * the board holds only this player.
 */
export function rankChange(base: readonly BoardRow[], before: Save, after: Save): RankUp | null {
  const others = base.filter((r) => r.slot !== before.slot);
  if (others.length === 0) return null;
  const mine = base.find((r) => r.slot === before.slot);
  const was = [...others, rowOf(before, mine?.updatedAt ?? before.updatedAt)];
  // The new row was saved last: it stands behind everyone it ties with.
  const now = [...others, rowOf(after, Number.MAX_SAFE_INTEGER)];
  let best: RankUp | null = null;
  let bestGain = 0;
  for (const table of TABLES) {
    const to = placeOf(now, table, after.slot);
    if (to === null) continue;
    const from = placeOf(was, table, before.slot) ?? was.length + 1;
    const gain = from - to;
    if (gain > bestGain) {
      bestGain = gain;
      best = { table, rank: to };
    }
  }
  return best;
}

export interface BoardView {
  rows: BoardRow[];
  /** False: no answer; `rows` is the copy last fetched on this device (or empty). */
  online: boolean;
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function validRow(r: unknown): r is BoardRow {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return isSlot(o.slot) && typeof o.name === 'string' && isPicture(o.picture)
    && isCount(o.stars) && isCount(o.wave) && isCount(o.versusWins) && isCount(o.computerWins) && isCount(o.updatedAt);
}

/**
 * The leaderboard's data: fetched when the screen opens and after a battle, and the last board
 * fetched kept on the device (`lvt2_board`) so the screen still shows something offline.
 * The app uses the one `board`, on the same cloud as the session; tests `configure` their own.
 */
export class BoardStore {
  private cloud: Cloud | null = null;
  private storage: Storage | undefined = defaultStorage();

  configure({ cloud, storage }: { cloud: Cloud; storage?: Storage }): void {
    this.cloud = cloud;
    this.storage = storage ?? defaultStorage();
  }

  private get c(): Cloud {
    this.cloud ??= defaultCloud();
    return this.cloud;
  }

  /** The board last fetched on this device, or null. */
  cached(): BoardRow[] | null {
    try {
      const raw = this.storage?.getItem(BOARD_KEY);
      if (raw == null) return null;
      const parsed: unknown = JSON.parse(raw);
      const rows = (parsed as { rows?: unknown }).rows;
      return Array.isArray(rows) ? rows.filter(validRow) : null;
    } catch {
      return null;
    }
  }

  async fetch(): Promise<BoardView> {
    const r = await this.c.board();
    if (Array.isArray(r)) {
      try {
        this.storage?.setItem(BOARD_KEY, JSON.stringify({ rows: r }));
      } catch {
        // Without storage there is no offline copy.
      }
      return { rows: r, online: true };
    }
    return { rows: this.cached() ?? [], online: false };
  }
}

/** The app's one board store. */
export const board = new BoardStore();
