import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot } from '../../src/ai/bot';
import { createFortressPlants, createRandomChild } from '../../src/ai/standIns';
import { versusConfig } from '../../src/ai/versus';
import { fakeConnection } from '../../src/cloud/connection';
import type { Connection, EventSourceLike } from '../../src/cloud/connection';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { CloudRoot } from '../../src/cloud/restClient';
import { matchId, newKeyPair, sharedSecret } from '../../src/cloud/versusKeys';
import { VersusLobby } from '../../src/cloud/versusLobby';
import type { MatchMeta } from '../../src/cloud/versusLobby';
import { CloudMatchChannel, readMatch } from '../../src/cloud/versusMatch';
import type { MatchChannel, MatchEvent } from '../../src/net/channel';
import { LockstepMatch } from '../../src/net/lockstepMatch';
import { parseTurnKey, turnKey } from '../../src/net/turnCodec';
import { VirtualClock } from '../../src/net/virtualClock';
import type { Slot } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import type { Faction } from '../../src/sim/types';
import { T0, saveFor } from './helpers';

/**
 * Two devices playing one Versus match over the cloud match channel (spec 6.1, 6.3, 8.2-8.4, 10
 * "Integration"): one `FakeDatabase` with its fake streams, every request checked by the real
 * rules file, real REST writes and two `EventSource` streams per device. Lukas (p01, plants, the
 * host) and Toby (p02, zombies) meet in the lobby; Toby invites, Lukas accepts, both derive the id.
 * Time is a virtual clock; one frame is 1/30 s and each device tries one tick a frame.
 */

const BUILD = '2289558';
const SEED = 2718281828;
const FRAME = 1000 / 30;
const PINS: Record<'p01' | 'p02', string> = { p01: '123', p02: '456' };
const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
const otherOf = (f: Faction): Faction => (f === 'plants' ? 'zombies' : 'plants');

let clock: VirtualClock;
let db: FakeDatabase;
let hashes: Record<string, string>;
const lobbies: VersusLobby[] = [];

/** Lets every queued answer and stream event arrive (fetch, `Response.json`, `EventSource` sends). */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/** Waits for a call, moving time on a little while it waits. */
async function run<T>(p: Promise<T>): Promise<T> {
  let done = false;
  let value: T | undefined;
  void p.then((v) => { done = true; value = v; });
  for (let i = 0; i < 200 && !done; i++) {
    await settle();
    if (!done) clock.advance(10);
  }
  if (!done) throw new Error('the call never answered');
  return value as T;
}

/** A device's connection to the fake: counts its open streams and every turn key its streams carry. */
interface Watched {
  conn: Connection;
  open: number;
  maxOpen: number;
  urls: string[];
  /** Turn keys as they arrived in stream messages on the turns stream, with how often. */
  turnKeys: Map<string, number>;
}

function watched(root: CloudRoot): Watched {
  const base = fakeConnection(db, root);
  const w: Watched = { conn: base, open: 0, maxOpen: 0, urls: [], turnKeys: new Map() };
  w.conn = {
    ...base,
    eventSource: (url) => {
      const es = base.eventSource(url);
      w.open++;
      w.maxOpen = Math.max(w.maxOpen, w.open);
      w.urls.push(url);
      const onTurns = new URL(url).pathname.includes('/turns/');
      let closed = false;
      const out: EventSourceLike = {
        addEventListener: (type, fn) => es.addEventListener(type, (e) => {
          if (onTurns && (type === 'put' || type === 'patch')) {
            const { path, data } = JSON.parse(e.data) as { path: string; data: unknown };
            const keys = path === '/' ? Object.keys(data && typeof data === 'object' ? data : {}) : [path.slice(1)];
            for (const k of keys) w.turnKeys.set(k, (w.turnKeys.get(k) ?? 0) + 1);
          }
          fn(e);
        }),
        close: () => {
          if (!closed) w.open--;
          closed = true;
          es.close();
        },
        get onerror() { return es.onerror; },
        set onerror(f) { es.onerror = f; },
      };
      return out;
    },
  };
  return w;
}

/** The startAt of a stream URL (JSON-quoted in the query), or null. */
const startAtOf = (url: string): string | null => {
  const v = new URL(url).searchParams.get('startAt');
  return v === null ? null : (JSON.parse(v) as string);
};

