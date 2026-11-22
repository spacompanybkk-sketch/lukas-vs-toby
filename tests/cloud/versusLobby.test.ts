import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeConnection } from '../../src/cloud/connection';
import type { Connection } from '../../src/cloud/connection';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { grownUpHash, pinHash } from '../../src/cloud/hash';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { Timers } from '../../src/cloud/stream';
import { matchId, newKeyPair, sharedSecret } from '../../src/cloud/versusKeys';
import type { KeyPair } from '../../src/cloud/versusKeys';
import { VersusLobby, readMeta } from '../../src/cloud/versusLobby';
import type { Invite, MatchMeta } from '../../src/cloud/versusLobby';
import type { Slot } from '../../src/progress/save';
import { T0, saveFor } from './helpers';

/**
 * The Versus lobby (spec 5, 6.1, 7.1-7.3, 8.1-8.2, 8.5) over the fake database, which checks every
 * request against the real rules file and streams as the REST API does. Time is a virtual clock:
 * the database's clock and each device's own clock (which may be wrong) are read from it.
 */

/** Timers that run only when the test moves time on. */
class VirtualClock implements Timers {
  t = 0;
  private next = 1;
  private readonly due = new Map<number, { at: number; fn: () => void }>();
  now = (): number => this.t;
  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.due.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }
  clear(h: unknown): void { this.due.delete(h as number); }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const first = [...this.due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!first) break;
      this.due.delete(first[0]);
      this.t = first[1].at;
      first[1].fn();
    }
    this.t = end;
  }
}

const BUILD = '2289558';
const PINS: Partial<Record<Slot, string>> = { p01: '123', p02: '456', p05: '555' };

let clock: VirtualClock;
let db: FakeDatabase;
let G: string;
let hashes: Partial<Record<Slot, string>>;
const lobbies: VersusLobby[] = [];

/** Lets every queued answer and stream event arrive. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/** Moves time on in small steps, letting answers and events arrive between them. */
async function pass(ms: number, step = 250): Promise<void> {
  for (let left = ms; left > 0; left -= step) {
    clock.advance(Math.min(step, left));
    await settle();
  }
}

/** Waits for a lobby call, moving time on a little while it waits (a retry waits a beat). */
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

/** One device of `me`, its own clock `skewMs` off, over `conn` (default: straight to the fake). */
function device(
  me: Slot,
  opts: { skewMs?: number; conn?: Connection; proof?: () => string | null; timeouts?: { heartbeatMs: number; hereMs: number; inviteMs: number } } = {},
): VersusLobby {
  const l = new VersusLobby({
    conn: opts.conn ?? fakeConnection(db), me, build: BUILD,
    ...(opts.timeouts ? { timeouts: opts.timeouts } : {}),
    proof: opts.proof ?? (() => hashes[me] ?? null),
    now: () => T0 + clock.now() + (opts.skewMs ?? 0),
    timers: clock,
  });
  lobbies.push(l);
  return l;
}

const peekAt = (path: string) => db.peek(`v2/${path}`);

/** A connection whose every request reaches the fake `ms` later (on the virtual clock). */
function slowConn(ms: number): Connection {
  const base = fakeConnection(db);
  return {
    ...base,
    fetch: (input, init) => new Promise<Response>((resolve, reject) => {
      clock.set(() => { base.fetch(input, init).then(resolve, reject); }, ms);
    }),
  };
}

beforeEach(async () => {
  clock = new VirtualClock();
  db = new FakeDatabase({ now: () => T0 + clock.now() });
  const cloud = createFakeCloud(db);
  hashes = {};
  for (const [slot, pin] of Object.entries(PINS) as [Slot, string][]) {
    hashes[slot] = await pinHash(slot, pin);
    expect(await cloud.createPlayer(saveFor(slot), hashes[slot]!)).toBe('ok');
  }
  G = await grownUpHash('135799');
  expect(await cloud.setGrownUpCode(G)).toBe('ok');
  clock.advance(1000);
});

afterEach(() => {
  for (const l of lobbies.splice(0)) l.stop();
});

const meta = (over: Partial<MatchMeta> = {}): MatchMeta => ({
  v: 1, build: BUILD, seed: 2718281828, seats: { plants: 'p01', zombies: 'p02' }, host: 'p02',
  head: { slot: 'p02', step: 3 }, turn: 6, delay: 12, test: null, created: 0, ...over,
});

