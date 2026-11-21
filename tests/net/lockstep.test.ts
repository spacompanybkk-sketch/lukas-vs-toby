import { describe, expect, it } from 'vitest';
import { Lockstep } from '../../src/net/lockstep';
import { decodeTurn } from '../../src/net/turnCodec';
import type { Command } from '../../src/sim/types';

const place = (lane = 2, col = 3): Command => ({ type: 'place', faction: 'plants', unit: 'peashooter', lane, col });
const plantsSeat = () => new Lockstep({ seat: 'plants', delay: 12 });

describe('Lockstep', () => {
  it('rejects a delay outside 9..30', () => {
    expect(() => new Lockstep({ seat: 'plants', delay: 8 })).toThrow(RangeError);
    expect(() => new Lockstep({ seat: 'plants', delay: 31 })).toThrow(RangeError);
    expect(new Lockstep({ seat: 'zombies', delay: 9 }).delay).toBe(9);
  });

  it('publishes turns 0 and 1 empty at tick 0, then nothing until tick 6', () => {
    const ls = plantsSeat();
    expect(ls.takeDue(0)).toEqual([{ k: 0, raw: '{}' }, { k: 1, raw: '{}' }]);
    for (let t = 0; t <= 5; t++) expect(ls.takeDue(t)).toEqual([]);
    expect(ls.takeDue(6)).toEqual([{ k: 2, raw: '{}' }]);
  });

  it('stamps a tap delay ticks later and publishes it once no tap can land in its turn', () => {
    const ls = plantsSeat();
    ls.takeDue(0);
    const tap = ls.submit(place(), 0);
    expect(tap).toEqual({ id: expect.any(Number), runTick: 12, cmd: place() });
    expect(ls.pending()).toEqual([tap]);
    expect(ls.takeDue(5)).toEqual([]);
    const due = ls.takeDue(6);
    expect(due.map((d) => d.k)).toEqual([2]);
    expect(decodeTurn(due[0]!.raw, 'plants').commands).toEqual([{ at: 0, cmd: place() }]);
  });

  it('runs a tick only with both turns held and its own acknowledged', () => {
    const ls = plantsSeat();
    expect(ls.canRun(0)).toBe(false);
    ls.takeDue(0);
    expect(ls.canRun(0)).toBe(false); // taken, not acknowledged
    ls.receive('zombies', 0, '{}');
    expect(ls.canRun(0)).toBe(false); // the other's turn held, own still unacknowledged
    ls.acked(0);
    for (let t = 0; t <= 5; t++) expect(ls.canRun(t)).toBe(true);
    expect(ls.canRun(6)).toBe(false);
    ls.acked(1);
    expect(ls.canRun(6)).toBe(false); // the other's turn 1 missing
  });

  it('acknowledges in the other order too', () => {
    const ls = plantsSeat();
    ls.takeDue(0);
    ls.acked(0);
    expect(ls.canRun(0)).toBe(false);
    ls.receive('zombies', 0, '{}');
    expect(ls.canRun(0)).toBe(true);
  });

  it('lists plants\' commands before zombies\' at one tick, and drops run taps from pending', () => {
    const ls = plantsSeat();
    ls.takeDue(0);
    ls.submit(place(1, 1), 0);
    ls.takeDue(6);
    ls.receive('zombies', 2, '{"c":[[0,"place","brainEater",2,9]]}');
    expect(ls.commandsAt(11)).toEqual([]);
    expect(ls.pending()).toHaveLength(1);
    expect(ls.commandsAt(12)).toEqual([
      { type: 'place', faction: 'plants', unit: 'peashooter', lane: 1, col: 1 },
      { type: 'place', faction: 'zombies', unit: 'brainEater', lane: 2, col: 9 },
    ]);
    expect(ls.pending()).toEqual([]);
  });

  it('runs the sender\'s own command from its stored string, faction from the seat', () => {
    const ls = plantsSeat();
    ls.adoptOwn(0, '{"c":[[2,"place","sunflower",0,0]]}');
    ls.receive('zombies', 0, '{}');
    expect(ls.canRun(2)).toBe(true); // adopted turns count as acknowledged
    expect(ls.commandsAt(2)).toEqual([{ type: 'place', faction: 'plants', unit: 'sunflower', lane: 0, col: 0 }]);
    expect(ls.takeDue(0)).toEqual([{ k: 1, raw: '{}' }]); // turn 0 is already in the database
  });

  it('keeps commands in record order within a seat', () => {
    const ls = plantsSeat();
    ls.takeDue(0);
    ls.submit(place(0, 0), 0);
    ls.submit(place(1, 0), 0);
    ls.takeDue(6);
    ls.receive('zombies', 2, '{}');
    expect(ls.commandsAt(12).map((c) => (c as { lane: number }).lane)).toEqual([0, 1]);
  });

  it('answers full to the ninth tap landing in one turn', () => {
    const ls = plantsSeat();
    ls.takeDue(0);
    for (let i = 0; i < 8; i++) expect(ls.submit(place(0, i), 0)).not.toBe('full');
    expect(ls.submit(place(1, 0), 0)).toBe('full');
    expect(ls.pending()).toHaveLength(8);
    expect(ls.submit(place(1, 0), 6)).toMatchObject({ runTick: 18 }); // the next turn is free
  });

  it('never stamps a tap into a turn already taken', () => {
    const ls = plantsSeat();
    const taken = ls.takeDue(30);
    const firstUntaken = taken.length;
    expect(firstUntaken).toBe(7); // 6k + 5 − 12 < 30 for k ≤ 6
    const tap = ls.submit(place(), 20);
    expect(tap).not.toBe('full');
    expect((tap as { runTick: number }).runTick).toBeGreaterThanOrEqual(6 * firstUntaken);
    expect(ls.takeDue(35)).toEqual([]);
    const next = ls.takeDue(36); // turn 7 is due once the tick passes 6·7 + 5 − 12 = 35
    expect(next.map((d) => d.k)).toEqual([7]);
    expect(decodeTurn(next[0]!.raw, 'plants').commands).toEqual([{ at: 0, cmd: place() }]);
  });

  it('carries an offered hash on the next taken turn only', () => {
    const ls = plantsSeat();
    ls.takeDue(0);
    ls.offerHash(30, 77);
    const [first] = ls.takeDue(6);
    expect(first!.raw).toBe('{"h":[30,77]}');
    expect(ls.takeDue(12)).toEqual([{ k: 3, raw: '{}' }]);
  });

  it('carries the newest of several offered hashes', () => {
    const ls = plantsSeat();
    ls.offerHash(30, 1);
    ls.offerHash(60, 2);
    const due = ls.takeDue(0);
    expect(due[0]!.raw).toBe('{"h":[60,2]}');
    expect(due[1]!.raw).toBe('{}');
  });

  it('keeps the first string of a turn received twice and ignores its own seat', () => {
    const ls = plantsSeat();
    ls.receive('zombies', 0, '{"c":[[0,"hero",1]]}');
    ls.receive('zombies', 0, '{"c":[[0,"hero",4]]}');
    ls.receive('plants', 0, '{"c":[[0,"hero",3]]}');
    ls.takeDue(0);
    ls.acked(0);
    expect(ls.commandsAt(0)).toEqual([{ type: 'hero', faction: 'zombies', lane: 1 }]);
  });

  it('hands out the other seat\'s hashes once each', () => {
    const ls = plantsSeat();
    ls.receive('zombies', 0, '{"h":[0,5]}');
    ls.receive('zombies', 0, '{"h":[0,6]}'); // repeat: ignored
    ls.receive('zombies', 5, '{"h":[30,9]}');
    ls.receive('zombies', 1, '{}');
    expect(ls.remoteHashes()).toEqual([[0, 5], [30, 9]]);
    expect(ls.remoteHashes()).toEqual([]);
  });

  it('reports the lowest turn not held for each seat', () => {
    const ls = plantsSeat();
    expect(ls.firstMissing('zombies')).toBe(0);
    ls.receive('zombies', 0, '{}');
    ls.receive('zombies', 2, '{}');
    expect(ls.firstMissing('zombies')).toBe(1);
    ls.receive('zombies', 1, '{}');
    expect(ls.firstMissing('zombies')).toBe(3);
    expect(ls.firstMissing('plants')).toBe(0);
    ls.takeDue(0);
    expect(ls.firstMissing('plants')).toBe(2);
  });

  it('drops taps of turns not yet taken after a sleep, keeping published ones', () => {
    const ls = plantsSeat();
    ls.takeDue(0);
    const published = ls.submit(place(0, 0), 0); // runTick 12, turn 2
    ls.takeDue(6);
    const late = ls.submit(place(1, 1), 6); // runTick 18, turn 3, not taken
    expect(ls.dropUnpublished()).toEqual([late]);
    expect(ls.pending()).toEqual([published]);
    expect(ls.takeDue(12)).toEqual([{ k: 3, raw: '{}' }]);
  });

  describe('adoptOwn on rejoin', () => {
    const dbRaw = '{"c":[[0,"hero",4]]}';

    it('lets the database string win over a turn built here that has not run', () => {
      const ls = plantsSeat();
      ls.takeDue(0);
      ls.submit(place(), 0); // runTick 12, turn 2
      ls.takeDue(6); // builds turn 2 locally with the place
      expect(ls.adoptOwn(2, dbRaw)).toBe(true);
      expect(ls.pending()).toEqual([]); // the superseded tap will never run
      ls.receive('zombies', 2, '{}');
      expect(ls.canRun(12)).toBe(true);
      expect(ls.commandsAt(12)).toEqual([{ type: 'hero', faction: 'plants', lane: 4 }]);
    });

    it('changes nothing when the database holds the same string', () => {
      const ls = plantsSeat();
      ls.takeDue(0);
      const tap = ls.submit(place(), 0);
      const [built] = ls.takeDue(6);
      expect(ls.adoptOwn(2, built!.raw)).toBe(true);
      expect(ls.pending()).toEqual([tap]);
      ls.receive('zombies', 2, '{}');
      expect(ls.commandsAt(12)).toEqual([place()]);
    });

    it('answers false when the turn already ran from a different string', () => {
      const ls = plantsSeat();
      ls.takeDue(0);
      ls.acked(0);
      ls.receive('zombies', 0, '{}');
      ls.commandsAt(0);
      expect(ls.adoptOwn(0, dbRaw)).toBe(false);
      expect(ls.commandsAt(0)).toEqual([{ type: 'hero', faction: 'plants', lane: 4 }]); // the database's from now on
      expect(ls.adoptOwn(1, dbRaw)).toBe(true); // turn 1 has not run
    });

    it('drops own taps stamped into a turn the database already holds', () => {
      const ls = plantsSeat();
      ls.takeDue(0);
      ls.submit(place(), 0); // runTick 12, turn 2, not taken yet
      expect(ls.adoptOwn(2, dbRaw)).toBe(true);
      expect(ls.pending()).toEqual([]);
    });

    it('does not jump over turns it does not hold', () => {
      const ls = plantsSeat();
      ls.adoptOwn(5, '{}');
      expect(ls.firstMissing('plants')).toBe(0);
      // turns 0–4 are still built here; 5 is not built again
      expect(ls.takeDue(60).map((d) => d.k)).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
      for (let k = 0; k <= 4; k++) {
        ls.acked(k);
        ls.receive('zombies', k, '{}');
        expect(ls.canRun(6 * k)).toBe(true);
      }
    });

    it('stamps a tap past an adopted turn ahead of the take cursor', () => {
      const ls = plantsSeat();
      ls.takeDue(0); // turns 0, 1
      ls.adoptOwn(2, '{}');
      ls.adoptOwn(4, '{}');
      const tap = ls.submit(place(), 0); // tick + delay = 12 lands in turn 2, held: next free is 3
      expect(tap).toMatchObject({ runTick: 18 });
      const tap2 = ls.submit(place(), 12); // 24 is turn 4, held: next free is 5
      expect(tap2).toMatchObject({ runTick: 30 });
    });
  });

  it('ignores hashes a record cannot carry', () => {
    const ls = plantsSeat();
    ls.offerHash(30, 77);
    ls.offerHash(54001, 1);
    ls.offerHash(60, 0x100000000);
    ls.offerHash(-30, 1);
    ls.offerHash(30.5, 1);
    expect(ls.takeDue(0)[0]!.raw).toBe('{"h":[30,77]}');
    ls.offerHash(54000, 0xffffffff);
    expect(ls.takeDue(6)[0]!.raw).toBe('{"h":[54000,4294967295]}');
  });

  it.each([-1, 1.5, Number.NaN])('throws RangeError on a tap at tick %s', (tick) => {
    expect(() => plantsSeat().submit(place(), tick)).toThrow(RangeError);
  });

  it('throws RangeError on a command no record can carry, keeping the valid taps beside it', () => {
    const ls = plantsSeat();
    const good = ls.submit(place(), 0);
    expect(() => ls.submit({ type: 'hero', faction: 'plants', lane: 1.5 }, 0)).toThrow(RangeError);
    expect(() => ls.submit({ type: 'place', faction: 'plants', unit: 'dragon' as never, lane: 2, col: 3 }, 0)).toThrow(RangeError);
    expect(() => ls.submit({ type: 'belt', faction: 'plants', slot: 0, lane: 1, col: 1 }, 0)).toThrow(RangeError);
    expect(ls.pending()).toEqual([good]);
    const [, , turn2] = ls.takeDue(6);
    expect(decodeTurn(turn2!.raw, 'plants').commands).toEqual([{ at: 0, cmd: place() }]);
  });

  it('ignores turn indices outside 0..MAX_TURN', () => {
    const ls = plantsSeat();
    ls.receive('zombies', -1, '{}');
    ls.receive('zombies', 9001, '{}');
    ls.receive('zombies', 1.5, '{}');
    expect(ls.firstMissing('zombies')).toBe(0);
  });
});
