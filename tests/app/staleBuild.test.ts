import { describe, expect, it } from 'vitest';
import { PlayerSession } from '../../src/app/session';
import { STALE_RELOAD_KEY, reloadForUnreadableSave } from '../../src/app/staleBuild';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud, saveToWire } from '../../src/cloud/restClient';
import type { Save, Slot } from '../../src/progress/save';
import { MemoryStorage } from '../progress/memoryStorage';

const T0 = 1_762_900_000_000;

/** The reload decision's world: a session store, whether the browser is online, the reloads made. */
function world({ online = true } = {}) {
  const reloads: number[] = [];
  const session = new MemoryStorage();
  const deps = { session, online: () => online, reload: () => { reloads.push(1); } };
  return { reloads, session, deps };
}

describe('reloadForUnreadableSave: at most once a session, only online', () => {
  it('reloads once, and marks the session so a second time in the same session does not', () => {
    const w = world();
    expect(reloadForUnreadableSave(w.deps)).toBe(true);
    expect(w.reloads).toHaveLength(1);
    expect(w.session.getItem(STALE_RELOAD_KEY)).not.toBeNull();
    expect(reloadForUnreadableSave(w.deps)).toBe(false);
    expect(w.reloads).toHaveLength(1);
  });

  it('never when offline, or without a session store to guard it (it could loop)', () => {
    const w = world({ online: false });
    expect(reloadForUnreadableSave(w.deps)).toBe(false);
    const on = world();
    expect(reloadForUnreadableSave({ ...on.deps, session: undefined })).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(reloadForUnreadableSave({ ...on.deps, session: throwing })).toBe(false);
    expect([...w.reloads, ...on.reloads]).toHaveLength(0);
  });
});

/** A save a newer build wrote: the same, plus a key this build does not know. */
const fromNewerBuild = (s: Save): string => JSON.stringify({ ...JSON.parse(saveToWire(s)), fromTheFuture: 1 });

/** A player made on the shared fake database (a "newer" device), its cloud save then made unreadable here. */
async function setup() {
  const db = new FakeDatabase({ now: () => T0 });
  const makerStorage = new MemoryStorage();
  const maker = new PlayerSession();
  maker.configure({ cloud: createFakeCloud(db), storage: makerStorage, now: () => T0, window: null, document: null });
  const made = await maker.create('Mia', 'peashooter', '123');
  if (typeof made === 'string') throw new Error(made);
  maker.dispose();
  const slot: Slot = made.slot;
  const hash = await pinHash(slot, '123');
  const unreadable = (): void => db.poke(`v2/saves/${slot}/${hash}/save`, fromNewerBuild(made));
  /** A session on a device with `storage`, wired as the game wires it (`staleBuild` counts). */
  const device = (storage = new MemoryStorage()) => {
    const calls: number[] = [];
    const s = new PlayerSession();
    s.configure({ cloud: createFakeCloud(db), storage, now: () => T0, window: null, document: null, staleBuild: () => { calls.push(1); } });
    return { s, calls, storage };
  };
  return { db, slot, hash, made, makerStorage, unreadable, device };
}

describe('the cloud tells whether the last read met an unreadable save (the answer stays refused)', () => {
  it('true after a save this build cannot read; false for a readable one, a wrong pin, nothing stored, offline', async () => {
    const { db, slot, hash, unreadable } = await setup();
    const cloud = createFakeCloud(db);
    expect(typeof await cloud.loadRecord(slot, hash)).toBe('object');
    expect(await cloud.unreadableSave!(slot, hash)).toBe(false);
    unreadable();
    expect(await cloud.loadRecord(slot, hash)).toBe('refused');
    expect(await cloud.unreadableSave!(slot, hash)).toBe(true);
    const wrong = await pinHash(slot, '999');
    expect(await cloud.loadRecord(slot, wrong)).toBe('wrong-pin');
    expect(await cloud.unreadableSave!(slot, wrong)).toBe(false);
    expect(await cloud.loadRecord(slot, hash)).toBe('refused');
    db.offline = true;
    expect(await cloud.loadRecord(slot, hash)).toBe('offline');
    expect(await cloud.unreadableSave!(slot, hash)).toBe(false);
    db.offline = false;
    db.poke(`v2/saves/${slot}/${hash}`, null);
    expect(await cloud.loadRecord(slot, hash)).toBeNull();
    expect(await cloud.unreadableSave!(slot, hash)).toBe(false);
  });
});

describe('only the pin pad, on a device with no copy of the player, asks for the reload', () => {
  it('log-in without a local copy: refused and one reload asked; after the reload (flag set) the plain refusal', async () => {
    const { db, unreadable, device, slot } = await setup();
    unreadable();
    const d = device();
    expect(await d.s.login(slot, '999')).toBe('wrong-pin');
    expect(d.calls).toHaveLength(0);
    expect(await d.s.login(slot, '123')).toBe('refused');
    expect(d.calls).toHaveLength(1);
    d.s.dispose();
    // Wired to the real guard (as the game does): the page "came back" in the same browser
    // session and still cannot read it, so no second reload.
    const w = world();
    const guarded = new PlayerSession();
    guarded.configure({
      cloud: createFakeCloud(db), storage: new MemoryStorage(), now: () => T0, window: null, document: null,
      staleBuild: () => { reloadForUnreadableSave(w.deps); },
    });
    expect(await guarded.login(slot, '123')).toBe('refused');
    expect(await guarded.login(slot, '123')).toBe('refused');
    expect(w.reloads).toHaveLength(1);
    guarded.dispose();
  });

  it('log-in on a device with its own copy: plays from it as before, no reload', async () => {
    const { unreadable, device, slot, makerStorage } = await setup();
    unreadable();
    const d = device(makerStorage); // the device that made Mia keeps her save and pin hash
    const r = await d.s.login(slot, '123');
    expect(typeof r).toBe('object');
    expect(d.calls).toHaveLength(0);
    d.s.dispose();
  });

  it('a grown-up pin reset meeting the unreadable cloud save: no reload', async () => {
    const { unreadable, device, slot, makerStorage } = await setup();
    const d = device(makerStorage);
    expect(await d.s.setGrownUp('135799')).toBe('ok');
    unreadable();
    await d.s.resetPin({ slot, name: 'Mia', picture: 'peashooter' }, '135799', '999');
    expect(d.calls).toHaveLength(0);
    d.s.dispose();
  });

  it('a sync read after log-out meeting the unreadable save: no reload', async () => {
    const { unreadable, device, slot, makerStorage } = await setup();
    const d = device(makerStorage);
    expect(typeof await d.s.login(slot, '123')).toBe('object');
    const sync = (d.s as unknown as { d: { sync: { flush(): Promise<void>; needsRead: boolean } } }).d.sync;
    unreadable();
    sync.needsRead = true;
    const reading = sync.flush();
    d.s.logout();
    await reading;
    await sync.flush();
    expect(d.calls).toHaveLength(0);
    d.s.dispose();
  });
});