describe('who is here', () => {
  it("Toby's heartbeat writes vs/here/p02 with his proof, and Lukas's list shows him", async () => {
    const toby = device('p02');
    toby.start();
    await settle();
    expect(peekAt('vs/here/p02')).toEqual({ at: T0 + clock.now(), busy: false });
    expect(peekAt(`proof/p02/${hashes.p02}`)).toEqual({ touch: T0 + clock.now() });
    const lukas = device('p01');
    // Nothing is listed before Lukas's own heartbeat comes back (no server time yet).
    lukas.start();
    expect(lukas.here.value).toEqual([]);
    expect(lukas.serverNow()).toBeNull();
    await settle();
    expect(lukas.here.value).toEqual([{ slot: 'p02', at: T0 + clock.now(), busy: false }]);
    expect(lukas.serverNow()).toBe(T0 + clock.now());
    // Lukas does not list himself.
    expect(toby.here.value.map((h) => h.slot)).toEqual(['p01']);
  });

  it('two streams per started device, opened after the first heartbeat answer, closed by stop', async () => {
    const lukas = device('p01');
    lukas.start();
    expect(db.openStreams()).toBe(0);
    await settle();
    expect(db.openStreams()).toBe(2);
    const toby = device('p02');
    toby.start();
    await settle();
    expect(db.openStreams()).toBe(4);
    toby.stop();
    expect(db.openStreams()).toBe(2);
    lukas.stop();
    expect(db.openStreams()).toBe(0);
  });

  it('heartbeats every 15 s; a player is gone once his last one is 40 s old', async () => {
    const lukas = device('p01');
    const toby = device('p02');
    lukas.start();
    toby.start();
    await settle();
    await pass(15_000);
    const last = T0 + clock.now();
    expect(peekAt('vs/here/p02')).toEqual({ at: last, busy: false });
    toby.stop();
    await pass(39_500);
    expect(lukas.here.value.map((h) => h.slot)).toEqual(['p02']);
    await pass(1_500);
    // 41 s after his last heartbeat: gone, though his record is still in the database.
    expect(peekAt('vs/here/p02')).not.toBeNull();
    expect(lukas.here.value).toEqual([]);
  });

  it.each([3_600_000, -3_600_000])('a device whose own clock is %i ms off still lists him (server time from its own echo)', async (skewMs) => {
    const toby = device('p02');
    toby.start();
    await settle();
    const lukas = device('p01', { skewMs });
    lukas.start();
    await settle();
    expect(lukas.serverNow()).toBe(T0 + clock.now());
    expect(lukas.here.value.map((h) => h.slot)).toEqual(['p02']);
    await pass(20_000);
    expect(lukas.serverNow()).toBe(T0 + clock.now());
    expect(lukas.here.value.map((h) => h.slot)).toEqual(['p02']);
  });

  it('an old record left behind by a player who went away is never listed', async () => {
    db.poke('v2/vs/here/p02', { at: T0 - 60_000, busy: false });
    const lukas = device('p01');
    lukas.start();
    await settle();
    expect(lukas.serverNow()).not.toBeNull();
    expect(lukas.here.value).toEqual([]);
  });

  it('setBusy shows busy to the others', async () => {
    const lukas = device('p01');
    const toby = device('p02');
    lukas.start();
    toby.start();
    await settle();
    expect(await run(toby.setBusy(true))).toBe('ok');
    await settle();
    expect(lukas.here.value).toEqual([{ slot: 'p02', at: expect.any(Number), busy: true }]);
  });

  it('every existing player (p05, no tick) may be here', async () => {
    const lukas = device('p01');
    lukas.start();
    await settle();
    const p05 = device('p05');
    expect(await run(p05.setBusy(false))).toBe('ok');
    await settle();
    expect(lukas.here.value.map((h) => h.slot)).toEqual(['p05']);
  });

  it('a slot with no player record is refused and holds no streams', async () => {
    const p07 = device('p07', { proof: () => '7'.repeat(64) });
    p07.start();
    await pass(1_000, 10);
    expect(peekAt('vs/here/p07')).toBeNull();
    expect(db.openStreams()).toBe(0);
    expect(await run(p07.setBusy(false))).toBe('refused');
  });

  it('setAllowed: a wrong grown-up code is not sent again; a proof of this very millisecond is', async () => {
    const lukas = device('p01');
    let from = db.requests.length;
    expect(await run(lukas.setAllowed('p05', true, '0'.repeat(64)))).toBe('refused');
    // The tick, then the code alone (refused: a wrong code), and nothing more.
    expect(db.requests.slice(from).map((r) => r.status)).toEqual([401, 401]);
    expect(await run(lukas.setAllowed('p05', true, G))).toBe('ok');
    from = db.requests.length;
    // Again at once, in the same server millisecond: refused, the code checks out, sent again a beat later.
    expect(await run(lukas.setAllowed('p05', false, G))).toBe('ok');
    expect(db.requests.slice(from).map((r) => r.status)).toEqual([401, 200, 200]);
    expect(peekAt('vs/allowed/p05')).toBeNull();
  });

  it('logged out (no proof): refused without asking the database', async () => {
    const lukas = device('p01', { proof: () => null });
    const before = db.requests.length;
    expect(await run(lukas.setBusy(false))).toBe('refused');
    expect(db.requests.length).toBe(before);
  });

  it('proof-carrying writes of one device are sent one at a time, so two at once both land', async () => {
    const toby = device('p02');
    const keys = await newKeyPair();
    const [a, b] = await run(Promise.all([toby.setBusy(false), toby.invite('p01', keys, 'zombies', null)]));
    expect([a, b]).toEqual(['ok', 'ok']);
    expect(peekAt('vs/here/p02')).not.toBeNull();
    expect(peekAt('vs/lobby/p01/in/p02')).toMatchObject({ pub: keys.pub });
  });

  it('roundTrips(): the heartbeat round trips, newest last, at most 8', async () => {
    // Every request takes 120 ms there and back.
    const slow = slowConn(120);
    // A quick heartbeat (the timeouts are injectable), so ten of them pass in 12 s.
    const lukas = device('p01', { conn: slow, timeouts: { heartbeatMs: 1_200, hereMs: 4_000, inviteMs: 6_000 } });
    expect(lukas.roundTrips()).toEqual([]);
    lukas.start();
    await pass(1_200, 120);
    expect(lukas.roundTrips()).toEqual([120]);
    await pass(1_200 * 10, 120);
    expect(lukas.roundTrips()).toEqual(Array(8).fill(120));
  });
});

