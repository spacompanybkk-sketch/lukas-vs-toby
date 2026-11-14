import type { Save, Slot } from '../progress/save';
import type { CardKey } from '../sim/types';

/** What anyone may see of a player: nickname and picture, nothing else. */
export interface PublicPlayer { slot: Slot; name: string; picture: CardKey }

/** A leaderboard row (one per player; the screen sorts it four ways). */
export interface BoardRow extends PublicPlayer {
  stars: number; wave: number; versusWins: number; computerWins: number; updatedAt: number;
}

/**
 * - `offline`: no answer (no network, a timeout, a server error); try again later.
 * - `wrong-pin`: the password (or the grown-up code) does not match.
 * - `taken`: that slot already has a player.
 * - `full`: all 30 slots have players.
 * - `refused`: the database said no for another reason, or sent something unreadable.
 */
export type CloudError = 'offline' | 'wrong-pin' | 'taken' | 'full' | 'refused';

/** A stored save with its version id (`ver`: 16 hex digits, new with every write). */
export interface SaveRecord { save: Save; ver: string }

export interface Cloud {
  listPlayers(): Promise<PublicPlayer[] | CloudError>;
  /** Claims the slot, stores its pin hash, the save (as version `ver`) and the board row in ONE multi-path update. */
  createPlayer(save: Save, hash: string, ver?: string): Promise<'ok' | CloudError>;
  /** The save at the player's hash; null = right hash, nothing stored; wrong hash → `wrong-pin`. */
  loadSave(slot: Slot, hash: string): Promise<Save | null | CloudError>;
  /** `loadSave` with the stored version id. */
  loadRecord(slot: Slot, hash: string): Promise<SaveRecord | null | CloudError>;
  /**
   * The save (as the new version `ver`) and its board row, in one update — a compare-and-swap:
   * it lands only if the stored version is `prev` (null: nothing stored yet). `conflict`: someone
   * else wrote first; reload, merge, try again.
   */
  writeSave(save: Save, hash: string, ver: string, prev: string | null): Promise<'ok' | 'conflict' | CloudError>;
  board(): Promise<BoardRow[] | CloudError>;
  /** Sets the grown-up code, only when none is set yet. */
  setGrownUpCode(hash: string): Promise<'ok' | CloudError>;
  /** Whether `hash` is the grown-up code (writes the harmless proof alone); a wrong one is `wrong-pin`. */
  checkGrownUpCode(hash: string): Promise<'ok' | CloudError>;
  /** Replaces the grown-up code, proven with the current one; a wrong one is `wrong-pin`. */
  changeGrownUpCode(oldHash: string, newHash: string): Promise<'ok' | CloudError>;
  deletePlayer(slot: Slot, grownUpHash: string): Promise<'ok' | CloudError>;
  /** A new pin for a player, behind the grown-up code; `save` becomes the player's save. */
  resetPin(slot: Slot, grownUpHash: string, newHash: string, save: Save, ver?: string): Promise<'ok' | CloudError>;
  /**
   * Whether the last read of this player's save found one stored that this build cannot read
   * (that read said `refused`). Optional: clouds that cannot tell leave it out.
   */
  unreadableSave?(slot: Slot, hash: string): Promise<boolean>;
}

export const isCloudError = (v: unknown): v is CloudError =>
  v === 'offline' || v === 'wrong-pin' || v === 'taken' || v === 'full' || v === 'refused';
