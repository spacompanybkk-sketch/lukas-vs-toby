import { BALANCE } from '../../data/balance';
import { ALL_CARDS, factionOf } from '../../data/units';
import type { Faction, UnitKey } from '../../sim/types';

/** Every unit in the Almanac, by side: the ten cards each, and the zombies' raised Bone Minion. */
export const ALMANAC_UNITS: Readonly<Record<Faction, readonly UnitKey[]>> = Object.freeze({
  plants: Object.freeze([...ALL_CARDS.plants]),
  zombies: Object.freeze([...ALL_CARDS.zombies, 'boneMinion' as UnitKey]),
});

/** A unit's raw numbers at level 1, read from the balance table now (it is still being tuned). */
export interface RawStats { hp: number; dps: number; speed: number }

export function rawStats(key: UnitKey): RawStats {
  const u = BALANCE.units[key];
  if (u === undefined) return { hp: 0, dps: 0, speed: 0 };
  // A bite or a shot, whichever hurts more each second; abilities are shown by their role icon.
  const bite = u.melee ? u.melee.damage / u.melee.interval : 0;
  const shot = u.shot ? u.shot.damage / u.shot.interval : 0;
  return { hp: u.hp, dps: Math.max(bite, shot), speed: u.speed };
}

/**
 * The three bars, each a share (0..1] of the biggest on the unit's own side. `dps` is null for a
 * unit with no bite or shot (its role icon stands there instead); `speed` is null for a plant
 * (it has roots).
 */
export interface StatBars { hp: number; dps: number | null; speed: number | null }

export function statBars(key: UnitKey): StatBars {
  const side = factionOf(key);
  const all = ALMANAC_UNITS[side].map(rawStats);
  const max = (pick: (s: RawStats) => number): number => Math.max(...all.map(pick));
  const s = rawStats(key);
  const share = (v: number, m: number): number => (m > 0 ? v / m : 0);
  return {
    hp: share(s.hp, max((x) => x.hp)),
    dps: s.dps > 0 ? share(s.dps, max((x) => x.dps)) : null,
    speed: side === 'plants' ? null : share(s.speed, max((x) => x.speed)),
  };
}
