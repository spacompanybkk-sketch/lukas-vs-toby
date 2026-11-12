import { describe, expect, it } from 'vitest';
import { botMatchup, percentile, playSeries, winShare } from '../../src/ai/balanceChecks';
import type { Faction } from '../../src/sim/types';
import { phase1RulesKnobs } from './phase1Rules';

// The computer-against-computer targets (fix list A.4), the matchups `npm run sim:smoke` prints:
// Medium v Medium each side 40-60% over 200 seeds, median length 3-6 minutes, under 25% of
// matches decided only in sudden death; Hard beats Easy at least 80% on each side (200 seeds);
// robust to start energy ×0.75 and ×1.25 (each side 25-75%, 100 seeds).

const BULK_MS = 120_000;
const MINUTE = 1800; // ticks
const KNOBS = phase1RulesKnobs(); // TODO(phase 2 Task 8): re-measure with paysBounty false and the Sunflower pause

describe('computer against computer', () => {
  it('Medium v Medium: each side wins 40-60% of 200, median 3-6 minutes, under 25% into sudden death', () => {
    const s = playSeries(botMatchup({ plants: 'medium', zombies: 'medium' }), 200, KNOBS);
    expect(winShare(s, 'plants')).toBeGreaterThanOrEqual(0.4);
    expect(winShare(s, 'plants')).toBeLessThanOrEqual(0.6);
    expect(winShare(s, 'zombies')).toBeGreaterThanOrEqual(0.4);
    expect(s.wins.draw).toBe(0);
    const median = percentile(s.lengths, 0.5) / MINUTE;
    expect(median).toBeGreaterThanOrEqual(3);
    expect(median).toBeLessThanOrEqual(6);
    expect(s.suddenDeath / s.results.length).toBeLessThan(0.25);
  }, BULK_MS);

  it.each(['plants', 'zombies'] as Faction[])('Hard beats Easy in at least 80% of 200 as %s', (hard) => {
    const skills = hard === 'plants' ? { plants: 'hard', zombies: 'easy' } as const : { plants: 'easy', zombies: 'hard' } as const;
    expect(winShare(playSeries(botMatchup(skills), 200, KNOBS), hard)).toBeGreaterThanOrEqual(0.8);
  }, BULK_MS);

  it.each([0.75, 1.25])('with start energy ×%s, Medium v Medium stays 25-75% each side', (factor) => {
    const s = playSeries(botMatchup({ plants: 'medium', zombies: 'medium' }, factor), 100, KNOBS);
    expect(winShare(s, 'plants')).toBeGreaterThanOrEqual(0.25);
    expect(winShare(s, 'plants')).toBeLessThanOrEqual(0.75);
  }, BULK_MS);
});
