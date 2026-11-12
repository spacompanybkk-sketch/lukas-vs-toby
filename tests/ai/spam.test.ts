import { describe, expect, it } from 'vitest';
import { mergeSpamMatchup, playSeries, spamMatchup, winShare } from '../../src/ai/balanceChecks';
import { PHASE1_CARDS } from '../../src/data/units';
import type { Faction } from '../../src/sim/types';
import { phase1RulesKnobs } from './phase1Rules';

// Spec 10: no single-unit spam beats the balanced (Medium) computer more than 55% of the time.
// The fix list adds merge-spam (every copy of one card merged into one unit). 100 seeds each, both
// sides, the matchups `npm run sim:smoke` prints.

const SEEDS = 100;
const LIMIT = 0.55;
const BULK_MS = 120_000;
const KNOBS = phase1RulesKnobs(); // TODO(phase 2 Task 8): re-measure with paysBounty false and the Sunflower pause

describe.each(['zombies', 'plants'] as Faction[])('one-card spam as %s against the Medium computer', (side) => {
  it.each(PHASE1_CARDS[side])(`%s: spam and merge-spam each win at most ${LIMIT * 100}% of ${SEEDS}`, (unit) => {
    for (const matchup of [spamMatchup(side, unit), mergeSpamMatchup(side, unit)]) {
      const stats = playSeries(matchup, SEEDS, KNOBS);
      expect(winShare(stats, side), matchup.title).toBeLessThanOrEqual(LIMIT);
    }
  }, BULK_MS);
});
