import { seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { levelScale } from './lookup';
import { TICKS_PER_SECOND } from './types';
import type { Faction, SimEvent, SimState, Unit, UnitKey } from './types';

/** Income is counted in 1/30000 of an energy per tick; this much carry buys one whole energy. */
const CARRY_PER_ENERGY = TICKS_PER_SECOND * 1000;

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];

/**
 * One tick of the economy, in this order:
 * (a) every timer counts down (the only place any timer does);
 * (b) trickle income is added to each side's carry and paid out in whole energy;
 * (c) every ready Sunflower pays.
 */
export function tickEconomy(s: SimState, b: Balance, events: SimEvent[]): void {
  countDownTimers(s);
  payTrickle(s, b);
  paySunflowers(s, b, events);
}

function countDownTimers(s: SimState): void {
  for (const u of s.units) {
    u.meleeTimer = Math.max(0, u.meleeTimer - 1);
    u.shotTimer = Math.max(0, u.shotTimer - 1);
    u.abilityTimer = Math.max(0, u.abilityTimer - 1);
  }
  for (const faction of FACTIONS) {
    const recharge = s.players[faction].recharge;
    for (const key of Object.keys(recharge) as UnitKey[]) {
      recharge[key] = Math.max(0, (recharge[key] ?? 0) - 1);
    }
  }
}

function payTrickle(s: SimState, b: Balance): void {
  for (const faction of FACTIONS) {
    const player = s.players[faction];
    player.carry += Math.round(b.trickle[faction] * s.config.incomeMultiplier[faction] * 1000);
    while (player.carry >= CARRY_PER_ENERGY) {
      player.energy += 1;
      player.carry -= CARRY_PER_ENERGY;
    }
  }
}

function paySunflowers(s: SimState, b: Balance, events: SimEvent[]): void {
  for (const u of s.units) {
    const sun = b.units[u.key]?.sun;
    if (!sun || u.abilityTimer > 0) continue;
    const amount = Math.round(sun.amount * levelScale(b, u.level)); // keeps energy whole if a tuned table is fractional
    s.players[u.faction].energy += amount;
    u.abilityTimer = seconds(sun.interval);
    events.push({
      type: 'energyGained', faction: u.faction, amount, source: 'sunflower',
      unitId: u.id, lane: u.lane, x: u.x,
    });
  }
}

/** The side that did not lose `victim` gains a share of what the victim cost, rounded down. */
export function payBounty(s: SimState, b: Balance, victim: Unit, events: SimEvent[]): void {
  const faction: Faction = victim.faction === 'plants' ? 'zombies' : 'plants';
  const amount = Math.floor(b.bountyShare[faction] * victim.spent);
  if (amount <= 0) return;
  s.players[faction].energy += amount;
  events.push({
    type: 'energyGained', faction, amount, source: 'bounty',
    unitId: null, lane: victim.lane, x: victim.x,
  });
}