describe('invites', () => {
  let lukas: VersusLobby;
  let toby: VersusLobby;
  let tobyKeys: KeyPair;

  beforeEach(async () => {
    lukas = device('p01');
    toby = device('p02');
    lukas.start();
    toby.start();
    await settle();
    tobyKeys = await newKeyPair();
  });

  it("Toby invites Lukas: Lukas's inbox shows it; at 61 s it is gone", async () => {
    expect(await run(toby.invite('p01', tobyKeys, 'zombies', { slot: 'p02', step: 3 }))).toBe('ok');
    await settle();
    expect(lukas.inbox.value).toEqual([
      { from: 'p02', pub: tobyKeys.pub, side: 'zombies', head: { slot: 'p02', step: 3 }, build: BUILD, at: expect.any(Number) },
    ]);
    await pass(59_000);
    expect(lukas.inbox.value).toHaveLength(1);
    await pass(2_000);
    expect(lukas.inbox.value).toEqual([]);
  });

  it('an invite without a head start; a second invite from Toby replaces the first; cancel removes it', async () => {
    expect(await run(toby.invite('p01', tobyKeys, 'zombies', null))).toBe('ok');
    await settle();
    expect(lukas.inbox.value).toEqual([expect.objectContaining({ from: 'p02', head: null })]);
    const again = await newKeyPair();
    await pass(1_000);
    expect(await run(toby.invite('p01', again, 'plants', { slot: 'p01', step: 2 }))).toBe('ok');
    await settle();
    expect(lukas.inbox.value).toEqual([expect.objectContaining({ from: 'p02', pub: again.pub, side: 'plants', head: { slot: 'p01', step: 2 } })]);
    expect(await run(toby.cancel('p01'))).toBe('ok');
    await settle();
    expect(lukas.inbox.value).toEqual([]);
    expect(peekAt('vs/lobby/p01/in/p02')).toBeNull();
  });

  it("decline writes { ok: false } into Toby's replies and clears Lukas's inbox", async () => {
    await run(toby.invite('p01', tobyKeys, 'zombies', null));
    await settle();
    expect(await run(lukas.decline('p02'))).toBe('ok');
    await settle();
    expect(toby.replies.value).toEqual([{ from: 'p01', ok: false, pub: null, build: BUILD, at: expect.any(Number) }]);
    expect(lukas.inbox.value).toEqual([]);
    expect(await run(toby.clearReply('p01'))).toBe('ok');
    await settle();
    expect(toby.replies.value).toEqual([]);
    expect(peekAt('vs/lobby/p02/back/p01')).toBeNull();
  });

  /** Lukas accepts Toby's invite with his own fresh keys; the id both derive. */
  async function accepted(by: VersusLobby, inv: Invite, m = meta()): Promise<{ keys: KeyPair; id: string; answer: unknown }> {
    const keys = await newKeyPair();
    const id = await matchId(await sharedSecret(keys, inv.pub), 0);
    return { keys, id, answer: await run(by.accept(inv, keys, m, id)) };
  }

  async function invited(): Promise<Invite> {
    await run(toby.invite('p01', tobyKeys, 'zombies', { slot: 'p02', step: 3 }));
    await settle();
    const inv = lukas.inbox.value[0];
    if (!inv) throw new Error('no invite arrived');
    return inv;
  }

  it('accept writes the reply and meta in one PATCH; Toby derives the id from the reply and reads that meta', async () => {
    const inv = await invited();
    const from = db.requests.length;
    const { keys, id, answer } = await accepted(lukas, inv);
    expect(answer).toBe('ok');
    const patches = db.requests.slice(from).filter((r) => r.method === 'PATCH' && r.status === 200);
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0]!.body as object).sort()).toEqual([
      `proof/p01/${hashes.p01}`, 'vs/lobby/p01/in/p02', 'vs/lobby/p02/back/p01', `vs/matches/${id}/meta`,
    ]);
    await settle();
    expect(lukas.inbox.value).toEqual([]);
    const reply = toby.replies.value.find((r) => r.from === 'p01');
    expect(reply).toMatchObject({ ok: true, pub: keys.pub, build: BUILD });
    const tobyId = await matchId(await sharedSecret(tobyKeys, reply!.pub!), 0);
    expect(tobyId).toBe(id);
    const conn = fakeConnection(db);
    const raw: unknown = await (await conn.fetch(conn.url(`vs/matches/${tobyId}/meta`))).json();
    expect(readMeta(raw)).toEqual({ ...meta(), created: expect.any(Number) });
  });

  it('a lost answer: accepting again finds its own meta and says ok', async () => {
    const inv = await invited();
    const keys = await newKeyPair();
    const id = await matchId(await sharedSecret(keys, inv.pub), 0);
    db.loseResponses = 1;
    expect(await run(lukas.accept(inv, keys, meta(), id))).toBe('offline');
    expect(peekAt(`vs/matches/${id}/meta`)).not.toBeNull();
    expect(await run(lukas.accept(inv, keys, meta(), id))).toBe('ok');
  });

  it('Review Focus 3: a second device of Lukas accepting the same invite answers taken and writes nothing', async () => {
    const inv = await invited();
    const lukas2 = device('p01');
    lukas2.start();
    await settle();
    const first = await accepted(lukas, inv);
    expect(first.answer).toBe('ok');
    const reply = peekAt('vs/lobby/p02/back/p01');
    const from = db.requests.length;
    // Its own keys, so its own id.
    const second = await accepted(lukas2, inv, meta({ seed: 99 }));
    expect(second.answer).toBe('taken');
    expect(db.requests.slice(from).filter((r) => r.method !== 'GET' && r.method !== 'STREAM')).toEqual([]);
    expect(peekAt('vs/lobby/p02/back/p01')).toEqual(reply);
    expect(peekAt(`vs/matches/${second.id}`)).toBeNull();
    // The same id with another meta (a write-once refusal) is taken too.
    expect(await run(lukas2.accept(inv, second.keys, meta({ seed: 99 }), first.id))).toBe('taken');
    expect(peekAt(`vs/matches/${first.id}/meta`)).toMatchObject({ seed: 2718281828 });
  });

  it('Review Focus 3: two devices of Lukas accepting at once: exactly one ok, one taken, one match, the reply untouched', async () => {
    const inv = await invited();
    // Two links of different speed, so that both devices read before either writes, and the two
    // writes land in different server milliseconds (the rules, not a proof clash, must refuse one).
    const lukas1 = device('p01', { conn: slowConn(20) });
    const lukas2 = device('p01', { conn: slowConn(25) });
    const k1 = await newKeyPair();
    const k2 = await newKeyPair();
    const id1 = await matchId(await sharedSecret(k1, inv.pub), 0);
    const id2 = await matchId(await sharedSecret(k2, inv.pub), 0);
    const from = db.requests.length;
    const answers = await run(Promise.all([lukas1.accept(inv, k1, meta(), id1), lukas2.accept(inv, k2, meta({ seed: 99 }), id2)]));
    expect([...answers].sort()).toEqual(['ok', 'taken']);
    const winner = answers[0] === 'ok' ? { keys: k1, id: id1, loser: id2 } : { keys: k2, id: id2, loser: id1 };
    // Both looked before either wrote: all four reads came before the first write.
    const reqs = db.requests.slice(from);
    const firstPatch = reqs.findIndex((r) => r.method === 'PATCH');
    expect(reqs.slice(0, firstPatch).filter((r) => r.method === 'GET')).toHaveLength(4);
    // The losing write was refused by the rules, in a later millisecond than the winning one.
    const writes = reqs.filter((r) => r.method === 'PATCH');
    expect(writes.map((r) => r.status)).toEqual([200, 401]);
    expect(peekAt(`vs/matches/${winner.id}/meta`)).not.toBeNull();
    expect(peekAt(`vs/matches/${winner.loser}`)).toBeNull();
    expect(peekAt('vs/lobby/p02/back/p01')).toMatchObject({ ok: true, pub: winner.keys.pub });
  });

  it('accepted on one device, then declined on another: the reply stays yes, and the decline answers quietly', async () => {
    const inv = await invited();
    const lukas2 = device('p01');
    const first = await accepted(lukas, inv);
    expect(first.answer).toBe('ok');
    const from = db.requests.length;
    expect(await run(lukas2.decline('p02'))).toBe('ok');
    expect(db.requests.slice(from).filter((r) => r.method === 'PATCH')).toEqual([]);
    expect(peekAt('vs/lobby/p02/back/p01')).toMatchObject({ ok: true, pub: first.keys.pub });
  });

  it('an invite Toby cancelled cannot be accepted', async () => {
    const inv = await invited();
    await run(toby.cancel('p01'));
    const { answer, id } = await accepted(lukas, inv);
    expect(answer).toBe('taken');
    expect(peekAt(`vs/matches/${id}`)).toBeNull();
  });
});

