/**
 * The balance tuner: measures every balance target at once for a set of knobs, and searches a few
 * knobs for the setting that misses the targets least. Deterministic: the same knobs and seeds
 * always print the same numbers.
 *
 *   npx tsx tools/tune.ts                       scorecard of the shipped knobs (100 seeds)
 *   npx tsx tools/tune.ts --seeds 60            the same with fewer seeds (quicker, noisier)
 *   npx tsx tools/tune.ts --search spec.json    coordinate search over the knobs in spec.json
 *   --set path=value,path=value                 start from the shipped knobs with these changed
 *   --only regex                                measure only the targets whose name matches
 *
 * A search spec is JSON: `{ "seeds": 60, "rounds": 2, "knobs": { "<path>": [values...] } }`.
 * A path names one number in the knobs, dot-separated from `balance`, `skills` or `difficulty`,
 * e.g. `balance.trickle.zombies`, `balance.units.skeletonWarrior.hp`,
 * `skills.easy.thinkEvery`, `difficulty.easy.zombies.income.human`. Each round tries every value of
 * each knob in turn, keeping the others, and keeps the value with the lowest penalty (ties keep
 * the current value). The penalty adds up how far each measure falls outside its target band (see
 * `TARGETS`), weighted, so a setting that meets every target scores 0.
 *
 * The scorecard measures the matchups in `src/ai/balanceChecks.ts`: the ones the tests assert.
 */

import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  FACTIONS, SHIPPED, SKILL_NAMES, allSpamMatchups, botMatchup, humanMatchup, percentile, playSeries, winShare,
} from '../src/ai/balanceChecks';
import type { Knobs, Matchup } from '../src/ai/balanceChecks';
import { cloneBalance } from '../src/data/balance';
import type { Faction } from '../src/sim/types';

/** One measured number with its target band [min, max] and a weight for the penalty. */
interface Measure { name: string; value: number; min: number; max: number; weight: number }

const MINUTE = 1800;

/** Plain, unfrozen copies of everything a tuner may change. */
export function cloneKnobs(k: Knobs): Knobs {
  return {
    balance: cloneBalance(k.balance),
    skills: JSON.parse(JSON.stringify(k.skills)) as Knobs['skills'],
    difficulty: JSON.parse(JSON.stringify(k.difficulty)) as Knobs['difficulty'],
  };
}

/** Sets the number at a dot path (see the note at the top). */
export function setKnob(k: Knobs, path: string, value: number): void {
  const parts = path.split('.');
  let node: Record<string, unknown> = k as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (typeof next !== 'object' || next === null) throw new Error(`no knob ${path}`);
    node = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1] as string;
  if (typeof node[last] !== 'number') throw new Error(`knob ${path} is not a number`);
  node[last] = value;
}

function side(m: Matchup): Faction {
  return m.title.includes('(plants)') ? 'plants' : 'zombies';
}

/**
 * Every target, measured. Bands are the fix list's; the weights make a miss on the must-fix
 * targets (spam, difficulty order) count more than a miss on a soft one.
 */
export function measure(knobs: Knobs, seeds: number, only?: RegExp): Measure[] {
  const out: Measure[] = [];
  /** Whether a measure (or a group of them, by its common start) is asked for. */
  const want = (name: string): boolean => only === undefined || only.test(name);

  if (want('medium v medium')) {
    const mm = playSeries(botMatchup({ plants: 'medium', zombies: 'medium' }), seeds * 2, knobs);
    out.push({ name: 'medium v medium: plants win', value: winShare(mm, 'plants'), min: 0.4, max: 0.6, weight: 3 });
    out.push({ name: 'medium v medium: median minutes', value: percentile(mm.lengths, 0.5) / MINUTE, min: 3, max: 6, weight: 1 });
    out.push({ name: 'medium v medium: sudden death share', value: mm.suddenDeath / mm.results.length, min: 0, max: 0.25, weight: 1 });
  }
  if (want('start energy')) {
    for (const f of [0.75, 1.25]) {
      const s = playSeries(botMatchup({ plants: 'medium', zombies: 'medium' }, f), seeds, knobs);
      out.push({ name: `start energy x${f}: plants win`, value: winShare(s, 'plants'), min: 0.25, max: 0.75, weight: 1 });
    }
  }
  if (want('hard v easy')) {
    for (const hard of FACTIONS) {
      const skills = hard === 'plants' ? { plants: 'hard', zombies: 'easy' } as const : { plants: 'easy', zombies: 'hard' } as const;
      const s = playSeries(botMatchup(skills), seeds, knobs);
      out.push({ name: `hard v easy: hard ${hard} win`, value: winShare(s, hard), min: 0.8, max: 1, weight: 2 });
    }
  }
  if (want('spam')) {
    for (const m of allSpamMatchups()) {
      if (!want(`spam: ${m.title}`)) continue;
      const s = playSeries(m, seeds, knobs);
      out.push({ name: `spam: ${m.title}`, value: winShare(s, side(m)), min: 0, max: 0.55, weight: 3 });
    }
  }
  {
    const bands = {
      child: { easy: [0.55, 0.85], medium: [0.15, 0.45], hard: [0, 0.15] },
      attentive: { easy: [0.85, 0.95], medium: [0.4, 0.6], hard: [0.15, 0.35] },
    } as const;
    for (const standIn of ['child', 'attentive'] as const) {
      for (const human of FACTIONS) {
        for (const d of SKILL_NAMES) {
          if (!want(`${standIn} as ${human} vs ${d}`)) continue;
          const s = playSeries(humanMatchup(standIn, human, d), seeds, knobs);
          const [min, max] = bands[standIn][d];
          out.push({ name: `${standIn} as ${human} vs ${d}`, value: winShare(s, human), min, max, weight: standIn === 'child' ? 2 : 1 });
        }
      }
    }
  }
  return out;
}

