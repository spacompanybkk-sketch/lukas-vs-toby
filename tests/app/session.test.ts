import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GATE_LOCK_MS, LOCK_MS, PlayerSession, lockKey, wrongKey } from '../../src/app/session';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { loadLocal, saveLocal } from '../../src/progress/localStore';
import { OLD_SAVE_KEYS } from '../../src/progress/migrate';
import { applyBattleResult } from '../../src/progress/rewards';
import { SLOTS } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { makeClock } from '../cloud/helpers';
import { MemoryStorage } from '../progress/memoryStorage';

let clock: ReturnType<typeof makeClock>;
let db: FakeDatabase;
let storage: MemoryStorage;
let s: PlayerSession;

/** A session on this "device" (its own storage), over the shared fake database. */
function deviceSession(store: Storage = storage): PlayerSession {
  const p = new PlayerSession();
  p.configure({ cloud: createFakeCloud(db), storage: store, now: clock.now, window: null, document: null });
  return p;
}

const asSave = (r: unknown): Save => {
  if (typeof r !== 'object' || r === null) throw new Error(`expected a save, got ${String(r)}`);
  return r as Save;
};

beforeEach(() => {
  clock = makeClock();
  db = new FakeDatabase({ now: clock.now });
  storage = new MemoryStorage();
  s = deviceSession();
});

afterEach(() => s.dispose());

describe('roster', () => {
  it('shows Lukas (p01) and Toby (p02) from the very first start, before they exist', async () => {
    const r = await s.roster();
    expect(r.online).toBe(true);
    expect(r.full).toBe(false);
    expect(r.players).toEqual([
      { slot: 'p01', name: 'Lukas', picture: 'peashooter', exists: false },
      { slot: 'p02', name: 'Toby', picture: 'brainEater', exists: false },
    ]);
  });

  it('puts the player last used on this device first', async () => {
    asSave(await s.create('Mia', 'sunflower', '111'));
    asSave(await s.create('Ben', 'hotTopic', '222'));
    s.logout();
    asSave(await s.login('p03', '111'));
    s.logout();
    const r = await s.roster();
    expect(r.players.map((p) => p.slot)).toEqual(['p03', 'p01', 'p02', 'p04']);
    expect(r.players.find((p) => p.slot === 'p03')).toMatchObject({ name: 'Mia', exists: true });
  });

  it('offline: only the players this device has a copy of, plus the two boys', async () => {
    asSave(await s.create('Mia', 'sunflower', '111'));
    s.logout();
    const other = deviceSession(new MemoryStorage());
    asSave(await other.create('Ben', 'hotTopic', '222'));
    other.dispose();
    db.offline = true;
    const r = await s.roster();
    expect(r.online).toBe(false);
    expect(r.players.map((p) => p.slot)).toEqual(['p03', 'p01', 'p02']);
  });

  it('is full when all 28 free places are taken', async () => {
    for (const slot of SLOTS.slice(2)) db.poke(`v2/players/${slot}`, { name: `N${slot}`, picture: 'sunflower' });
    const r = await s.roster();
    expect(r.full).toBe(true);
    expect(await s.create('Late', 'sunflower', '123')).toBe('full');
  });
});

