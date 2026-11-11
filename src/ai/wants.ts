/**
 * How a strategy turns its wish list into one command: it lists what it would like to do, most
 * urgent first, and `choose` sends the first thing the match accepts right now.
 */

import type { Match } from '../sim/match';
import type { Command } from '../sim/types';

/** Something a strategy would like to do, in its order of preference. */
export interface Want {
  readonly cmd: Command;
  /**
   * What to do when this cannot be done yet. Left out: move on down the list. `'energy'`: if it is
   * only short of energy, wait for the energy rather than spend it further down the list. `'card'`:
   * wait out the card's recharge as well.
   */
  readonly wait?: 'energy' | 'card';
  /** Runs when this is the command chosen. */
  readonly onChosen?: () => void;
}

/**
 * The first wish `match.check` accepts right now, or null: nothing to do, or saving up for a wish
 * that said to wait. Whatever it returns, the match accepts at this moment.
 */
export function choose(match: Match, wants: Iterable<Want>): Command | null {
  for (const want of wants) {
    const reason = match.check(want.cmd);
    if (reason === null) {
      want.onChosen?.();
      return want.cmd;
    }
    if (reason === 'no-energy' && want.wait !== undefined) return null;
    if (reason === 'recharging' && want.wait === 'card') return null;
  }
  return null;
}
