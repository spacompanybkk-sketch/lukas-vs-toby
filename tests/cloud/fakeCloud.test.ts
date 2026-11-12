import { describe, expect, it } from 'vitest';
import { FAKE_DATABASE_URL, FakeDatabase } from '../../src/cloud/fakeCloud';
import type { Json } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { boardRowFor, createFakeCloud } from '../../src/cloud/restClient';
import { T0, hex, makeClock, saveFor } from './helpers';

const SV = { '.sv': 'timestamp' };

/** Raw REST calls against the fake, the way a forger would make them. */
function raw(db: FakeDatabase) {
  const call = async (method: string, path: string, body?: Json): Promise<{ status: number; data: unknown }> => {
    const res = await db.fetch(`${FAKE_DATABASE_URL}/${path}.json`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: await res.json() };
  };
  return {
    get: (p: string) => call('GET', p),
    put: (p: string, b: Json) => call('PUT', p, b),
    patch: (p: string, b: Json) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
  };
}

/** A database with p01 (pin 123) and p02 (pin 456), and the grown-up code hex('a'). */
async function world() {
  const clock = makeClock();
  const db = new FakeDatabase({ now: clock.now });
  const cloud = createFakeCloud(db);
  const h1 = await pinHash('p01', '123');
  const h2 = await pinHash('p02', '456');
  await cloud.createPlayer(saveFor('p01', 'Lukas'), h1);
  await cloud.createPlayer(saveFor('p02', 'Toby'), h2);
  await cloud.setGrownUpCode(hex('a'));
  clock.t = T0 + 1000;
  return { db, r: raw(db), h1, h2, clock };
}

const row = (slot: 'p01' | 'p02', extra: Record<string, Json> = {}): Json =>
  ({ ...(boardRowFor(saveFor(slot)) as Record<string, Json>), ...extra });