describe('create', () => {
  it('gives a new player the lowest free place after the two boys, on Medium, and logs them in', async () => {
    const save = asSave(await s.create('Mia', 'sunflower', '123'));
    expect(save).toMatchObject({ slot: 'p03', name: 'Mia', picture: 'sunflower', difficulty: { plants: 'medium', zombies: 'medium' } });
    expect(s.player.value).toEqual(save);
    expect(db.peek('v2/players/p03')).toEqual({ name: 'Mia', picture: 'sunflower' });
    expect(loadLocal('p03', storage)).toEqual(save);
  });

  it('Lukas keeps Medium; Toby gets Easy on both sides', async () => {
    const lukas = asSave(await s.create('Lukas', 'peashooter', '123', 'p01'));
    expect(lukas.difficulty).toEqual({ plants: 'medium', zombies: 'medium' });
    s.logout();
    const toby = asSave(await s.create('Toby', 'brainEater', '456', 'p02'));
    expect(toby.difficulty).toEqual({ plants: 'easy', zombies: 'easy' });
  });

  it("imports that boy's old save on this device when he is created, once", async () => {
    storage.setItem(OLD_SAVE_KEYS.lukas, JSON.stringify({ tobyDollars: 300, currentLevel: 4, upgrades: { peashooter: 3 } }));
    const lukas = asSave(await s.create('Lukas', 'peashooter', '123', 'p01'));
    expect(lukas.coins).toBe(900);
    expect(lukas.importedOld).toBe(true);
    s.logout();
    expect(asSave(await s.login('p01', '123')).coins).toBe(900);
  });

  it('imports the old save at a later log-in on a device that has one', async () => {
    const ipad = deviceSession(new MemoryStorage());
    expect(asSave(await ipad.create('Toby', 'brainEater', '456', 'p02')).importedOld).toBe(false);
    ipad.dispose();
    storage.setItem(OLD_SAVE_KEYS.toby, JSON.stringify({ tobyDollars: 50, currentLevel: 1, upgrades: {} }));
    const toby = asSave(await s.login('p02', '456'));
    expect(toby.coins).toBe(50);
    expect(s.player.value?.importedOld).toBe(true);
    s.logout();
    expect(asSave(await s.login('p02', '456')).coins).toBe(50);
  });

  it('a boy deleted and made again does not get the old coins a second time on this device', async () => {
    storage.setItem(OLD_SAVE_KEYS.lukas, JSON.stringify({ tobyDollars: 300, currentLevel: 1, upgrades: {} }));
    asSave(await s.create('Lukas', 'peashooter', '123', 'p01'));
    expect(await s.setGrownUp('246802')).toBe('ok');
    expect(await s.deletePlayer('p01', '246802')).toBe('ok');
    expect(asSave(await s.create('Lukas', 'peashooter', '123', 'p01')).coins).toBe(0);
  });

  it('needs a connection: offline nothing is made and nothing kept; the retry works', async () => {
    db.offline = true;
    expect(await s.create('Mia', 'sunflower', '123')).toBe('offline');
    expect(s.player.value).toBeNull();
    expect(loadLocal('p03', storage)).toBeNull();
    db.offline = false;
    expect(db.peek('v2/players')).toBeNull();
    expect(asSave(await s.create('Mia', 'sunflower', '123')).slot).toBe('p03');
  });

  it('an answer lost on the way back: the retry finds the player made with this pin, and no second one', async () => {
    db.loseResponses = 1;
    expect(await s.create('Mia', 'sunflower', '123')).toBe('offline');
    // The same taps again (the retry button): the place already claimed is tried first.
    const save = asSave(await s.create('Mia', 'sunflower', '123'));
    expect(save.slot).toBe('p03');
    expect(Object.keys(db.peek('v2/players') as object)).toEqual(['p03']);
  });

  it('when another device takes the slot first, the next free one is used', async () => {
    db.poke('v2/players/p03', { name: 'Other', picture: 'sunflower' });
    db.poke('v2/secrets/p03', 'a'.repeat(64));
    expect(asSave(await s.create('Mia', 'sunflower', '123')).slot).toBe('p04');
  });

  it('refuses a bad name or pin without asking the cloud', async () => {
    const before = db.requests.length;
    expect(await s.create('', 'sunflower', '123')).toBe('invalid');
    expect(await s.create('Elevenchars', 'sunflower', '123')).toBe('invalid');
    expect(await s.create('Mia', 'sunflower', '12')).toBe('invalid');
    expect(db.requests.length).toBe(before);
  });
});

