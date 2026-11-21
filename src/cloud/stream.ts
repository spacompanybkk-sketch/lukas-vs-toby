import type { Connection, EventSourceLike } from './connection';
import { FAKE_DATABASE_URL, isAutomated } from './restClient';

/**
 * A stream of one database path over the REST API's `EventSource` streaming (spec 6.1). The
 * browser's own reconnect is never used: on an `error` or a `cancel` the source is closed and
 * our code opens a new one after a backoff (0.5 s doubling to 8 s, back to 0.5 s after the next
 * `open`), reading `query()` again so a reconnect asks only for what it lacks. When the page
 * becomes visible again it reopens at once.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type StreamEvent =
  | { kind: 'put' | 'patch'; path: string; data: Json }
  | { kind: 'open' }
  | { kind: 'down'; why: 'error' | 'cancel' };

/** Injected timers, so tests run on a virtual clock (the same shape as `src/net/channel.ts`'s). */
export interface Timers { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }

interface PageDoc {
  visibilityState?: string;
  addEventListener(t: 'visibilitychange', f: () => void): void;
  removeEventListener(t: 'visibilitychange', f: () => void): void;
}

export interface StreamOptions {
  conn: Connection;
  path: string;
  /** Read at every open (e.g. `{ orderBy: '$key', startAt: 't000042' }`). */
  query?: () => Record<string, string>;
  on(e: StreamEvent): void;
  timers?: Timers;
  /** The page, for `visibilitychange` (default: `document` when there is one). */
  doc?: PageDoc;
  backoff?: { firstMs: number; maxMs: number };
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class RtdbStream {
  private source: EventSourceLike | null = null;
  private timer: unknown = null;
  private closed = false;
  private failures = 0;
  private count = 0;
  private warned = false;
  private readonly timers: Timers;
  private readonly doc: PageDoc | undefined;
  private readonly backoff: { firstMs: number; maxMs: number };
  private readonly onVisible = (): void => {
    if (this.doc?.visibilityState === 'visible') this.reopen();
  };

  constructor(private readonly o: StreamOptions) {
    this.timers = o.timers ?? realTimers;
    this.backoff = o.backoff ?? { firstMs: 500, maxMs: 8000 };
    this.doc = o.doc ?? (typeof document === 'undefined' ? undefined : document);
    this.doc?.addEventListener('visibilitychange', this.onVisible);
    this.open();
  }

  /** How many sources this stream has opened. */
  get opens(): number { return this.count; }

  /** Closes the current source and opens a new one now (no backoff). */
  reopen(): void {
    if (this.closed) return;
    this.letGo();
    this.open();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.letGo();
    this.doc?.removeEventListener('visibilitychange', this.onVisible);
  }

  private letGo(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
  }

  private open(): void {
    const url = this.o.conn.url(this.o.path, this.o.query?.());
    // As RestCloud: a page under automation never reaches the children's live data.
    if (!url.startsWith(`${FAKE_DATABASE_URL}/`) && this.o.conn.root !== 'v2test' && isAutomated()) {
      if (!this.warned) console.warn('RtdbStream: automation may not use the live database; nothing is opened.');
      this.warned = true;
      return;
    }
    const es = this.o.conn.eventSource(url);
    this.source = es;
    this.count += 1;
    const mine = (): boolean => this.source === es;
    es.addEventListener('open', () => {
      if (!mine()) return;
      this.failures = 0;
      this.o.on({ kind: 'open' });
    });
    for (const kind of ['put', 'patch'] as const) {
      es.addEventListener(kind, (e) => {
        if (!mine()) return;
        let msg: unknown;
        try {
          msg = JSON.parse(e.data);
        } catch {
          msg = undefined;
        }
        if (!isObj(msg) || typeof msg.path !== 'string' || !('data' in msg)) {
          this.down('error');
          return;
        }
        this.o.on({ kind, path: msg.path, data: msg.data as Json });
      });
    }
    es.addEventListener('cancel', () => { if (mine()) this.down('cancel'); });
    // Firebase sends this when credentials stop being valid; we use none, so it is a cancel.
    es.addEventListener('auth_revoked', () => { if (mine()) this.down('cancel'); });
    es.onerror = () => { if (mine()) this.down('error'); };
  }

  /** The source failed: close it (so the browser never reconnects it) and open another later. */
  private down(why: 'error' | 'cancel'): void {
    this.letGo();
    const wait = Math.min(this.backoff.firstMs * 2 ** this.failures, this.backoff.maxMs);
    this.failures += 1;
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (!this.closed) this.open();
    }, wait);
    this.o.on({ kind: 'down', why });
  }
}
