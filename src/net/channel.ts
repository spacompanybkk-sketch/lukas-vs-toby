import type { Slot } from '../progress/save';
import type { Faction } from '../sim/types';

/**
 * The match channel (spec 6.1, 6.3, 8): how a lockstep match talks to the database. Types only;
 * the cloud lane implements it over REST + `EventSource`, tests over an in-memory transport.
 */

/** A write's outcome: stored, not reached (retry with the same value), or refused by the rules. */
export type WriteAnswer = 'ok' | 'offline' | 'refused';

/** The match's control records besides the turn logs (spec 6.3, 8.1). */
export type ControlRecord =
  | { kind: 'ready'; seat: Faction; at: number }
  | { kind: 'pause'; by: Slot; n: number } | { kind: 'resume' }
  | { kind: 'end'; seat: Faction; raw: string } // '{"w":"zombies","t":6120,"h":118734552}', < 100 chars
  | { kind: 'quit'; by: Slot }
  | { kind: 'sync'; n: 1 | 2 | 3; tick: number; snap: string }
  | { kind: 'again'; seat: Faction; value: 0 | 1 };

/** What a listener hears: a turn of either seat, a control record, the match deleted, the link up or down. */
export type MatchEvent =
  | { kind: 'turn'; seat: Faction; k: number; raw: string }
  | ControlRecord
  | { kind: 'gone' } // the match was deleted
  | { kind: 'link'; up: boolean };

/** Injected timers, so tests run on a virtual clock. */
export interface Timers { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }

export interface MatchChannel {
  /** Writes these own turns in one write; idempotent (the same value may be sent again). */
  publishTurns(seat: Faction, turns: readonly { k: number; raw: string }[]): Promise<WriteAnswer>;
  /** Writes a control record; `'resume'` deletes the pause record. `keepalive` lets it leave as the page hides. */
  write(rec: ControlRecord, opts?: { keepalive?: boolean }): Promise<WriteAnswer>;
  /** Deletes the whole match. */
  remove(): Promise<WriteAnswer>;
  /** Replays what is stored (turns from `from[seat]` on), then live events; returns the unsubscribe. */
  listen(from: Record<Faction, number>, on: (e: MatchEvent) => void): () => void;
}
