import { BALANCE } from '../../data/balance';
import { ALL_CARDS, factionOf, isCard } from '../../data/units';
import { MAX_LEVEL, MAX_UPGRADE } from '../../sim/types';
import type { Faction, UnitKey } from '../../sim/types';

/** Every unit in the Almanac, by side: the ten cards each, and the zombies' raised Bone Minion. */
export const ALMANAC_UNITS: Readonly<Record<Faction, readonly UnitKey[]>> = Object.freeze({
  plants: Object.freeze([...ALL_CARDS.plants]),
  zombies: Object.freeze([...ALL_CARDS.zombies, 'boneMinion' as UnitKey]),
});

/**
 * A unit's raw numbers at `level` with Marketplace `upgrade`, read from the balance table now (it
 * is still being tuned): health and the bite or shot times the side's level curve and the upgrade
 * step, as the simulation scales them. Speed changes with neither. A unit that is no card (the
 * Bone Minion) takes no upgrade.
 */
export interface RawStats { hp: number; dps: number; speed: number }

export function rawStats(key: UnitKey, level = 1, upgrade = 0): RawStats {
  const u = BALANCE.units[key];
  if (u === undefined) return { hp: 0, dps: 0, speed: 0 };
  const side = factionOf(key);
  const lv = Math.min(Math.max(1, Math.floor(level)), MAX_LEVEL);
  const up = isCard(key) ? Math.min(Math.max(0, upgrade), MAX_UPGRADE) : 0;
  const step = BALANCE.upgradeStep[side];
  const hpScale = (BALANCE.levelCurves.hp[side][lv] ?? 1) * (1 + step.hp * up);
  const dmgScale = (BALANCE.levelCurves.damage[side][lv] ?? 1) * (1 + step.damage * up);
  // A bite or a shot, whichever hurts more each second; abilities are shown by their role icon.
  const bite = u.melee ? u.melee.damage / u.melee.interval : 0;
  const shot = u.shot ? u.shot.damage / u.shot.interval : 0;
  return { hp: u.hp * hpScale, dps: Math.max(bite, shot) * dmgScale, speed: u.speed };
}

/**
 * The three bars, each a share (0..1] of the biggest on the unit's own side at the top level and
 * full upgrade. Health and damage use the square root of that share, so a level-1 unit still has
 * a bar a child can see and every level and upgrade step visibly adds to it; the order between
 * units is kept. `hpPlain` / `dpsPlain`: the same without the upgrade (the rest is drawn in gold).
 * `dps` is null for a unit with no bite or shot (its role icon stands there instead); `speed` is
 * null for a plant (it has roots), and a plain share of the fastest on its side.
 */
export interface StatBars {
  hp: number; dps: number | null; speed: number | null;
  hpPlain: number; dpsPlain: number | null;
}

/** The biggest health and damage on a side, at the top level and full upgrade. */
function sideTop(side: Faction): RawStats {
  const all = ALMANAC_UNITS[side].map((k) => rawStats(k, MAX_LEVEL, MAX_UPGRADE));
  return {
    hp: Math.max(...all.map((x) => x.hp)),
    dps: Math.max(...all.map((x) => x.dps)),
    speed: Math.max(...ALMANAC_UNITS[side].map((k) => rawStats(k).speed)),
  };
}

export function statBars(key: UnitKey, level = 1, upgrade = 0): StatBars {
  const side = factionOf(key);
  const top = sideTop(side);
  const s = rawStats(key, level, upgrade);
  const plain = rawStats(key, level, 0);
  const root = (v: number, m: number): number => (m > 0 ? Math.min(1, Math.sqrt(v / m)) : 0);
  return {
    hp: root(s.hp, top.hp),
    dps: s.dps > 0 ? root(s.dps, top.dps) : null,
    speed: side === 'plants' ? null : (top.speed > 0 ? s.speed / top.speed : 0),
    hpPlain: root(plain.hp, top.hp),
    dpsPlain: plain.dps > 0 ? root(plain.dps, top.dps) : null,
  };
}
