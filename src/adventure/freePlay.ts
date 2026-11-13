import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { ALL_CARDS, isCard } from '../data/units';
import { touch } from '../progress/save';
import type { Save } from '../progress/save';
import { defaultConfig } from '../sim/match';
import type { CardKey, Faction, LevelMode, MatchConfig } from '../sim/types';
import { unlockedCards } from './campaign';
import { LEVELS } from './levels';
import { ADVENTURE } from './rewards';
import type { LevelDef } from './types';

/**
 * Free Play (plan Task 7): endless waves (the plants survive) or endless gardens (the zombies break
 * through), made by the simulation's endless source (`MatchConfig.endless`). This is the adventure
 * side of it: the setup from a player's save, the score, and the reward.
 */
export const FREE_PLAY = Object.freeze({
  /** Coins for each wave cleared (survive) or garden broken (breakthrough). */
  coinsPerWave: 5,
  /** The first zombie wave of a survive run comes this long after the start. */
  firstWaveSeconds: 10,
});

/** The result of one Free Play run, kept on the device until it is in the save (`levelSession`). */
export interface FreePlayRecord { kind: 'free'; battleId: string; side: Faction; wave: number; cleared: number }

const other = (side: Faction): Faction => (side === 'plants' ? 'zombies' : 'plants');

/** The mode a side plays Free Play in. */
export const freePlayMode = (side: Faction): 'survive' | 'breakthrough' => (side === 'plants' ? 'survive' : 'breakthrough');

/** The waves or gardens cleared at a score of `wave` (`SimState.wave`). */
export function wavesCleared(mode: LevelMode, wave: number): number {
  return mode === 'breakthrough' ? Math.max(0, wave) : Math.max(0, wave - 1);
}

/**
 * The other side's cards the waves are made of: its first three, those the player has unlocked
 * playing that side's Adventure, and those the player has met (won a level against) on their own
 * side's Adventure. In the card order of spec 6.6.
 */
export function freePlayEnemyCards(save: Save, side: Faction, levels: readonly LevelDef[] = LEVELS): CardKey[] {
  const enemy = other(side);
  const met = new Set<CardKey>(unlockedCards(save, enemy));
  for (const def of levels) {
    if (def.side !== side || (save[side].stars[def.id] ?? 0) === 0) continue;
    const seen = [...(def.opponent?.cards ?? []), ...def.waves.map((w) => w.unit), ...def.prepared.map((p) => p.unit)];
    for (const k of seen) if (isCard(k) && ALL_CARDS[enemy].includes(k)) met.add(k);
  }
  return ALL_CARDS[enemy].filter((k) => met.has(k));
}

/**
 * The match of a Free Play run on `side` for the owner of `save`: the player's Adventure cards,
 * hero, two spells, Marketplace upgrades and difficulty income; the other side holds nothing (no
 * hand, hero, spells or upgrades: the waves are its whole play) and no computer plays it. Survive
 * has no clock and a zombie base that cannot fall; breakthrough's clock lives in the match state.
 */
export function freePlayConfig(save: Save, side: Faction, seed: number, levels: readonly LevelDef[] = LEVELS, balance: Balance = BALANCE): MatchConfig {
  const base = defaultConfig(seed >>> 0, balance);
  const enemy = other(side);
  const mode = freePlayMode(side);
  const upgrades: Partial<Record<CardKey, number>> = {};
  for (const key of ALL_CARDS[side]) {
    const level = save.upgrades[key];
    if (level !== undefined) upgrades[key] = level;
  }
  return {
    ...base,
    mode,
    goalTicks: null,
    suddenDeath: false,
    endless: { cards: freePlayEnemyCards(save, side, levels), firstWaveTicks: mode === 'survive' ? seconds(FREE_PLAY.firstWaveSeconds) : 0 },
    cards: { [side]: unlockedCards(save, side), [enemy]: [] } as unknown as Record<Faction, CardKey[]>,
    heroes: { [side]: true, [enemy]: false } as Record<Faction, boolean>,
    spells: { [side]: base.spells[side], [enemy]: 0 } as Record<Faction, number>,
    upgrades: { [side]: upgrades, [enemy]: {} } as Record<Faction, Partial<Record<CardKey, number>>>,
    incomeMultiplier: { [side]: ADVENTURE.income[save.difficulty[side]], [enemy]: 1 } as Record<Faction, number>,
    invulnerableBase: mode === 'survive' ? 'zombies' : null,
  };
}

/** Which best a run counts towards: survive's waves (`bestWave`) or breakthrough's gardens (`bestGarden`). */
export const bestKey = (side: Faction): 'bestWave' | 'bestGarden' => (side === 'plants' ? 'bestWave' : 'bestGarden');

/**
 * A run's result into `save`: `coinsPerWave` for each wave cleared, and its mode's best raised to
 * the score reached (`bestWave` for survive, `bestGarden` for breakthrough), once per battle id
 * (a battle id the save holds as `lastBattle` changes nothing). `best`: the score beat that best.
 */
export function applyFreePlayResult(save: Save, rec: FreePlayRecord, now: number): { save: Save; coins: number; best: boolean } {
  if (save.lastBattle === rec.battleId) return { save, coins: 0, best: false };
  const coins = Math.max(0, Math.floor(rec.cleared)) * FREE_PLAY.coinsPerWave;
  const key = bestKey(rec.side);
  const best = rec.wave > save[key];
  const next: Save = { ...save, coins: save.coins + coins, [key]: Math.max(save[key], rec.wave), lastBattle: rec.battleId };
  return { save: touch(next, now), coins, best };
}