describe('login and the lock-out', () => {
  beforeEach(async () => {
    asSave(await s.create('Mia', 'sunflower', '123'));
    s.logout();
  });

  it('the right number logs in', async () => {
    const save = asSave(await s.login('p03', '123'));
    expect(save.name).toBe('Mia');
    expect(s.player.value?.slot).toBe('p03');
  });

  it('three wrong numbers in a row lock that player for 30 s; the lock survives a reload', async () => {
    expect(await s.login('p03', '000')).toBe('wrong-pin');
    expect(await s.login('p03', '001')).toBe('wrong-pin');
    expect(s.lockedUntil('p03')).toBe(0);
    expect(await s.login('p03', '002')).toBe('locked');
    expect(s.lockedUntil('p03')).toBe(clock.t + LOCK_MS);
    expect(storage.getItem(lockKey('p03'))).toBe(String(clock.t + LOCK_MS));
    // Even the right number waits, and the cloud is not asked.
    const before = db.requests.length;
    expect(await s.login('p03', '123')).toBe('locked');
    expect(db.requests.length).toBe(before);
    // A reload (a new session on the same device) still sees it.
    const reloaded = deviceSession();
    expect(reloaded.lockedUntil('p03')).toBe(clock.t + LOCK_MS);
    clock.t += LOCK_MS - 1;
    expect(await reloaded.login('p03', '123')).toBe('locked');
    clock.t += 1;
    expect(reloaded.lockedUntil('p03')).toBe(0);
    expect(asSave(await reloaded.login('p03', '123')).name).toBe('Mia');
    reloaded.dispose();
  });

  it('the count of wrong numbers survives a reload: two wrong, reload, one wrong locks', async () => {
    expect(await s.login('p03', '000')).toBe('wrong-pin');
    expect(await s.login('p03', '001')).toBe('wrong-pin');
    expect(storage.getItem(wrongKey('p03'))).toBe('2');
    const reloaded = deviceSession();
    expect(await reloaded.login('p03', '002')).toBe('locked');
    expect(storage.getItem(wrongKey('p03'))).toBeNull();
    reloaded.dispose();
  });

  it('a lock that has run out is cleared with its count', async () => {
    for (const pin of ['000', '001', '002']) await s.login('p03', pin);
    clock.t += LOCK_MS;
    expect(s.lockedUntil('p03')).toBe(0);
    expect(storage.getItem(lockKey('p03'))).toBeNull();
    // A fresh three tries, not one.
    expect(await s.login('p03', '000')).toBe('wrong-pin');
  });

  it('a device clock set back never makes the wait longer than one lock', async () => {
    for (const pin of ['000', '001', '002']) await s.login('p03', pin);
    clock.t -= 24 * 3600_000; // the clock went back a day
    expect(s.lockedUntil('p03')).toBe(0);
    expect(storage.getItem(lockKey('p03'))).toBeNull();
    expect(asSave(await s.login('p03', '123')).name).toBe('Mia');
  });

  it('a right number resets the count: wrong, wrong, right, wrong does not lock', async () => {
    await s.login('p03', '000');
    await s.login('p03', '000');
    asSave(await s.login('p03', '123'));
    s.logout();
    expect(await s.login('p03', '000')).toBe('wrong-pin');
    expect(s.lockedUntil('p03')).toBe(0);
  });

  it('the right number with no save in the cloud: this device copy is adopted; elsewhere a fresh save', async () => {
    asSave(await s.login('p03', '123'));
    s.update((save) => ({ ...save, coins: 12 }));
    await s.flush();
    s.logout();
    db.poke('v2/saves/p03', null);
    expect(asSave(await s.login('p03', '123')).coins).toBe(12);
    s.logout();
    db.poke('v2/saves/p03', null);
    const ipad = deviceSession(new MemoryStorage());
    expect(asSave(await ipad.login('p03', '123'))).toMatchObject({ name: 'Mia', picture: 'sunflower', coins: 0 });
    ipad.dispose();
  });

  it('the lock is per player', async () => {
    asSave(await s.create('Ben', 'hotTopic', '222'));
    s.logout();
    for (const pin of ['000', '001', '002']) await s.login('p03', pin);
    expect(s.lockedUntil('p03')).toBeGreaterThan(0);
    expect(s.lockedUntil('p04')).toBe(0);
    expect(asSave(await s.login('p04', '222')).name).toBe('Ben');
  });

  it('offline: the right number plays from the device copy; a wrong one counts towards the lock', async () => {
    asSave(await s.login('p03', '123'));
    s.logout();
    db.offline = true;
    expect(asSave(await s.login('p03', '123')).name).toBe('Mia');
    s.logout();
    expect(await s.login('p03', '999')).toBe('wrong-pin');
    expect(await s.login('p03', '998')).toBe('wrong-pin');
    expect(await s.login('p03', '997')).toBe('locked');
  });

  it('the cloud refuses (stale rules) but this device knows the number: plays from the device copy, no wrong try', async () => {
    asSave(await s.login('p03', '123'));
    s.update((save) => ({ ...save, coins: 9 }));
    await s.flush();
    s.logout();
    // Every rules check now fails: what a rules rollback looks like to the client.
    db.poke('v2/secrets/p03', 'f'.repeat(64));
    for (let i = 0; i < 4; i++) {
      expect(asSave(await s.login('p03', '123')).coins).toBe(9);
      expect(s.syncState.value).toBe('offline');
      s.logout();
    }
    expect(s.lockedUntil('p03')).toBe(0);
    expect(storage.getItem(wrongKey('p03'))).toBeNull();
    // A number this device does not know is still wrong.
    expect(await s.login('p03', '124')).toBe('wrong-pin');
  });

  it('offline on a device that never had this player: cannot tell, says offline, does not count', async () => {
    const ipad = deviceSession(new MemoryStorage());
    db.offline = true;
    for (let i = 0; i < 4; i++) expect(await ipad.login('p03', '123')).toBe('offline');
    expect(ipad.lockedUntil('p03')).toBe(0);
    ipad.dispose();
  });
});

