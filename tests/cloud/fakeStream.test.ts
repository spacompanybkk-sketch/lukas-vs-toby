import { describe, expect, it } from 'vitest';
import { FAKE_DATABASE_URL, FakeDatabase } from '../../src/cloud/fakeCloud';
import type { Json } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud } from '../../src/cloud/restClient';
import { T0, makeClock, saveFor } from './helpers';

/**
 * The fake database's streaming (spec 6.1, 8.5, 12): an `EventSource` for its own URLs that
 * sends what the REST API sends — `put`/`cancel` events whose `data` is JSON text — after the
 * same read rules as a GET, with `orderBy="$key"` and `startAt`/`endAt`.
 */

const SV = { '.sv': 'timestamp' };
const ID = '3f9c0a1e5b7d24c68e0f1a2b3c4d5e6f';
const MATCH = `v2/vs/matches/${ID}`;

interface Heard { type: string; data: unknown }

/** Everything an open stream hears, in order; JSON parsed. */
function listen(db: FakeDatabase, path: string, query: Record<string, string> = {}) {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, JSON.stringify(v)])).toString();
  const es = db.eventSource(`${FAKE_DATABASE_URL}/${path}.json${q ? `?${q}` : ''}`);
  const heard: Heard[] = [];
  for (const type of ['open', 'put', 'patch', 'keep-alive', 'cancel']) {
    es.addEventListener(type, (e) => heard.push({ type, data: type === 'open' ? null : JSON.parse(e.data) }));
  }
  es.onerror = () => heard.push({ type: 'error', data: null });
  return { es, heard };
}

