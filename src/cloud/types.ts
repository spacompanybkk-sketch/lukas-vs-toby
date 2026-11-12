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

export interface Cloud {
  listPlayers(): Promise<PublicPlayer[] | CloudError>;
  /** Claims the slot, stores its pin hash, the save and the board row in ONE multi-path update. */
  createPlayer(save: Save, hash: string): Promise<'ok' | CloudError>;
  /** The save at the player's hash; null = right hash, nothing stored; wrong hash → `wrong-pin`. */
  loadSave(slot: Slot, hash: string): Promise<Save | null | CloudError>;
  /** The save and its board row, in one update. */
  writeSave(save: Save, hash: string): Promise<'ok' | CloudError>;
  board(): Promise<BoardRow[] | CloudError>;
  /** Sets the grown-up code, only when none is set yet. */
  setGrownUpCode(hash: string): Promise<'ok' | CloudError>;
  /** Replaces the grown-up code, proven with the current one; a wrong one is `wrong-pin`. */
  changeGrownUpCode(oldHash: string, newHash: string): Promise<'ok' | CloudError>;
  deletePlayer(slot: Slot, grownUpHash: string): Promise<'ok' | CloudError>;
  /** A new pin for a player, behind the grown-up code; `save` becomes the player's save. */
  resetPin(slot: Slot, grownUpHash: string, newHash: string, save: Save): Promise<'ok' | CloudError>;
}

export const isCloudError = (v: unknown): v is CloudError =>
  v === 'offline' || v === 'wrong-pin' || v === 'taken' || v === 'full' || v === 'refused';