describe('update', () => {
  it('a battle result goes through update: coins on the device at once and in the cloud', async () => {
    asSave(await s.create('Mia', 'sunflower', '123'));
    s.update((save) => applyBattleResult(save, { won: true, skill: 'medium', baseHpShare: 0.5, versus: false }, clock.now()));
    expect(s.player.value?.coins).toBe(40);
    expect(loadLocal('p03', storage)?.coins).toBe(40);
    await s.flush();
    const other = deviceSession(new MemoryStorage());
    expect(asSave(await other.login('p03', '123')).coins).toBe(40);
    other.dispose();
  });

  it('buying an upgrade goes through update: coins and level on the device at once and in the cloud', async () => {
    asSave(await s.create('Mia', 'sunflower', '123'));
    s.update((save) => ({ ...save, coins: 350 }));
    expect(s.buy('peashooter')).toBe('ok');
    expect(s.player.value).toMatchObject({ coins: 250, upgrades: { peashooter: 1 } });
    expect(s.buy('peashooter')).toBe('ok');
    expect(loadLocal('p03', storage)).toMatchObject({ coins: 50, upgrades: { peashooter: 2 } });
    await s.flush();
    const other = deviceSession(new MemoryStorage());
    expect(asSave(await other.login('p03', '123'))).toMatchObject({ coins: 50, upgrades: { peashooter: 2 } });
    other.dispose();
  });

  it('buying with too few coins or at level 10 changes nothing', async () => {
    asSave(await s.create('Mia', 'sunflower', '123'));
    s.update((save) => ({ ...save, coins: 99, upgrades: { brainEater: 10 } }));
    const before = s.player.value;
    expect(s.buy('peashooter')).toBe('no-coins');
    expect(s.buy('brainEater')).toBe('max');
    expect(s.player.value).toBe(before);
  });

  it('buying with nobody logged in says so', () => {
    expect(s.buy('peashooter')).toBe('no-player');
  });

  it('logout forgets the player', async () => {
    asSave(await s.create('Mia', 'sunflower', '123'));
    s.logout();
    expect(s.player.value).toBeNull();
  });
});

