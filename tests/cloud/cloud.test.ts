import { describe, expect, it } from 'vitest';
import { pinHash } from '../../src/cloud/hash';
import { SLOTS } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { T0, hex, saveFor, setup } from './helpers';

const V1 = '1111111111111111';
const V2 = '2222222222222222';
const V3 = '3333333333333333';

/** The Cloud interface end to end: the real REST client over the fake database and the real rules. */
describe('players', () => {
  it('create → list → load with the right pin', async () => {
    const { cloud } = setup();
    const s: Save = { ...saveFor('p01', 'Lukas'), coins: 40 };
    const h = await pinHash('p01', '123');
    expect(await cloud.createPlayer(s, h)).toBe('ok');
    expect(await cloud.listPlayers()).toEqual([{ slot: 'p01', name: 'Lukas', picture: s.picture }]);
    expect(await cloud.loadSave('p01', h)).toEqual(s);
  });

  it('load with a wrong pin is wrong-pin', async () => {
    const { cloud } = setup();
    await cloud.createPlayer(saveFor('p01', 'Lukas'), await pinHash('p01', '123'));
    expect(await cloud.loadSave('p01', await pinHash('p01', '124'))).toBe('wrong-pin');
    // The same digits salted with another slot are a wrong pin too.
    expect(await cloud.loadSave('p01', await pinHash('p02', '123'))).toBe('wrong-pin');
  });

  it('a slot nobody has is wrong-pin for any pin (nothing to compare against)', async () => {
    const { cloud } = setup();
    expect(await cloud.loadSave('p07', await pinHash('p07', '000'))).toBe('wrong-pin');
  });

  it('a taken slot returns taken and leaves the first player alone', async () => {
    const { cloud } = setup();
    const h1 = await pinHash('p03', '111');
    await cloud.createPlayer(saveFor('p03', 'Mia'), h1);
    expect(await cloud.createPlayer(saveFor('p03', 'Max'), await pinHash('p03', '222'))).toBe('taken');
    expect(await cloud.listPlayers()).toEqual([expect.objectContaining({ slot: 'p03', name: 'Mia' })]);
    expect(await cloud.loadSave('p03', h1)).toMatchObject({ name: 'Mia' });
  });

  it('the 31st create returns full', async () => {
    const { cloud } = setup();
    for (const slot of SLOTS) expect(await cloud.createPlayer(saveFor(slot), await pinHash(slot, '000'))).toBe('ok');
    expect(await cloud.listPlayers()).toHaveLength(30);
    expect(await cloud.createPlayer(saveFor('p31'), await pinHash('p31', '000'))).toBe('full');
    // A slot that has a player is taken, even when the list is full too.
    expect(await cloud.createPlayer(saveFor('p05', 'Late'), await pinHash('p05', '000'))).toBe('taken');
    expect(await cloud.listPlayers()).toHaveLength(30);
  });

  it('a slot outside p01…p30 is refused even when there is room', async () => {
    const { cloud, db } = setup();
    expect(await cloud.createPlayer(saveFor('p31'), await pinHash('p31', '000'))).toBe('refused');
    expect(await cloud.createPlayer(saveFor('p00'), await pinHash('p00', '000'))).toBe('refused');
    expect(db.peek('v2')).toBeNull();
  });

  it('stores the save as one string, so empty maps and lists come back as written', async () => {
    const { cloud, db } = setup();
    const s = saveFor('p02', 'Toby');
    const h = await pinHash('p02', '777');
    await cloud.createPlayer(s, h, V1);
    expect(db.peek(`v2/saves/p02/${h}/save`)).toBe(JSON.stringify(s));
    expect(await cloud.loadSave('p02', h)).toEqual(s);
    const t: Save = { ...s, plants: { stars: { 'w1-1': 2 }, unlocked: ['peashooter', 'sunflower'] }, updatedAt: T0 + 5 };
    expect(await cloud.writeSave(t, h, V2, V1)).toBe('ok');
    expect(await cloud.loadSave('p02', h)).toEqual(t);
  });
});

