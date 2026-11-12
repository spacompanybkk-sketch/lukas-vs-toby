import { SHIPPED } from '../../src/ai/balanceChecks';
import type { Knobs } from '../../src/ai/balanceChecks';
import { BALANCE, cloneBalance } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';

/**
 * The shipped table with the phase-2 owner rules that the computer-player bands were not measured
 * for switched back to their phase-1 behaviour, so the bands below keep testing the computer
 * players rather than the new rules. Every call returns a fresh, unfrozen copy.
 */
export function phase1RulesBalance(): Balance {
  const b = cloneBalance(BALANCE);
  b.baseDefense.paysBounty = true; // TODO(phase 2 Task 8): re-measure with paysBounty false
  return b;
}

/** `SHIPPED` with `phase1RulesBalance()`. */
export function phase1RulesKnobs(): Knobs {
  return { ...SHIPPED, balance: phase1RulesBalance() };
}
