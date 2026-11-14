import { describe, expect, it } from 'vitest';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud, saveToWire } from '../../src/cloud/restClient';
import { STALE_RELOAD_KEY, reloadForUnreadableSave } from '../../src/app/staleBuild';
import { newSave } from '../../src/progress/save';
import { MemoryStorage } from '../progress/memoryStorage';

const T0 = 1_762_900_000_000;

/** The reload decision's world: a session store, whether the browser is online, whether a player is in, and the reloads made. */
function world({ online = true, loggedIn = false } = {}) {
  const reloads: number[] = [];
  const session = new MemoryStorage();
  const deps = { session, online: () => online, loggedIn: () => loggedIn, reload: () => { reloads.push(1); } };
  return { reloads, session, deps };
}

describe('reloadForUnreadableSave: an older cached build meets a save it cannot read', () => {
  it('reloads once, and marks the session so a second time in the same session does not', () => {
    const w = world();
    expect(reloadForUnreadableSave(w.deps)).toBe(true);
    expect(w.reloads).toHaveLength(1);
    expect(w.session.getItem(STALE_RELOAD_KEY)).not.toBeNull();
    // The reloaded page (same session) meets it again: no loop, the refused answer stands.
    expect(reloadForUnreadableSave(w.deps)).toBe(false);
    expect(w.reloads).toHaveLength(1);
  });

  it('never when offline', () => {
    const w = world({ online: false });
    expect(reloadForUnreadableSave(w.deps)).toBe(false);
    expect(w.reloads).toHaveLength(0);
  });

  it('never in the middle of play (a player logged in): only at the pin pad', () => {
    const w = world({ loggedIn: true });
    expect(reloadForUnreadableSave(w.deps)).toBe(false);
    expect(w.reloads).toHaveLength(0);
  });

  it('never without a session store to guard it (it could loop)', () => {
    const w = world();
    expect(reloadForUnreadableSave({ ...w.deps, session: undefined })).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(reloadForUnreadableSave({ ...w.deps, session: throwing })).toBe(false);
    expect(w.reloads).toHaveLength(0);
  });
});

describe('the cloud tells only about an unreadable stored save', () => {
  async function setup() {
    const db = new FakeDatabase({ now: () => T0 });
    const seen: string[] = [];
    const cloud = createFakeCloud(db, 'v2', undefined, { onUnreadableSave: () => seen.push('unreadable') });
    const save = newSave('p03', 'Mia', 'peashooter', T0);
    const hash = await pinHash('p03', '123');
    expect(await cloud.createPlayer(save, hash, '0123456789abcdef')).toBe('ok');
    return { db, cloud, seen, save, hash };
  }

  it('a save this build cannot read (a newer build\'s key): refused, and the cloud says so once', async () => {
    const { db, cloud, seen, save, hash } = await setup();
    const newer = JSON.stringify({ ...JSON.parse(saveToWire(save)), fromTheFuture: 1 });
    db.poke(`v2/saves/p03/${hash}/save`, newer);
    expect(await cloud.loadRecord('p03', hash)).toBe('refused');
    expect(seen).toEqual(['unreadable']);
  });

  it('a readable save, a wrong pin, nothing stored, or offline: not told', async () => {
    const { db, cloud, seen, hash } = await setup();
    expect(typeof await cloud.loadRecord('p03', hash)).toBe('object');
    expect(await cloud.loadRecord('p03', await pinHash('p03', '999'))).toBe('wrong-pin');
    expect(await cloud.loadRecord('p04', await pinHash('p04', '123'))).toBe('wrong-pin');
    db.offline = true;
    expect(await cloud.loadRecord('p03', hash)).toBe('offline');
    db.offline = false;
    db.poke(`v2/saves/p03/${hash}`, null);
    expect(await cloud.loadRecord('p03', hash)).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe('at the pin pad: a device with no copy of its own meets a save from a newer build', () => {
  it('the first log-in reloads the page once; after the reload (same session) it is the ordinary refusal; a wrong pin never reloads', async () => {
    const db = new FakeDatabase({ now: () => T0 });
    const w = world();
    const { PlayerSession } = await import('../../src/app/session');
    // A newer build made the player and wrote a key this build does not know.
    const maker = new PlayerSession();
    maker.configure({ cloud: createFakeCloud(db), storage: new MemoryStorage(), now: () => T0, window: null, document: null });
    const made = await maker.create('Mia', 'peashooter', '123');
    if (typeof made === 'string') throw new Error(made);
    const slot = made.slot;
    maker.dispose();
    const hash = await pinHash(slot, '123');
    db.poke(`v2/saves/${slot}/${hash}/save`, JSON.stringify({ ...JSON.parse(saveToWire(made)), fromTheFuture: 1 }));

    // This device: an older build, nothing of Mia's on it, wired as the game wires it.
    const s = new PlayerSession();
    const cloud = createFakeCloud(db, 'v2', undefined, {
      onUnreadableSave: () => { reloadForUnreadableSave({ ...w.deps, loggedIn: () => s.player.peek() !== null }); },
    });
    s.configure({ cloud, storage: new MemoryStorage(), now: () => T0, window: null, document: null });
    expect(await s.login(slot, '999')).toBe('wrong-pin');
    expect(w.reloads).toHaveLength(0);
    const first = await s.login(slot, '123');
    expect(typeof first).toBe('string');
    expect(w.reloads).toHaveLength(1);
    // The page came back (same browser session) and still cannot read it: no second reload.
    const again = await s.login(slot, '123');
    expect(again).toBe(first);
    expect(w.reloads).toHaveLength(1);
    s.dispose();
  });
});
