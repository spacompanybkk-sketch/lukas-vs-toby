import { seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { bossFallen } from './boss';
import { damageBase } from './damage';
import { hasClock } from './script';
import { TICKS_PER_SECOND } from './types';
import type { Faction, SimEvent, SimState } from './types';

/**
 * Step stage 7, after deaths: sudden death, then the winner. Does nothing once a winner is set
 * (and `Match.step` does not even get here then), so a match ends exactly once.
 *
 * Sudden death is a function of the tick: it is active on every step where `config.suddenDeath`
 * is true and `tick >= startTick` (`startTick = seconds(startSeconds)`). On each such step both
 * bases lose `balance.baseHp × (baseRate + growthPerSecond × secondsSinceStart) / 30`, where
 * `secondsSinceStart = (tick − startTick) / 30`, the same absolute amount for both (plants' base
 * first, `lane: null`), so the healthier base outlasts the other. The `suddenDeath` event is
 * emitted once, on the first step where it is active and the state flag was still false; that
 * step sets the flag. In a match counting up from tick 0 that first step is tick `startTick`.
 *
 * Sudden death is off, whatever `config.suddenDeath` says, in the modes played against a clock
 * (survive, breakthrough, conveyor; see `hasClock`).
 *
 * Winner: a base at or below 0 has fallen and its side loses; both fallen on the same tick is a
 * `'draw'`. `matchEnded` is emitted on the step the winner is decided, as that step's last event.
 * Then the clock: with `goalTicks` set and no base fallen, the step that completes tick number
 * `goalTicks` (the step run at `tick = goalTicks − 1`, after which the tick count reads `goalTicks`)
 * ends the match with the plants winning: they held out (survive, conveyor) or the zombies ran out
 * of time (breakthrough). `goalReached` then `matchEnded`. A match with a clock therefore lasts at
 * most `goalTicks` steps.
 *
 * The boss first: in a boss level the boss being down ends the match at once with its foes winning
 * (`bossDefeated`, then `matchEnded`; see `bossFallen`), even if a base falls on the same step (the
 * player who beat the boss wins, whatever else happened that step); then the bases.
 */
export function tickEndgame(s: SimState, b: Balance, events: SimEvent[]): void {
  if (s.winner !== null) return;
  tickSuddenDeath(s, b, events);
  decideBoss(s, events);
  if (s.winner === null) decideWinner(s, events);
  if (s.winner === null) tickGoal(s, events);
}

function tickGoal(s: SimState, events: SimEvent[]): void {
  const goal = s.config.goalTicks;
  if (goal === null || !hasClock(s.config.mode) || s.tick + 1 < goal) return;
  s.winner = 'plants';
  events.push({ type: 'goalReached', winner: 'plants' }, { type: 'matchEnded', winner: 'plants' });
}

function tickSuddenDeath(s: SimState, b: Balance, events: SimEvent[]): void {
  const rule = b.suddenDeath;
  const startTick = seconds(rule.startSeconds);
  if (!s.config.suddenDeath || hasClock(s.config.mode) || s.tick < startTick) return;
  if (!s.suddenDeath) {
    s.suddenDeath = true;
    events.push({ type: 'suddenDeath' });
  }
  const secondsSinceStart = (s.tick - startTick) / TICKS_PER_SECOND;
  const amount = b.baseHp * (rule.baseRate + rule.growthPerSecond * secondsSinceStart) / TICKS_PER_SECOND;
  damageBase(s, b, 'plants', amount, null, events);
  damageBase(s, b, 'zombies', amount, null, events);
}

function decideBoss(s: SimState, events: SimEvent[]): void {
  const winner = bossFallen(s, events);
  if (winner === null) return;
  s.winner = winner;
  events.push({ type: 'matchEnded', winner });
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
