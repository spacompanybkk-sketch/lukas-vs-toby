/**
 * Plays Adventure levels and Free Play with the level stand-ins (`levelStandIns.ts`) and reads
 * what the campaign checks need: who won, the stars, how long it took and how it ended (the clock,
 * a base, the boss). Shared by `tools/levels.ts` and the long tests (`tests/ai/long/levels-w*.test.ts`),
 * so both play exactly the same matches. Seeds are the match seed; the stand-in and the level's
 * computer are seeded from it as the app seeds them. Every level list defaults to `LEVELS`, all
 * the worlds there are.
 */

import { levelConfig, unlockedCards } from '../adventure/campaign';
import { FREE_PLAY, freePlayConfig as shippedFreePlayConfig } from '../adventure/freePlay';
import { LEVELS } from '../adventure/levels';
import { ADVENTURE, starsFor } from '../adventure/rewards';
import type { Stars } from '../adventure/rewards';
import type { LevelDef } from '../adventure/types';
import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { newSave } from '../progress/save';
import type { Save } from '../progress/save';
import { MAX_UPGRADE, upgradeCost } from '../progress/upgrades';
import { Match } from '../sim/match';
import type { CardKey, Command, Faction, MatchConfig } from '../sim/types';
import { createBasicBot } from './basicBot';
import type { Bot } from './bot';
import { opponentOf } from './difficulty';
import { FAVOURITES, STAND_IN_DIFFICULTY, createLevelStandIn } from './levelStandIns';
import { heroHidden } from '../adventure/levels';
import type { LevelStandIn } from './levelStandIns';
import { MAX_MATCH_TICKS } from './runMatch';

// ---- The campaign's curve (ruling 11) ----

/** Levels in a world (spec 10): a level's place in its side's campaign is `(world − 1) × 8 + n`. */
export const LEVELS_PER_WORLD = 8;
/** The campaign's last level. */
export const LAST_LEVEL = 5 * LEVELS_PER_WORLD;

/** `def`'s place in its side's campaign, 1..40: world 1 holds 1–8, w2-1 is 9, w5-8 is 40. */
export function campaignIndex(def: Pick<LevelDef, 'world' | 'n'>): number {
  return (def.world - 1) * LEVELS_PER_WORLD + def.n;
}

/** A win-rate band, %: the trend and the range a level must sit in. */
export interface WinBand { target: number; lo: number; hi: number }

/**
 * The average player's win band on campaign level `i` (1..40). World 1 (ruling A18): 90% or more,
 * the challenge there is the stars. From level 9 (ruling 11): `88 − 48·(i − 9)/31`, ±8, and a boss
 * may sit 5 below the trend.
 */
export function averageWinBand(i: number, boss: boolean): WinBand {
  if (!Number.isInteger(i) || i < 1 || i > LAST_LEVEL) throw new RangeError(`no campaign level ${i}`);
  if (i <= LEVELS_PER_WORLD) return { target: 100, lo: 90, hi: 100 };
  const target = 88 - (48 * (i - 9)) / 31;
  return { target, lo: target - 8 - (boss ? 5 : 0), hi: target + 8 };
}

/** The expert wins at least this share, %, of every level. */
export const EXPERT_WIN_MIN = 95;
/** The beginner on Easy wins at least 70% through world 2 (ruling 11); later he is not held to a band. */
export function beginnerWinMin(i: number): number | null {
  return i <= 2 * LEVELS_PER_WORLD ? 70 : null;
}

// ---- The average player's coins and Marketplace (recon 4, 8.11) ----

/**
 * The stars the average player takes on a level the first time: in the Backyard he three-stars
 * most levels (the measured mean is about 2.7); later, with the win curve falling towards 40%, a
 * level won after a few tries is reckoned at two.
 */
export const AVERAGE_STARS = { backyard: 2.7, later: 2 } as const;

/**
 * The coins the average player is reckoned to earn on campaign level `i` before he moves on: his
 * stars at `perNewStar` each, plus `loss` for every loss he takes first, `(1 − p)/p` of them at the
 * band's win rate `p` (none in the Backyard).
 */
export function averageCoinsOn(i: number): number {
  const p = averageWinBand(i, false).target / 100;
  const stars = i <= LEVELS_PER_WORLD ? AVERAGE_STARS.backyard : AVERAGE_STARS.later;
  return stars * ADVENTURE.perNewStar + (ADVENTURE.loss * (1 - p)) / p;
}

