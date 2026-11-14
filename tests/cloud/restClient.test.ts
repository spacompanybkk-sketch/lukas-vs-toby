import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_URL, FAKE_DATABASE_URL, RestCloud, TIMEOUT_MS, boardRowFor, cloudMode, createCloud, lazyCloud, randomVer, saveFromWire, saveToWire } from '../../src/cloud/restClient';
import type { Cloud } from '../../src/cloud/types';
import type { Save } from '../../src/progress/save';
import { T0, hex, saveFor } from './helpers';

type Call = { url: string; method: string; body: unknown };

/** A `fetch` that answers every call with `status` and `data`, and records what it was asked. */
function mockFetch(answer: (call: Call) => { status: number; data?: unknown } | 'network' | 'hang') {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = {
      url: String(input),
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const a = answer(call);
    if (a === 'network') throw new TypeError('Failed to fetch');
    if (a === 'hang') {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return new Response(JSON.stringify(a.data ?? null), { status: a.status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const H = hex('1');
const G = hex('9');
const V1 = '0123456789abcdef';
const V2 = 'fedcba9876543210';
const s: Save = { ...saveFor('p01', 'Lukas'), coins: 50 };
const SV = { '.sv': 'timestamp' };

afterEach(() => {
  vi.useRealTimers();
});

describe('requests', () => {
  it('uses the old game\'s database and the v2 root by default', async () => {
    expect(DATABASE_URL).toBe('https://lukas-toby-plants-vs-zombies-default-rtdb.firebaseio.com');
    const m = mockFetch(() => ({ status: 200, data: null }));
    await new RestCloud({ fetch: m.fetch }).listPlayers();
    await new RestCloud({ fetch: m.fetch, root: 'v2test' }).board();
    expect(m.calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `${DATABASE_URL}/v2/players.json`],
      ['GET', `${DATABASE_URL}/v2test/board.json`],
    ]);
  });

  it('creates a player in ONE multi-path PATCH at the root', async () => {
    const m = mockFetch(() => ({ status: 200, data: {} }));
    expect(await new RestCloud({ fetch: m.fetch, newVer: () => V1 }).createPlayer(s, H)).toBe('ok');
    expect(m.calls).toEqual([{
      url: `${DATABASE_URL}/v2.json`,
      method: 'PATCH',
      body: {
        'secrets/p01': H,
        [`saves/p01/${H}`]: { save: JSON.stringify(s), touch: SV, ver: V1 },
        'players/p01': { name: 'Lukas', picture: s.picture },
        'board/p01': { slot: 'p01', name: 'Lukas', picture: s.picture, stars: 0, wave: 0, versusWins: 0, computerWins: 0, updatedAt: SV },
      },
    }]);
  });

  it('writes a save and its board row in one PATCH, naming its new version and the one it replaces', async () => {
    const m = mockFetch(() => ({ status: 200, data: {} }));
    await new RestCloud({ fetch: m.fetch }).writeSave(s, H, V2, V1);
    await new RestCloud({ fetch: m.fetch }).writeSave(s, H, V1, null);
    expect(m.calls[1]!.body).toEqual({ [`saves/p01/${H}`]: { save: JSON.stringify(s), touch: SV, ver: V1 }, 'board/p01': boardRowFor(s) });
    m.calls.splice(1);
    expect(m.calls).toEqual([{
      url: `${DATABASE_URL}/v2.json`, method: 'PATCH',
      body: { [`saves/p01/${H}`]: { save: JSON.stringify(s), touch: SV, ver: V2, prev: V1 }, 'board/p01': boardRowFor(s) },
    }]);
  });

  it('loads at the exact save path', async () => {
    const m = mockFetch(() => ({ status: 200, data: { save: JSON.stringify(s), touch: T0, ver: V1 } }));
    expect(await new RestCloud({ fetch: m.fetch }).loadSave('p01', H)).toEqual(s);
    expect(await new RestCloud({ fetch: m.fetch }).loadRecord('p01', H)).toEqual({ save: s, ver: V1 });
    expect(m.calls[0]).toMatchObject({ method: 'GET', url: `${DATABASE_URL}/v2/saves/p01/${H}.json` });
  });

  it('deletes and resets with the grown-up proof in the same update', async () => {
    const m = mockFetch(() => ({ status: 200, data: {} }));
    const c = new RestCloud({ fetch: m.fetch, newVer: () => V1 });
    await c.deletePlayer('p01', G);
    await c.resetPin('p01', G, H, s);
    await c.setGrownUpCode(G);
    expect(m.calls[0]!.body).toEqual({
      'secrets/p01': null, 'saves/p01': null, 'players/p01': null, 'board/p01': null, [`admin/proof/${G}`]: { touch: SV },
    });
    expect(m.calls[1]!.body).toEqual({
      'secrets/p01': H,
      'saves/p01': { [H]: { save: JSON.stringify(s), touch: SV, ver: V1 } },
      'players/p01': { name: 'Lukas', picture: s.picture },
      'board/p01': boardRowFor(s),
      [`admin/proof/${G}`]: { touch: SV },
    });
    expect(m.calls[2]).toEqual({ url: `${DATABASE_URL}/v2/admin/secret.json`, method: 'PUT', body: G });
  });

  it('never builds a path from a bad slot or hash', async () => {
    const m = mockFetch(() => ({ status: 200, data: null }));
    const c = new RestCloud({ fetch: m.fetch });
    expect(await c.loadSave('p01', '../admin')).toBe('refused');
    expect(await c.loadSave('p/../x' as 'p01', H)).toBe('refused');
    expect(await c.writeSave(s, 'ABC', V2, V1)).toBe('refused');
    expect(await c.writeSave(s, H, 'short', V1)).toBe('refused');
    expect(await c.writeSave(s, H, V2, 'bad')).toBe('refused');
    expect(await c.createPlayer(s, H, 'XYZ')).toBe('refused');
    expect(await c.deletePlayer('p01', 'x')).toBe('refused');
    expect(await c.resetPin('p02', G, H, s)).toBe('refused');
    expect(await c.setGrownUpCode('nope')).toBe('refused');
    expect(m.calls).toEqual([]);
  });
});

describe('answers', () => {
  const each = (c: RestCloud) => ({
    listPlayers: () => c.listPlayers(),
    createPlayer: () => c.createPlayer(s, H),
    loadSave: () => c.loadSave('p01', H),
    writeSave: () => c.writeSave(s, H, V2, V1),
    board: () => c.board(),
    setGrownUpCode: () => c.setGrownUpCode(G),
    deletePlayer: () => c.deletePlayer('p01', G),
    resetPin: () => c.resetPin('p01', G, H, s),
  });

  it.each([401, 403])('maps HTTP %i by call', async (status) => {
    // createPlayer asks the player list why; answer that one with two players.
    const m = mockFetch((call) => (call.method === 'GET' && call.url.endsWith('/players.json')
      ? { status: 200, data: { p01: { name: 'A', picture: 'peashooter' } } } : { status }));
    const calls = each(new RestCloud({ fetch: m.fetch }));
    const results: Record<string, unknown> = {};
    for (const [name, fn] of Object.entries(calls)) results[name] = await fn();
    expect(results).toEqual({
      listPlayers: [{ slot: 'p01', name: 'A', picture: 'peashooter' }],
      createPlayer: 'taken',
      loadSave: 'wrong-pin',
      writeSave: 'wrong-pin',
      board: 'refused',
      setGrownUpCode: 'refused',
      deletePlayer: 'wrong-pin',
      resetPin: 'wrong-pin',
    });
  });

  it('a refused create is taken when the slot has a player (checked first), full when 30 others do, refused when the slot is free', async () => {
    const thirty = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${String(i + 1).padStart(2, '0')}`, { name: 'A', picture: 'peashooter' }]));
    const full = mockFetch((c) => (c.method === 'GET' ? { status: 200, data: thirty } : { status: 401 }));
    // The 30th create whose answer was lost: its own row is there, so the retry hears taken.
    expect(await new RestCloud({ fetch: full.fetch }).createPlayer(s, H)).toBe('taken');
    expect(await new RestCloud({ fetch: full.fetch }).createPlayer(saveFor('p31'), H)).toBe('full');
    const free = mockFetch((c) => (c.method === 'GET' ? { status: 200, data: null } : { status: 401 }));
    expect(await new RestCloud({ fetch: free.fetch }).createPlayer(s, H)).toBe('refused');
  });

  it.each<['network' | number]>([['network'], [500], [503], [429]])('maps %s to offline for every call', async (how) => {
    const m = mockFetch(() => (how === 'network' ? 'network' : { status: how }));
    for (const fn of Object.values(each(new RestCloud({ fetch: m.fetch })))) expect(await fn()).toBe('offline');
  });

  it('a refused write is a conflict when the stored version is not the one it replaced', async () => {
    const stored = (ver: string) => mockFetch((c) => (c.method === 'PATCH' ? { status: 401 }
      : { status: 200, data: { save: JSON.stringify(s), touch: T0, ver } }));
    expect(await new RestCloud({ fetch: stored(V2).fetch }).writeSave(s, H, hex('3').slice(0, 16), V1)).toBe('conflict');
    expect(await new RestCloud({ fetch: stored(V2).fetch }).writeSave(s, H, V1, null)).toBe('conflict');
    // The stored version is the one named: the refusal was for something else.
    expect(await new RestCloud({ fetch: stored(V1).fetch }).writeSave(s, H, V2, V1)).toBe('refused');
    const gone = mockFetch((c) => (c.method === 'PATCH' ? { status: 401 } : { status: 200, data: null }));
    expect(await new RestCloud({ fetch: gone.fetch }).writeSave(s, H, V2, V1)).toBe('refused');
  });

  it('a stored record without a version is unreadable, not nothing', async () => {
    const m = mockFetch(() => ({ status: 200, data: { save: JSON.stringify(s), touch: T0 } }));
    expect(await new RestCloud({ fetch: m.fetch }).loadRecord('p01', H)).toBe('refused');
  });

  it('randomVer gives 16 hex digits, different each time', () => {
    const a = randomVer();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(Array.from({ length: 50 }, randomVer)).size).toBe(50);
  });

  it('maps HTTP 400 to refused', async () => {
    const m = mockFetch(() => ({ status: 400, data: { error: 'Invalid data' } }));
    const c = new RestCloud({ fetch: m.fetch });
    expect(await c.writeSave(s, H, V2, null)).toBe('refused');
    expect(await c.loadSave('p01', H)).toBe('refused');
  });

  it('maps a body that is not JSON (a captive portal) to offline', async () => {
    const fetch = vi.fn(async () => new Response('<html>log in to the wifi</html>', { status: 200 }));
    expect(await new RestCloud({ fetch: fetch as unknown as typeof globalThis.fetch }).board()).toBe('offline');
  });

  it('gives up after 5 s and reports offline, leaving no timer behind', async () => {
    vi.useFakeTimers();
    expect(TIMEOUT_MS).toBe(5000);
    const m = mockFetch(() => 'hang');
    const p = new RestCloud({ fetch: m.fetch }).loadSave('p01', H);
    let done: unknown = 'not yet';
    void p.then((v) => { done = v; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe('not yet');
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe('offline');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loadSave: null when nothing is stored; refused when what is stored is unreadable or another slot\'s', async () => {
    const answers: unknown[] = [
      null, { save: JSON.stringify({ ...s, coins: -1 }), touch: T0 }, { save: JSON.stringify(saveFor('p02')), touch: T0 }, 'text',
      { save: s, touch: T0 }, { save: '{broken', touch: T0 },
    ];
    const m = mockFetch(() => ({ status: 200, data: answers.shift() }));
    const c = new RestCloud({ fetch: m.fetch });
    expect(await c.loadSave('p01', H)).toBeNull();
    for (let i = 0; i < 5; i++) expect(await c.loadSave('p01', H)).toBe('refused');
  });

  it('skips malformed players and board rows instead of failing', async () => {
    const m = mockFetch((c) => ({
      status: 200,
      data: c.url.endsWith('players.json')
        ? { p02: { name: 'B', picture: 'sunflower' }, p01: { name: 'A', picture: 'peashooter' }, p40: { name: 'X', picture: 'peashooter' }, p03: { name: 'C', picture: 'dragon' } }
        : { p01: { name: 'A', picture: 'peashooter', stars: 3, wave: 2, versusWins: 1, computerWins: 0, updatedAt: T0 }, p02: { name: 'B', picture: 'sunflower', stars: -1 } },
    }));
    const c = new RestCloud({ fetch: m.fetch });
    expect(await c.listPlayers()).toEqual([
      { slot: 'p01', name: 'A', picture: 'peashooter' }, { slot: 'p02', name: 'B', picture: 'sunflower' },
    ]);
    expect(await c.board()).toEqual([
      { slot: 'p01', name: 'A', picture: 'peashooter', stars: 3, wave: 2, versusWins: 1, computerWins: 0, updatedAt: T0 },
    ]);
  });
});

describe('the save on the wire', () => {
  it('is ONE JSON string, read back exactly, whatever the database does to maps and lists', () => {
    const t: Save = { ...s, upgrades: {}, plants: { stars: { w1: 3 }, unlocked: ['peashooter'] } };
    expect(typeof saveToWire(t)).toBe('string');
    expect(saveFromWire(saveToWire(t))).toEqual(t);
  });

  it('carries lastBattle, teached and bestGarden, and reads a string written before they existed', () => {
    const t: Save = { ...s, lastBattle: 'b1', teached: ['p1-1:0'], bestGarden: 5 };
    expect(saveFromWire(saveToWire(t))).toEqual(t);
    const { lastBattle: _l, teached: _t, bestGarden: _g, ...before } = t;
    expect(saveFromWire(JSON.stringify(before))).toEqual({ ...t, lastBattle: null, teached: [], bestGarden: 0 });
  });

  it('refuses anything that is not a string holding a valid save', () => {
    expect(saveFromWire(s)).toBeNull();
    expect(saveFromWire('{nope')).toBeNull();
    expect(saveFromWire(JSON.stringify({ ...s, coins: 1.5 }))).toBeNull();
    expect(saveFromWire(null)).toBeNull();
  });
});

describe('the fake, loaded only when asked for', () => {
  it('createCloud(fake) works through a dynamic import', async () => {
    const c = createCloud('fake');
    expect(await c.listPlayers()).toEqual([]);
    expect(await c.createPlayer(s, H)).toBe('ok');
    expect(await c.loadSave('p01', H)).toEqual(s);
  });

  it('a cloud that fails to load answers offline, and loads on a later call', async () => {
    let tries = 0;
    const inner = { listPlayers: async () => [] } as unknown as Cloud;
    const c = lazyCloud(async () => {
      tries += 1;
      if (tries === 1) throw new Error('chunk missing');
      return inner;
    });
    expect(await c.listPlayers()).toBe('offline');
    expect(await c.listPlayers()).toEqual([]);
    expect(tries).toBe(2);
  });

  it('is not mistaken for a promise', async () => {
    const c = lazyCloud(async () => ({}) as Cloud);
    expect((c as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(c)).resolves.toBe(c);
  });
});

describe('cloudMode', () => {
  it('is the fake until the build flag says live', () => {
    expect(cloudMode('', undefined)).toBe('fake');
    expect(cloudMode('?cloud=test', undefined)).toBe('fake');
    expect(cloudMode('', 'fake')).toBe('fake');
  });

  it('with the flag live: v2 by default; v2test or the fake only with ?debug as well', () => {
    expect(cloudMode('', 'live')).toBe('live');
    expect(cloudMode('?cloud=test&debug', 'live')).toBe('test');
    expect(cloudMode('?x=1&cloud=fake&debug=1', 'live')).toBe('fake');
    expect(cloudMode('?cloud=other&debug', 'live')).toBe('live');
  });

  it('with the flag live, ?cloud=fake or ?cloud=test without ?debug is ignored (a stray link never moves a child off v2)', () => {
    expect(cloudMode('?cloud=test', 'live')).toBe('live');
    expect(cloudMode('?cloud=fake', 'live')).toBe('live');
  });
});

describe('under automation (navigator.webdriver)', () => {
  const okFetch = vi.fn(async () => new Response('null', { status: 200 }));

  it('refuses every call to the live v2 root without making a request', async () => {
    okFetch.mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new RestCloud({ root: 'v2', fetch: okFetch as unknown as typeof fetch, automated: () => true });
    expect(await c.listPlayers()).toBe('refused');
    expect(await c.board()).toBe('refused');
    expect(okFetch).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('runs against v2test, and against the fake, as usual', async () => {
    okFetch.mockClear();
    const test = new RestCloud({ root: 'v2test', fetch: okFetch as unknown as typeof fetch, automated: () => true });
    expect(await test.listPlayers()).toEqual([]);
    const fake = new RestCloud({ baseUrl: FAKE_DATABASE_URL, root: 'v2', fetch: okFetch as unknown as typeof fetch, automated: () => true });
    expect(await fake.listPlayers()).toEqual([]);
    expect(okFetch).toHaveBeenCalledTimes(2);
  });

  it('a person (not automation) reaches v2', async () => {
    okFetch.mockClear();
    const c = new RestCloud({ root: 'v2', fetch: okFetch as unknown as typeof fetch, automated: () => false });
    expect(await c.listPlayers()).toEqual([]);
    expect(okFetch).toHaveBeenCalledTimes(1);
  });
});
