import { signal } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import { isSlot } from '../progress/save';
import type { Slot } from '../progress/save';
import type { Faction } from '../sim/types';
import type { Connection } from './connection';
import { FAKE_DATABASE_URL, TIMEOUT_MS, isAutomated } from './restClient';
import { RtdbStream } from './stream';
import type { Json, StreamEvent, Timers } from './stream';
import { PUB_RE } from './versusKeys';
import type { KeyPair } from './versusKeys';

/**
 * The Versus lobby (spec 5, 7, 8): "who is here", invites with ECDH public keys, replies, and
 * creating the match in the same update as the accepting reply. Plain REST writes and two
 * `EventSource` streams (`vs/here` and `vs/lobby/<me>`, spec 6.1), no SDK, no auth: each write
 * that must come from a player carries his pin proof (`proof/<me>/<hash>/touch = now`, 7.2).
 *
 * Every proof-carrying write of this device goes through one queue: the rules refuse a proof the
 * database already stored in the same millisecond, so two in parallel would refuse each other. A
 * refusal is tried once more a beat later; a write-once `meta` refused is read back (8.4).
 *
 * Ages (here 40 s, invites and replies 60 s) are measured on the database's clock: the `at` of
 * this device's own last heartbeat as it came back on the stream, plus the local time since
 * (8.5). Records are never trusted for merely existing: an old one is simply not listed.
 */

// The same shapes as lane vs-net's `src/net/channel.ts` (`WriteAnswer`), `src/ai/versus.ts`
// (`HeadStart`) and `src/net/timeouts.ts` (`VersusTimeouts`), which this branch does not have yet;
// structurally equal, so `VS_TIMEOUTS` and the net types fit here as they are.
type WriteAnswer = 'ok' | 'offline' | 'refused';
type HeadStep = 0 | 1 | 2 | 3 | 4 | 5;
interface HeadStart { slot: Slot; step: HeadStep }
/** The lobby's part of `VersusTimeouts` (spec 6.8). */
interface LobbyTimeouts { heartbeatMs: number; hereMs: number; inviteMs: number }
const LOBBY_TIMEOUTS: LobbyTimeouts = Object.freeze({ heartbeatMs: 15000, hereMs: 40000, inviteMs: 60000 });

export interface HereEntry { slot: Slot; at: number; busy: boolean }
export interface Invite { from: Slot; pub: string; side: Faction /* the inviter's */; head: HeadStart | null; build: string; at: number }
export interface Reply { from: Slot; ok: boolean; pub: string | null; build: string; at: number }
export interface MatchMeta {
  v: 1; build: string; seed: number; seats: Record<Faction, Slot>; host: Slot; head: HeadStart | null;
  turn: 6; delay: number; test: number | null; created: number;
}
export interface LobbyDeps {
  conn: Connection;
  me: Slot;
  /** The logged-in player's pin hash (`session.proofHash()`), or null. */
  proof(): string | null;
  build: string;
  /** This device's own clock (may be wrong; only differences of it are used). */
  now?: () => number;
  timers?: Timers;
  timeouts?: LobbyTimeouts;
}

const SV = Object.freeze({ '.sv': 'timestamp' });
const HASH_RE = /^[0-9a-f]{64}$/;
const BUILD_RE = /^[0-9a-f]{7,12}$/;
/** A refused proof-carrying write is tried once more after this pause (a new server millisecond). */
const RETRY_GAP_MS = 50;
/** Heartbeat round trips kept for the input delay (spec 6.2, plan ruling 5). */
const MAX_ROUND_TRIPS = 8;

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

type Obj = { [k: string]: Json };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWhole = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isFaction = (v: unknown): v is Faction => v === 'plants' || v === 'zombies';
const segments = (path: string): string[] => path.split('/').filter((p) => p.length > 0);

/** `tree` with `value` at `segs`; a null value deletes, and an emptied object becomes null (as the database stores). */
function setAt(tree: Json, segs: readonly string[], value: Json): Json {
  if (segs.length === 0) return value;
  const out: Obj = isObj(tree) ? { ...tree } : {};
  const [k, ...rest] = segs as [string, ...string[]];
  const child = setAt(out[k] ?? null, rest, value);
  if (child === null) delete out[k];
  else out[k] = child;
  return Object.keys(out).length === 0 ? null : out;
}

