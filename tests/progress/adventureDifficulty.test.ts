import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud, saveToWire } from '../../src/cloud/restClient';
import { SaveSync } from '../../src/cloud/sync';
import { ALL_CARDS } from '../../src/data/units';
import { loadLocal } from '../../src/progress/localStore';
import { mergeSaves } from '../../src/progress/merge';
import { MAX_TEACHED, PICTURES, newSave, parseSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { MemoryStorage } from './memoryStorage';

const T0 = 1_762_900_000_000;

/** A save as a build from before this key wrote it: the same fields, without `adventureDifficulty`. */
function oldWire(s: Save): string {
  const o: Record<string, unknown> = JSON.parse(saveToWire(s));
  delete o.adventureDifficulty;
  return JSON.stringify(o);
}

describe('review focus 4: Adventure difficulty in old and new saves', () => {
  const base: Save = { ...newSave('p01', 'Lukas', 'peashooter', T0), difficulty: { plants: 'hard', zombies: 'easy' } };

  it('an old save string has no key and reads with the key seeded from difficulty', () => {
    const wire = oldWire(base);
    expect(wire).not.toContain('adventureDifficulty');
    expect(parseSave(JSON.parse(wire))?.adventureDifficulty).toEqual({ plants: 'hard', zombies: 'easy' });
  });

  it('old + new merge: the newer copy\'s Adventure difficulty wins, whichever of the two is old', () => {
    const old = parseSave(JSON.parse(oldWire({ ...base, updatedAt: T0 + 100 })))!;
    const fresh: Save = { ...base, adventureDifficulty: { plants: 'easy', zombies: 'medium' }, updatedAt: T0 + 200 };
    const m = mergeSaves(old, fresh, T0 + 500);
    expect(m.adventureDifficulty).toEqual({ plants: 'easy', zombies: 'medium' });
    expect(m.difficulty).toEqual({ plants: 'hard', zombies: 'easy' });
    expect(parseSave(JSON.parse(saveToWire(m)))).toEqual(m);
    // The old copy newer: its seeded value (= its difficulty) is the newer one.
    const later = parseSave(JSON.parse(oldWire({ ...base, updatedAt: T0 + 300 })))!;
    expect(mergeSaves(later, fresh, T0 + 500).adventureDifficulty).toEqual({ plants: 'hard', zombies: 'easy' });
  });

  it('the largest save there can be (80 levels a side, everything unlocked and upgraded, 128 steps) stays under 20,000 characters', () => {
    const stars: Record<string, 3> = {};
    const zstars: Record<string, 3> = {};
    for (let w = 1; w <= 5; w++) {
      for (let n = 1; n <= 16; n++) {
        stars[`p${w}-${n}`] = 3;
        zstars[`z${w}-${n}`] = 3;
      }
    }
    const upgrades = Object.fromEntries(PICTURES.map((k) => [k, 10]));
    const biggest: Save = {
      ...base, name: 'ABCDEFGHIJ', coins: Number.MAX_SAFE_INTEGER, upgrades,
      plants: { stars, unlocked: [...ALL_CARDS.plants] }, zombies: { stars: zstars, unlocked: [...ALL_CARDS.zombies] },
      bestWave: Number.MAX_SAFE_INTEGER, bestGarden: Number.MAX_SAFE_INTEGER,
      versusWins: Number.MAX_SAFE_INTEGER, computerWins: Number.MAX_SAFE_INTEGER, updatedAt: Number.MAX_SAFE_INTEGER,
      lastBattle: 'b'.repeat(64), teached: Array.from({ length: MAX_TEACHED }, (_, i) => `${i}`.padStart(64, 's')),
      adventureDifficulty: { plants: 'medium', zombies: 'medium' },
    };
    expect(parseSave(biggest)).toEqual(biggest);
    const wire = saveToWire(biggest);
    expect(wire.length).toBeLessThan(20_000);
  });
});

describe('review focus 4: an old save in the cloud loads, plays, syncs and merges with a device that has the key', () => {
  let t = T0;
  let db: FakeDatabase;
  const syncs: SaveSync[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    t = T0;
    db = new FakeDatabase({ now: () => t });
  });
  afterEach(() => {
    for (const s of syncs.splice(0)) s.dispose();
    vi.useRealTimers();
  });
  const make = (storage = new MemoryStorage()): { sync: SaveSync; storage: MemoryStorage } => {
    const sync = new SaveSync(createFakeCloud(db), storage, { now: () => t, window: null, document: null });
    syncs.push(sync);
    return { sync, storage };
  };

  it('device B reads the old string, changes Adventure difficulty, and device A (old copy on it) merges it in', async () => {
    const first = make();
    const start: Save = { ...newSave('p01', 'Lukas', 'peashooter', T0), difficulty: { plants: 'hard', zombies: 'easy' } };
    expect(await first.sync.create(start, '123')).not.toBe('offline');
    first.sync.dispose();
    // The cloud and device A hold the save as an old build wrote it: no adventureDifficulty.
    const hash = await pinHash('p01', '123');
    const path = `v2/saves/p01/${hash}/save`;
    db.poke(path, oldWire(start));
    first.storage.setItem('lvt2_save_p01', oldWire(start));
    expect(String(db.peek(path))).not.toContain('adventureDifficulty');
    // Device A comes back with its old copy.
    const a = make(first.storage);
    expect(typeof await a.sync.login('p01', '123')).toBe('object');

    // Device B logs in: the old string loads, seeded from difficulty.
    const b = make();
    const loaded = await b.sync.login('p01', '123');
    expect(typeof loaded).toBe('object');
    expect((loaded as Save).adventureDifficulty).toEqual({ plants: 'hard', zombies: 'easy' });

    // B plays: a new Adventure difficulty for the plants, and a star; it syncs through the real rules.
    t = T0 + 100;
    b.sync.update((s) => ({ ...s, adventureDifficulty: { ...s.adventureDifficulty, plants: 'easy' }, plants: { ...s.plants, stars: { 'p1-1': 2 } } }));
    await b.sync.idle();
    expect(b.sync.state.value).toBe('synced');
    expect(String(db.peek(path))).toContain('"adventureDifficulty":{"plants":"easy","zombies":"easy"}');

    // A, which still has the old copy, plays offline-style (more coins) and then syncs: merged.
    t = T0 + 50;
    a.sync.update((s) => ({ ...s, coins: 40 }));
    await a.sync.idle();
    const merged = a.sync.save.value!;
    expect(merged.coins).toBe(40);
    expect(merged.plants.stars['p1-1']).toBe(2);
    expect(merged.adventureDifficulty.plants).toBe('easy');
    expect(merged.difficulty).toEqual({ plants: 'hard', zombies: 'easy' });
    expect(loadLocal('p01', a.storage)?.adventureDifficulty.plants).toBe('easy');
  });
});