describe('readMeta', () => {
  const wire = { v: 1, build: BUILD, seed: 7, seats: { plants: 'p01', zombies: 'p02' }, host: 'p01', turn: 6, delay: 12, created: T0 };

  it('reads a stored meta; head and test absent are null', () => {
    expect(readMeta(wire)).toEqual({ ...wire, head: null, test: null });
    expect(readMeta({ ...wire, head: { slot: 'p02', step: 5 }, test: 40 })).toMatchObject({ head: { slot: 'p02', step: 5 }, test: 40 });
  });

  it.each([
    ['not an object', 'x'],
    ['v 2', { ...wire, v: 2 }],
    ['a short build', { ...wire, build: 'abc' }],
    ['a fractional seed', { ...wire, seed: 1.5 }],
    ['the same player twice', { ...wire, seats: { plants: 'p01', zombies: 'p01' } }],
    ['a host who does not play', { ...wire, host: 'p03' }],
    ['a head start for nobody here', { ...wire, head: { slot: 'p03', step: 1 } }],
    ['a head start of 6', { ...wire, head: { slot: 'p01', step: 6 } }],
    ['turn 5', { ...wire, turn: 5 }],
    ['delay 8', { ...wire, delay: 8 }],
    ['an unknown field', { ...wire, extra: 1 }],
    ['no created', { ...wire, created: undefined }],
  ])('refuses %s', (_why, raw) => {
    expect(readMeta(JSON.parse(JSON.stringify(raw)))).toBeNull();
  });
});

