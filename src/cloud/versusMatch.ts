import type { ControlRecord, MatchChannel, MatchEvent, WriteAnswer } from '../net/channel';
import { parseTurnKey, turnKey } from '../net/turnCodec';
import { isSlot } from '../progress/save';
import type { Slot } from '../progress/save';
import type { Faction } from '../sim/types';
import type { Connection } from './connection';
import { FAKE_DATABASE_URL, TIMEOUT_MS, isAutomated } from './restClient';
import { RtdbStream } from './stream';
import type { Json, StreamEvent, StreamOptions, Timers } from './stream';
import { readMeta } from './versusLobby';
import type { MatchMeta } from './versusLobby';

/**
 * The match channel over the Realtime Database (spec 6.1, 6.3, 8): REST writes with `fetch`, and
 * while listening exactly two `EventSource` streams:
 * - `turns/<other seat>`, ranged `orderBy="$key"&startAt=<first turn not yet heard>`, so a
 *   reopen asks only for what this device lacks. Its `put '/'` after a reopen carries only that
 *   range: it is merged into what was heard, never taken as the whole log.
 * - the match root, ranged `orderBy="$key"&endAt="sync"`: every control node (`again`, `end`,
 *   `meta`, `pause`, `quit`, `ready`, `sync`) and never `turns`. Its range never changes, so its
 *   `put '/'` is the whole truth about the control nodes: it replaces what is held, and the
 *   difference becomes events (a pause gone while the stream was down is a `resume`; the root
 *   gone, or its `meta` removed, is `gone`).
 * Own turns are not streamed: a device that must read its own log back (rejoin) uses `readMatch`.
 *
 * Writes are idempotent (8.4): a write whose answer was lost is sent again by the caller with the
 * same value. Most write-once rules take the very same value again; `ready` (the server's clock)
 * cannot, and a write racing another device's may lose: so a refused write-once write reads the
 * node back, and when it holds what this device wrote (for `ready`: any time) the answer is `ok`.
 * Writes to the `pause` node leave this device in the order they were made, so a `resume` never
 * overtakes the pause it ends.
 */

export interface StoredMatch { meta: MatchMeta; turns: Record<Faction, Map<number, string>>; control: ControlRecord[] }

export interface CloudMatchOptions {
  conn: Connection;
  /** The match id (32 hex digits). */
  id: string;
  /** This device's seat and player. */
  seat: Faction;
  me: Slot;
  timers?: Timers;
  /** The page, for the streams' `visibilitychange` (default: `document` when there is one). */
  doc?: StreamOptions['doc'];
}

const SV = Object.freeze({ '.sv': 'timestamp' });
const ID_RE = /^[0-9a-f]{32}$/;
const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
const SYNC_NS = [1, 2, 3] as const;

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

type Obj = { [k: string]: Json };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const segments = (path: string): string[] => path.split('/').filter((p) => p.length > 0);
const other = (f: Faction): Faction => (f === 'plants' ? 'zombies' : 'plants');

/** `tree` with `value` at `segs`; null deletes, an emptied object becomes null (as the database stores). */
function setAt(tree: Json, segs: readonly string[], value: Json): Json {
  if (segs.length === 0) return value;
  const out: Obj = isObj(tree) ? { ...tree } : {};
  const [k, ...rest] = segs as [string, ...string[]];
  const child = setAt(out[k] ?? null, rest, value);
  if (child === null) delete out[k];
  else out[k] = child;
  return Object.keys(out).length === 0 ? null : out;
}

