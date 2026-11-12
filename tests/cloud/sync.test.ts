import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud } from '../../src/cloud/restClient';
import { BACKOFF, SaveSync, reconcile } from '../../src/cloud/sync';
import type { Cloud } from '../../src/cloud/types';
import { lastSlot, loadLocal, saveLocal } from '../../src/progress/localStore';
import type { Save } from '../../src/progress/save';
import { MemoryStorage } from '../progress/memoryStorage';
import { T0, makeClock, saveFor } from './helpers';

const at = (t: number, coins = 0): Save => ({ ...saveFor('p01', 'Lukas'), coins, updatedAt: t });

describe('reconcile', () => {
  it.each<[string, Save | null, Save | null, { use: Save | null; push: boolean; store: boolean }]>([
    ['nothing anywhere', null, null, { use: null, push: false, store: false }],
    ['only the device has it', at(T0, 1), null, { use: at(T0, 1), push: true, store: false }],
    ['only the cloud has it', null, at(T0, 2), { use: at(T0, 2), push: false, store: true }],
    ['the device is newer', at(T0 + 5, 1), at(T0, 2), { use: at(T0 + 5, 1), push: true, store: false }],
    ['the cloud is newer', at(T0, 1), at(T0 + 5, 2), { use: at(T0 + 5, 2), push: false, store: true }],
    ['equal: no work', at(T0, 1), at(T0, 1), { use: at(T0, 1), push: false, store: false }],
  ])('%s', (_what, local, remote, expected) => {
    expect(reconcile(local, remote)).toEqual(expected);
  });

  it('keeps the newer save whole, never field by field', () => {
    const older: Save = { ...at(T0), coins: 999, bestWave: 50 };
    const newer: Save = { ...at(T0 + 1), coins: 1, bestWave: 2 };
    expect(reconcile(older, newer).use).toBe(newer);
    expect(reconcile(newer, older).use).toBe(newer);
  });
});

