/**
 * Hero powers (spec 6.7): Lukas's Mega Mower and Toby's Bone Storm. Each side's `heroTimer` starts
 * at `seconds(firstChargeSeconds)` and counts down in `tickEconomy` (which says `heroReady` on the
 * step it reaches 0); aimed at a lane, the power hits every standing enemy unit there by a fixed
 * amount and the timer starts again from `seconds(chargeSeconds)`.
 */

import { seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { capHit, damageUnit } from './damage';
import { inLane, isStanding } from './lookup';
import { LANES } from './types';
import type { Command, CommandRejection, SimEvent, SimState } from './types';

export type HeroCommand = Extract<Command, { type: 'hero' }>;

/** `hero-off` (the setup has no hero for that side), `bad-lane`, `hero-charging`. */
export function checkHero(s: SimState, cmd: HeroCommand): CommandRejection | null {
  if (!s.config.heroes[cmd.faction]) return 'hero-off';
  if (!(Number.isInteger(cmd.lane) && cmd.lane >= 0 && cmd.lane < LANES)) return 'bad-lane';
  if (s.players[cmd.faction].heroTimer > 0) return 'hero-charging';
  return null;
}

/**
 * Carries out a hero command that `checkHero` has passed: `heroUsed`, then every standing enemy
 * unit in the lane, in ascending id, takes the side's `hero.damage` through `damageUnit` with armor
 * ignored (a shield only stops shots, so it never stops this); a boss at most its `hitCap` share
 * of its max (`capHit`), and a wide one once, whichever of its lanes is aimed at. It touches no base, projectile or
 * hazard. A unit it brings to 0 is removed by `resolveDeaths` (cause `'damage'`, bounty paid).
 */
export function useHero(s: SimState, b: Balance, cmd: HeroCommand, events: SimEvent[]): void {
  const power = b.hero[cmd.faction];
  s.players[cmd.faction].heroTimer = seconds(power.chargeSeconds);
  events.push({ type: 'heroUsed', faction: cmd.faction, lane: cmd.lane });
  for (const u of s.units) {
    if (u.faction === cmd.faction || !inLane(u, cmd.lane) || !isStanding(u)) continue;
    damageUnit(s, b, u, capHit(b, u, power.damage), events, true);
  }
}
