import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectionTo, fakeDbUrl, pageConnection } from '../../src/cloud/connection';
import { pinHash } from '../../src/cloud/hash';
import { FAKE_DATABASE_URL, RestCloud, createCloud, defaultCloud } from '../../src/cloud/restClient';
import { saveFor } from './helpers';

describe('fakeDbUrl', () => {
  it('takes a localhost or 127.0.0.1 address with a port, in fake mode only', () => {
    expect(fakeDbUrl('?debug&cloud=fake&fakedb=http://localhost:5316', 'fake')).toBe('http://localhost:5316');
    expect(fakeDbUrl('?fakedb=http://127.0.0.1:5400/', 'fake')).toBe('http://127.0.0.1:5400');
  });

  it('refuses anything else', () => {
    for (const bad of [
      'http://evil.example', 'http://evil.example:5316', 'https://localhost:5316/x', 'https://localhost:5316',
      'http://localhost:5316/x', 'http://localhost', 'http://user@localhost:5316', 'http://localhost:5316?x=1',
      'http://localhost.evil.example:5316', 'javascript:alert(1)', '',
    ]) {
      expect(fakeDbUrl(`?debug&cloud=fake&fakedb=${encodeURIComponent(bad)}`, 'fake'), bad).toBeNull();
    }
    expect(fakeDbUrl('?debug&cloud=fake', 'fake')).toBeNull();
    expect(fakeDbUrl('?debug&cloud=fake&fakedb=http://localhost:5316', 'test')).toBeNull();
    expect(fakeDbUrl('?debug&cloud=fake&fakedb=http://localhost:5316', 'live')).toBeNull();
  });
});

describe('a connection', () => {
  it('builds REST URLs under its root, query values JSON-quoted', () => {
    const c = connectionTo('http://localhost:5316', 'v2test', globalThis.fetch, () => { throw new Error('unused'); });
    expect(c.root).toBe('v2test');
    expect(c.url('vs/here')).toBe('http://localhost:5316/v2test/vs/here.json');
    expect(c.url('')).toBe('http://localhost:5316/v2test.json');
    const u = new URL(c.url('vs/matches/ab/turns/plants', { orderBy: '$key', startAt: 't000002' }));
    expect(u.pathname).toBe('/v2test/vs/matches/ab/turns/plants.json');
    expect([...u.searchParams]).toEqual([['orderBy', '"$key"'], ['startAt', '"t000002"']]);
  });
});

describe('the page connection', () => {
  // Node's own localStorage needs a file; this page keeps its fake in memory.
  beforeAll(() => { vi.stubGlobal('localStorage', undefined); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('in fake mode it is the same database as the page\'s cloud', async () => {
    const conn = await pageConnection();
    expect(conn.root).toBe('v2');
    expect(conn.url('players').startsWith(`${FAKE_DATABASE_URL}/`)).toBe(true);
    const h = await pinHash('p03', '333');
    const s = saveFor('p03', 'Ada');
    const res = await conn.fetch(conn.url(''), {
      method: 'PATCH',
      body: JSON.stringify({
        [`secrets/p03`]: h,
        [`saves/p03/${h}`]: { save: JSON.stringify(s), touch: { '.sv': 'timestamp' }, ver: 'aaaaaaaaaaaaaaaa' },
        'players/p03': { name: 'Ada', picture: s.picture },
        'board/p03': { slot: 'p03', name: 'Ada', picture: s.picture, stars: 0, wave: 0, versusWins: 0, computerWins: 0, updatedAt: { '.sv': 'timestamp' } },
      }),
    });
    expect(res.status).toBe(200);
    expect(await defaultCloud().listPlayers()).toEqual([{ slot: 'p03', name: 'Ada', picture: s.picture }]);
    // A second page connection is that same database too.
    const again = await pageConnection();
    const back = await (await again.fetch(again.url('players/p03'))).json();
    expect(back).toEqual({ name: 'Ada', picture: s.picture });
  });

  it('createCloud(fake) with a fakedb address is the REST client on that server\'s v2test', async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response('null', { status: 200 });
    }) as typeof fetch;
    try {
      const c = createCloud('fake', {}, 'http://localhost:5316');
      expect(c).toBeInstanceOf(RestCloud);
      expect(await c.listPlayers()).toEqual([]);
      expect(calls).toEqual(['http://localhost:5316/v2test/players.json']);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