describe('saves and the board', () => {
  it('writeSave stores the save and its board row together', async () => {
    const { cloud, clock } = setup();
    const h = await pinHash('p01', '123');
    await cloud.createPlayer(saveFor('p01', 'Lukas'), h, V1);
    clock.t = T0 + 60_000;
    const s: Save = {
      ...saveFor('p01', 'Lukas'), coins: 500, bestWave: 14, versusWins: 3, computerWins: 9,
      plants: { stars: { a: 3, b: 2 }, unlocked: [] }, updatedAt: T0 + 60_000,
    };
    expect(await cloud.writeSave(s, h, V2, V1)).toBe('ok');
    expect(await cloud.loadSave('p01', h)).toEqual(s);
    expect(await cloud.board()).toEqual([{
      slot: 'p01', name: 'Lukas', picture: s.picture, stars: 5, wave: 14, versusWins: 3, computerWins: 9, updatedAt: T0 + 60_000,
    }]);
  });

  it('writeSave with a wrong pin is wrong-pin and changes nothing', async () => {
    const { cloud } = setup();
    const h = await pinHash('p01', '123');
    const s = saveFor('p01', 'Lukas');
    await cloud.createPlayer(s, h, V1);
    expect(await cloud.writeSave({ ...s, coins: 9999 }, await pinHash('p01', '999'), V2, V1)).toBe('wrong-pin');
    expect(await cloud.loadSave('p01', h)).toEqual(s);
  });

  it('board lists every player, sorted by slot', async () => {
    const { cloud } = setup();
    await cloud.createPlayer(saveFor('p09'), await pinHash('p09', '000'));
    await cloud.createPlayer(saveFor('p02'), await pinHash('p02', '000'));
    expect((await cloud.board()) as unknown[]).toHaveLength(2);
    expect(((await cloud.board()) as { slot: string }[]).map((r) => r.slot)).toEqual(['p02', 'p09']);
  });

  it('clamps the board row to what the rules accept', async () => {
    const { cloud } = setup();
    const h = await pinHash('p01', '123');
    const s: Save = { ...saveFor('p01'), bestWave: 123_456, computerWins: 200_000 };
    expect(await cloud.createPlayer(s, h)).toBe('ok');
    expect(await cloud.board()).toEqual([expect.objectContaining({ wave: 9999, computerWins: 99999 })]);
  });
});

describe('compare-and-swap on the version id', () => {
  it('a write lands only over the version it names; the second of two writers gets conflict', async () => {
    const { cloud } = setup();
    const h = await pinHash('p01', '123');
    await cloud.createPlayer(saveFor('p01', 'Lukas'), h, V1);
    expect(await cloud.loadRecord('p01', h)).toEqual({ save: saveFor('p01', 'Lukas'), ver: V1 });
    const a = { ...saveFor('p01', 'Lukas'), coins: 10, updatedAt: T0 + 1 };
    const b = { ...saveFor('p01', 'Lukas'), coins: 20, updatedAt: T0 + 2 };
    expect(await cloud.writeSave(a, h, V2, V1)).toBe('ok');
    expect(await cloud.writeSave(b, h, V3, V1)).toBe('conflict');
    expect(await cloud.writeSave(b, h, V3, null)).toBe('conflict');
    expect(await cloud.loadRecord('p01', h)).toEqual({ save: a, ver: V2 });
    expect(await cloud.writeSave(b, h, V3, V2)).toBe('ok');
  });

  it('refuses a write that keeps the old version id', async () => {
    const { cloud } = setup();
    const h = await pinHash('p01', '123');
    await cloud.createPlayer(saveFor('p01', 'Lukas'), h, V1);
    expect(await cloud.writeSave({ ...saveFor('p01', 'Lukas'), updatedAt: T0 + 1 }, h, V1, V1)).toBe('refused');
  });
});

