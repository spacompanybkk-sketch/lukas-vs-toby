import { seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { energyOff } from './endless';
import { levelScale } from './lookup';
import { canAct } from './status';
import { TICKS_PER_SECOND } from './types';
import type { CardKey, Faction, SimEvent, SimState, Unit } from './types';

/** Income is counted in 1/30000 of an energy per tick; this much carry buys one whole energy. */
const CARRY_PER_ENERGY = TICKS_PER_SECOND * 1000;

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];

/**
 * One tick of the economy, in this order:
 * (a) every timer counts down, never below 0 (the only place any of these do; statuses count down
 *     in `tickStatuses`): each unit's attack, ability and aura timers, unless the unit cannot act (see
 *     `canAct`), each card's recharge, the plant base's defence timer in each lane, and each side's
 *     hero timer while the setup has that hero on (`heroReady` on the step it reaches 0), and each
 *     dealt spell's timer (`spellReady` on the step it reaches 0). A hasted unit's bite and shot
 *     timers count down `frenzy.factor` times as fast: the share above 1 is carried in whole
 *     thousandths of a tick (`hasteCarry`) and each whole tick of it takes one more off both;
 * (a2) every unit with `expires` counts it down, whether it can act or not, and leaves the lawn
 *     on reaching 0 (`unitDied`, cause `'spent'`, no bounty);
 * (a3) a Sun maker that is `hurt` keeps its Sun timer still (see (c)); `hurt` itself counts down
 *     at the end of the stage, stunned or not, so a unit hurt during tick T makes no Sun on ticks
 *     T+1 .. T+n and carries on from where it stopped on T+n+1;
 * (b) trickle income is added to each side's carry and paid out in whole energy;
 * (c) every ready Sunflower that can act and is not hurt pays.
 * With the level's `noEnergy` neither (b) nor (c) pays anything (a Sun maker's timer stays at 0),
 * and `payBounty` pays nothing: energy stays where it started, at 0. In Free Play the same holds
 * for the waves' side alone (see `energyOff`).
 */
export function tickEconomy(s: SimState, b: Balance, events: SimEvent[]): void {
  countDownTimers(s, b);
  chargeHeroes(s, events);
  chargeSpells(s, events);
  expireUnits(s, events);
  payTrickle(s, b);
  paySunflowers(s, b, events);
  for (const u of s.units) if (u.hurt > 0) u.hurt -= 1;
}

/** A whole tick of hasted countdown, in `hasteCarry` units. */
const HASTE_CARRY_PER_TICK = 1000;

function countDownTimers(s: SimState, b: Balance): void {
  const hasteExtra = Math.round(((b.spells.frenzy.factor ?? 1) - 1) * HASTE_CARRY_PER_TICK);
  for (const u of s.units) {
    if (!canAct(u)) continue;
    u.meleeTimer = Math.max(0, u.meleeTimer - 1);
    u.shotTimer = Math.max(0, u.shotTimer - 1);
    if (!(u.hurt > 0 && b.units[u.key]?.sun)) u.abilityTimer = Math.max(0, u.abilityTimer - 1); // a hurt Sun maker's timer waits
    u.auraTimer = Math.max(0, u.auraTimer - 1);
    if (u.haste <= 0) {
      u.hasteCarry = 0;
      continue;
    }
    u.hasteCarry += hasteExtra;
    while (u.hasteCarry >= HASTE_CARRY_PER_TICK) {
      u.hasteCarry -= HASTE_CARRY_PER_TICK;
      u.meleeTimer = Math.max(0, u.meleeTimer - 1);
      u.shotTimer = Math.max(0, u.shotTimer - 1);
    }
  }
  for (const faction of FACTIONS) {
    const recharge = s.players[faction].recharge;
    for (const key of Object.keys(recharge) as CardKey[]) {
      recharge[key] = Math.max(0, (recharge[key] ?? 0) - 1);
    }
  }
  const baseDefense = s.baseDefenseTimers;
  for (let lane = 0; lane < baseDefense.length; lane++) {
    baseDefense[lane] = Math.max(0, (baseDefense[lane] ?? 0) - 1);
  }
}

function chargeHeroes(s: SimState, events: SimEvent[]): void {
  for (const faction of FACTIONS) {
    const player = s.players[faction];
    if (!s.config.heroes[faction] || player.heroTimer <= 0) continue;
    player.heroTimer -= 1;
    if (player.heroTimer === 0) events.push({ type: 'heroReady', faction });
  }
}

function chargeSpells(s: SimState, events: SimEvent[]): void {
  for (const faction of FACTIONS) {
    for (const slot of s.players[faction].spells) {
      if (slot.timer <= 0) continue;
      slot.timer -= 1;
      if (slot.timer === 0) events.push({ type: 'spellReady', faction, spell: slot.key });
    }
  }
}

function expireUnits(s: SimState, events: SimEvent[]): void {
  if (!s.units.some((u) => u.expires > 0)) return;
  const kept: Unit[] = [];
  for (const u of s.units) {
    if (u.expires > 0) {
      u.expires -= 1;
      if (u.expires === 0) {
        events.push({
          type: 'unitDied', unitId: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level, cause: 'spent',
        });
        continue;
      }
    }
    kept.push(u);
  }
  s.units = kept;
}

function payTrickle(s: SimState, b: Balance): void {
  for (const faction of FACTIONS) {
    if (energyOff(s.config, faction)) continue;
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
    if (!sun || energyOff(s.config, u.faction) || u.abilityTimer > 0 || !canAct(u) || u.hurt > 0) continue;
    const amount = Math.round(sun.amount * levelScale(b, u.faction, u.level, 'special')); // keeps energy whole if a tuned table is fractional
    s.players[u.faction].energy += amount;
    u.abilityTimer = seconds(sun.interval);
    events.push({
      type: 'energyGained', faction: u.faction, amount, source: 'sunflower',
      unitId: u.id, lane: u.lane, x: u.x,
    });
  }
}

/** The side that did not lose `victim` gains a share of what the victim cost, rounded down; nothing with `noEnergy`. */
export function payBounty(s: SimState, b: Balance, victim: Unit, events: SimEvent[]): void {
  const faction: Faction = victim.faction === 'plants' ? 'zombies' : 'plants';
  if (energyOff(s.config, faction)) return;
  const amount = Math.floor(b.bountyShare[faction] * victim.spent);
  if (amount <= 0) return;
  s.players[faction].energy += amount;
  events.push({
    type: 'energyGained', faction, amount, source: 'bounty',
    unitId: null, lane: victim.lane, x: victim.x,
  });
}
