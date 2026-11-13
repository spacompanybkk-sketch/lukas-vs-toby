/**
 * Plays Adventure levels and Free Play with the level stand-ins (`levelStandIns.ts`) and reads
 * what the campaign checks need: who won, the stars, how long it took and how it ended (the clock,
 * a base, the boss). Shared by `tools/levels.ts` and `tests/ai/long/levels.test.ts`, so both play
 * exactly the same matches. Seeds are the match seed; the stand-in and the level's computer are
 * seeded from it as the app seeds them.
 */

import { levelConfig } from '../adventure/campaign';
import { BACKYARD } from '../adventure/levels/backyard';
import { ADVENTURE, starsFor } from '../adventure/rewards';
import type { Stars } from '../adventure/rewards';
import type { LevelDef } from '../adventure/types';
import { BALANCE } from '../data/balance';
import type { Balance } from '../data/balance';
import { ALL_CARDS } from '../data/units';
import { newSave } from '../progress/save';
import type { Save } from '../progress/save';
import { Match, defaultConfig } from '../sim/match';
import type { CardKey, Command, Faction, MatchConfig } from '../sim/types';
import { createBasicBot } from './basicBot';
import type { Bot } from './bot';
import { opponentOf } from './difficulty';
import { FAVOURITES, STAND_IN_DIFFICULTY, averageUpgrade, createLevelStandIn } from './levelStandIns';
import type { LevelStandIn } from './levelStandIns';
import { MAX_MATCH_TICKS } from './runMatch';

/** How a level ended: its clock ran out, a base fell, the boss fell, or (a soft lock) nothing by the limit. */
export type LevelEnd = 'clock' | 'base' | 'boss' | 'none';

export interface LevelPlayed {
  won: boolean;
  stars: Stars;
  /** Steps played. */
  ticks: number;
  end: LevelEnd;
}

/** Coins the campaign has paid the player before `def` (three stars on every earlier level of its side). */
export function coinsBefore(def: LevelDef, levels: readonly LevelDef[] = BACKYARD): number {
  const earlier = levels.filter((l) => l.side === def.side && (l.world < def.world || (l.world === def.world && l.n < def.n)));
  return earlier.length * 3 * ADVENTURE.perNewStar;
}

/**
 * The save a stand-in comes to `def` with: every unlock of the levels before it, the stand-in's
 * difficulty, and (the average player only) his favourites upgraded as the rewards allow.
 */
export function standInSave(kind: LevelStandIn, def: LevelDef, levels: readonly LevelDef[] = BACKYARD): Save {
  const side = def.side;
  const fresh = newSave(side === 'plants' ? 'p01' : 'p02', 'Kid', side === 'plants' ? 'peashooter' : 'brainEater', 0);
  const unlocked = levels
    .filter((l) => l.side === side && l.unlocks !== null && (l.world < def.world || (l.world === def.world && l.n < def.n)))
    .map((l) => l.unlocks as CardKey);
  const upgrades: Save['upgrades'] = {};
  const level = kind === 'average' ? averageUpgrade(coinsBefore(def, levels)) : 0;
  if (level > 0) for (const key of FAVOURITES[side]) upgrades[key] = level;
  return {
    ...fresh,
    upgrades,
    [side]: { ...fresh[side], unlocked },
    difficulty: { ...fresh.difficulty, [side]: STAND_IN_DIFFICULTY[kind] },
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

/** One level, one stand-in, one seed. */
export function playLevel(def: LevelDef, kind: LevelStandIn, seed: number, balance: Balance = BALANCE, levels: readonly LevelDef[] = BACKYARD): LevelPlayed {
  const config = levelConfig(def, standInSave(kind, def, levels), seed, balance);
  const maxTicks = config.goalTicks ?? MAX_MATCH_TICKS;
  const { match, end } = play(config, [createLevelStandIn(kind, def.side, seed), levelOpponent(def, seed)], balance, maxTicks + 1);
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
    minutes: median(results.map((r) => r.ticks)) / 1800,
    ends,
  };
}

export function playLevelSeries(def: LevelDef, kind: LevelStandIn, first: number, seeds: number, balance: Balance = BALANCE): LevelPlayed[] {
  const out: LevelPlayed[] = [];
  for (let seed = first; seed < first + seeds; seed++) out.push(playLevel(def, kind, seed, balance));
  return out;
}

// ---- Free Play ----

/** The cards a Backyard graduate holds, per side (the five the Backyard deals). */
export const FREE_PLAY_CARDS: Readonly<Record<Faction, readonly CardKey[]>> = {
  plants: ALL_CARDS.plants.slice(0, 5),
  zombies: ALL_CARDS.zombies.slice(0, 5),
};
/** Free Play survive: the first wave comes this long after the start (ticks): time for a first plant. */
export const FREE_PLAY_FIRST_WAVE = 300;

/**
 * Free Play for a player on `side` at a difficulty: survive (the plants hold out against endless
 * waves) or breakthrough (the zombies break garden after garden). The player holds the Backyard's
 * five cards, two spells and the hero; the waves' side has nothing but its waves.
 */
export function freePlayConfig(side: Faction, seed: number, income: number, balance: Balance = BALANCE): MatchConfig {
  const c = defaultConfig(seed, balance);
  const waves = opponentOf(side);
  return {
    ...c,
    mode: side === 'plants' ? 'survive' : 'breakthrough',
    goalTicks: null,
    invulnerableBase: side === 'plants' ? 'zombies' : null,
    cards: { [side]: [...FREE_PLAY_CARDS[side]], [waves]: [] } as Record<Faction, CardKey[]>,
    heroes: { [side]: true, [waves]: false } as Record<Faction, boolean>,
    spells: { [side]: c.spells[side], [waves]: 0 } as Record<Faction, number>,
    incomeMultiplier: { [side]: income, [waves]: 1 } as Record<Faction, number>,
    suddenDeath: false,
    endless: { cards: [...FREE_PLAY_CARDS[waves]], firstWaveTicks: side === 'plants' ? FREE_PLAY_FIRST_WAVE : 0 },
  };
}

export interface FreePlayed {
  /** Survive: the wave reached (waves started); breakthrough: the gardens broken. */
  score: number;
  ticks: number;
}

/** Free Play is over at the latest after this long (ticks): 40 minutes. */
export const FREE_PLAY_MAX_TICKS = 72_000;

export function playFreePlay(side: Faction, kind: LevelStandIn, seed: number, balance: Balance = BALANCE): FreePlayed {
  const income = ADVENTURE.income[STAND_IN_DIFFICULTY[kind]];
  const config = freePlayConfig(side, seed, income, balance);
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