/** The control records a match root holds, keyed by node, in a fixed order (ready, sync, pause, quit, end, again). */
function controlsOf(tree: Json): Map<string, ControlRecord> {
  const out = new Map<string, ControlRecord>();
  if (!isObj(tree)) return out;
  const { ready, sync, pause, quit, end, again } = tree;
  for (const seat of FACTIONS) {
    const at = isObj(ready) ? ready[seat] : undefined;
    if (typeof at === 'number') out.set(`ready/${seat}`, { kind: 'ready', seat, at });
  }
  for (const n of SYNC_NS) {
    const s = isObj(sync) ? sync[`s${n}`] : undefined;
    if (isObj(s) && isWhole(s.tick) && typeof s.snap === 'string') out.set(`sync/s${n}`, { kind: 'sync', n, tick: s.tick, snap: s.snap });
  }
  if (isObj(pause) && typeof pause.by === 'string' && isSlot(pause.by) && isWhole(pause.n)) {
    out.set('pause', { kind: 'pause', by: pause.by, n: pause.n });
  }
  if (isObj(quit) && typeof quit.by === 'string' && isSlot(quit.by)) out.set('quit', { kind: 'quit', by: quit.by });
  for (const seat of FACTIONS) {
    const raw = isObj(end) ? end[seat] : undefined;
    if (typeof raw === 'string') out.set(`end/${seat}`, { kind: 'end', seat, raw });
  }
  for (const seat of FACTIONS) {
    const v = isObj(again) ? again[seat] : undefined;
    if (v === 0 || v === 1) out.set(`again/${seat}`, { kind: 'again', seat, value: v });
  }
  return out;
}

/** A control record's node below the match and the value written there (`resume`: the pause deleted). */
function controlWire(rec: ControlRecord): [node: string, value: Json] {
  switch (rec.kind) {
    case 'ready': return [`ready/${rec.seat}`, SV]; // the database's clock, as the rules want
    case 'pause': return ['pause', { by: rec.by, n: rec.n }];
    case 'resume': return ['pause', null];
    case 'end': return [`end/${rec.seat}`, rec.raw];
    case 'quit': return ['quit', { by: rec.by }];
    case 'sync': return [`sync/s${rec.n}`, { tick: rec.tick, snap: rec.snap }];
    case 'again': return [`again/${rec.seat}`, rec.value];
  }
}

type Answer = { kind: 'ok'; data: unknown } | { kind: 'offline' } | { kind: 'refused' };

/** One REST call with the 5 s timeout: ok, offline (no answer, a server error) or refused. */
async function request(
  conn: Connection, timers: Timers, method: 'GET' | 'PATCH' | 'DELETE', path: string,
  opts: { body?: Obj; query?: Record<string, string>; keepalive?: boolean } = {},
): Promise<Answer> {
  const url = conn.url(path, opts.query);
  // As RestCloud: a page under automation never reaches the children's live data.
  if (!url.startsWith(`${FAKE_DATABASE_URL}/`) && conn.root !== 'v2test' && isAutomated()) return { kind: 'refused' };
  const controller = new AbortController();
  const timer = timers.set(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await conn.fetch(url, {
      method,
      signal: controller.signal,
      ...(opts.keepalive ? { keepalive: true } : {}),
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body), headers: { 'Content-Type': 'application/json' } }),
    });
    if (res.status >= 500 || res.status === 429 || res.status === 408) return { kind: 'offline' };
    if (!res.ok) return { kind: 'refused' };
    return { kind: 'ok', data: await res.json() };
  } catch {
    return { kind: 'offline' };
  } finally {
    timers.clear(timer);
  }
}

export class CloudMatchChannel implements MatchChannel {
  readonly seat: Faction;
  readonly me: Slot;
  private readonly conn: Connection;
  private readonly base: string;
  private readonly timers: Timers;
  private readonly doc: StreamOptions['doc'];
  /** Writes to the `pause` node, one after another. */
  private pauseQueue: Promise<unknown> = Promise.resolve();

  constructor(o: CloudMatchOptions) {
    if (!ID_RE.test(o.id)) throw new RangeError('a match id is 32 lowercase hex digits');
    this.conn = o.conn;
    this.base = `vs/matches/${o.id}`;
    this.seat = o.seat;
    this.me = o.me;
    this.timers = o.timers ?? realTimers;
    this.doc = o.doc;
  }