beforeEach(async () => {
  clock = new VirtualClock();
  db = new FakeDatabase({ now: () => T0 + clock.now() });
  hashes = {};
  for (const root of ['v2', 'v2test'] as const) {
    const cloud = createFakeCloud(db, root);
    for (const [slot, pin] of Object.entries(PINS) as [Slot, string][]) {
      hashes[slot] = await pinHash(slot, pin);
      expect(await cloud.createPlayer(saveFor(slot), hashes[slot]!)).toBe('ok');
    }
  }
  clock.advance(1000);
});

afterEach(() => {
  for (const l of lobbies.splice(0)) l.stop();
});

function lobby(me: Slot, root: CloudRoot): VersusLobby {
  const l = new VersusLobby({
    conn: fakeConnection(db, root), me, build: BUILD, proof: () => hashes[me] ?? null,
    now: () => T0 + clock.now(), timers: clock,
  });
  lobbies.push(l);
  return l;
}

/**
 * The lobby: Toby invites Lukas, Lukas accepts with the match's meta (one PATCH), Toby derives the
 * id from Lukas's reply. Both lobbies stop (as the flow does on entering the battle).
 */
async function meet(root: CloudRoot = 'v2', test: number | null = null): Promise<{ id: string; meta: MatchMeta }> {
  const lukas = lobby('p01', root);
  const toby = lobby('p02', root);
  lukas.start();
  toby.start();
  await settle();
  const tobyKeys = await newKeyPair();
  expect(await run(toby.invite('p01', tobyKeys, 'zombies', { slot: 'p02', step: 3 }))).toBe('ok');
  await settle();
  const inv = lukas.inbox.value[0];
  if (!inv) throw new Error('no invite arrived');
  const lukasKeys = await newKeyPair();
  const id = await matchId(await sharedSecret(lukasKeys, inv.pub), 0);
  const meta: MatchMeta = {
    v: 1, build: BUILD, seed: SEED, seats: { plants: 'p01', zombies: 'p02' }, host: 'p01',
    head: inv.head, turn: 6, delay: 12, test, created: 0,
  };
  expect(await run(lukas.accept(inv, lukasKeys, meta, id))).toBe('ok');
  await settle();
  const reply = toby.replies.value.find((r) => r.from === 'p01' && r.ok);
  if (!reply?.pub) throw new Error('no reply arrived');
  expect(await matchId(await sharedSecret(tobyKeys, reply.pub), 0)).toBe(id);
  lukas.stop();
  toby.stop();
  expect(db.openStreams()).toBe(0);
  const stored = await run(readMatch(fakeConnection(db, root), id, clock));
  if (stored === null || stored === 'offline') throw new Error('the match is not stored');
  return { id, meta: stored.meta };
}

interface Peer {
  seat: Faction;
  slot: Slot;
  w: Watched;
  ch: CloudMatchChannel;
  lm: LockstepMatch;
  bot: Bot;
  /** `match.hash()` at every tick that is a multiple of 30. */
  hashes: Map<number, number>;
  /** Everything the match heard from the channel. */
  events: MatchEvent[];
  thoughtAt: number;
}

function peers(id: string, meta: MatchMeta, root: CloudRoot): Record<Faction, Peer> {
  const make = (seat: Faction): Peer => {
    const slot = meta.seats[seat];
    const w = watched(root);
    const ch = new CloudMatchChannel({ conn: w.conn, id, seat, me: slot, timers: clock });
    const peer = { seat, slot, w, ch, hashes: new Map(), events: [], thoughtAt: -1 } as unknown as Peer;
    const heard: MatchChannel = {
      publishTurns: (s, t) => ch.publishTurns(s, t),
      write: (rec, o) => ch.write(rec, o),
      remove: () => ch.remove(),
      listen: (from, on) => ch.listen(from, (e) => { peer.events.push(e); on(e); }),
    };
    const setup = { seed: meta.seed, seats: meta.seats, head: meta.head, ...(meta.test !== null ? { testBaseHp: meta.test } : {}) };
    peer.lm = new LockstepMatch({
      match: new Match(versusConfig(setup)), seat, delay: meta.delay, host: meta.host === slot, me: slot,
      other: meta.seats[otherOf(seat)], channel: heard, now: () => clock.now(), timers: clock,
    });
    peer.bot = slot === 'p02' ? createRandomChild(seat, meta.seed) : createFortressPlants(meta.seed);
    return peer;
  };
  return { plants: make('plants'), zombies: make('zombies') };
}

