import { seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { damageBase } from './combat';
import { TICKS_PER_SECOND } from './types';
import type { Faction, SimEvent, SimState } from './types';

/**
 * Step stage 7, after deaths: sudden death, then the winner. Does nothing once a winner is set
 * (and `Match.step` does not even get here then), so a match ends exactly once.
 *
 * Sudden death, only when `config.suddenDeath`: on the tick equal to `seconds(startSeconds)` the
 * flag is set and `suddenDeath` emitted, and from that same step on both bases lose
 * `balance.baseHp × (baseRate + growthPerSecond × secondsSinceStart) / 30` every tick, where
 * `secondsSinceStart = (tick − startTick) / 30` (0 on the first step). Both lose the same absolute
 * amount (plants' base first, `lane: null`), so the healthier base outlasts the other.
 *
 * Winner: a base at or below 0 has fallen and its side loses; both fallen on the same tick is a
 * `'draw'`. `matchEnded` is emitted on the step the winner is decided, as that step's last event.
 */
export function tickEndgame(s: SimState, b: Balance, events: SimEvent[]): void {
  if (s.winner !== null) return;
  tickSuddenDeath(s, b, events);
  decideWinner(s, events);
}

function tickSuddenDeath(s: SimState, b: Balance, events: SimEvent[]): void {
  const rule = b.suddenDeath;
  const startTick = seconds(rule.startSeconds);
  // `>=`, not `===`: the same tick in any match that counts up from 0, and a state that was set
  // up past the start (a scenario or a test) still gets its sudden death instead of none.
  if (s.config.suddenDeath && !s.suddenDeath && s.tick >= startTick) {
    s.suddenDeath = true;
    events.push({ type: 'suddenDeath' });
  }
  if (!s.suddenDeath) return;
  const secondsSinceStart = (s.tick - startTick) / TICKS_PER_SECOND;
  const amount = b.baseHp * (rule.baseRate + rule.growthPerSecond * secondsSinceStart) / TICKS_PER_SECOND;
  damageBase(s, 'plants', amount, null, events);
  damageBase(s, 'zombies', amount, null, events);
}

function decideWinner(s: SimState, events: SimEvent[]): void {
  const plantsFell = hasFallen(s.baseHp.plants);
  const zombiesFell = hasFallen(s.baseHp.zombies);
  if (!plantsFell && !zombiesFell) return;
  const winner: Faction | 'draw' = plantsFell && zombiesFell ? 'draw' : plantsFell ? 'zombies' : 'plants';
  s.winner = winner;
  events.push({ type: 'matchEnded', winner });
}

/**
 * A base at or below 0 has fallen. So has one whose health is not a number, as `isStanding`
 * treats a unit: a broken number ends the match rather than letting it run for ever.
 */
function hasFallen(hp: number): boolean {
  return !(hp > 0);
}
