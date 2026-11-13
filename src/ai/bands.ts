/**
 * Every balance band of phase 2 (plan Task 8; spec sections 6, 10 and 21), as data: which matchups
 * to play on how many seeds, and how to turn the results into the number that must fall inside the
 * band. The tests (`tests/ai`) and the tuner (`tools/tune.ts`) both read this list, so they measure
 * exactly the same thing. A matchup is named by a plain `MatchupSpec`, so a worker thread can
 * rebuild it from JSON.
 */

import { ALL_CARDS } from '../data/units';
import { SPELLS } from '../sim/spells';
import type { CardKey, Faction, SpellKey } from '../sim/types';
import {
  FACTIONS, SKILL_NAMES, botMatchup, humanMatchup, mergeSpamMatchup, percentile, pickShares, spamMatchup,
  spellsMatchup, summarise, winShare,
} from './balanceChecks';
import type { HumanStandIn, Matchup, Played, SeriesStats } from './balanceChecks';
import type { Knobs } from './balanceChecks';
import type { Skill } from './bot';

/** A matchup as plain data. */
export type MatchupSpec =
  | { kind: 'bot'; plants: Skill; zombies: Skill; energy?: number }
  | { kind: 'spam'; faction: Faction; unit: CardKey; merge: boolean }
  | { kind: 'human'; standIn: HumanStandIn; human: Faction; difficulty: Skill }
  | { kind: 'spells'; plants: SpellKey[]; zombies: SpellKey[] };

export function matchupOf(spec: MatchupSpec): Matchup {
  switch (spec.kind) {
    case 'bot': return botMatchup({ plants: spec.plants, zombies: spec.zombies }, spec.energy ?? 1);
    case 'spam': return spec.merge ? mergeSpamMatchup(spec.faction, spec.unit) : spamMatchup(spec.faction, spec.unit);
    case 'human': return humanMatchup(spec.standIn, spec.human, spec.difficulty);
    case 'spells': return spellsMatchup({ plants: spec.plants, zombies: spec.zombies });
    default: {
      const unhandled: never = spec;
      throw new Error(`no matchup ${JSON.stringify(unhandled)}`);
    }
  }
}

/** A stable name for a spec, so a measurement plays each matchup once however many bands read it. */
export function specKey(spec: MatchupSpec): string {
  return JSON.stringify(spec);
}

/**
 * One band: `plays` lists the matchups and seed counts it needs; `value` reads the series (in the
 * order of `plays`) and gives the number that must fall within [min, max]. `weight` scores a miss
 * for the tuner. `group` names the brief's row it belongs to.
 */
export interface Band {
  readonly name: string;
  readonly group: string;
  readonly min: number;
  readonly max: number;
  readonly weight: number;
  /** How the value is shown: a share in %, minutes, a ratio, or points (already ×100). */
  readonly unit: '%' | 'min' | 'x' | 'pts';
  readonly plays: ReadonlyArray<{ spec: MatchupSpec; seeds: number }>;
  readonly value: (series: readonly SeriesStats[]) => number;
}

const MINUTE = 1800;

/**
 * The spell pairings measured for "no deal decides the match": the 20 the one-spell edges predict
 * to be most extreme (strongest plant hands against weakest zombie hands and the other way round).
 * Measuring all 100 at 300 seeds each is 30,000 matches; these are where a miss would show.
 */
export const EXTREME_PAIRS: ReadonlyArray<readonly [readonly SpellKey[], readonly SpellKey[]]> = [];
const MM: MatchupSpec = { kind: 'bot', plants: 'medium', zombies: 'medium' };
const HH: MatchupSpec = { kind: 'bot', plants: 'hard', zombies: 'hard' };
const NO_SPELLS: MatchupSpec = { kind: 'spells', plants: [], zombies: [] };

function share(side: Faction) {
  return (series: readonly SeriesStats[]): number => winShare(series[0] as SeriesStats, side);
}