  /** One root PATCH of `vs/matches/<id>/turns/<seat>/t…` entries. */
  async publishTurns(seat: Faction, turns: readonly { k: number; raw: string }[]): Promise<WriteAnswer> {
    if (turns.length === 0) return 'ok';
    const body: Obj = {};
    for (const { k, raw } of turns) body[`${this.base}/turns/${seat}/${turnKey(k)}`] = raw;
    const a = await request(this.conn, this.timers, 'PATCH', '', { body });
    if (a.kind !== 'refused') return a.kind;
    // A refusal may be a retry losing to nothing but the rules' view of it: read the log back.
    const keys = turns.map((t) => turnKey(t.k)).sort();
    const back = await request(this.conn, this.timers, 'GET', `${this.base}/turns/${seat}`, {
      query: { orderBy: '$key', startAt: keys[0]!, endAt: keys[keys.length - 1]! },
    });
    if (back.kind !== 'ok') return back.kind;
    const held = isObj(back.data) ? back.data : {};
    return turns.every((t) => held[turnKey(t.k)] === t.raw) ? 'ok' : 'refused';
  }

  write(rec: ControlRecord, opts?: { keepalive?: boolean }): Promise<WriteAnswer> {
    if (rec.kind !== 'pause' && rec.kind !== 'resume') return this.writeNode(rec, opts);
    const p = this.pauseQueue.then(() => this.writeNode(rec, opts));
    this.pauseQueue = p.catch(() => undefined);
    return p;
  }

  private async writeNode(rec: ControlRecord, opts?: { keepalive?: boolean }): Promise<WriteAnswer> {
    const [node, value] = controlWire(rec);
    const path = `${this.base}/${node}`;
    const a = await request(this.conn, this.timers, 'PATCH', '', { body: { [path]: value }, keepalive: opts?.keepalive === true });
    if (a.kind !== 'refused' || rec.kind === 'pause' || rec.kind === 'resume') return a.kind;
    // Write-once: refused, unless the node already holds this very write (an earlier try whose
    // answer was lost, or for `ready` any earlier try: its time is the server's).
    const back = await request(this.conn, this.timers, 'GET', path);
    if (back.kind !== 'ok') return back.kind;
    if (rec.kind === 'ready') return typeof back.data === 'number' ? 'ok' : 'refused';
    return JSON.stringify(back.data) === JSON.stringify(value) ? 'ok' : 'refused';
  }

  async remove(): Promise<WriteAnswer> {
    const a = await request(this.conn, this.timers, 'DELETE', this.base);
    return a.kind;
  }