/** `side`'s levels before `def` in `levels`, in campaign order. */
function earlierLevels(def: LevelDef, levels: readonly LevelDef[]): LevelDef[] {
  return levels
    .filter((l) => l.side === def.side && (l.world < def.world || (l.world === def.world && l.n < def.n)))
    .sort((a, b) => a.world - b.world || a.n - b.n);
}

/** Coins the average player has earned before `def` (`averageCoinsOn` for every earlier level of its side). */
export function coinsBefore(def: LevelDef, levels: readonly LevelDef[] = LEVELS): number {
  return Math.floor(earlierLevels(def, levels).reduce((n, l) => n + averageCoinsOn(campaignIndex(l)), 0));
}

/** The average player upgrades his three first favourites and his newest unlocks: this many in all. */
export const FAVOURITE_COUNT = 5;

/** His favourites holding `unlocked` (in unlock order): his three, then the newest unlocks. */
export function favouritesAt(side: Faction, unlocked: readonly CardKey[]): CardKey[] {
  const base = FAVOURITES[side];
  const newest = unlocked.filter((k) => !base.includes(k)).slice(-(FAVOURITE_COUNT - base.length));
  return [...base, ...newest];
}

/**
 * The average player's Marketplace levels coming to `def`: after every earlier level he banks its
 * coins (`averageCoinsOn`), takes its unlock, and buys the cheapest next level among his current
 * favourites (ties to the earlier favourite) while the coins last, at the real prices
 * (`upgradeCost`: 100 × the level). Levels bought for a favourite he later drops stay bought.
 */
export function averageUpgrades(def: LevelDef, levels: readonly LevelDef[] = LEVELS): Partial<Record<CardKey, number>> {
  const ups: Partial<Record<CardKey, number>> = {};
  const unlocked: CardKey[] = [];
  let coins = 0;
  for (const l of earlierLevels(def, levels)) {
    coins += averageCoinsOn(campaignIndex(l));
    if (l.unlocks !== null) unlocked.push(l.unlocks);
    const favourites = favouritesAt(def.side, unlocked);
    for (;;) {
      let pick: CardKey | null = null;
      for (const k of favourites) if ((ups[k] ?? 0) < MAX_UPGRADE && (pick === null || (ups[k] ?? 0) < (ups[pick] ?? 0))) pick = k;
      if (pick === null) break;
      const cost = upgradeCost((ups[pick] ?? 0) + 1);
      if (coins < cost) break;
      coins -= cost;
      ups[pick] = (ups[pick] ?? 0) + 1;
    }
  }
  return ups;
}

/** How a level ended: its clock ran out, a base fell, the boss fell, or (a soft lock) nothing by the limit. */
export type LevelEnd = 'clock' | 'base' | 'boss' | 'none';

export interface LevelPlayed {
  won: boolean;
  stars: Stars;
  /** Steps played. */
  ticks: number;
  end: LevelEnd;
}

/**
 * The save a stand-in comes to `def` with: every unlock of the levels before it, the stand-in's
 * difficulty, and (the average player only) his Marketplace levels as his coins buy them
 * (`averageUpgrades`).
 */
export function standInSave(kind: LevelStandIn, def: LevelDef, levels: readonly LevelDef[] = LEVELS): Save {
  const side = def.side;
  const fresh = newSave(side === 'plants' ? 'p01' : 'p02', 'Kid', side === 'plants' ? 'peashooter' : 'brainEater', 0);
  const unlocked = earlierLevels(def, levels).filter((l) => l.unlocks !== null).map((l) => l.unlocks as CardKey);
  return {
    ...fresh,
    upgrades: kind === 'average' ? averageUpgrades(def, levels) : {},
    [side]: { ...fresh[side], unlocked },
    adventureDifficulty: { ...fresh.adventureDifficulty, [side]: STAND_IN_DIFFICULTY[kind] },
  };
}

/** The level's computer, seeded as the app seeds it (`BattleController`), or a player that does nothing. */
function levelOpponent(def: LevelDef, seed: number): Bot {
  const enemy = opponentOf(def.side);
  if (def.opponent === null) return { faction: enemy, think: () => [] };
  return createBasicBot(enemy, def.opponent.skill, (Math.imul(seed, 2654435761) + 1) >>> 0);
}