/**
 * A stream event applied to what we hold. The lobby's streams are never ranged, so a `put` at `/`
 * (an open or a reopen) is the whole truth and replaces; anything deeper is merged in.
 */
function applyEvent(tree: Json, e: StreamEvent): Json {
  if (e.kind === 'put') return setAt(tree, segments(e.path), e.data);
  if (e.kind === 'patch' && isObj(e.data)) {
    let t = tree;
    for (const [k, v] of Object.entries(e.data)) t = setAt(t, [...segments(e.path), ...segments(k)], v);
    return t;
  }
  return tree;
}

function readHead(raw: unknown, may: readonly Slot[]): HeadStart | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw) || Object.keys(raw).length !== 2) return undefined;
  const { slot, step } = raw;
  if (!isSlot(slot) || !may.includes(slot) || !isWhole(step, 0, 5)) return undefined;
  return { slot, step: step as HeadStep };
}

const META_KEYS = new Set(['v', 'build', 'seed', 'seats', 'host', 'head', 'turn', 'delay', 'test', 'created']);

/** A match's `meta` as stored (head and test absent when null), or null when anything is off. */
export function readMeta(raw: unknown): MatchMeta | null {
  if (!isObj(raw) || Object.keys(raw).some((k) => !META_KEYS.has(k))) return null;
  const { v, build, seed, seats, host, turn, delay, test, created } = raw;
  if (v !== 1 || typeof build !== 'string' || !BUILD_RE.test(build) || !Number.isSafeInteger(seed)) return null;
  if (!isObj(seats) || Object.keys(seats).length !== 2) return null;
  const { plants, zombies } = seats;
  if (!isSlot(plants) || !isSlot(zombies) || plants === zombies) return null;
  if (host !== plants && host !== zombies) return null;
  const head = readHead(raw.head, [plants, zombies]);
  if (head === undefined || turn !== 6 || !isWhole(delay, 9, 30)) return null;
  if (test !== undefined && test !== null && !isWhole(test, 1, 500)) return null;
  if (typeof created !== 'number' || !Number.isFinite(created)) return null;
  return {
    v: 1, build, seed: seed as number, seats: { plants, zombies }, host, head, turn: 6, delay,
    test: typeof test === 'number' ? test : null, created,
  };
}

/** `meta` as it is written: no nulls (the database would drop them), `created` the server's clock. */
function metaToWire(m: MatchMeta): Obj {
  return {
    v: 1, build: m.build, seed: m.seed, seats: { plants: m.seats.plants, zombies: m.seats.zombies }, host: m.host,
    ...(m.head ? { head: { slot: m.head.slot, step: m.head.step } } : {}),
    turn: 6, delay: m.delay,
    ...(m.test !== null ? { test: m.test } : {}),
    created: SV,
  };
}

/** Whether a stored meta is the one we wrote (everything but the server's `created`). */
function sameMeta(a: MatchMeta, b: MatchMeta): boolean {
  // Both in the wire's fixed key order, `created` as the same placeholder.
  return JSON.stringify(metaToWire(a)) === JSON.stringify(metaToWire(b));
}

