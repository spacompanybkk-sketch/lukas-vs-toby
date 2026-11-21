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

  it('ignores turn indices outside 0..MAX_TURN', () => {
    const ls = plantsSeat();
    ls.receive('zombies', -1, '{}');
    ls.receive('zombies', 9001, '{}');
    ls.receive('zombies', 1.5, '{}');
    expect(ls.firstMissing('zombies')).toBe(0);
  });
});
