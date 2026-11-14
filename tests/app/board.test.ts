import { describe, expect, it } from 'vitest';
import { BOARD_KEY, BoardStore, TABLES, placeOf, rankChange, rankTable, rowOf, scoreOf } from '../../src/app/board';
import type { BoardRow } from '../../src/cloud/types';
import { newSave } from '../../src/progress/save';
import type { Save, Slot } from '../../src/progress/save';
import { setup } from '../cloud/helpers';
import { MemoryStorage } from '../progress/memoryStorage';

const row = (slot: Slot, o: Partial<BoardRow> = {}): BoardRow => ({
  slot, name: `N${slot}`, picture: 'peashooter', stars: 0, wave: 0, versusWins: 0, computerWins: 0, updatedAt: 100, ...o,
});

describe('rankTable', () => {
  it('orders by the number, highest first, and leaves out players with none', () => {
    const rows = [row('p01', { computerWins: 2 }), row('p02', { computerWins: 9 }), row('p03'), row('p04', { computerWins: 5 })];
    expect(rankTable(rows, 'computer').map((r) => [r.row.slot, r.rank])).toEqual([['p02', 1], ['p04', 2], ['p01', 3]]);
  });

  it('ties share a rank, the earlier updatedAt first, and the next rank skips', () => {
    const rows = [
      row('p01', { stars: 6, updatedAt: 300 }), row('p02', { stars: 6, updatedAt: 100 }),
      row('p03', { stars: 9 }), row('p04', { stars: 2 }),
    ];
    expect(rankTable(rows, 'stars').map((r) => [r.row.slot, r.rank])).toEqual([['p03', 1], ['p02', 2], ['p01', 2], ['p04', 4]]);
  });

  it('reads each table from its own field', () => {
    const r = row('p01', { stars: 1, wave: 2, versusWins: 3, computerWins: 4 });
    expect(TABLES.map((t) => scoreOf(r, t))).toEqual([1, 2, 3, 4]);
  });

  it('placeOf: the rank, or null when not on the table', () => {
    const rows = [row('p01', { wave: 3 }), row('p02')];
    expect(placeOf(rows, 'wave', 'p01')).toBe(1);
    expect(placeOf(rows, 'wave', 'p02')).toBeNull();
  });
});

describe('rankChange', () => {
  const save = (slot: Slot, o: Partial<Save> = {}): Save => ({ ...newSave(slot, `N${slot}`, 'peashooter', 50), ...o });

  it('a win that moves the player up shows the new rank in that table', () => {
    const base = [row('p01', { computerWins: 3 }), row('p02', { computerWins: 2, updatedAt: 50 }), row('p03', { computerWins: 1 })];
    const before = save('p03', { computerWins: 1 });
    const after = save('p03', { computerWins: 3 });
    // 3 ties p01's 3: they share first place (p03 stands behind p01 in the list).
    expect(rankChange(base, before, after)).toEqual({ table: 'computer', rank: 1 });
  });

  it('no change of place, no cue', () => {
    const base = [row('p01', { computerWins: 9 }), row('p02', { computerWins: 2 })];
    expect(rankChange(base, save('p02', { computerWins: 2 }), save('p02', { computerWins: 3 }))).toBeNull();
  });

  it('first time on a table with others on the board counts as moving up', () => {
    const base = [row('p01', { computerWins: 5 }), row('p02')];
    expect(rankChange(base, save('p02'), save('p02', { computerWins: 1 }))).toEqual({ table: 'computer', rank: 2 });
  });

  it('entering a table, however high, never outranks a real climb of one place elsewhere', () => {
    const base = [
      row('p01', { computerWins: 5 }), row('p02', { computerWins: 2 }), row('p03', { computerWins: 1 }),
      row('p05', { versusWins: 1 }), row('p06', { versusWins: 1 }), row('p07', { versusWins: 1 }),
    ];
    const before = save('p03', { computerWins: 1 });
    // computer: 3rd → 2nd (a climb of 1); versus: in for the first time, at 1st (from "below 7").
    const after = save('p03', { computerWins: 3, versusWins: 2 });
    expect(rankChange(base, before, after)).toEqual({ table: 'computer', rank: 2 });
  });

  it('with only entries, the best entry is shown', () => {
    const base = [row('p01', { versusWins: 5, stars: 1 }), row('p02', { stars: 9 })];
    // versus: in at 2nd (behind p01's 5); wave: in at 1st (nobody else has a wave). Both are entries.
    const after = { ...save('p03'), bestWave: 4, versusWins: 1 };
    expect(rankChange(base, save('p03'), after)).toEqual({ table: 'wave', rank: 1 });
  });

  it('with one player there is no cue', () => {
    expect(rankChange([row('p01')], save('p01'), save('p01', { computerWins: 1 }))).toBeNull();
    expect(rankChange([], save('p01'), save('p01', { computerWins: 1 }))).toBeNull();
  });

  it('only the best improvement is shown', () => {
    const base = [
      row('p01', { computerWins: 5, versusWins: 1 }), row('p02', { computerWins: 4, versusWins: 3 }),
      row('p03', { computerWins: 3, versusWins: 2 }), row('p04', { computerWins: 1, versusWins: 0 }),
    ];
    const before = save('p04', { computerWins: 1 });
    // computer: 4th → 1st (3 places); versus: unranked → 1st. A real climb beats a first entry.
    const after = save('p04', { computerWins: 6, versusWins: 4 });
    expect(rankChange(base, before, after)).toEqual({ table: 'computer', rank: 1 });
    const after2 = save('p04', { computerWins: 6, versusWins: 1 });
    // computer: 4th → 1st (+3); versus: unranked (5) → 3rd (+2).
    expect(rankChange(base, before, after2)).toEqual({ table: 'computer', rank: 1 });
  });

  it('rowOf publishes the save as a board row', () => {
    const r = rowOf(save('p05', { computerWins: 2, bestWave: 7 }), 99);
    expect(r).toMatchObject({ slot: 'p05', computerWins: 2, wave: 7, stars: 0, updatedAt: 99 });
  });
});

describe('BoardStore', () => {
  it('fetches the board and keeps it on the device; offline it gives the kept copy', async () => {
    const { db, cloud } = setup();
    const storage = new MemoryStorage();
    db.poke('v2/board/p01', row('p01', { computerWins: 4 }) as never);
    const store = new BoardStore();
    store.configure({ cloud, storage });
    const first = await store.fetch();
    expect(first.online).toBe(true);
    expect(first.rows.map((r) => r.slot)).toEqual(['p01']);
    expect(JSON.parse(storage.getItem(BOARD_KEY) ?? 'null').rows).toHaveLength(1);

    db.offline = true;
    const again = await store.fetch();
    expect(again).toEqual({ online: false, rows: first.rows });
  });

  it('offline with nothing kept: an empty board; a broken copy is ignored', async () => {
    const { db, cloud } = setup();
    db.offline = true;
    const storage = new MemoryStorage();
    storage.setItem(BOARD_KEY, '{nope');
    const store = new BoardStore();
    store.configure({ cloud, storage });
    expect(await store.fetch()).toEqual({ online: false, rows: [] });
    expect(store.cached()).toBeNull();
  });
});