/** A device's own view of the cloud, whose connection the test can cut. */
function device(inner: Cloud) {
  const net = { down: false, writes: [] as { save: Save; result: string }[], loads: 0 };
  const cloud = new Proxy(inner, {
    get(target, key: keyof Cloud) {
      return async (...args: unknown[]) => {
        if (key === 'loadSave') net.loads += 1;
        const result = net.down ? 'offline' : await (target[key] as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        if (key === 'writeSave') net.writes.push({ save: args[0] as Save, result: result as string });
        return result;
      };
    },
  });
  return { cloud, net };
}

/** Something with addEventListener, that the test can fire and count. */
function events(visibilityState = 'visible') {
  const fns = new Map<string, Set<() => void>>();
  return {
    visibilityState,
    addEventListener(type: string, fn: () => void) { if (!fns.has(type)) fns.set(type, new Set()); fns.get(type)!.add(fn); },
    removeEventListener(type: string, fn: () => void) { fns.get(type)?.delete(fn); },
    fire(type: string) { for (const fn of fns.get(type) ?? []) fn(); },
    count() { let n = 0; for (const s of fns.values()) n += s.size; return n; },
  };
}

describe('SaveSync', () => {
  let clock: ReturnType<typeof makeClock>;
  let db: FakeDatabase;
  let shared: Cloud;
  const syncs: SaveSync[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock = makeClock();
    db = new FakeDatabase({ now: clock.now });
    shared = createFakeCloud(db);
  });

  afterEach(() => {
    for (const s of syncs.splice(0)) s.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  function make(cloud: Cloud = shared, storage = new MemoryStorage(), opts: ConstructorParameters<typeof SaveSync>[2] = {}) {
    const sync = new SaveSync(cloud, storage, { now: clock.now, window: null, document: null, ...opts });
    syncs.push(sync);
    return { sync, storage };
  }

  const addCoins = (n: number) => (s: Save): Save => ({ ...s, coins: s.coins + n });

  it('creates, then logs in on another device with the same pin', async () => {
    const a = make();
    expect(await a.sync.create(saveFor('p01', 'Lukas'), '123')).toEqual(saveFor('p01', 'Lukas'));
    expect(loadLocal('p01', a.storage)).toEqual(saveFor('p01', 'Lukas'));
    expect(lastSlot(a.storage)).toBe('p01');
    expect(a.sync.state.value).toBe('synced');
    const b = make();
    expect(await b.sync.login('p01', '124')).toBe('wrong-pin');
    expect(b.sync.save.value).toBeNull();
    expect(await b.sync.login('p01', '123')).toEqual(saveFor('p01', 'Lukas'));
    expect(loadLocal('p01', b.storage)).toEqual(saveFor('p01', 'Lukas'));
  });

  it('update writes the device copy at once and the cloud right after', async () => {
    const { sync, storage } = make();
    await sync.create(saveFor('p01', 'Lukas'), '123');
    clock.t = T0 + 50;
    sync.update(addCoins(30));
    expect(loadLocal('p01', storage)).toMatchObject({ coins: 30, updatedAt: T0 + 50 });
    expect(sync.state.value).toBe('pending');
    await sync.idle();
    expect(sync.state.value).toBe('synced');
    expect(await shared.loadSave('p01', await pinHash('p01', '123'))).toMatchObject({ coins: 30 });
  });

  it('stamps an update that did not stamp itself', async () => {
    const { sync } = make();
    await sync.create(saveFor('p01', 'Lukas'), '123');
    clock.t = T0 + 70;
    sync.update(addCoins(1));
    expect(sync.save.value?.updatedAt).toBe(T0 + 70);
    await sync.idle();
  });

  it('review focus 1: A saves at t1 offline, B at t2 > t1; A reconnects and adopts B\'s save', async () => {
    const A = device(shared);
    const B = device(shared);
    const a = make(A.cloud);
    const b = make(B.cloud);
    await a.sync.create(saveFor('p01', 'Lukas'), '123');
    await b.sync.login('p01', '123');

    A.net.down = true;
    clock.t = T0 + 100; // t1
    a.sync.update(addCoins(10));
    await a.sync.idle();
    expect(a.sync.state.value).toBe('offline');
    expect(loadLocal('p01', a.storage)).toMatchObject({ coins: 10 });

    clock.t = T0 + 200; // t2
    b.sync.update(addCoins(50));
    await b.sync.idle();
    expect(b.sync.state.value).toBe('synced');

    A.net.down = false;
    clock.t = T0 + 300;
    await vi.advanceTimersByTimeAsync(BACKOFF.firstMs);
    await a.sync.idle();
    expect(a.sync.state.value).toBe('synced');
    expect(a.sync.save.value).toMatchObject({ coins: 50, updatedAt: T0 + 200 });
    expect(loadLocal('p01', a.storage)).toMatchObject({ coins: 50, updatedAt: T0 + 200 });
    expect(A.net.writes.filter((w) => w.result === 'ok')).toEqual([]);
    expect(await shared.loadSave('p01', await pinHash('p01', '123'))).toMatchObject({ coins: 50 });
  });

  it('…and when A\'s offline save is the newer one, it wins whole', async () => {
    const A = device(shared);
    const a = make(A.cloud);
    const b = make();
    await a.sync.create(saveFor('p01', 'Lukas'), '123');
    await b.sync.login('p01', '123');
    A.net.down = true;
    clock.t = T0 + 100;
    b.sync.update((s) => ({ ...s, bestWave: 9 }));
    await b.sync.idle();
    clock.t = T0 + 200;
    a.sync.update(addCoins(10));
    await a.sync.idle();
    A.net.down = false;
    await a.sync.flush();
    const cloudCopy = await shared.loadSave('p01', await pinHash('p01', '123'));
    expect(cloudCopy).toMatchObject({ coins: 10, bestWave: 0, updatedAt: T0 + 200 });
  });

  it('review focus 2: a cloud that fails then recovers keeps the device copy, shows offline then synced, and sends only the latest save', async () => {
    const A = device(shared);
    const { sync, storage } = make(A.cloud);
    await sync.create(saveFor('p01', 'Lukas'), '123');
    A.net.down = true;
    for (const n of [1, 2, 3]) {
      clock.t = T0 + n * 10;
      sync.update(addCoins(1));
      await sync.idle();
    }
    expect(sync.state.value).toBe('offline');
    expect(loadLocal('p01', storage)).toMatchObject({ coins: 3 });
    expect(A.net.writes.map((w) => w.result)).toEqual(['offline']);

    A.net.down = false;
    await vi.advanceTimersByTimeAsync(BACKOFF.firstMs);
    await sync.idle();
    expect(sync.state.value).toBe('synced');
    const sent = A.net.writes.filter((w) => w.result === 'ok');
    expect(sent.map((w) => w.save.coins)).toEqual([3]);
    expect(await shared.loadSave('p01', await pinHash('p01', '123'))).toMatchObject({ coins: 3 });
  });

  it('backs off 2 s, 4 s, 8 s … up to 60 s, and starts over after a success', async () => {
    const A = device(shared);
    const { sync } = make(A.cloud);
    await sync.create(saveFor('p01', 'Lukas'), '123');
    A.net.down = true;
    sync.update(addCoins(1));
    await sync.idle();
    const attempts = () => A.net.writes.length + A.net.loads;
    const gaps: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = attempts();
      let waited = 0;
      while (attempts() === before) {
        await vi.advanceTimersByTimeAsync(1000);
        waited += 1000;
        await sync.idle();
      }
      gaps.push(waited);
    }
    expect(gaps).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    A.net.down = false;
    await vi.advanceTimersByTimeAsync(60_000);
    await sync.idle();
    expect(sync.state.value).toBe('synced');
    A.net.down = true;
    sync.update(addCoins(1));
    await sync.idle();
    const before = attempts();
    await vi.advanceTimersByTimeAsync(2000);
    await sync.idle();
    expect(attempts()).toBe(before + 1);
  });

  it('retries at once when the browser comes back online or the page becomes visible', async () => {
    const win = events();
    const doc = events('visible');
    const A = device(shared);
    const { sync } = make(A.cloud, new MemoryStorage(), { window: win, document: doc });
    await sync.create(saveFor('p01', 'Lukas'), '123');
    A.net.down = true;
    sync.update(addCoins(1));
    await sync.idle();
    A.net.down = false;
    win.fire('online');
    await sync.idle();
    expect(sync.state.value).toBe('synced');

    // Another device saves meanwhile; coming back to the page picks it up.
    const other = make();
    await other.sync.login('p01', '123');
    clock.t = T0 + 500;
    other.sync.update(addCoins(100));
    await other.sync.idle();
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    await sync.idle();
    expect(sync.save.value?.coins).toBe(1);
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    await sync.idle();
    expect(sync.save.value?.coins).toBe(101);
  });

  it('dispose leaves no timer and no listener behind', async () => {
    const win = events();
    const doc = events();
    const A = device(shared);
    const sync = new SaveSync(A.cloud, new MemoryStorage(), { now: clock.now, window: win, document: doc });
    expect(win.count() + doc.count()).toBe(2);
    await sync.create(saveFor('p01', 'Lukas'), '123');
    A.net.down = true;
    sync.update(addCoins(1));
    await sync.idle();
    expect(vi.getTimerCount()).toBe(1);
    sync.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(win.count() + doc.count()).toBe(0);
    A.net.down = false;
    win.fire('online');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(A.net.writes.filter((w) => w.result === 'ok')).toEqual([]);
  });

  it('logs in offline on a device that knows the player, and syncs when the cloud returns', async () => {
    const A = device(shared);
    const first = make(A.cloud);
    await first.sync.create(saveFor('p01', 'Lukas'), '123');
    first.sync.update(addCoins(5));
    await first.sync.idle();
    first.sync.dispose();

    A.net.down = true;
    const { sync } = make(A.cloud, first.storage);
    expect(await sync.login('p01', '999')).toBe('offline');
    expect(await sync.login('p01', '123')).toMatchObject({ coins: 5 });
    expect(sync.state.value).toBe('offline');
    sync.update(addCoins(1));
    A.net.down = false;
    await vi.advanceTimersByTimeAsync(BACKOFF.firstMs);
    await sync.idle();
    expect(sync.state.value).toBe('synced');
    expect(await shared.loadSave('p01', await pinHash('p01', '123'))).toMatchObject({ coins: 6 });
  });

  it('cannot log in offline on a device that has never seen the player', async () => {
    const A = device(shared);
    await make(A.cloud).sync.create(saveFor('p01', 'Lukas'), '123');
    A.net.down = true;
    const { sync, storage } = make(A.cloud);
    expect(await sync.login('p01', '123')).toBe('offline');
    expect(sync.save.value).toBeNull();
    expect(loadLocal('p01', storage)).toBeNull();
  });

  it('on log-in a newer device copy is pushed and a newer cloud copy is stored', async () => {
    const a = make();
    await a.sync.create(saveFor('p01', 'Lukas'), '123');
    a.sync.dispose();
    // The device played on after the last sync (e.g. the tab closed before the write).
    saveLocal({ ...saveFor('p01', 'Lukas'), coins: 77, updatedAt: T0 + 10 }, a.storage);
    const again = make(shared, a.storage);
    expect(await again.sync.login('p01', '123')).toMatchObject({ coins: 77 });
    expect(again.sync.state.value).toBe('pending');
    await again.sync.idle();
    expect(await shared.loadSave('p01', await pinHash('p01', '123'))).toMatchObject({ coins: 77 });

    saveLocal({ ...saveFor('p01', 'Lukas'), coins: 1, updatedAt: T0 + 5 }, a.storage);
    const third = make(shared, a.storage);
    expect(await third.sync.login('p01', '123')).toMatchObject({ coins: 77 });
    expect(loadLocal('p01', a.storage)).toMatchObject({ coins: 77 });
  });

  it('ignores a device copy left by an earlier player in the same slot', async () => {
    const st = new MemoryStorage();
    saveLocal({ ...saveFor('p01', 'Old'), coins: 5000, updatedAt: T0 + 999 }, st);
    st.setItem('lvt2_hash_p01', await pinHash('p01', '111'));
    await make().sync.create(saveFor('p01', 'New'), '222');
    const { sync } = make(shared, st);
    expect(await sync.login('p01', '222')).toMatchObject({ name: 'New', coins: 0 });
    expect(loadLocal('p01', st)).toMatchObject({ name: 'New', coins: 0 });
    await sync.idle();
    expect(await shared.loadSave('p01', await pinHash('p01', '222'))).toMatchObject({ name: 'New', coins: 0 });
  });

  it('stops retrying when the pin was changed elsewhere (the device copy stays)', async () => {
    const { sync, storage } = make();
    await sync.create(saveFor('p01', 'Lukas'), '123');
    await shared.setGrownUpCode('a'.repeat(64));
    await shared.resetPin('p01', 'a'.repeat(64), await pinHash('p01', '456'), { ...saveFor('p01', 'Lukas'), updatedAt: T0 + 1 });
    clock.t = T0 + 10;
    sync.update(addCoins(4));
    await sync.idle();
    expect(sync.state.value).toBe('offline');
    expect(vi.getTimerCount()).toBe(0);
    expect(loadLocal('p01', storage)).toMatchObject({ coins: 4 });
  });

  describe('review focus 2: a create interrupted after the request', () => {
    it('leaves no player on the device until a retry succeeds', async () => {
      const { sync, storage } = make();
      db.loseResponses = 1;
      expect(await sync.create(saveFor('p01', 'Lukas'), '123')).toBe('offline');
      expect(sync.save.value).toBeNull();
      expect(loadLocal('p01', storage)).toBeNull();
      expect(lastSlot(storage)).toBeNull();
      // The write did land; the retry recognises it as this very player.
      expect(await sync.create(saveFor('p01', 'Lukas'), '123')).toEqual(saveFor('p01', 'Lukas'));
      expect(loadLocal('p01', storage)).toEqual(saveFor('p01', 'Lukas'));
      expect(await shared.listPlayers()).toHaveLength(1);
    });

    it('a request that never arrived leaves nothing anywhere, and the retry creates', async () => {
      const { sync, storage } = make();
      db.offline = true;
      expect(await sync.create(saveFor('p01', 'Lukas'), '123')).toBe('offline');
      expect(loadLocal('p01', storage)).toBeNull();
      db.offline = false;
      expect(await shared.listPlayers()).toEqual([]);
      expect(await sync.create(saveFor('p01', 'Lukas'), '123')).toEqual(saveFor('p01', 'Lukas'));
    });

    it('a request that hangs gives up after 5 s and leaves nothing on the device', async () => {
      const { sync, storage } = make();
      db.hang = true;
      const p = sync.create(saveFor('p01', 'Lukas'), '123');
      // Hashing the pin is real async work; wait (in real time) until the request's timeout is set.
      while (vi.getTimerCount() === 0) await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toBe('offline');
      expect(loadLocal('p01', storage)).toBeNull();
    });

    it('someone else\'s player in the slot is still taken', async () => {
      await make().sync.create(saveFor('p01', 'Lukas'), '123');
      const { sync, storage } = make();
      expect(await sync.create(saveFor('p01', 'Mia'), '123')).toBe('taken');
      expect(await sync.create(saveFor('p01', 'Lukas'), '999')).toBe('taken');
      expect(loadLocal('p01', storage)).toBeNull();
    });
  });

  it('update with nobody logged in is a programming error', () => {
    const { sync } = make();
    expect(() => sync.update(addCoins(1))).toThrow();
  });
});