/** Peak open streams seen per frame across the whole database. */
let peakOpen = 0;

/** One frame: time moves, answers and stream events land, each device thinks and tries one tick. */
async function frame(ps: Record<Faction, Peer>): Promise<void> {
  clock.advance(FRAME);
  await settle();
  for (const f of FACTIONS) {
    const p = ps[f];
    const { match } = p.lm;
    if (match.state.tick !== p.thoughtAt) {
      p.thoughtAt = match.state.tick;
      for (const cmd of p.bot.think(match)) p.lm.tap(cmd);
    }
    if (p.lm.tryStep().kind === 'ran' && match.state.tick % 30 === 0) p.hashes.set(match.state.tick, match.hash());
    expect(p.w.open).toBeLessThanOrEqual(2);
  }
  peakOpen = Math.max(peakOpen, db.openStreams());
}

async function playUntil(ps: Record<Faction, Peer>, done: () => boolean, maxMs: number): Promise<void> {
  const end = clock.now() + maxMs;
  while (!done() && clock.now() < end) await frame(ps);
  if (!done()) throw new Error(`not done after ${maxMs} ms: ticks ${ps.plants.lm.match.state.tick}/${ps.zombies.lm.match.state.tick}`);
}

const ticks = (ps: Record<Faction, Peer>) => Math.min(ps.plants.lm.match.state.tick, ps.zombies.lm.match.state.tick);

/** Both devices computed the same hash at every tick both checked; returns how many were compared. */
function agree(ps: Record<Faction, Peer>): number {
  let n = 0;
  for (const [tick, h] of ps.plants.hashes) {
    const theirs = ps.zombies.hashes.get(tick);
    if (theirs === undefined) continue;
    expect(theirs, `hash at tick ${tick}`).toBe(h);
    n++;
  }
  return n;
}

const startAll = (ps: Record<Faction, Peer>) => { for (const f of FACTIONS) ps[f].lm.start(); };