/** Plays `config` with these bots until it is decided or `maxTicks`; how it ended. */
function play(config: MatchConfig, bots: readonly Bot[], balance: Balance, maxTicks: number): { match: Match; end: LevelEnd } {
  const match = new Match(config, balance);
  const ordered = [...bots].sort((a, b) => (a.faction === 'plants' ? 0 : 1) - (b.faction === 'plants' ? 0 : 1));
  let end: LevelEnd = 'none';
  while (match.state.winner === null && match.state.tick < maxTicks) {
    const commands: Command[] = [];
    for (const bot of ordered) commands.push(...bot.think(match));
    const events = match.step(commands);
    if (match.state.winner !== null) {
      end = events.some((e) => e.type === 'bossDefeated') ? 'boss'
        : events.some((e) => e.type === 'goalReached') ? 'clock' : 'base';
    }
  }
  return { match, end };
}

/**
 * The stand-in of `kind` for `def`, with the hero only where the child has its button: the same
 * rule the HUD uses (`heroHidden`), so a level before the hero's lesson is measured without it.
 */
export function standInFor(def: LevelDef, kind: LevelStandIn, seed: number, levels: readonly LevelDef[] = LEVELS): Bot {
  return createLevelStandIn(kind, def.side, seed, { hero: !heroHidden(def, levels) });
}

/**
 * One level, one stand-in, one seed. `wrap` (probes only) changes the stand-in, e.g. to hide a
 * twist from him or to play another one in his seat.
 */
export function playLevel(
  def: LevelDef, kind: LevelStandIn, seed: number, balance: Balance = BALANCE, levels: readonly LevelDef[] = LEVELS,
  wrap: (bot: Bot, seed: number) => Bot = (bot) => bot,
): LevelPlayed {
  const config = levelConfig(def, standInSave(kind, def, levels), seed, balance);
  const maxTicks = config.goalTicks ?? MAX_MATCH_TICKS;
  const { match, end } = play(config, [wrap(standInFor(def, kind, seed, levels), seed), levelOpponent(def, seed)], balance, maxTicks + 1);
  const s = match.state;
  const side = def.side;
  const won = s.winner === side;
  const max = s.baseMaxHp[side];
  const goal = config.goalTicks;
  const stars = starsFor(def, {
    won,
    baseHpShare: max > 0 ? Math.max(0, s.baseHp[side]) / max : 0,
    clockShareLeft: goal === null ? 0 : Math.max(0, goal - s.tick) / goal,
  });
  return { won, stars, ticks: s.tick, end };
}

/** What a series of one level and one stand-in comes to. */
export interface LevelStats {
  seeds: number;
  /** Wins, %. */
  win: number;
  medianStars: number;
  /** Shares of seeds with 3 stars, %. */
  threeStars: number;
  /** Shares of seeds with 2 stars or more, %. */
  twoPlus: number;
  /** Median length, minutes. */
  minutes: number;
  /** Shares, %, of seeds that ended by the clock, a base, the boss, or not at all. */
  ends: Record<LevelEnd, number>;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
};

export function summariseLevel(results: readonly LevelPlayed[]): LevelStats {
  const n = results.length;
  const pct = (k: number): number => (n === 0 ? 0 : (100 * k) / n);
  const ends: Record<LevelEnd, number> = { clock: 0, base: 0, boss: 0, none: 0 };
  for (const r of results) ends[r.end] += 1;
  for (const k of Object.keys(ends) as LevelEnd[]) ends[k] = pct(ends[k]);
  return {
    seeds: n,
    win: pct(results.filter((r) => r.won).length),
    medianStars: median(results.map((r) => r.stars)),
    threeStars: pct(results.filter((r) => r.stars === 3).length),
    twoPlus: pct(results.filter((r) => r.stars >= 2).length),
    minutes: median(results.map((r) => r.ticks)) / 1800,
    ends,
  };
}

export function playLevelSeries(
  def: LevelDef, kind: LevelStandIn, first: number, seeds: number, balance: Balance = BALANCE, levels: readonly LevelDef[] = LEVELS,
): LevelPlayed[] {
  const out: LevelPlayed[] = [];
  for (let seed = first; seed < first + seeds; seed++) out.push(playLevel(def, kind, seed, balance, levels));
  return out;
}

// ---- Free Play ----

