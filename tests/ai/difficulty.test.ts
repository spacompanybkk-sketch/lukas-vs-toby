import { describe, expect, it } from 'vitest';
import { humanMatchup, playSeries, winShare } from '../../src/ai/balanceChecks';
import type { HumanStandIn } from '../../src/ai/balanceChecks';
import type { Skill } from '../../src/ai/bot';
import type { Faction } from '../../src/sim/types';

// The difficulty buttons, measured with two stand-in humans on each side, each on its difficulty's
// own setup (src/ai/difficulty.ts), 100 seeds:
// - the random child (a random affordable card into a random lane every 2 s as zombies, every 3 s
//   as plants): Easy > Medium > Hard, with Easy 55-85%, Medium 15-45%, Hard under 15%;
// - the attentive player (plays like the Medium computer): Easy 85-95%, Medium 40-60%, Hard 15-35%.

const SEEDS = 100;
const BULK_MS = 120_000;
const SKILLS: readonly Skill[] = ['easy', 'medium', 'hard'];

const BANDS: Record<HumanStandIn, Record<Skill, readonly [number, number]>> = {
  child: { easy: [0.55, 0.85], medium: [0.15, 0.45], hard: [0, 0.15] },
  attentive: { easy: [0.85, 0.95], medium: [0.4, 0.6], hard: [0.15, 0.35] },
};

function rates(standIn: HumanStandIn, human: Faction): Record<Skill, number> {
  const out = {} as Record<Skill, number>;
  for (const skill of SKILLS) out[skill] = winShare(playSeries(humanMatchup(standIn, human, skill), SEEDS), human);
  return out;
}

describe.each(['zombies', 'plants'] as Faction[])('difficulty for a human playing %s', (human) => {
  it('the random child wins most on Easy and least on Hard, inside each band', () => {
    const r = rates('child', human);
    expect(r.easy, 'Easy above Medium').toBeGreaterThan(r.medium);
    expect(r.medium, 'Medium above Hard').toBeGreaterThan(r.hard);
    for (const skill of SKILLS) {
      const [min, max] = BANDS.child[skill];
      expect(r[skill], `child on ${skill}`).toBeGreaterThanOrEqual(min);
      expect(r[skill], `child on ${skill}`).toBeLessThanOrEqual(max);
    }
  }, BULK_MS);

  it('the attentive player wins about 90% on Easy, half on Medium and a quarter on Hard', () => {
    const r = rates('attentive', human);
    expect(r.easy).toBeGreaterThan(r.medium);
    expect(r.medium).toBeGreaterThan(r.hard);
    for (const skill of SKILLS) {
      const [min, max] = BANDS.attentive[skill];
      expect(r[skill], `attentive on ${skill}`).toBeGreaterThanOrEqual(min);
      expect(r[skill], `attentive on ${skill}`).toBeLessThanOrEqual(max);
    }
  }, BULK_MS);
});