describe('the fake database enforces the rules file', () => {
  it('reads: players and board are public; secrets, saves listings, admin and the roots are not', async () => {
    const { r, h1 } = await world();
    expect((await r.get('v2/players')).status).toBe(200);
    expect((await r.get('v2/board')).status).toBe(200);
    for (const p of ['v2', 'v2test', 'v2/secrets', 'v2/secrets/p01', 'v2/saves', 'v2/saves/p01', 'v2/admin', 'v2/admin/secret', '']) {
      expect((await r.get(p)).status, p).toBe(401);
    }
    expect((await r.get(`v2/saves/p01/${h1}`)).status).toBe(200);
    expect((await r.get(`v2/saves/p01/${hex('0')}`)).status).toBe(401);
  });

  it('refuses a save written under a hash that is not the slot\'s secret', async () => {
    const { r } = await world();
    const res = await r.patch('v2', { [`saves/p01/${hex('0')}`]: { save: saveFor('p01') as unknown as Json, touch: SV } });
    expect(res.status).toBe(401);
  });

  it('refuses a board or player row without the pin proof', async () => {
    const { r, db } = await world();
    expect((await r.put('v2/board/p01', row('p01', { stars: 240, updatedAt: SV }))).status).toBe(401);
    expect((await r.put('v2/players/p01', { name: 'Hacked', picture: 'peashooter' })).status).toBe(401);
    expect((await r.del('v2/players/p01')).status).toBe(401);
    expect(db.peek('v2/players/p01')).toMatchObject({ name: 'Lukas' });
  });

  it('refuses another player\'s leaderboard row, even with your own proof', async () => {
    const { r, h2 } = await world();
    const res = await r.patch('v2', {
      [`saves/p02/${h2}`]: { save: saveFor('p02', 'Toby') as unknown as Json, touch: SV },
      'board/p01': row('p01', { stars: 0, updatedAt: SV }),
    });
    expect(res.status).toBe(401);
  });

  it('refuses a stale touch: the proof must be written in this very update', async () => {
    const { r, h1 } = await world();
    const res = await r.patch('v2', {
      [`saves/p01/${h1}`]: { save: saveFor('p01', 'Lukas') as unknown as Json, touch: T0 },
      'board/p01': row('p01', { updatedAt: SV }),
    });
    expect(res.status).toBe(401);
    // Writing the board row alone, relying on an earlier touch, fails too.
    expect((await r.put('v2/board/p01', row('p01', { updatedAt: SV }))).status).toBe(401);
  });

  it('accepts the owner\'s honest update', async () => {
    const { r, h1 } = await world();
    const res = await r.patch('v2', {
      [`saves/p01/${h1}`]: { save: saveFor('p01', 'Lukas') as unknown as Json, touch: SV },
      'board/p01': row('p01', { stars: 12, updatedAt: SV }),
    });
    expect(res.status).toBe(200);
  });

  it.each<[string, Record<string, Json>]>([
    ['stars 241', { stars: 241 }],
    ['stars -1', { stars: -1 }],
    ['stars 1.5', { stars: 1.5 }],
    ['wave 10000', { wave: 10_000 }],
    ['versusWins 100000', { versusWins: 100_000 }],
    ['computerWins as text', { computerWins: '5' }],
    ['updatedAt in the future', { updatedAt: T0 + 999_999 }],
    ['a name of 11 letters', { name: 'ABCDEFGHIJK' }],
    ['a name with a space', { name: 'Lu kas' }],
    ['an unknown picture', { picture: 'boneMinion' }],
    ['another slot inside the row', { slot: 'p02' }],
    ['an extra field', { email: 'x@y.z' }],
  ])('refuses absurd numbers in the owner\'s own row: %s', async (_what, extra) => {
    const { r, h1 } = await world();
    const res = await r.patch('v2', {
      [`saves/p01/${h1}`]: { save: saveFor('p01', 'Lukas') as unknown as Json, touch: SV },
      'board/p01': row('p01', { updatedAt: SV, ...extra }),
    });
    expect(res.status).toBe(401);
  });

  it('refuses a 31st slot even with every proof in place', async () => {
    const { r } = await world();
    const h = await pinHash('p31', '000');
    const s = saveFor('p31') as unknown as Json;
    const res = await r.patch('v2', {
      'secrets/p31': h,
      [`saves/p31/${h}`]: { save: s, touch: SV },
      'players/p31': { name: 'Extra', picture: 'peashooter' },
      'board/p31': { ...(row('p01') as Record<string, Json>), slot: 'p31', updatedAt: SV },
    });
    expect(res.status).toBe(401);
  });

  it('refuses overwriting a secret, and a secret that is not 64 hex digits', async () => {
    const { r, db, h1 } = await world();
    expect((await r.put('v2/secrets/p01', hex('b'))).status).toBe(401);
    expect((await r.del('v2/secrets/p01')).status).toBe(401);
    expect(db.peek('v2/secrets/p01')).toBe(h1);
    const res = await r.patch('v2', {
      'secrets/p05': 'short',
      'players/p05': { name: 'Eve', picture: 'peashooter' },
    });
    expect(res.status).toBe(401);
  });

  it('refuses a secret claimed without its player row (no ghost slots)', async () => {
    const { r } = await world();
    expect((await r.put('v2/secrets/p09', hex('c'))).status).toBe(401);
  });

  it('refuses changing the grown-up code, and a proof under any other hash', async () => {
    const { r } = await world();
    expect((await r.put('v2/admin/secret', hex('b'))).status).toBe(401);
    expect((await r.put(`v2/admin/proof/${hex('b')}`, { touch: SV })).status).toBe(401);
    const res = await r.patch('v2', { 'players/p01': null, [`admin/proof/${hex('b')}`]: { touch: SV } });
    expect(res.status).toBe(401);
    expect((await r.put(`v2/admin/proof/${hex('a')}`, { touch: SV })).status).toBe(200);
    expect((await r.put(`v2/admin/proof/${hex('a')}`, { touch: T0 })).status).toBe(401);
  });

  it('refuses anything else under v2 and v2test', async () => {
    const { r } = await world();
    expect((await r.put('v2/notes', 'hi')).status).toBe(401);
    expect((await r.put('v2test/notes', 'hi')).status).toBe(401);
    expect((await r.put('v2', { players: null })).status).toBe(401);
    expect((await r.put('elsewhere', 1)).status).toBe(401);
  });

  it('leaves the old open paths open', async () => {
    const { r } = await world();
    for (const p of ['presence', 'rooms', 'challenges']) {
      expect((await r.put(`${p}/x`, { a: 1 })).status, p).toBe(200);
      expect((await r.get(p)).data, p).toEqual({ x: { a: 1 } });
    }
  });

  it('applies a multi-path update atomically: one refused path writes nothing', async () => {
    const { r, db, h1 } = await world();
    const res = await r.patch('', {
      'presence/lukas': true,
      [`v2/saves/p01/${h1}`]: { save: saveFor('p01', 'Lukas') as unknown as Json, touch: SV },
      'v2/board/p02': row('p02', { updatedAt: SV }),
    });
    expect(res.status).toBe(401);
    expect(db.peek('presence')).toBeNull();
  });

  it('refuses overlapping paths in one update', async () => {
    const { r } = await world();
    expect((await r.patch('', { 'presence/a': 1, 'presence/a/b': 2 })).status).toBe(400);
  });

  it('stores like the real database: no empty objects, arrays by index, server time', async () => {
    const clock = makeClock();
    const db = new FakeDatabase({ now: clock.now });
    const r = raw(db);
    await r.put('rooms/a', { empty: {}, list: ['x', 'y'], when: SV, nested: { gone: {} } });
    expect(db.peek('rooms/a')).toEqual({ list: ['x', 'y'], when: T0 });
    expect(db.peek('rooms/a/list/1')).toBe('y');
  });
});

describe('fake database controls', () => {
  it('keeps its data in the given storage between page loads', async () => {
    const { MemoryStorage } = await import('../progress/memoryStorage');
    const storage = new MemoryStorage();
    const a = createFakeCloud(new FakeDatabase({ storage }));
    const h = await pinHash('p01', '123');
    await a.createPlayer(saveFor('p01'), h);
    const b = createFakeCloud(new FakeDatabase({ storage }));
    expect(await b.loadSave('p01', h)).toEqual(saveFor('p01'));
  });

  it('logs requests, fails while offline, and can apply a write but lose the answer', async () => {
    const db = new FakeDatabase({ now: () => T0 });
    const r = raw(db);
    db.offline = true;
    await expect(r.get('presence')).rejects.toThrow(TypeError);
    db.offline = false;
    db.loseResponses = 1;
    await expect(r.put('presence/a', 1)).rejects.toThrow(TypeError);
    expect(db.peek('presence/a')).toBe(1);
    expect(db.requests.map((q) => q.status)).toEqual(['offline', 'lost']);
  });
});