type Answer = { kind: 'ok'; data: unknown } | { kind: 'offline' } | { kind: 'refused' };

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class VersusLobby {
  private readonly hereList: Signal<HereEntry[]> = signal<HereEntry[]>([]);
  private readonly inboxList: Signal<Invite[]> = signal<Invite[]>([]);
  private readonly replyList: Signal<Reply[]> = signal<Reply[]>([]);
  /** Others whose heartbeat is under 40 s old on the database's clock; empty until our own first echo. */
  readonly here: ReadonlySignal<HereEntry[]> = this.hereList;
  /** Invites to me under 60 s old. */
  readonly inbox: ReadonlySignal<Invite[]> = this.inboxList;
  /** Answers to my invites under 60 s old. */
  readonly replies: ReadonlySignal<Reply[]> = this.replyList;

  private readonly me: Slot;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly t: LobbyTimeouts;
  private busy = false;
  private started = false;
  /** Bumped by start and stop, so a late answer from an earlier start opens nothing. */
  private generation = 0;
  private beatTimer: unknown = null;
  private expiryTimer: unknown = null;
  private streams: RtdbStream[] = [];
  private hereTree: Json = null;
  private lobbyTree: Json = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly trips: number[] = [];
  /** Local send time of the latest heartbeat the database answered ok. */
  private okSentLocal: number | null = null;
  /** The newest `at` of our own heartbeat seen on the stream, and when (local clock) it arrived. */
  private seen: { at: number; local: number } | null = null;
  /** The echo the server's clock is taken from (8.5). */
  private echo: { at: number; local: number } | null = null;

  constructor(private readonly d: LobbyDeps) {
    this.me = d.me;
    this.now = d.now ?? (() => Date.now());
    this.timers = d.timers ?? realTimers;
    this.t = d.timeouts ?? LOBBY_TIMEOUTS;
  }

  /** Heartbeat now and every 15 s; streams `vs/here` and `vs/lobby/<me>` once a heartbeat is answered `ok`. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const gen = ++this.generation;
    this.beat(gen);
  }

  /** Closes both streams and stops the heartbeat (the record ages out on the other devices). */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.generation += 1;
    if (this.beatTimer !== null) this.timers.clear(this.beatTimer);
    if (this.expiryTimer !== null) this.timers.clear(this.expiryTimer);
    this.beatTimer = this.expiryTimer = null;
    for (const s of this.streams) s.close();
    this.streams = [];
  }

  /** `busy: true` while in a battle (nobody can invite him then); written at once. */
  setBusy(busy: boolean): Promise<WriteAnswer> {
    this.busy = busy;
    return this.heartbeat();
  }

  /** The database's clock: our own last echoed heartbeat `at` plus the local time since; null before the first echo. */
  serverNow(): number | null {
    return this.echo === null ? null : this.echo.at + (this.now() - this.echo.local);
  }

  /** Heartbeat PATCH round trips in ms, newest last, at most 8. */
  roundTrips(): readonly number[] {
    return [...this.trips];
  }

  invite(to: Slot, keys: KeyPair, side: Faction, head: HeadStart | null): Promise<WriteAnswer> {
    if (!isSlot(to) || to === this.me) return Promise.resolve('refused');
    return this.enqueue(() => this.sendProven({
      [`vs/lobby/${to}/in/${this.me}`]: {
        pub: keys.pub, side, ...(head ? { head: { slot: head.slot, step: head.step } } : {}), build: this.d.build, at: SV,
      },
    }));
  }

  cancel(to: Slot): Promise<WriteAnswer> {
    if (!isSlot(to) || to === this.me) return Promise.resolve('refused');
    return this.enqueue(() => this.sendProven({ [`vs/lobby/${to}/in/${this.me}`]: null }));
  }

  /**
   * No: `{ ok: false }` into the inviter's replies, and the invite out of my inbox, in one update.
   * The rules take a reply only while the invite exists and only in the update that deletes it, so
   * when the invite is already gone (another device of mine answered it, or the inviter took it
   * back) there is nothing to decline: the answer is a quiet `ok` and nothing is written.
   */
  decline(from: Slot): Promise<WriteAnswer> {
    if (!isSlot(from) || from === this.me) return Promise.resolve('refused');
    const body: Obj = {
      [`vs/lobby/${from}/back/${this.me}`]: { ok: false, build: this.d.build, at: SV },
      [`vs/lobby/${this.me}/in/${from}`]: null,
    };
    return this.enqueue(async () => {
      // Checked before each try and after the last refusal; a refusal is tried once more a beat later.
      for (let attempt = 0; ; attempt++) {
        const still = await this.inviteStill(from, null);
        if (still === 'offline') return 'offline';
        if (still === 'gone') return 'ok';
        if (attempt === 2) return 'refused';
        if (attempt === 1) await this.pause(RETRY_GAP_MS);
        const a = await this.sendOnce(body);
        if (a !== 'refused') return a;
      }
    });
  }

  /** Whether the invite from `from` is still in my inbox (the very one `inv`, when given). */
  private async inviteStill(from: Slot, inv: Invite | null): Promise<'there' | 'gone' | 'offline'> {
    const a = await this.request('GET', `vs/lobby/${this.me}/in/${from}`);
    if (a.kind === 'offline') return 'offline';
    if (a.kind !== 'ok' || !isObj(a.data)) return 'gone';
    if (inv !== null && (a.data.pub !== inv.pub || a.data.at !== inv.at)) return 'gone';
    return 'there';
  }

  /**
   * Yes: my reply with my public key, the match's `meta` at `id` and the invite out of my inbox,
   * in ONE update. `taken` when the invite is no longer there to accept (another device of mine
   * answered it, or the inviter took it back) or a different `meta` already sits at `id`; then
   * nothing is written. A refusal of my own retry (a lost answer) reads back as `ok`.
   */
  accept(inv: Invite, keys: KeyPair, meta: MatchMeta, id: string): Promise<WriteAnswer | 'taken'> {
    if (!/^[0-9a-f]{32}$/.test(id) || !isSlot(inv.from) || inv.from === this.me) return Promise.resolve('refused');
    const metaPath = `vs/matches/${id}/meta`;
    /** What is at `id` now: ours (`ok`), someone else's (`taken`), nothing (null). */
    const there = async (): Promise<'ok' | 'taken' | 'offline' | null> => {
      const a = await this.request('GET', metaPath);
      if (a.kind !== 'ok') return 'offline';
      if (a.data === null) return null;
      const m = readMeta(a.data);
      return m !== null && sameMeta(m, meta) ? 'ok' : 'taken';
    };
    return this.enqueue(async () => {
      const [mine, still] = await Promise.all([there(), this.inviteStill(inv.from, inv)]);
      if (mine === 'ok' || mine === 'taken') return mine;
      if (mine === 'offline' || still === 'offline') return 'offline';
      // The invite is gone or another one: answered elsewhere, or taken back.
      if (still === 'gone') return 'taken';
      const body: Obj = {
        [`vs/lobby/${inv.from}/back/${this.me}`]: { ok: true, pub: keys.pub, build: this.d.build, at: SV },
        [`vs/lobby/${this.me}/in/${inv.from}`]: null,
        [metaPath]: metaToWire(meta),
      };
      for (let attempt = 0; ; attempt++) {
        const a = await this.sendOnce(body);
        if (a !== 'refused') return a;
        const after = await there();
        if (after === 'ok' || after === 'taken' || after === 'offline') return after;
        // Refused with no meta of ours: another device of mine answered first (the rules take a
        // reply only while the invite exists, in the update that deletes it). Close quietly.
        const now = await this.inviteStill(inv.from, inv);
        if (now === 'offline') return 'offline';
        if (now === 'gone') return 'taken';
        if (attempt === 1) return 'refused';
        await this.pause(RETRY_GAP_MS);
      }
    });
  }

  /**
   * Writes a match's `meta` at `id` with this player's proof in the same update, for a match that
   * needs no invite (a rematch). `taken` when a different `meta` already sits there; a refusal is
   * read back (a retry of a lost answer reads as `ok`) and tried once more a beat later.
   */
  createMatch(meta: MatchMeta, id: string): Promise<WriteAnswer | 'taken'> {
    if (!/^[0-9a-f]{32}$/.test(id)) return Promise.resolve('refused');
    const metaPath = `vs/matches/${id}/meta`;
    return this.enqueue(async () => {
      for (let attempt = 0; ; attempt++) {
        const a = await this.sendOnce({ [metaPath]: metaToWire(meta) });
        if (a !== 'refused') return a;
        const back = await this.request('GET', metaPath);
        if (back.kind !== 'ok') return back.kind;
        if (back.data !== null) {
          const held = readMeta(back.data);
          return held !== null && sameMeta(held, meta) ? 'ok' : 'taken';
        }
        if (attempt === 2) return 'refused';
        await this.pause(RETRY_GAP_MS);
      }
    });
  }

  /** Removes the reply `from` left in my lobby. */
  clearReply(from: Slot): Promise<WriteAnswer> {
    if (!isSlot(from) || from === this.me) return Promise.resolve('refused');
    return this.enqueue(() => this.sendProven({ [`vs/lobby/${this.me}/back/${from}`]: null }));
  }

  /** Who may play Versus: p01, p02 and every slot the grown-up ticked in. */
  async allowed(): Promise<ReadonlySet<Slot> | 'offline'> {
    const a = await this.request('GET', 'vs/allowed');
    if (a.kind !== 'ok') return 'offline';
    const out = new Set<Slot>(['p01', 'p02']);
    if (isObj(a.data)) for (const [k, v] of Object.entries(a.data)) if (isSlot(k) && v === true) out.add(k);
    return out;
  }

  /**
   * Ticks a player in or out (the grown-up screen), with the grown-up proof. Ticked out, his
   * "here" record and his lobby go in the same update, so he leaves the list at once.
   */
  setAllowed(slot: Slot, on: boolean, grownUpHash: string): Promise<WriteAnswer> {
    if (!isSlot(slot) || slot === 'p01' || slot === 'p02' || !HASH_RE.test(grownUpHash)) return Promise.resolve('refused');
    const body: Obj = {
      [`vs/allowed/${slot}`]: on ? true : null,
      ...(on ? {} : { [`vs/here/${slot}`]: null, [`vs/lobby/${slot}`]: null }),
      [`admin/proof/${grownUpHash}`]: { touch: SV },
    };
    return this.enqueue(async () => {
      const a = await this.write(body);
      if (a !== 'refused') return a;
      // A wrong code is not tried again: the proof alone (whose rule has no same-millisecond
      // check) tells a wrong code from a proof stored in this very millisecond.
      const code = await this.write({ [`admin/proof/${grownUpHash}`]: { touch: SV } });
      if (code !== 'ok') return code;
      await this.pause(RETRY_GAP_MS);
      return this.write(body);
    });
  }

  // ---- heartbeat and streams ----

  private beat(gen: number): void {
    if (gen !== this.generation) return;
    this.beatTimer = this.timers.set(() => this.beat(gen), this.t.heartbeatMs);
    void this.heartbeat();
  }

  private heartbeat(): Promise<WriteAnswer> {
    return this.enqueue(() => this.sendProven({ [`vs/here/${this.me}`]: { at: SV, busy: this.busy } }, (sent, ms) => {
      this.trips.push(ms);
      if (this.trips.length > MAX_ROUND_TRIPS) this.trips.shift();
      this.okSentLocal = Math.max(this.okSentLocal ?? sent, sent);
      // The streams open on the first heartbeat the database took: a player it refuses (not on
      // the Versus list) holds none.
      if (this.started) this.openStreams();
      this.takeEcho();
    }));
  }

  /** Two streams while started (spec 6.1): `vs/here` and `vs/lobby/<me>`. */
  private openStreams(): void {
    if (this.streams.length > 0) return;
    // `on` may run inside the constructor (a refused factory), so it never touches the stream itself.
    this.streams = [
      new RtdbStream({ conn: this.d.conn, path: 'vs/here', timers: this.timers, on: (e) => {
        this.hereTree = applyEvent(this.hereTree, e);
        this.noteOwn();
        this.refresh();
      } }),
      new RtdbStream({ conn: this.d.conn, path: `vs/lobby/${this.me}`, timers: this.timers, on: (e) => {
        this.lobbyTree = applyEvent(this.lobbyTree, e);
        this.refresh();
      } }),
    ];
  }

  /** Our own heartbeat as the stream shows it: a newer `at` is a candidate echo. */
  private noteOwn(): void {
    const mine = isObj(this.hereTree) ? this.hereTree[this.me] : undefined;
    const at = isObj(mine) ? mine.at : undefined;
    if (typeof at !== 'number' || (this.seen !== null && at <= this.seen.at)) return;
    this.seen = { at, local: this.now() };
    this.takeEcho();
  }

  /**
   * The server's clock is taken from an `at` that arrived after a heartbeat we know landed was
   * sent: so never from a record left by an earlier visit, and never from a reopened stream
   * repeating an `at` we already hold.
   */
  private takeEcho(): void {
    const s = this.seen;
    if (s === null || this.okSentLocal === null || s.local < this.okSentLocal) return;
    if (this.echo !== null && s.at <= this.echo.at) return;
    this.echo = s;
    this.refresh();
  }

  /** Recomputes the three lists from what we hold and the server's clock, and wakes up at the next expiry. */
  private refresh(): void {
    if (this.expiryTimer !== null) this.timers.clear(this.expiryTimer);
    this.expiryTimer = null;
    const now = this.serverNow();
    const here: HereEntry[] = [];
    const inbox: Invite[] = [];
    const replies: Reply[] = [];
    let next = Infinity;
    const fresh = (at: number, limit: number): boolean => {
      if (now === null || now - at >= limit) return false;
      next = Math.min(next, at + limit - now);
      return true;
    };
    if (isObj(this.hereTree)) {
      for (const [slot, r] of Object.entries(this.hereTree)) {
        if (!isSlot(slot) || slot === this.me || !isObj(r) || typeof r.at !== 'number' || typeof r.busy !== 'boolean') continue;
        if (fresh(r.at, this.t.hereMs)) here.push({ slot, at: r.at, busy: r.busy });
      }
    }
    const lobby = isObj(this.lobbyTree) ? this.lobbyTree : {};
    if (isObj(lobby.in)) {
      for (const [from, r] of Object.entries(lobby.in)) {
        const inv = this.readInvite(from, r);
        if (inv && fresh(inv.at, this.t.inviteMs)) inbox.push(inv);
      }
    }
    if (isObj(lobby.back)) {
      for (const [from, r] of Object.entries(lobby.back)) {
        const rep = this.readReply(from, r);
        if (rep && fresh(rep.at, this.t.inviteMs)) replies.push(rep);
      }
    }
    const bySlot = (a: { slot?: Slot; from?: Slot }, b: { slot?: Slot; from?: Slot }) =>
      (a.slot ?? a.from ?? '').localeCompare(b.slot ?? b.from ?? '');
    here.sort(bySlot);
    inbox.sort(bySlot);
    replies.sort(bySlot);
    if (!sameJson(here, this.hereList.peek())) this.hereList.value = here;
    if (!sameJson(inbox, this.inboxList.peek())) this.inboxList.value = inbox;
    if (!sameJson(replies, this.replyList.peek())) this.replyList.value = replies;
    if (this.started && next !== Infinity) this.expiryTimer = this.timers.set(() => this.refresh(), Math.max(0, next));
  }

  private readInvite(from: string, r: Json): Invite | null {
    if (!isSlot(from) || from === this.me || !isObj(r)) return null;
    const { pub, side, build, at } = r;
    if (typeof pub !== 'string' || !PUB_RE.test(pub) || !isFaction(side)) return null;
    if (typeof build !== 'string' || !BUILD_RE.test(build) || typeof at !== 'number') return null;
    const head = readHead(r.head, [this.me, from]);
    if (head === undefined) return null;
    return { from, pub, side, head, build, at };
  }

  private readReply(from: string, r: Json): Reply | null {
    if (!isSlot(from) || from === this.me || !isObj(r)) return null;
    const { ok, pub, build, at } = r;
    if (typeof ok !== 'boolean' || typeof build !== 'string' || !BUILD_RE.test(build) || typeof at !== 'number') return null;
    const key = typeof pub === 'string' && PUB_RE.test(pub) ? pub : null;
    if (ok && key === null) return null;
    return { from, ok, pub: ok ? key : null, build, at };
  }

  // ---- requests ----

  /** Runs proof-carrying jobs one at a time, in order. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** A write with my pin proof; a refusal is tried once more a beat later. */
  private async sendProven(body: Obj, onOk?: (sentLocal: number, ms: number) => void): Promise<WriteAnswer> {
    const a = await this.sendOnce(body, onOk);
    if (a !== 'refused') return a;
    await this.pause(RETRY_GAP_MS);
    return this.sendOnce(body, onOk);
  }

  /** One write with my pin proof in the same update; refused at once when nobody is logged in. */
  private async sendOnce(body: Obj, onOk?: (sentLocal: number, ms: number) => void): Promise<WriteAnswer> {
    const hash = this.d.proof();
    if (hash === null || !HASH_RE.test(hash)) return 'refused';
    const sent = this.now();
    const a = await this.write({ ...body, [`proof/${this.me}/${hash}`]: { touch: SV } });
    if (a === 'ok') onOk?.(sent, this.now() - sent);
    return a;
  }

  private async write(body: Obj): Promise<WriteAnswer> {
    const a = await this.request('PATCH', '', body);
    return a.kind;
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => { this.timers.set(resolve, ms); });
  }

  /** One REST call with the 5 s timeout: ok, offline (no answer, a server error) or refused. */
  private async request(method: 'GET' | 'PATCH', path: string, body?: Obj): Promise<Answer> {
    const url = this.d.conn.url(path);
    // As RestCloud: a page under automation never reaches the children's live data.
    if (!url.startsWith(`${FAKE_DATABASE_URL}/`) && this.d.conn.root !== 'v2test' && isAutomated()) return { kind: 'refused' };
    const controller = new AbortController();
    const timer = this.timers.set(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.d.conn.fetch(url, {
        method,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
      });
      if (res.status >= 500 || res.status === 429 || res.status === 408) return { kind: 'offline' };
      if (!res.ok) return { kind: 'refused' };
      return { kind: 'ok', data: await res.json() };
    } catch {
      return { kind: 'offline' };
    } finally {
      this.timers.clear(timer);
    }
  }
}
