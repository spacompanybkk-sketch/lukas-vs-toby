import { describe, expect, it } from 'vitest';
import { FAKE_DATABASE_URL, FakeDatabase } from '../../src/cloud/fakeCloud';
import type { Json } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { boardRowFor, createFakeCloud } from '../../src/cloud/restClient';
import { T0, hex, makeClock, saveFor } from './helpers';

const SV = { '.sv': 'timestamp' };
/** Version ids: p01 and p02 are created as VA and VB; NEW is the next one a writer picks. */
const VA = 'aaaaaaaaaaaaaaaa';
const VB = 'bbbbbbbbbbbbbbbb';
const NEW = 'cccccccccccccccc';

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
  await cloud.createPlayer(saveFor('p01', 'Lukas'), h1, VA);
  await cloud.createPlayer(saveFor('p02', 'Toby'), h2, VB);
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
    const res = await r.patch('v2', { [`saves/p01/${hex('0')}`]: { save: JSON.stringify(saveFor('p01')), touch: SV, ver: NEW } });
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
      [`saves/p02/${h2}`]: { save: JSON.stringify(saveFor('p02', 'Toby')), touch: SV, ver: NEW, prev: VB },
      'board/p01': row('p01', { stars: 0, updatedAt: SV }),
    });
    expect(res.status).toBe(401);
  });

  it('refuses a stale touch: the proof must be written in this very update', async () => {
    const { r, h1 } = await world();
    const res = await r.patch('v2', {
      [`saves/p01/${h1}`]: { save: JSON.stringify(saveFor('p01', 'Lukas')), touch: T0, ver: NEW, prev: VA },
      'board/p01': row('p01', { updatedAt: SV }),
    });
    expect(res.status).toBe(401);
    // Writing the board row alone, relying on an earlier touch, fails too.
    expect((await r.put('v2/board/p01', row('p01', { updatedAt: SV }))).status).toBe(401);
  });

  it('accepts the owner\'s honest update', async () => {
    const { r, h1 } = await world();
    const res = await r.patch('v2', {
      [`saves/p01/${h1}`]: { save: JSON.stringify(saveFor('p01', 'Lukas')), touch: SV, ver: NEW, prev: VA },
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
      [`saves/p01/${h1}`]: { save: JSON.stringify(saveFor('p01', 'Lukas')), touch: SV, ver: NEW, prev: VA },
      'board/p01': row('p01', { updatedAt: SV, ...extra }),
    });
    expect(res.status).toBe(401);
  });

  it('refuses a 31st slot even with every proof in place', async () => {
    const { r } = await world();
    const h = await pinHash('p31', '000');
    const s = JSON.stringify(saveFor('p31'));
    const res = await r.patch('v2', {
      'secrets/p31': h,
      [`saves/p31/${h}`]: { save: s, touch: SV, ver: NEW },
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
      [`v2/saves/p01/${h1}`]: { save: JSON.stringify(saveFor('p01', 'Lukas')), touch: SV, ver: NEW, prev: VA },
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

describe('fix round 1: no ghosts, no self-deletes, bounded saves, a changeable grown-up code', () => {
  it('refuses the owner deleting their own player or board row (it would leave a ghost slot)', async () => {
    const { r, db, h1 } = await world();
    for (const path of ['players/p01', 'board/p01']) {
      const res = await r.patch('v2', {
        [`saves/p01/${h1}`]: { save: JSON.stringify(saveFor('p01', 'Lukas')), touch: SV, ver: NEW, prev: VA },
        [path]: null,
      });
      expect(res.status, path).toBe(401);
    }
    expect(db.peek('v2/players/p01')).not.toBeNull();
    expect(db.peek('v2/board/p01')).not.toBeNull();
  });

  it('refuses deleting saves without the grown-up proof, even the owner\'s own', async () => {
    const { r, db, h1 } = await world();
    expect((await r.del('v2/saves/p01')).status).toBe(401);
    expect((await r.del(`v2/saves/p01/${h1}`)).status).toBe(401);
    expect((await r.patch('v2', { 'saves/p01': null, 'players/p01': null })).status).toBe(401);
    expect(db.peek(`v2/saves/p01/${h1}`)).not.toBeNull();
    const ok = await r.patch('v2', { 'saves/p01': null, [`admin/proof/${hex('a')}`]: { touch: SV } });
    expect(ok.status).toBe(200);
  });

  it('refuses claiming a slot whose player row exists without a secret', async () => {
    const { r, db } = await world();
    db.poke('v2/players/p09', { name: 'Orphan', picture: 'peashooter' });
    const h = await pinHash('p09', '000');
    const res = await r.patch('v2', {
      'secrets/p09': h,
      [`saves/p09/${h}`]: { save: JSON.stringify(saveFor('p09')), touch: SV, ver: NEW },
      'players/p09': { name: 'Thief', picture: 'peashooter' },
      'board/p09': { ...(row('p01') as Record<string, Json>), slot: 'p09', updatedAt: SV },
    });
    expect(res.status).toBe(401);
    expect(db.peek('v2/players/p09')).toMatchObject({ name: 'Orphan' });
  });

  it.each<[string, Json]>([
    ['an object', saveFor('p01', 'Lukas') as unknown as Json],
    ['a number', 5],
    ['a string over 20,000 characters', 'x'.repeat(20_001)],
  ])('refuses a save that is %s', async (_what, save) => {
    const { r, h1 } = await world();
    const res = await r.patch('v2', { [`saves/p01/${h1}`]: { save, touch: SV, ver: NEW, prev: VA }, 'board/p01': row('p01', { updatedAt: SV }) });
    expect(res.status).toBe(401);
  });

  it('accepts a save string of exactly 20,000 characters', async () => {
    const { r, h1 } = await world();
    const res = await r.patch('v2', { [`saves/p01/${h1}`]: { save: 'x'.repeat(20_000), touch: SV, ver: NEW, prev: VA }, 'board/p01': row('p01', { updatedAt: SV }) });
    expect(res.status).toBe(200);
  });

  it('changes the grown-up code only with the current one', async () => {
    const { db } = await world();
    const cloud = createFakeCloud(db);
    expect(await cloud.changeGrownUpCode(hex('b'), hex('c'))).toBe('wrong-pin');
    expect(await cloud.changeGrownUpCode(hex('a'), hex('c'))).toBe('ok');
    expect(db.peek('v2/admin/secret')).toBe(hex('c'));
    expect(await cloud.deletePlayer('p01', hex('a'))).toBe('wrong-pin');
    expect(await cloud.deletePlayer('p01', hex('c'))).toBe('ok');
  });
});

describe('the fake is never more permissive than the real database', () => {
  it('fails a rule whose child() path has an empty segment', async () => {
    const rules = { rules: { a: { '.read': true, '.write': "!root.child('x//y').exists()" } } };
    const db = new FakeDatabase({ now: () => T0, rules });
    expect((await raw(db).put('a', 1)).status).toBe(401);
    const ok = new FakeDatabase({ now: () => T0, rules: { rules: { a: { '.write': "!root.child('x/y').exists()" } } } });
    expect((await raw(ok).put('a', 1)).status).toBe(200);
  });

  it('refuses at once a rules file whose .matches it cannot evaluate', () => {
    expect(() => new FakeDatabase({ rules: { rules: { a: { '.write': "data.val().matches(/x/)" } } } })).toThrow();
  });

  it('does not touch String.prototype', () => {
    expect(Object.getOwnPropertySymbols(String.prototype).map((s) => s.description)).not.toContain('rules.matches');
    expect((String.prototype as unknown as Record<string, unknown>).matches).toBeUndefined();
  });
});

describe('fix round 2: compare-and-swap and a grown-up code that cannot be deleted', () => {
  const write = (h: string, extra: Record<string, Json>) => ({
    [`saves/p01/${h}`]: { save: JSON.stringify(saveFor('p01', 'Lukas')), touch: SV, ...extra },
    'board/p01': row('p01', { updatedAt: SV }),
  });

  it('accepts a write naming the stored version, and only once', async () => {
    const { r, db, h1 } = await world();
    expect((await r.patch('v2', write(h1, { ver: NEW, prev: VA }))).status).toBe(200);
    expect(db.peek(`v2/saves/p01/${h1}/ver`)).toBe(NEW);
    // The second writer from the same version is refused.
    expect((await r.patch('v2', write(h1, { ver: 'dddddddddddddddd', prev: VA }))).status).toBe(401);
  });

  it.each<[string, Record<string, Json>]>([
    ['no prev over a stored record', { ver: NEW }],
    ['a stale prev', { ver: NEW, prev: 'eeeeeeeeeeeeeeee' }],
    ['the stored version again as the new one', { ver: VA, prev: VA }],
    ['no version at all', { prev: VA }],
    ['a version that is not 16 hex digits', { ver: 'XYZ', prev: VA }],
    ['a prev that is not 16 hex digits', { ver: NEW, prev: 'short' }],
  ])('refuses %s', async (_what, extra) => {
    const { r, db, h1 } = await world();
    expect((await r.patch('v2', write(h1, extra))).status).toBe(401);
    expect(db.peek(`v2/saves/p01/${h1}/ver`)).toBe(VA);
  });

  it('never deletes the grown-up code, even with its proof', async () => {
    const { r, db } = await world();
    expect((await r.del('v2/admin/secret')).status).toBe(401);
    expect((await r.patch('v2', { 'admin/secret': null, [`admin/proof/${hex('a')}`]: { touch: SV } })).status).toBe(401);
    expect(db.peek('v2/admin/secret')).toBe(hex('a'));
  });
});
