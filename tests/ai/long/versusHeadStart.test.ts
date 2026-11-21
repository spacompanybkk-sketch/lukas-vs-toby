import { afterAll, describe, expect, it } from 'vitest';
import { runMatch } from '../../../src/ai/runMatch';
import { createFortressPlants, createRandomChild, createSteadyZombies } from '../../../src/ai/standIns';
import { DEFAULT_HEAD_STEP, versusConfig } from '../../../src/ai/versus';
import type { HeadStep } from '../../../src/ai/versus';
import type { Faction } from '../../../src/sim/types';

/**
 * The head-start sweep (spec §3, two-device plan task 1). A random-tapping child stand-in (Toby,
 * `p02`) against the adult stand-in (Lukas, `p01`: steady zombies against a plant child, the
 * fortress plants against a zombie child), Versus rules, head start steps 0–5, seeds 1..200.
 * `DEFAULT_HEAD_STEP[side]` is the smallest step at which the child wins at least 40%, or 5 if
 * none does. Runs only with `LVT_BALANCE=1`.
 *
 * Measured (seeds 1..200, child win rate; draws count as not won), 2026-11-21 on 7cca25e:
 *
 *   step                   0      1      2      3      4      5
 *   child as plants     0.5%   0.0%   0.5%   0.0%   0.0%   0.0%
 *   child as zombies    7.5%  15.0%  28.0%  42.5%  58.5%  74.0%
 *
 * So zombies 3, and plants 5 because no step reaches 40%: the random plant child is not rescued
 * by any head start against the steady zombies (reported in task-1-report.md; the sim is not changed).
 */

const SEEDS = 200;
const TARGET = 0.4;
const STEPS: readonly HeadStep[] = [0, 1, 2, 3, 4, 5];
const SIDES: readonly Faction[] = ['plants', 'zombies'];

/** The child's win share on `side` at `step` over seeds 1..SEEDS. */
function childWinRate(side: Faction, step: HeadStep): number {
  let wins = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const adult = side === 'plants' ? createSteadyZombies(seed) : createFortressPlants(seed);
    const seats = side === 'plants' ? { plants: 'p02', zombies: 'p01' } as const : { plants: 'p01', zombies: 'p02' } as const;
    const result = runMatch(versusConfig({ seed, seats, head: { slot: 'p02', step } }), [createRandomChild(side, seed), adult]);
    if (result.winner === side) wins++;
  }
  return wins / SEEDS;
}

describe('versus head start sweep (seeds 1..200)', () => {
  const rates = new Map<Faction, number[]>();
  const ratesOf = (side: Faction): number[] => {
    let r = rates.get(side);
    if (r === undefined) {
      r = STEPS.map((step) => childWinRate(side, step));
      rates.set(side, r);
    }
    return r;
  };

  const rowOf = (side: Faction): string =>
    `child as ${side.padEnd(7)} ${ratesOf(side).map((v) => `${(v * 100).toFixed(1)}%`.padStart(7)).join('')}`;

  afterAll(() => {
    if (rates.size === 0) return;
    // Straight to stdout: Vitest drops the console of a test that holds the worker this long.
    process.stdout.write(`${['step             ' + STEPS.map((s) => String(s).padStart(7)).join(''),
      ...SIDES.filter((s) => rates.has(s)).map(rowOf)].join('\n')}\n`);
  });

  for (const side of SIDES) {
    it(`DEFAULT_HEAD_STEP.${side} is the smallest step where a ${side} child wins ≥ 40%`, () => {
      const r = ratesOf(side);
      const row = rowOf(side);
      const reached = STEPS.find((s) => (r[s] ?? 0) >= TARGET);
      expect(DEFAULT_HEAD_STEP[side], `child as ${side}: ${row}`).toBe(reached ?? 5);
    }, 3_600_000);
  }
});