describe('grown-up', () => {
  beforeEach(async () => {
    asSave(await s.create('Mia', 'sunflower', '123'));
    s.update((save) => ({ ...save, coins: 77 }));
    await s.flush();
    s.logout();
  });

  it('first use sets the code; afterwards only that code opens', async () => {
    expect(await s.checkGrownUp('135799')).toBe('wrong');
    expect(s.grownUpKnown()).toBe(false);
    expect(await s.setGrownUp('135799')).toBe('ok');
    expect(s.grownUpKnown()).toBe(true);
    expect(await s.checkGrownUp('135799')).toBe('ok');
    expect(await s.checkGrownUp('135800')).toBe('wrong');
    // Once set, nobody can set another (a moment later: a proof from this very millisecond would count).
    clock.t += 1;
    expect(await deviceSession(new MemoryStorage()).setGrownUp('000000')).toBe('taken');
  });

  it('deletes a player with the code: gone from the cloud and the device', async () => {
    await s.setGrownUp('135799');
    expect(await s.deletePlayer('p03', '135800')).toBe('wrong');
    expect(db.peek('v2/players/p03')).not.toBeNull();
    expect(await s.deletePlayer('p03', '135799')).toBe('ok');
    expect(db.peek('v2/players/p03')).toBeNull();
    expect(loadLocal('p03', storage)).toBeNull();
    expect((await s.roster()).players.map((p) => p.slot)).toEqual(['p01', 'p02']);
  });

  it('gives a forgotten number a new one and keeps the progress; the old number no longer works', async () => {
    await s.setGrownUp('135799');
    expect(await s.resetPin({ slot: 'p03', name: 'Mia', picture: 'sunflower' }, '135799', '999')).toBe('ok');
    expect(await s.login('p03', '123')).toBe('wrong-pin');
    expect(asSave(await s.login('p03', '999')).coins).toBe(77);
  });

  it('a new number keeps everything from both copies (this device and the cloud), merged', async () => {
    await s.setGrownUp('135799');
    const other = deviceSession(new MemoryStorage());
    asSave(await other.login('p03', '123'));
    other.update((save) => ({ ...save, coins: 200 }));
    await other.flush();
    other.dispose();
    asSave(await s.login('p03', '123'));
    db.offline = true;
    s.update((save) => ({ ...save, computerWins: 3 }));
    s.logout();
    db.offline = false;
    clock.t += 10;
    expect(await s.resetPin({ slot: 'p03', name: 'Mia', picture: 'sunflower' }, '135799', '999')).toBe('ok');
    expect(asSave(await s.login('p03', '999'))).toMatchObject({ coins: 200, computerWins: 3 });
  });

  it('only a wrong grown-up code is "wrong"; any other refusal is a retry', async () => {
    await s.setGrownUp('135799');
    clock.t += 10;
    expect(await s.resetPin({ slot: 'p03', name: 'Mia', picture: 'sunflower' }, '000001', '999')).toBe('wrong');
    expect(await s.deletePlayer('p03', '000001')).toBe('wrong');
    expect(await s.resetPin({ slot: 'p03', name: 'Mia', picture: 'sunflower' }, '135799', '12')).toBe('failed');
  });

  it('a new number on a device that knows nothing of the player starts the save fresh, and says so', async () => {
    await s.setGrownUp('135799');
    const ipad = deviceSession(new MemoryStorage());
    expect(await ipad.resetPin({ slot: 'p03', name: 'Mia', picture: 'sunflower' }, '135799', '999')).toBe('fresh');
    expect(asSave(await ipad.login('p03', '999'))).toMatchObject({ name: 'Mia', coins: 0 });
    ipad.dispose();
  });

  it('a new number clears that player’s lock', async () => {
    await s.setGrownUp('135799');
    for (const pin of ['000', '001', '002']) await s.login('p03', pin);
    expect(s.lockedUntil('p03')).toBeGreaterThan(0);
    await s.resetPin({ slot: 'p03', name: 'Mia', picture: 'sunflower' }, '135799', '999');
    expect(s.lockedUntil('p03')).toBe(0);
  });

  it('the gate: the first code typed is set only when the cloud has none; then right, wrong, and five wrong lock it 60 s', async () => {
    expect(await s.openGate('135799')).toBe('new');
    clock.t += 1;
    expect(await s.openGate('135799')).toBe('ok');
    clock.t += 1;
    // On another device that has never seen a code: a mistype is just wrong, never "set a new code".
    const other = deviceSession(new MemoryStorage());
    expect(await other.openGate('111111')).toBe('wrong');
    for (let i = 0; i < 3; i++) expect(await other.openGate('111111')).toBe('wrong');
    expect(await other.openGate('111111')).toBe('locked');
    expect(other.gateLockedUntil()).toBe(clock.t + GATE_LOCK_MS);
    expect(await other.openGate('135799')).toBe('locked');
    clock.t += GATE_LOCK_MS;
    expect(await other.openGate('135799')).toBe('ok');
    other.dispose();
  });

  it('a mistyped confirmation of a new code is fixed by choosing again (proven with the first)', async () => {
    expect(await s.openGate('135799')).toBe('new');
    clock.t += 1;
    expect(await s.changeGrownUp('135799', '246802')).toBe('ok');
    clock.t += 1;
    expect(await s.openGate('246802')).toBe('ok');
    clock.t += 1;
    expect(await s.checkGrownUp('135799')).toBe('wrong');
  });

  it('offline the grown-up gate says offline', async () => {
    db.offline = true;
    expect(await s.checkGrownUp('135799')).toBe('offline');
    expect(await s.setGrownUp('135799')).toBe('offline');
    expect(await s.openGate('135799')).toBe('offline');
  });

  it('a device copy left behind is not shown after the player is deleted elsewhere', async () => {
    saveLocal({ ...(loadLocal('p03', storage) as Save) }, storage);
    await s.setGrownUp('135799');
    const other = deviceSession(new MemoryStorage());
    expect(await other.deletePlayer('p03', '135799')).toBe('ok');
    other.dispose();
    expect((await s.roster()).players.map((p) => p.slot)).toEqual(['p01', 'p02']);
  });
});