  listen(from: Record<Faction, number>, on: (e: MatchEvent) => void): () => void {
    const them = other(this.seat);
    let live = true;
    const emit = (e: MatchEvent): void => { if (live) on(e); };

    // The other seat's turns heard by this listener; the next reopen starts at the first one lacking.
    const heard = new Set<number>();
    const firstMissing = (): number => {
      let k = from[them];
      while (heard.has(k)) k++;
      return k;
    };
    const takeTurns = (entries: [string, Json][]): void => {
      const fresh: { k: number; raw: string }[] = [];
      for (const [key, raw] of entries) {
        const k = parseTurnKey(key);
        if (k === null || k < from[them] || typeof raw !== 'string' || heard.has(k)) continue;
        heard.add(k);
        fresh.push({ k, raw });
      }
      fresh.sort((a, b) => a.k - b.k);
      for (const t of fresh) emit({ kind: 'turn', seat: them, k: t.k, raw: t.raw });
    };
    const onTurns = (e: StreamEvent): void => {
      if (e.kind !== 'put' && e.kind !== 'patch') return;
      const segs = segments(e.path);
      if (segs.length === 0) {
        // A put at '/' carries only the range asked for: merged, never replacing (a null is "none in range").
        if (isObj(e.data)) takeTurns(Object.entries(e.data));
      } else if (segs.length === 1) {
        takeTurns([[segs[0]!, e.data]]);
      }
    };

    // The control nodes as last heard; the root's range never changes, so a put at '/' replaces.
    let controls: Json = null;
    let gone = false;
    const onRoot = (e: StreamEvent): void => {
      if (e.kind !== 'put' && e.kind !== 'patch') return;
      if (gone) return;
      if (e.kind === 'put' && segments(e.path).length === 0 && e.data === null) {
        gone = true;
        emit({ kind: 'gone' });
        return;
      }
      let next = controls;
      if (e.kind === 'put') next = setAt(next, segments(e.path), e.data);
      else if (isObj(e.data)) for (const [k, v] of Object.entries(e.data)) next = setAt(next, [...segments(e.path), ...segments(k)], v);
      // The database may announce a deletion as one whole-root null or as per-child removals: meta
      // (write-once, so it only ever disappears with the match) going from there to none is `gone` too.
      if (isObj(controls) && controls.meta !== undefined && !(isObj(next) && next.meta !== undefined)) {
        gone = true;
        emit({ kind: 'gone' });
        return;
      }
      const was = controlsOf(controls);
      const is = controlsOf(next);
      controls = next;
      for (const [node, rec] of is) {
        const before = was.get(node);
        if (before === undefined || JSON.stringify(before) !== JSON.stringify(rec)) emit(rec);
      }
      if (was.has('pause') && !is.has('pause')) emit({ kind: 'resume' });
    };

    // The link is up once both streams have delivered data since their last failure.
    const up = { turns: false, root: false };
    let linked = false;
    const link = (which: keyof typeof up, isUp: boolean): void => {
      up[which] = isUp;
      const now = up.turns && up.root;
      if (now !== linked) {
        linked = now;
        emit({ kind: 'link', up: now });
      }
    };
    const watch = (which: keyof typeof up, handle: (e: StreamEvent) => void) => (e: StreamEvent): void => {
      if (!live) return;
      if (e.kind === 'down') link(which, false);
      else if (e.kind === 'put' || e.kind === 'patch') {
        handle(e);
        link(which, true);
      }
    };

    // `on` may run inside a constructor (a refused factory): it never touches the stream variables.
    const common = { conn: this.conn, timers: this.timers, ...(this.doc ? { doc: this.doc } : {}) };
    const turns = new RtdbStream({
      ...common, path: `${this.base}/turns/${them}`,
      query: () => ({ orderBy: '$key', startAt: turnKey(firstMissing()) }),
      on: watch('turns', onTurns),
    });
    const root = new RtdbStream({
      ...common, path: this.base,
      query: () => ({ orderBy: '$key', endAt: 'sync' }),
      on: watch('root', onRoot),
    });
    return () => {
      live = false;
      turns.close();
      root.close();
    };
  }
}

/** One GET of the whole match (rejoin): meta, both turn logs and the control records; null when there is none. */
export async function readMatch(conn: Connection, id: string, timers: Timers = realTimers): Promise<StoredMatch | null | 'offline'> {
  if (!ID_RE.test(id)) return null;
  const a = await request(conn, timers, 'GET', `vs/matches/${id}`);
  if (a.kind === 'offline') return 'offline';
  if (a.kind !== 'ok' || !isObj(a.data)) return null;
  const meta = readMeta(a.data.meta);
  if (meta === null) return null;
  const turns: Record<Faction, Map<number, string>> = { plants: new Map(), zombies: new Map() };
  const logs = a.data.turns;
  for (const seat of FACTIONS) {
    const log = isObj(logs) ? logs[seat] : undefined;
    if (!isObj(log)) continue;
    const entries = Object.entries(log)
      .map(([key, raw]) => [parseTurnKey(key), raw] as const)
      .filter((e): e is readonly [number, string] => e[0] !== null && typeof e[1] === 'string')
      .sort((x, y) => x[0] - y[0]);
    for (const [k, raw] of entries) turns[seat].set(k, raw);
  }
  return { meta, turns, control: [...controlsOf(a.data).values()] };
}