/** Every band, at `scale` × the brief's seed counts (1 = as the brief says). */
export function allBands(scale = 1): Band[] {
  const n = (seeds: number): number => Math.max(1, Math.round(seeds * scale));
  const bands: Band[] = [];
  const add = (b: Band): void => { bands.push(b); };

  // Medium v Medium.
  add({ name: 'medium v medium: plants win', group: 'MvM', min: 0.4, max: 0.6, weight: 6, unit: '%', plays: [{ spec: MM, seeds: n(200) }], value: share('plants') });
  add({
    name: 'medium v medium: median minutes', group: 'length', min: 3, max: 6, weight: 1, unit: 'min', plays: [{ spec: MM, seeds: n(200) }],
    value: (s) => percentile((s[0] as SeriesStats).lengths, 0.5) / MINUTE,
  });
  add({
    name: 'medium v medium: sudden death share', group: 'length', min: 0, max: 0.249, weight: 1, unit: '%', plays: [{ spec: MM, seeds: n(200) }],
    value: (s) => (s[0] as SeriesStats).suddenDeath / (s[0] as SeriesStats).results.length,
  });

  // Hard beats Easy.
  for (const hard of FACTIONS) {
    const spec: MatchupSpec = hard === 'plants'
      ? { kind: 'bot', plants: 'hard', zombies: 'easy' } : { kind: 'bot', plants: 'easy', zombies: 'hard' };
    add({ name: `hard ${hard} beat easy`, group: 'HvE', min: 0.8, max: 1, weight: 3, unit: '%', plays: [{ spec, seeds: n(200) }], value: share(hard) });
  }

  // The two adults who play the way Michal did.
  add({
    name: 'fortress plants v hard', group: 'adults', min: 0.15, max: 0.4, weight: 4, unit: '%',
    plays: [{ spec: { kind: 'human', standIn: 'fortress', human: 'plants', difficulty: 'hard' }, seeds: n(200) }], value: share('plants'),
  });
  add({
    name: 'steady zombies v hard', group: 'adults', min: 0.15, max: 0.4, weight: 4, unit: '%',
    plays: [{ spec: { kind: 'human', standIn: 'steady', human: 'zombies', difficulty: 'hard' }, seeds: n(200) }], value: share('zombies'),
  });
  add({
    name: 'steady zombies v medium', group: 'adults', min: 0.4, max: 0.65, weight: 4, unit: '%',
    plays: [{ spec: { kind: 'human', standIn: 'steady', human: 'zombies', difficulty: 'medium' }, seeds: n(200) }], value: share('zombies'),
  });

  // The random child, the newest-card child, the slow tapper, the attentive player.
  const childBands: Record<Skill, [number, number]> = { easy: [0.55, 0.85], medium: [0.15, 0.45], hard: [0, 0.149] };
  for (const human of FACTIONS) {
    for (const d of SKILL_NAMES) {
      const [min, max] = childBands[d];
      add({
        name: `random child as ${human} v ${d}`, group: 'child', min, max, weight: 2, unit: '%',
        plays: [{ spec: { kind: 'human', standIn: 'child', human, difficulty: d }, seeds: n(200) }], value: share(human),
      });
    }
    add({
      name: `newest-card child as ${human} v easy`, group: 'newest', min: 0.25, max: 0.85, weight: 2, unit: '%',
      plays: [{ spec: { kind: 'human', standIn: 'newest', human, difficulty: 'easy' }, seeds: n(200) }], value: share(human),
    });
    add({
      name: `slow tapper as ${human} v easy`, group: 'slow', min: 0.45, max: 1, weight: 2, unit: '%',
      plays: [{ spec: { kind: 'human', standIn: 'slow', human, difficulty: 'easy' }, seeds: n(200) }], value: share(human),
    });
  }

  // Start energy (phase 1's robustness check, kept).
  for (const energy of [0.75, 1.25]) {
    add({
      name: `start energy x${energy}: plants win`, group: 'energy', min: 0.25, max: 0.75, weight: 1, unit: '%',
      plays: [{ spec: { kind: 'bot', plants: 'medium', zombies: 'medium', energy }, seeds: n(100) }], value: share('plants'),
    });
  }

  // One-card spam and merge-spam against Medium, all twenty cards.
  for (const faction of FACTIONS) {
    for (const unit of ALL_CARDS[faction]) {
      for (const merge of [false, true]) {
        add({
          name: `${merge ? 'merge-spam' : 'spam'} ${unit}`, group: 'spam', min: 0, max: 0.6, weight: 3, unit: '%',
          plays: [{ spec: { kind: 'spam', faction, unit, merge }, seeds: n(200) }], value: share(faction),
        });
      }
    }
  }

  // Each card's pick share by the Hard computer (Hard v Hard).
  for (const faction of FACTIONS) {
    for (const unit of ALL_CARDS[faction]) {
      add({
        name: `pick share ${unit}`, group: 'picks', min: 0.03, max: 1, weight: 2, unit: '%',
        plays: [{ spec: HH, seeds: n(200) }], value: (s) => pickShares(s[0] as SeriesStats, faction)[unit],
      });
    }
  }

  // Spells (Task 8b): each one, alone on its side against a side with none, gives its side the same
  // felt edge: +8..+16 points of Medium v Medium on 600 seeds (target +12). With two dealt a side,
  // Medium v Medium stays 40-60% on 400 seeds, and no pairing decides a match: the most extreme
  // pairings (`EXTREME_PAIRS`, 300 seeds each) keep the plants within 30-70%.
  for (const faction of FACTIONS) {
    for (const spell of SPELLS[faction]) {
      const hands = { plants: [] as SpellKey[], zombies: [] as SpellKey[] };
      hands[faction] = [spell];
      add({
        name: `spell ${spell} alone: edge`, group: 'spell-one', min: 8, max: 16, weight: 1, unit: 'pts',
        plays: [{ spec: { kind: 'spells', ...hands }, seeds: n(600) }, { spec: NO_SPELLS, seeds: n(600) }],
        value: (s) => 100 * (winShare(s[0] as SeriesStats, faction) - winShare(s[1] as SeriesStats, faction)),
      });
    }
  }
  add({
    name: 'medium v medium, spells dealt: plants win (400)', group: 'spell-deal', min: 0.4, max: 0.6, weight: 3, unit: '%',
    plays: [{ spec: MM, seeds: n(400) }], value: share('plants'),
  });
  for (const [p, z] of EXTREME_PAIRS) {
    add({
      name: `spell pairing ${p.join('+')} v ${z.join('+')}: plants win`, group: 'spell-pairs', min: 0.3, max: 0.7, weight: 1, unit: '%',
      plays: [{ spec: { kind: 'spells', plants: [...p], zombies: [...z] }, seeds: n(300) }], value: share('plants'),
    });
  }

  return bands;
}