describe('the cloud match channel, two peers over the fake database', () => {
  beforeEach(() => { peakOpen = 0; });

  it('lobby to match: both derive the id; both ready records are written with the server clock and heard by both', async () => {
    const { id, meta } = await meet();
    expect(meta.seats).toEqual({ plants: 'p01', zombies: 'p02' });
    const ps = peers(id, meta, 'v2');
    const heard: Record<Faction, MatchEvent[]> = { plants: [], zombies: [] };
    const stop = FACTIONS.map((f) => ps[f].ch.listen({ plants: 0, zombies: 0 }, (e) => heard[f].push(e)));
    for (const f of FACTIONS) expect(await run(ps[f].ch.write({ kind: 'ready', seat: f, at: 0 }))).toBe('ok');
    await settle();
    const ready = db.peek(`v2/vs/matches/${id}/ready`) as Record<Faction, number>;
    expect(ready).toEqual({ plants: expect.any(Number), zombies: expect.any(Number) });
    expect(ready.plants).toBeGreaterThan(T0);
    for (const f of FACTIONS) {
      expect(heard[f].filter((e) => e.kind === 'ready')).toEqual([
        { kind: 'ready', seat: 'plants', at: ready.plants }, { kind: 'ready', seat: 'zombies', at: ready.zombies },
      ]);
      expect(heard[f]).toContainEqual({ kind: 'link', up: true });
    }
    expect(db.openStreams()).toBe(4);
    for (const s of stop) s();
    expect(db.openStreams()).toBe(0);
  });

  it('both play 600 ticks with taps and agree on every hash; turns are PATCHes of turns/<seat>/t… only; a lost answer is retried with the same value; at most 2 streams a device', async () => {
    const { id, meta } = await meet();
    const ps = peers(id, meta, 'v2');
    const from = db.requests.length;
    startAll(ps);
    let lostAt = -1;
    await playUntil(ps, () => {
      if (lostAt < 0 && ticks(ps) >= 300) {
        lostAt = db.requests.length;
        db.loseResponses = 1;
      }
      return ticks(ps) >= 600;
    }, 60_000);
    expect(agree(ps)).toBeGreaterThanOrEqual(19);
    // the bots tapped: commands are in both logs
    const turns = db.peek(`v2/vs/matches/${id}/turns`) as Record<Faction, Record<string, string>>;
    for (const f of FACTIONS) expect(Object.values(turns[f]).some((raw) => raw.includes('"c"'))).toBe(true);

    const writes = db.requests.slice(from).filter((r) => r.method !== 'GET' && r.method !== 'STREAM');
    expect(writes.length).toBeGreaterThan(100);
    for (const r of writes) {
      expect(r.method).toBe('PATCH');
      expect(r.path).toBe('/v2');
      const keys = Object.keys(r.body as object);
      const seat = /^vs\/matches\/[0-9a-f]{32}\/turns\/(plants|zombies)\/t\d{6}$/.exec(keys[0]!)?.[1];
      expect(seat).toBeDefined();
      for (const k of keys) expect(k).toMatch(new RegExp(`^vs/matches/${id}/turns/${seat}/t\\d{6}$`));
    }
    // the lost answer: applied, then the very same PATCH again, accepted by the rules
    const lost = db.requests.slice(lostAt).find((r) => r.status === 'lost');
    expect(lost).toBeDefined();
    const retry = db.requests.slice(db.requests.indexOf(lost!) + 1).find((r) => r.method === 'PATCH' && JSON.stringify(r.body) === JSON.stringify(lost!.body));
    expect(retry?.status).toBe(200);
    expect(db.requests.slice(from).some((r) => r.status === 401)).toBe(false);

    for (const f of FACTIONS) {
      expect(ps[f].w.maxOpen).toBe(2);
      // the other seat's turns, each once on the stream
      for (const [k, n] of ps[f].w.turnKeys) expect(n, `${f} heard ${k}`).toBe(1);
    }
    expect(peakOpen).toBeLessThanOrEqual(4);
  });

  it('pause and resume: both stop, both go on, hashes still agree', async () => {
    const { id, meta } = await meet();
    const ps = peers(id, meta, 'v2');
    startAll(ps);
    await playUntil(ps, () => ticks(ps) >= 120, 30_000);
    ps.zombies.lm.pause();
    for (let i = 0; i < 10; i++) await frame(ps);
    expect(ps.plants.lm.pausedBy).toBe('p02');
    expect(ps.zombies.lm.pausedBy).toBe('p02');
    expect(db.peek(`v2/vs/matches/${id}/pause`)).toEqual({ by: 'p02', n: expect.any(Number) });
    const stood = FACTIONS.map((f) => ps[f].lm.match.state.tick);
    for (let i = 0; i < 30; i++) await frame(ps);
    expect(FACTIONS.map((f) => ps[f].lm.match.state.tick)).toEqual(stood);
    ps.plants.lm.resume();
    for (let i = 0; i < 10; i++) await frame(ps);
    expect(ps.plants.lm.pausedBy).toBeNull();
    expect(ps.zombies.lm.pausedBy).toBeNull();
    expect(db.peek(`v2/vs/matches/${id}/pause`)).toBeNull();
    expect(ps.zombies.events).toContainEqual({ kind: 'resume' });
    await playUntil(ps, () => ticks(ps) >= 300, 30_000);
    expect(agree(ps)).toBeGreaterThanOrEqual(9);
  });

  it('a test: 40 match on v2test ends with both end records and the same outcome; remove() deletes it and the other sees gone', async () => {
    const { id, meta } = await meet('v2test', 40);
    expect(meta.test).toBe(40);
    const ps = peers(id, meta, 'v2test');
    startAll(ps);
    await playUntil(ps, () => ps.plants.lm.outcome() !== null && ps.zombies.lm.outcome() !== null, 15 * 60_000);
    const outcome = ps.plants.lm.outcome();
    expect(ps.zombies.lm.outcome()).toEqual(outcome);
    expect(outcome?.kind).toBe('won');
    const ends = db.peek(`v2test/vs/matches/${id}/end`) as Record<Faction, string>;
    expect(Object.keys(ends).sort()).toEqual(['plants', 'zombies']);
    for (const f of FACTIONS) expect(ps[f].events).toContainEqual({ kind: 'end', seat: f, raw: ends[f] });
    expect(agree(ps)).toBeGreaterThan(0);

    expect(await run(ps.plants.ch.remove())).toBe('ok');
    await settle();
    expect(db.peek(`v2test/vs/matches/${id}`)).toBeNull();
    expect(ps.zombies.events.at(-1)).toEqual({ kind: 'gone' });
    expect(ps.plants.events.at(-1)).toEqual({ kind: 'gone' });
    // a write after the deletion is refused (no meta); a second remove is fine
    expect(await run(ps.zombies.ch.write({ kind: 'end', seat: 'zombies', raw: ends.zombies }))).toBe('refused');
    expect(await run(ps.zombies.ch.remove())).toBe('ok');
    expect(await run(readMatch(ps.zombies.w.conn, id, clock))).toBeNull();
    for (const f of FACTIONS) expect(ps[f].w.maxOpen).toBe(2);
  }, 60_000);

  it('readMatch of a live match returns its meta, both logs and the control records', async () => {
    const { id, meta } = await meet();
    const ps = peers(id, meta, 'v2');
    expect(await run(ps.plants.ch.write({ kind: 'ready', seat: 'plants', at: 0 }))).toBe('ok');
    startAll(ps);
    await playUntil(ps, () => ticks(ps) >= 90, 30_000);
    const stored = await run(readMatch(ps.zombies.w.conn, id, clock));
    if (stored === null || stored === 'offline') throw new Error('no match');
    expect(stored.meta).toEqual(meta);
    const turns = db.peek(`v2/vs/matches/${id}/turns`) as Record<Faction, Record<string, string>>;
    for (const f of FACTIONS) {
      expect(stored.turns[f].size).toBe(Object.keys(turns[f]).length);
      expect(stored.turns[f].size).toBeGreaterThan(10);
      for (const [k, raw] of stored.turns[f]) expect(turns[f][turnKey(k)]).toBe(raw);
    }
    expect(stored.control).toEqual([{ kind: 'ready', seat: 'plants', at: db.peek(`v2/vs/matches/${id}/ready/plants`) }]);
    expect(await run(readMatch(ps.zombies.w.conn, 'f'.repeat(32), clock))).toBeNull();
    db.offline = true;
    expect(await run(readMatch(ps.zombies.w.conn, id, clock))).toBe('offline');
    db.offline = false;
  });

  it('dropStreams mid-match: both reconnect from their first missing turn, nothing fetched twice, and agree again', async () => {
    const { id, meta } = await meet();
    const ps = peers(id, meta, 'v2');
    startAll(ps);
    await playUntil(ps, () => ticks(ps) >= 300, 30_000);
    const heardBefore = FACTIONS.map((f) => ps[f].w.turnKeys.size);
    const opened = FACTIONS.map((f) => ps[f].w.urls.length);
    db.dropStreams();
    expect(db.openStreams()).toBe(0);
    // the other seat writes on while the streams are down (backoff 0.5 s)
    for (let i = 0; i < 10; i++) await frame(ps);
    for (let i = 0; i < 20; i++) await frame(ps);
    expect(db.openStreams()).toBe(4);
    for (const [i, f] of FACTIONS.entries()) {
      const p = ps[f];
      const reopened = p.w.urls.slice(opened[i]);
      expect(reopened).toHaveLength(2);
      const turnsUrl = reopened.find((u) => new URL(u).pathname.includes('/turns/'))!;
      const heard = [...p.w.turnKeys.keys()].slice(0, heardBefore[i]).map((k) => parseTurnKey(k)!);
      const firstMissing = Math.max(...heard) + 1;
      expect(heard).toHaveLength(firstMissing); // 0..n-1, none lacking
      expect(startAtOf(turnsUrl)).toBe(turnKey(firstMissing));
      // the link went down once (both streams) and came back once both delivered again
      expect(p.events.filter((e) => e.kind === 'link').slice(-2)).toEqual([{ kind: 'link', up: false }, { kind: 'link', up: true }]);
    }
    await playUntil(ps, () => ticks(ps) >= 600, 60_000);
    for (const f of FACTIONS) {
      for (const [k, n] of ps[f].w.turnKeys) expect(n, `${f} heard ${k}`).toBe(1);
      expect(ps[f].w.maxOpen).toBe(2);
    }
    expect(agree(ps)).toBeGreaterThanOrEqual(19);
  });
});

