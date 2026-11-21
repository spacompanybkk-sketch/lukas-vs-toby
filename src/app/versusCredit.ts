import type { VersusOutcome } from '../net/lockstepMatch';
import type { Slot } from '../progress/save';
import type { Faction } from '../sim/types';

/**
 * Who a Versus outcome credits on this device (spec 9): a win (the winner's seat) or a forfeit
 * (the one who did not give up) counts for the winner and is a plain loss for the other; a draw,
 * an unfinished match and a disagreement credit nobody (null).
 */
export function versusCredit(o: VersusOutcome, mySeat: Faction, me: Slot): { won: boolean } | null {
  switch (o.kind) {
    case 'won': return o.winner === 'draw' ? null : { won: o.winner === mySeat };
    case 'forfeit': return { won: o.by !== me };
    case 'unfinished':
    case 'disagree':
      return null;
  }
}