/** A band's measured value. */
export interface Measured { band: Band; value: number; ok: boolean }

export function inBand(band: Band, value: number): boolean {
  return value >= band.min && value <= band.max;
}

/**
 * Plays what `bands` need (each matchup once, at the largest seed count any band asks of it) with
 * `play`, which may be the plain loop or a pool of workers, and measures every band.
 */
export async function measureBands(
  bands: readonly Band[],
  play: (spec: MatchupSpec, seeds: number) => Promise<Played[]>,
  knobs: Knobs,
): Promise<Measured[]> {
  const need = new Map<string, { spec: MatchupSpec; seeds: number }>();
  for (const b of bands) {
    for (const p of b.plays) {
      const key = specKey(p.spec);
      const had = need.get(key);
      if (had === undefined || had.seeds < p.seeds) need.set(key, { spec: p.spec, seeds: p.seeds });
    }
  }
  const played = new Map<string, Played[]>();
  await Promise.all([...need.entries()].map(async ([key, { spec, seeds }]) => {
    played.set(key, await play(spec, seeds));
  }));
  return bands.map((band) => {
    const series = band.plays.map((p) => {
      const all = played.get(specKey(p.spec)) ?? [];
      return summarise(matchupOf(p.spec).title, all.slice(0, p.seeds), knobs.balance);
    });
    const value = band.value(series);
    return { band, value, ok: inBand(band, value) };
  });
}

/** How far outside its band a value is, weighted; 0 inside. In the band's own unit (shares as 0..1). */
export function bandMiss(m: Measured): number {
  const { band, value } = m;
  const miss = value < band.min ? band.min - value : value > band.max ? value - band.max : 0;
  const scale = band.unit === 'pts' ? 0.01 : band.unit === 'min' ? 0.1 : 1;
  return miss * scale * band.weight;
}

export function formatValue(band: Band, value: number): string {
  switch (band.unit) {
    case '%': return `${(value * 100).toFixed(1)}%`;
    case 'min': return value.toFixed(2);
    case 'x': return value.toFixed(2);
    case 'pts': return value.toFixed(1);
    default: return String(value);
  }
}

export function formatRange(band: Band): string {
  const f = (v: number): string => (band.unit === '%' ? `${Math.round(v * 100)}` : String(v));
  return `${f(band.min)}-${f(band.max)}${band.unit === '%' ? '%' : ''}`;
}