describe('the cloud match channel, write by write', () => {
  async function pair(): Promise<{ id: string; lukas: CloudMatchChannel; toby: CloudMatchChannel }> {
    const { id } = await meet();
    const conn = fakeConnection(db);
    return {
      id,
      lukas: new CloudMatchChannel({ conn, id, seat: 'plants', me: 'p01', timers: clock }),
      toby: new CloudMatchChannel({ conn, id, seat: 'zombies', me: 'p02', timers: clock }),
    };
  }

  it('a lost answer on a turn PATCH: sent again with the same value, ok; another value for a stored turn is refused', async () => {
    const { id, lukas } = await pair();
    const turns = [{ k: 0, raw: '{}' }, { k: 1, raw: '{"c":[[2,"place","sunflower",1,0]]}' }];
    db.loseResponses = 1;
    expect(await run(lukas.publishTurns('plants', turns))).toBe('offline');
    expect(db.peek(`v2/vs/matches/${id}/turns/plants`)).toEqual({ t000000: '{}', t000001: turns[1]!.raw });
    expect(await run(lukas.publishTurns('plants', turns))).toBe('ok');
    expect(await run(lukas.publishTurns('plants', [{ k: 1, raw: '{}' }]))).toBe('refused');
    expect(db.peek(`v2/vs/matches/${id}/turns/plants/t000001`)).toBe(turns[1]!.raw);
    expect(await run(lukas.publishTurns('plants', []))).toBe('ok');
  });

  it('a lost answer on an end write: sent again, ok; a slot the other device filled first is refused; the other seat\'s empty slot may be filled', async () => {
    const { id, lukas, toby } = await pair();
    const mine = '{"w":"plants","t":340,"h":876393386}';
    db.loseResponses = 1;
    expect(await run(lukas.write({ kind: 'end', seat: 'plants', raw: mine }))).toBe('offline');
    expect(db.peek(`v2/vs/matches/${id}/end/plants`)).toBe(mine);
    expect(await run(lukas.write({ kind: 'end', seat: 'plants', raw: mine }))).toBe('ok');
    // Toby's forfeit into both slots: his own is empty, Lukas's already holds Lukas's end
    const quit = '{"w":"quit","by":"p02","t":300,"h":1}';
    expect(await run(toby.write({ kind: 'end', seat: 'zombies', raw: quit }))).toBe('ok');
    expect(await run(toby.write({ kind: 'end', seat: 'plants', raw: quit }))).toBe('refused');
    expect(db.peek(`v2/vs/matches/${id}/end`)).toEqual({ plants: mine, zombies: quit });
  });

  it('a lost answer on ready: the retry carries a new server time and is refused by the rules, read back as ok', async () => {
    const { id, toby } = await pair();
    db.loseResponses = 1;
    expect(await run(toby.write({ kind: 'ready', seat: 'zombies', at: 0 }))).toBe('offline');
    const first = db.peek(`v2/vs/matches/${id}/ready/zombies`);
    clock.advance(5);
    const from = db.requests.length;
    expect(await run(toby.write({ kind: 'ready', seat: 'zombies', at: 0 }))).toBe('ok');
    expect(db.requests.slice(from).map((r) => [r.method, r.status])).toEqual([['PATCH', 401], ['GET', 200]]);
    expect(db.peek(`v2/vs/matches/${id}/ready/zombies`)).toBe(first);
  });

  it('pause, resume, sync, again and keepalive map to their nodes; resume deletes the pause', async () => {
    const { id, lukas, toby } = await pair();
    const heard: MatchEvent[] = [];
    const stop = toby.listen({ plants: 0, zombies: 0 }, (e) => heard.push(e));
    const seen: RequestInit[] = [];
    const conn = fakeConnection(db);
    const spy = new CloudMatchChannel({
      conn: { ...conn, fetch: (input, init) => { seen.push(init ?? {}); return conn.fetch(input, init); } },
      id, seat: 'plants', me: 'p01', timers: clock,
    });
    expect(await run(spy.write({ kind: 'pause', by: 'p01', n: 4 }, { keepalive: true }))).toBe('ok');
    expect(seen.at(-1)?.keepalive).toBe(true);
    expect(db.peek(`v2/vs/matches/${id}/pause`)).toEqual({ by: 'p01', n: 4 });
    expect(await run(lukas.write({ kind: 'resume' }))).toBe('ok');
    expect(db.peek(`v2/vs/matches/${id}/pause`)).toBeNull();
    expect(await run(lukas.write({ kind: 'sync', n: 1, tick: 1800, snap: '{"x":1}' }))).toBe('ok');
    expect(await run(lukas.write({ kind: 'sync', n: 1, tick: 1800, snap: '{"x":1}' }))).toBe('ok');
    expect(await run(lukas.write({ kind: 'sync', n: 1, tick: 1800, snap: '{"x":2}' }))).toBe('refused');
    expect(await run(lukas.write({ kind: 'again', seat: 'plants', value: 1 }))).toBe('ok');
    await settle();
    expect(heard.filter((e) => e.kind !== 'link')).toEqual([
      { kind: 'pause', by: 'p01', n: 4 }, { kind: 'resume' },
      { kind: 'sync', n: 1, tick: 1800, snap: '{"x":1}' }, { kind: 'again', seat: 'plants', value: 1 },
    ]);
    stop();
  });

  it('a pause deleted while the streams were down is a resume on the reopen; a new pause is heard', async () => {
    const { lukas, toby } = await pair();
    const heard: MatchEvent[] = [];
    const stop = toby.listen({ plants: 0, zombies: 0 }, (e) => heard.push(e));
    expect(await run(lukas.write({ kind: 'pause', by: 'p01', n: 4 }))).toBe('ok');
    await settle();
    db.dropStreams();
    await settle();
    expect(await run(lukas.write({ kind: 'resume' }))).toBe('ok');
    clock.advance(600);
    await settle();
    expect(heard.filter((e) => e.kind !== 'link')).toEqual([{ kind: 'pause', by: 'p01', n: 4 }, { kind: 'resume' }]);
    expect(await run(lukas.write({ kind: 'pause', by: 'p01', n: 8 }))).toBe('ok');
    await settle();
    expect(heard.at(-1)).toEqual({ kind: 'pause', by: 'p01', n: 8 });
    stop();
  });
});