describe('the grown-up removing a player', () => {
  it('clears his "here", his lobby and his proofs in the same update', async () => {
    const lukas = device('p01');
    lukas.start();
    await settle();
    const p05 = device('p05');
    p05.start();
    await settle();
    expect(await run(lukas.invite('p05', await newKeyPair(), 'plants', null))).toBe('ok');
    expect(peekAt('vs/here/p05')).not.toBeNull();
    expect(peekAt('vs/lobby/p05/in/p01')).not.toBeNull();
    expect(peekAt(`proof/p05/${hashes.p05}`)).not.toBeNull();
    p05.stop();
    await pass(1_000);
    const cloud = createFakeCloud(db);
    expect(await cloud.deletePlayer('p05', G)).toBe('ok');
    for (const p of ['vs/here/p05', 'vs/lobby/p05', 'proof/p05', 'players/p05']) expect(peekAt(p)).toBeNull();
    // Removed: off the list (no player record). A new player in that slot may play again.
    expect(await run(device('p05').setBusy(false))).toBe('refused');
    const h = await pinHash('p05', '000');
    expect(await cloud.createPlayer(saveFor('p05', 'New'), h)).toBe('ok');
    hashes.p05 = h;
    await pass(1_000);
    expect(await run(device('p05').setBusy(false))).toBe('ok');
  });
});