describe('a fake or test cloud keeps to its own device keys', () => {
  it('fake: saves, hashes, sync, locks and last player under lvt2f_; the old save is carried but never marked used', async () => {
    const shared = new MemoryStorage();
    shared.setItem(OLD_SAVE_KEYS.lukas, JSON.stringify({ tobyDollars: 300, currentLevel: 1, upgrades: {} }));
    const fake = new PlayerSession();
    fake.configure({ cloud: createFakeCloud(new FakeDatabase({ now: clock.now })), storage: shared, now: clock.now, window: null, document: null, mode: 'fake' });
    expect(asSave(await fake.create('Lukas', 'peashooter', '123', 'p01')).coins).toBe(300);
    fake.logout();
    for (const pin of ['000', '001', '002']) await fake.login('p01', pin);
    fake.dispose();
    const keys = Array.from({ length: shared.length }, (_, i) => shared.key(i) as string);
    expect(keys.filter((k) => k.startsWith('lvt2_'))).toEqual([]);
    expect(keys).toEqual(expect.arrayContaining(['lvt2f_save_p01', 'lvt2f_hash_p01', 'lvt2f_lock_p01', 'lvt2f_last_slot']));
    expect(keys.some((k) => k.includes('oldimport'))).toBe(false);
    expect(shared.getItem(OLD_SAVE_KEYS.lukas)).not.toBeNull();

    // The real game on this device later: none of that is seen, and the old coins are still there to carry.
    const live = new PlayerSession();
    live.configure({ cloud: createFakeCloud(db), storage: shared, now: clock.now, window: null, document: null, mode: 'live' });
    expect(live.lockedUntil('p01')).toBe(0);
    expect((await live.roster()).players.find((p) => p.slot === 'p01')?.exists).toBe(false);
    expect(asSave(await live.create('Lukas', 'peashooter', '123', 'p01')).coins).toBe(300);
    expect(shared.getItem('lvt2_oldimport_p01')).toBe('1');
    live.dispose();
  });

  it('test: under lvt2t_', async () => {
    const shared = new MemoryStorage();
    const t = new PlayerSession();
    t.configure({ cloud: createFakeCloud(db), storage: shared, now: clock.now, window: null, document: null, mode: 'test' });
    asSave(await t.create('Mia', 'sunflower', '123'));
    t.dispose();
    const keys = Array.from({ length: shared.length }, (_, i) => shared.key(i) as string);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('lvt2t_'))).toBe(true);
  });
});