export function penalty(measures: readonly Measure[]): number {
  let p = 0;
  for (const m of measures) {
    const miss = m.value < m.min ? m.min - m.value : m.value > m.max ? m.value - m.max : 0;
    p += miss * m.weight;
  }
  return p;
}

function print(measures: readonly Measure[]): void {
  for (const m of measures) {
    const ok = m.value >= m.min && m.value <= m.max;
    const value = m.name.includes('minutes') ? m.value.toFixed(2) : `${Math.round(m.value * 100)}%`;
    const band = m.name.includes('minutes') ? `${m.min}-${m.max}` : `${Math.round(m.min * 100)}-${Math.round(m.max * 100)}%`;
    console.log(`  ${ok ? '  ' : 'XX'} ${m.name.padEnd(56)} ${value.padStart(6)}   (${band})`);
  }
  console.log(`  penalty ${penalty(measures).toFixed(3)}`);
}

interface SearchSpec { seeds?: number; rounds?: number; only?: string; workers?: number; knobs: Record<string, number[]> }

interface Job { knobs: Knobs; seeds: number; only: string | undefined }

/**
 * Measures several settings at once, one worker thread each (at most `workers` at a time), and
 * returns their penalties in order. Each worker plays exactly what `measure` would on this thread.
 */
async function measureAll(jobs: readonly Job[], workers: number): Promise<number[]> {
  const results: number[] = new Array<number>(jobs.length);
  let next = 0;
  const runOne = async (): Promise<void> => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await new Promise<number>((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: jobs[index], execArgv: ['--import', 'tsx'] });
        worker.once('message', (p: number) => { resolve(p); void worker.terminate(); });
        worker.once('error', reject);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, runOne));
  return results;
}

async function search(spec: SearchSpec, start: Knobs): Promise<void> {
  const seeds = spec.seeds ?? 60;
  const workers = spec.workers ?? 3;
  const only = spec.only === undefined ? undefined : new RegExp(spec.only);
  const current = cloneKnobs(start);
  const chosen: Record<string, number> = {};
  let best = penalty(measure(current, seeds, only));
  console.log(`start: penalty ${best.toFixed(3)}`);
  for (let round = 1; round <= (spec.rounds ?? 1); round++) {
    for (const [path, values] of Object.entries(spec.knobs)) {
      let bestValue: number | undefined = chosen[path];
      const jobs = values.map((value): Job => {
        const trial = cloneKnobs(current);
        setKnob(trial, path, value);
        return { knobs: trial, seeds, only: spec.only };
      });
      const penalties = await measureAll(jobs, workers);
      values.forEach((value, i) => {
        const p = penalties[i] as number;
        console.log(`  round ${round} ${path} = ${value}: penalty ${p.toFixed(3)}`);
        if (p < best) {
          best = p;
          bestValue = value;
        }
      });
      if (bestValue !== undefined) {
        setKnob(current, path, bestValue);
        chosen[path] = bestValue;
      }
      console.log(`round ${round} keeps ${path} = ${chosen[path] ?? '(as started)'}; penalty ${best.toFixed(3)}`);
    }
  }
  console.log('\nchosen:', JSON.stringify(chosen));
  print(measure(current, seeds, only));
}

function main(): void {
  const args = process.argv.slice(2);
  const seedsAt = args.indexOf('--seeds');
  const seeds = seedsAt >= 0 ? Number(args[seedsAt + 1]) : 100;
  const searchAt = args.indexOf('--search');
  const onlyAt = args.indexOf('--only');
  const setAt = args.indexOf('--set');
  const start = cloneKnobs(SHIPPED);
  if (setAt >= 0) {
    for (const pair of (args[setAt + 1] as string).split(',')) {
      const [path, value] = pair.split('=');
      setKnob(start, path as string, Number(value));
    }
  }
  if (searchAt >= 0) {
    void search(JSON.parse(readFileSync(args[searchAt + 1] as string, 'utf8')) as SearchSpec, start);
  } else {
    console.log(`Scorecard, ${setAt >= 0 ? `shipped knobs with ${args[setAt + 1]}` : 'shipped knobs'}, ${seeds} seeds (medium v medium ${seeds * 2})`);
    print(measure(start, seeds, onlyAt >= 0 ? new RegExp(args[onlyAt + 1] as string) : undefined));
  }
}

if (!isMainThread) {
  const job = workerData as Job;
  parentPort?.postMessage(penalty(measure(job.knobs, job.seeds, job.only === undefined ? undefined : new RegExp(job.only))));
} else if (process.argv[1]?.endsWith('tune.ts')) {
  main();
}
