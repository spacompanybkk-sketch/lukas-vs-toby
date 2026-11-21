import { describe, expect, it } from 'vitest';
import {
  EMPTY_TURN, MAX_TURN, decodeTurn, encodeTurn, parseTurnKey, turnKey, type Turn,
} from '../../src/net/turnCodec';
import type { Command } from '../../src/sim/types';

const EMPTY: Turn = { commands: [], hash: null };

describe('encodeTurn', () => {
  it('writes the record of spec 6.3 exactly', () => {
    const raw = encodeTurn({
      commands: [
        { at: 3, cmd: { type: 'place', faction: 'zombies', unit: 'brainEater', lane: 2, col: 9 } },
        { at: 5, cmd: { type: 'spell', faction: 'zombies', spell: 'meteor', lane: 1, col: 4 } },
      ],
      hash: [300, 3452586360],
    });
    expect(raw).toBe('{"c":[[3,"place","brainEater",2,9],[5,"spell","meteor",1,4]],"h":[300,3452586360]}');
  });

  it('writes an empty turn as {}', () => {
    expect(encodeTurn(EMPTY)).toBe('{}');
    expect(EMPTY_TURN).toBe('{}');
  });

  it('writes a hash alone without a command list', () => {
    expect(encodeTurn({ commands: [], hash: [30, 77] })).toBe('{"h":[30,77]}');
  });

  it('throws RangeError on nine commands', () => {
    const cmd: Command = { type: 'hero', faction: 'plants', lane: 1 };
    const commands = Array.from({ length: 9 }, () => ({ at: 0, cmd }));
    expect(() => encodeTurn({ commands, hash: null })).toThrow(RangeError);
  });

  it('throws RangeError on a belt command', () => {
    const cmd: Command = { type: 'belt', faction: 'plants', slot: 0, lane: 1, col: 2 };
    expect(() => encodeTurn({ commands: [{ at: 0, cmd }], hash: null })).toThrow(RangeError);
  });

  it.each([-1, 6, 1.5])('throws RangeError on offset %s', (at) => {
    const cmd: Command = { type: 'hero', faction: 'plants', lane: 1 };
    expect(() => encodeTurn({ commands: [{ at, cmd }], hash: null })).toThrow(RangeError);
  });

  it('throws RangeError past 400 characters', () => {
    // eight of the longest real commands and a full hash fit
    const longest: Command = { type: 'place', faction: 'zombies', unit: 'skeletonWarrior', lane: 4, col: 9 };
    const full = Array.from({ length: 8 }, () => ({ at: 5, cmd: longest }));
    expect(encodeTurn({ commands: full, hash: [54000, 4294967295] }).length).toBeLessThanOrEqual(400);
    // merges onto absurd ids do not
    const merge: Command = { type: 'merge', faction: 'plants', unit: 'avocadoBunker', targetId: 1e20 };
    const huge = Array.from({ length: 8 }, () => ({ at: 0, cmd: merge }));
    expect(() => encodeTurn({ commands: huge, hash: [54000, 4294967295] })).toThrow(RangeError);
  });
});

describe('decodeTurn round trip', () => {
  const commands: Command[] = [
    { type: 'place', faction: 'plants', unit: 'peashooter', lane: 0, col: 3 },
    { type: 'merge', faction: 'plants', unit: 'sunflower', targetId: 42 },
    { type: 'remove', faction: 'plants', targetId: 7 },
    { type: 'hero', faction: 'plants', lane: 4 },
    { type: 'spell', faction: 'plants', spell: 'rockWall', lane: 2, col: 5 },
  ];

  it.each(commands.map((cmd, i) => [cmd.type, cmd, i] as const))('keeps a %s command', (_type, cmd, i) => {
    const turn: Turn = { commands: [{ at: i, cmd }], hash: null };
    expect(decodeTurn(encodeTurn(turn), 'plants')).toEqual(turn);
  });

  it('writes each type in its fixed field order', () => {
    const raw = encodeTurn({ commands: commands.map((cmd, at) => ({ at, cmd })), hash: [60, 1] });
    expect(JSON.parse(raw)).toEqual({
      c: [
        [0, 'place', 'peashooter', 0, 3],
        [1, 'merge', 'sunflower', 42],
        [2, 'remove', 7],
        [3, 'hero', 4],
        [4, 'spell', 'rockWall', 2, 5],
      ],
      h: [60, 1],
    });
  });

  it('keeps all of a full turn with its hash', () => {
    const turn: Turn = { commands: commands.map((cmd, at) => ({ at, cmd })), hash: [60, 4294967295] };
    expect(decodeTurn(encodeTurn(turn), 'plants')).toEqual(turn);
  });
});