describe('the grown-up gate', () => {
  it('sets the grown-up code once', async () => {
    const { cloud } = setup();
    expect(await cloud.setGrownUpCode(hex('a'))).toBe('ok');
    expect(await cloud.setGrownUpCode(hex('b'))).toBe('refused');
  });

  it('deletes a player only with the grown-up code', async () => {
    const { cloud, db } = setup();
    await cloud.setGrownUpCode(hex('a'));
    const h = await pinHash('p04', '444');
    await cloud.createPlayer(saveFor('p04'), h);
    expect(await cloud.deletePlayer('p04', hex('b'))).toBe('wrong-pin');
    expect(await cloud.listPlayers()).toHaveLength(1);
    expect(await cloud.deletePlayer('p04', hex('a'))).toBe('ok');
    expect(await cloud.listPlayers()).toEqual([]);
    expect(await cloud.board()).toEqual([]);
    expect(db.peek('v2/secrets/p04')).toBeNull();
    expect(db.peek('v2/saves/p04')).toBeNull();
    // The slot is free again.
    expect(await cloud.createPlayer(saveFor('p04', 'New'), await pinHash('p04', '000'))).toBe('ok');
  });

  it('cannot delete or reset before a grown-up code exists', async () => {
    const { cloud } = setup();
    await cloud.createPlayer(saveFor('p04'), await pinHash('p04', '444'));
    expect(await cloud.deletePlayer('p04', hex('a'))).toBe('wrong-pin');
    expect(await cloud.resetPin('p04', hex('a'), await pinHash('p04', '000'), saveFor('p04'))).toBe('wrong-pin');
  });

  it('resets a forgotten pin: the new pin works, the old one does not, the old save is gone', async () => {
    const { cloud, db } = setup();
    await cloud.setGrownUpCode(hex('a'));
    const old = await pinHash('p04', '444');
    await cloud.createPlayer({ ...saveFor('p04'), coins: 10 }, old);
    const fresh = await pinHash('p04', '555');
    const s: Save = { ...saveFor('p04'), coins: 10, updatedAt: T0 + 1 };
    expect(await cloud.resetPin('p04', hex('c'), fresh, s)).toBe('wrong-pin');
    expect(await cloud.resetPin('p04', hex('a'), fresh, s)).toBe('ok');
    expect(await cloud.loadSave('p04', fresh)).toEqual(s);
    expect(await cloud.loadSave('p04', old)).toBe('wrong-pin');
    expect(db.peek(`v2/saves/p04/${old}`)).toBeNull();
    expect(await cloud.writeSave(s, old, V2, V1)).toBe('wrong-pin');
  });
});

describe('failures', () => {
  it('no network is offline for every call', async () => {
    const { cloud, db } = setup();
    db.offline = true;
    const h = await pinHash('p01', '123');
    const s = saveFor('p01');
    expect(await cloud.listPlayers()).toBe('offline');
    expect(await cloud.createPlayer(s, h)).toBe('offline');
    expect(await cloud.loadSave('p01', h)).toBe('offline');
    expect(await cloud.writeSave(s, h, V2, null)).toBe('offline');
    expect(await cloud.board()).toBe('offline');
    expect(await cloud.setGrownUpCode(hex('a'))).toBe('offline');
    expect(await cloud.deletePlayer('p01', hex('a'))).toBe('offline');
    expect(await cloud.resetPin('p01', hex('a'), h, s)).toBe('offline');
  });

  it('a stored save that cannot be read is refused, never "nothing stored"', async () => {
    const { cloud, db } = setup();
    const h = await pinHash('p01', '123');
    await cloud.createPlayer(saveFor('p01'), h);
    db.poke(`v2/saves/p01/${h}/save`, JSON.stringify({ ...saveFor('p01'), v: 2 }));
    expect(await cloud.loadSave('p01', h)).toBe('refused');
  });

  it('the v2test root is separate from v2', async () => {
    const { db, cloud } = setup('v2test');
    await cloud.createPlayer(saveFor('p01'), await pinHash('p01', '123'));
    expect(db.peek('v2')).toBeNull();
    expect(db.peek('v2test/players/p01')).not.toBeNull();
  });
});