describe('gone on the root stream (shapes the real database may send)', () => {
  /** A channel whose root stream is scripted by hand; returns the events and a way to send root stream events. */
  function scripted(): { events: MatchEvent[]; send: (type: 'put' | 'patch', path: string, data: unknown) => void } {
    const handlers: Record<string, (e: { data: string }) => void>[] = [];
    const base = fakeConnection(db, 'v2');
    const conn: Connection = {
      ...base,
      eventSource: (url) => {
        const h: Record<string, (e: { data: string }) => void> = {};
        if (!new URL(url).pathname.includes('/turns/')) handlers.push(h);
        return { addEventListener: (t, fn) => { h[t] = fn; }, close: () => {}, onerror: null };
      },
    };
    const events: MatchEvent[] = [];
    const ch = new CloudMatchChannel({ conn, id: 'a'.repeat(32), seat: 'plants', me: 'p01', timers: clock });
    ch.listen({ plants: 0, zombies: 0 }, (e) => events.push(e));
    return {
      events,
      send: (type, path, data) => handlers[0]![type]!({ data: JSON.stringify({ path, data }) }),
    };
  }
  const meta = { v: 1, seed: 1 };

  it('a whole-root null is gone', () => {
    const s = scripted();
    s.send('put', '/', { meta });
    s.send('put', '/', null);
    expect(s.events.filter((e) => e.kind === 'gone')).toHaveLength(1);
  });

  it('per-child removal of meta (put null at /meta) is gone', () => {
    const s = scripted();
    s.send('put', '/', { meta, sync: { plants: { t: 30 } } });
    s.send('put', '/sync', null);
    expect(s.events.some((e) => e.kind === 'gone')).toBe(false);
    s.send('put', '/meta', null);
    expect(s.events.filter((e) => e.kind === 'gone')).toHaveLength(1);
  });

  it('a patch setting meta to null, or a later snapshot without meta, is gone', () => {
    const a = scripted();
    a.send('put', '/', { meta });
    a.send('patch', '/', { meta: null });
    expect(a.events.filter((e) => e.kind === 'gone')).toHaveLength(1);
    const b = scripted();
    b.send('put', '/', { meta });
    b.send('put', '/', { sync: { plants: { t: 30 } } });
    expect(b.events.filter((e) => e.kind === 'gone')).toHaveLength(1);
  });

  it('a root that never held meta is not gone', () => {
    const s = scripted();
    s.send('put', '/', { sync: { plants: { t: 30 } } });
    expect(s.events.some((e) => e.kind === 'gone')).toBe(false);
  });
});