/** Lets every queued event and answer arrive. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

async function patch(db: FakeDatabase, path: string, body: Record<string, Json>): Promise<number> {
  const res = await db.fetch(`${FAKE_DATABASE_URL}/${path}.json`, { method: 'PATCH', body: JSON.stringify(body) });
  return res.status;
}

function matchWithTurns(db: FakeDatabase, n: number): void {
  const plants: Record<string, Json> = {};
  for (let k = 0; k < n; k++) plants[`t${String(k).padStart(6, '0')}`] = '{}';
  db.poke(MATCH, {
    meta: { v: 1, build: '2289558', seed: 1, seats: { plants: 'p01', zombies: 'p02' }, host: 'p02', turn: 6, delay: 12, created: T0 },
    ready: { plants: T0, zombies: T0 },
    turns: { plants, zombies: { t000000: '{}' } },
  });
}

describe('fake streaming', () => {
  it('opens with a put of the current value at /, then a put at the written path, relative', async () => {
    const clock = makeClock();
    const db = new FakeDatabase({ now: clock.now });
    const cloud = createFakeCloud(db);
    const { heard } = listen(db, 'v2/players');
    await settle();
    expect(heard).toEqual([{ type: 'open', data: null }, { type: 'put', data: { path: '/', data: null } }]);
    expect(await cloud.createPlayer(saveFor('p01', 'Lukas'), await pinHash('p01', '123'))).toBe('ok');
    await settle();
    expect(heard.slice(2)).toEqual([{ type: 'put', data: { path: '/p01', data: { name: 'Lukas', picture: saveFor('p01').picture } } }]);
    expect(db.openStreams()).toBe(1);
  });

  it('a multi-path PATCH sends one put per written path, with the server time as the request\'s now', async () => {
    const clock = makeClock();
    const db = new FakeDatabase({ now: clock.now });
    matchWithTurns(db, 1);
    const { heard } = listen(db, MATCH);
    await settle();
    expect(heard[1]).toMatchObject({ type: 'put', data: { path: '/' } });
    clock.t = T0 + 777;
    expect(await patch(db, MATCH, { 'turns/plants/t000001': '{}', 'turns/zombies/t000001': '{"c":[]}', 'sync/s1': { tick: 6, snap: '{}' } })).toBe(200);
    db.poke(`${MATCH}/again/plants`, SV);
    await settle();
    expect(heard.slice(2)).toEqual([
      { type: 'put', data: { path: '/turns/plants/t000001', data: '{}' } },
      { type: 'put', data: { path: '/turns/zombies/t000001', data: '{"c":[]}' } },
      { type: 'put', data: { path: '/sync/s1', data: { tick: 6, snap: '{}' } } },
      { type: 'put', data: { path: '/again/plants', data: T0 + 777 } },
    ]);
  });

  it('a write above the stream sends a put at /; a write beside it sends nothing', async () => {
    const db = new FakeDatabase({ now: makeClock().now });
    matchWithTurns(db, 1);
    const { heard } = listen(db, `${MATCH}/turns/plants`);
    await settle();
    db.poke(`${MATCH}/turns`, { plants: { t000000: 'a' } });
    db.poke(`${MATCH}/ready/plants`, 5);
    await settle();
    expect(heard.slice(2)).toEqual([{ type: 'put', data: { path: '/', data: { t000000: 'a' } } }]);
  });

  it('an unreadable path is cancelled, and so is a stream the rules stop allowing', async () => {
    const db = new FakeDatabase({ now: makeClock().now });
    const a = listen(db, 'v2/secrets');
    const b = listen(db, 'v2/vs/matches');
    await settle();
    expect(a.heard).toEqual([{ type: 'open', data: null }, { type: 'cancel', data: 'Permission denied' }]);
    expect(b.heard.map((h) => h.type)).toEqual(['open', 'cancel']);
    expect(db.openStreams()).toBe(0);
    expect(db.requests.map((r) => [r.method, r.path, r.status])).toEqual([['STREAM', '/v2/secrets', 401], ['STREAM', '/v2/vs/matches', 401]]);
    // A save is readable under its slot's pin hash only: a new pin cancels the open stream.
    db.poke('v2/secrets/p01', 'a'.repeat(64));
    const save = listen(db, `v2/saves/p01/${'a'.repeat(64)}`);
    await settle();
    expect(save.heard.map((h) => h.type)).toEqual(['open', 'put']);
    db.poke('v2/secrets/p01', 'b'.repeat(64));
    await settle();
    expect(save.heard.slice(2)).toEqual([{ type: 'cancel', data: 'Permission denied' }]);
    expect(db.openStreams()).toBe(0);
  });

  it('orderBy="$key" with startAt leaves out the earlier turns, at the open and later', async () => {
    const db = new FakeDatabase({ now: makeClock().now });
    matchWithTurns(db, 4);
    const { heard } = listen(db, `${MATCH}/turns/plants`, { orderBy: '$key', startAt: 't000002' });
    await settle();
    expect(heard[1]).toEqual({ type: 'put', data: { path: '/', data: { t000002: '{}', t000003: '{}' } } });
    db.poke(`${MATCH}/turns/plants/t000001`, 'late');
    db.poke(`${MATCH}/turns/plants/t000004`, '{}');
    await settle();
    expect(heard.slice(2)).toEqual([{ type: 'put', data: { path: '/t000004', data: '{}' } }]);
  });

  it('endAt="sync" on a match root leaves out the turns', async () => {
    const db = new FakeDatabase({ now: makeClock().now });
    matchWithTurns(db, 2);
    const { heard } = listen(db, MATCH, { orderBy: '$key', endAt: 'sync' });
    await settle();
    const first = (heard[1]!.data as { data: Record<string, unknown> }).data;
    expect(Object.keys(first).sort()).toEqual(['meta', 'ready']);
    expect(await patch(db, MATCH, { 'turns/plants/t000002': '{}', 'pause': { by: 'p02', n: 1 } })).toBe(200);
    await settle();
    expect(heard.slice(2)).toEqual([{ type: 'put', data: { path: '/pause', data: { by: 'p02', n: 1 } } }]);
  });

  it('a GET honours the same query', async () => {
    const db = new FakeDatabase({ now: makeClock().now });
    matchWithTurns(db, 3);
    const q = `orderBy=${encodeURIComponent('"$key"')}&startAt=${encodeURIComponent('"t000001"')}`;
    const res = await db.fetch(`${FAKE_DATABASE_URL}/${MATCH}/turns/plants.json?${q}`);
    expect(await res.json()).toEqual({ t000001: '{}', t000002: '{}' });
    const bad = await db.fetch(`${FAKE_DATABASE_URL}/${MATCH}/turns/plants.json?startAt=%22t%22`);
    expect(bad.status).toBe(400);
  });

  it('a query the fake does not model fails as an error, never as more data than asked', async () => {
    const db = new FakeDatabase({ now: makeClock().now });
    matchWithTurns(db, 1);
    const { heard } = listen(db, `${MATCH}/turns/plants`, { orderBy: 'tick' });
    await settle();
    expect(heard).toEqual([{ type: 'error', data: null }]);
    expect(db.openStreams()).toBe(0);
  });

  it('dropStreams() errors every open stream (a lost Wi-Fi); closed streams hear nothing more', async () => {
    const db = new FakeDatabase({ now: makeClock().now });
    const a = listen(db, 'v2/players');
    const b = listen(db, 'v2/board');
    const c = listen(db, 'v2/players');
    await settle();
    c.es.close();
    expect(db.openStreams()).toBe(2);
    db.dropStreams();
    db.poke('v2/players/p01', { name: 'X', picture: 'cat' });
    await settle();
    expect(a.heard.map((h) => h.type)).toEqual(['open', 'put', 'error']);
    expect(b.heard.map((h) => h.type)).toEqual(['open', 'put', 'error']);
    expect(c.heard.map((h) => h.type)).toEqual(['open', 'put']);
    expect(db.openStreams()).toBe(0);
  });

  it('an offline database fails a new stream at once; a stream for another host never opens', async () => {
    const db = new FakeDatabase({ now: makeClock().now });
    db.offline = true;
    const a = listen(db, 'v2/players');
    const other = db.eventSource('https://example.firebaseio.com/v2/players.json');
    let otherFailed = false;
    other.onerror = () => { otherFailed = true; };
    await settle();
    expect(a.heard).toEqual([{ type: 'error', data: null }]);
    expect(otherFailed).toBe(true);
    expect(db.openStreams()).toBe(0);
  });
});
