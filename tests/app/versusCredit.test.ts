import { describe, expect, it } from 'vitest';
import { versusCredit } from '../../src/app/versusCredit';
import type { VersusOutcome } from '../../src/net/lockstepMatch';

/** Spec 9: who a Versus outcome credits on one device. */
describe('versusCredit', () => {
  const rows: [string, VersusOutcome, 'plants' | 'zombies', 'p01' | 'p02', { won: boolean } | null][] = [
    ['won by my seat (plants)', { kind: 'won', winner: 'plants' }, 'plants', 'p01', { won: true }],
    ['won by the other seat (plants)', { kind: 'won', winner: 'zombies' }, 'plants', 'p01', { won: false }],
    ['won by my seat (zombies)', { kind: 'won', winner: 'zombies' }, 'zombies', 'p02', { won: true }],
    ['won by the other seat (zombies)', { kind: 'won', winner: 'plants' }, 'zombies', 'p02', { won: false }],
    ['a draw', { kind: 'won', winner: 'draw' }, 'plants', 'p01', null],
    ['a forfeit by me', { kind: 'forfeit', winner: 'zombies', by: 'p01' }, 'plants', 'p01', { won: false }],
    ['a forfeit by the other', { kind: 'forfeit', winner: 'plants', by: 'p02' }, 'plants', 'p01', { won: true }],
    ['unfinished (broken)', { kind: 'unfinished', why: 'broken' }, 'plants', 'p01', null],
    ['unfinished (flag)', { kind: 'unfinished', why: 'flag' }, 'zombies', 'p02', null],
    ['unfinished (silence)', { kind: 'unfinished', why: 'silence' }, 'zombies', 'p02', null],
    ['unfinished (gone)', { kind: 'unfinished', why: 'gone' }, 'plants', 'p01', null],
    ['a disagreement (host shown)', { kind: 'disagree', shown: 'plants' }, 'plants', 'p01', null],
  ];
  it.each(rows)('%s', (_name, outcome, seat, me, expected) => {
    expect(versusCredit(outcome, seat, me)).toEqual(expected);
  });
});
