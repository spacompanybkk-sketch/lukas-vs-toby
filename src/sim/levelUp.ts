import type { Balance } from '../data/balance';
import { priceOf } from '../data/units';
import { grownHealth } from './abilities';
import { levelScale, statsFor, upgradeScale } from './lookup';
import type { SimEvent, SimState, Unit } from './types';

/**
 * A merge's effect on its target, however it was paid for (a card from the hand, a belt card):
 * the target goes up one level. Its max health becomes `hp` times the balance table's `hp` level
 * curve times its Marketplace multiplier (`upgradeScale`) (times `grownHealth`, so a Hot Topic keeps
 * its stacks and what they give), rounded, and its health keeps its share of the max, rounded, at
 * least 1 and never above the max: both stay whole even when a tuned table has fractional level
 * multipliers. `spent` grows by the card's price (bounties pay a share of it). Position, timers and
 * everything else stay. Emits `unitMerged`.
 */
export function levelUp(s: SimState, b: Balance, target: Unit, events: SimEvent[]): void {
  const oldHp = target.hp;
  const oldMaxHp = target.maxHp;
  target.level += 1;
  const stats = statsFor(b, target.key);
  const maxHp = Math.round(
    stats.hp * levelScale(b, target.faction, target.level, 'hp')
    * upgradeScale(b, s.config, target, 'hp') * grownHealth(stats, target),
  );
  target.maxHp = maxHp;
  target.hp = Math.min(maxHp, Math.max(1, Math.round(maxHp * oldHp / oldMaxHp)));
  target.spent += priceOf(target.key);
  events.push({ type: 'unitMerged', unitId: target.id, level: target.level });
}