describe('decodeTurn', () => {
  it('sets the faction of the seat on every command, a peashooter on the zombies side too', () => {
    const turn = decodeTurn('{"c":[[0,"place","peashooter",1,2],[1,"hero",3],[2,"remove",5]]}', 'zombies');
    expect(turn.commands.map((c) => c.cmd.faction)).toEqual(['zombies', 'zombies', 'zombies']);
    expect(turn.commands[0]).toEqual({ at: 0, cmd: { type: 'place', faction: 'zombies', unit: 'peashooter', lane: 1, col: 2 } });
  });

  it('reads {} as an empty turn', () => {
    expect(decodeTurn('{}', 'plants')).toEqual(EMPTY);
  });

  const nine = `{"c":[${Array.from({ length: 9 }, () => '[0,"hero",1]').join(',')}]}`;
  // a good record padded with JSON whitespace: only its length is wrong
  const good = '{"c":[[0,"hero",1]]}';
  const long = good.slice(0, -1) + ' '.repeat(401 - good.length) + '}';
  it.each<[string, unknown]>([
    ['null', null],
    ['the empty string', ''],
    ['a broken object', '{'],
    ['a list', '[]'],
    ['an unknown key', '{"x":1}'],
    ['offset 6', '{"c":[[6,"hero",1]]}'],
    ['a belt command', '{"c":[[0,"belt",0,1,2]]}'],
    ['an unknown type', '{"c":[[0,"dance",1]]}'],
    ['a missing field', '{"c":[[0,"place","peashooter",1]]}'],
    ['1.5 as a lane', '{"c":[[0,"hero",1.5]]}'],
    ['nine commands', nine],
    ['a 401-character string', long],
    ['h with three numbers', '{"h":[30,77,1]}'],
    ['an unknown unit', '{"c":[[0,"place","dragon",1,2]]}'],
    ['an unknown spell', '{"c":[[0,"spell","nuke",1,2]]}'],
    ['a number instead of a string', 7],
    ['a JSON string of a string', '"{}"'],
    ['one bad command among good ones', '{"c":[[0,"hero",1],[1,"hero","x"]],"h":[30,1]}'],
  ])('reads %s as no commands and no hash', (_name, raw) => {
    expect(decodeTurn(raw, 'plants')).toEqual(EMPTY);
  });

  it('the 401-character case is a good record but for its length', () => {
    expect(long.length).toBe(401);
    const exactly400 = good.slice(0, -1) + ' '.repeat(400 - good.length) + '}';
    expect(decodeTurn(exactly400, 'plants').commands).toHaveLength(1);
  });
});

describe('turn keys', () => {
  it('pads to six digits behind t', () => {
    expect(turnKey(0)).toBe('t000000');
    expect(turnKey(120)).toBe('t000120');
    expect(turnKey(9000)).toBe('t009000');
    expect(MAX_TURN).toBe(9000);
  });

  it.each([9001, -1, 1.5, Number.NaN])('throws on %s', (k) => {
    expect(() => turnKey(k)).toThrow(RangeError);
  });

  it('parses its own keys and nothing else', () => {
    expect(parseTurnKey('t000120')).toBe(120);
    expect(parseTurnKey('t009000')).toBe(9000);
    expect(parseTurnKey('t9')).toBeNull();
    expect(parseTurnKey('t009001')).toBeNull();
    expect(parseTurnKey('x000120')).toBeNull();
    expect(parseTurnKey('t00012a')).toBeNull();
  });
});