/**
 * A stand-in who has played every level of `levels` (both sides, three stars each): every unlock,
 * the stand-in's difficulty on both sides, and (the average player) the Marketplace levels his
 * coins bought on `side`'s campaign. The shipped Free Play reads its hand, waves and upgrades from
 * such a save, so the measured run grows with the unlocks as the shipped one does.
 */
export function graduateSave(kind: LevelStandIn, side: Faction, levels: readonly LevelDef[] = LEVELS): Save {
  const fresh = newSave('p01', 'Kid', 'peashooter', 0);
  const of = (f: Faction): Save['plants'] => {
    const mine = levels.filter((l) => l.side === f).sort((x, y) => x.world - y.world || x.n - y.n);
    return {
      stars: Object.fromEntries(mine.map((l) => [l.id, 3])),
      unlocked: mine.filter((l) => l.unlocks !== null).map((l) => l.unlocks as CardKey),
    };
  };
  // One step past the side's last level, so `averageUpgrades` counts every level as earlier.
  const last = levels.filter((l) => l.side === side).sort((x, y) => y.world - x.world || y.n - x.n)[0];
  const after: LevelDef | undefined = last === undefined ? undefined : { ...last, n: last.n + 1 };
  return {
    ...fresh,
    upgrades: kind === 'average' && after !== undefined ? averageUpgrades(after, levels) : {},
    plants: of('plants'),
    zombies: of('zombies'),
    adventureDifficulty: { plants: STAND_IN_DIFFICULTY[kind], zombies: STAND_IN_DIFFICULTY[kind] },
  };
}

/** The cards a graduate of `levels` holds, per side (the Backyard alone deals five). */
export function freePlayCards(levels: readonly LevelDef[] = LEVELS): Readonly<Record<Faction, readonly CardKey[]>> {
  const g = graduateSave('expert', 'plants', levels);
  return { plants: unlockedCards(g, 'plants'), zombies: unlockedCards(g, 'zombies') };
}

/** Free Play survive: the first wave comes this long after the start (ticks): time for a first plant. */
export const FREE_PLAY_FIRST_WAVE = seconds(FREE_PLAY.firstWaveSeconds);

/**
 * Free Play for a stand-in of `kind` on `side`, as the shipped screen builds it (`freePlayConfig`
 * of `adventure/freePlay.ts`) for a graduate of `levels` (`graduateSave`): survive (the plants hold
 * out against endless waves) or breakthrough (the zombies break garden after garden).
 */
export function freePlayConfigFor(
  kind: LevelStandIn, side: Faction, seed: number, balance: Balance = BALANCE, levels: readonly LevelDef[] = LEVELS,
): MatchConfig {
  return shippedFreePlayConfig(graduateSave(kind, side, levels), side, seed, levels, balance);
}

export interface FreePlayed {
  /** Survive: the wave reached (waves started); breakthrough: the gardens broken. */
  score: number;
  ticks: number;
}

/** Free Play is over at the latest after this long (ticks): 40 minutes. */
export const FREE_PLAY_MAX_TICKS = 72_000;

export function playFreePlay(
  side: Faction, kind: LevelStandIn, seed: number, balance: Balance = BALANCE, levels: readonly LevelDef[] = LEVELS,
): FreePlayed {
  const config = freePlayConfigFor(kind, side, seed, balance, levels);
  const bots: Bot[] = [createLevelStandIn(kind, side, seed), { faction: opponentOf(side), think: () => [] }];
  const { match } = play(config, bots, balance, FREE_PLAY_MAX_TICKS);
  return { score: match.state.wave, ticks: match.state.tick };
}

export interface FreePlayStats {
  seeds: number;
  medianScore: number;
  /** Share of seeds with a score of at least 1, %. */
  atLeastOne: number;
  /** Median length, minutes, and the share over 20 minutes, %. */
  minutes: number;
  over20: number;
}

export function summariseFreePlay(results: readonly FreePlayed[]): FreePlayStats {
  const n = results.length;
  return {
    seeds: n,
    medianScore: median(results.map((r) => r.score)),
    atLeastOne: n === 0 ? 0 : (100 * results.filter((r) => r.score >= 1).length) / n,
    minutes: median(results.map((r) => r.ticks)) / 1800,
    over20: n === 0 ? 0 : (100 * results.filter((r) => r.ticks > 36_000).length) / n,
  };
}
