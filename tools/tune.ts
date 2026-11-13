/**
 * The balance tuner: measures every band of `src/ai/bands.ts` (the ones the tests assert) for a set
 * of knobs, on a pool of at most three worker threads, and searches a few knobs for the setting
 * that misses the bands least. Deterministic: the same knobs and seeds always print the same
 * numbers.
 *
 *   npx tsx tools/tune.ts                       every band, the brief's seed counts, seeds 1..N
 *   npx tsx tools/tune.ts --first 1001          the same on the second seed block (1001..)
 *   npx tsx tools/tune.ts --scale 0.5           half the seeds everywhere (quicker, noisier)
 *   npx tsx tools/tune.ts --only regex          only the bands whose name or group matches
 *   npx tsx tools/tune.ts --merge               also the merge values (lane duels)
 *   npx tsx tools/tune.ts --casts               also each power's uses per dealt match at Medium
 *   --set path=value,path=value                 start from the shipped knobs with these changed
 *   --workers N                                 worker threads (default 3, never more than 3)
 *   --search spec.json                          coordinate search over the knobs in spec.json
 *
 * A search spec is JSON: `{ "scale": 0.5, "rounds": 2, "only": "MvM|adults", "knobs": { "<path>":
 * [values...] } }`. A path names one number in the knobs, dot-separated from `balance`, `skills` or
 * `difficulty`, e.g. `balance.trickle.plants`, `skills.zombies.hard.thinkEvery`,
 * `difficulty.easy.zombies.income.human`. Each round tries every value of each knob in turn,
 * keeping the others, and keeps the value with the lowest penalty (ties keep the current value).
 * The penalty adds up how far each band misses, weighted (`bandMiss`), so 0 means every band holds.
 */

import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { SHIPPED, castsPerMatch, playSeries, summarise } from '../src/ai/balanceChecks';
import type { Knobs, Played } from '../src/ai/balanceChecks';
import { allBands, bandMiss, formatRange, formatValue, matchupOf, measureBands } from '../src/ai/bands';
import type { Band, MatchupSpec, Measured } from '../src/ai/bands';
import { FIGHTERS, unitMergeValue } from '../src/ai/duels';
import { cloneBalance } from '../src/data/balance';

/** Plain, unfrozen copies of everything a tuner may change. */
export function cloneKnobs(k: Knobs): Knobs {
  return {
    balance: cloneBalance(k.balance),
    skills: JSON.parse(JSON.stringify(k.skills)) as Knobs['skills'],
    difficulty: JSON.parse(JSON.stringify(k.difficulty)) as Knobs['difficulty'],
  };
}

/** Sets the number (or boolean) at a dot path (see the note at the top). */
export function setKnob(k: Knobs, path: string, value: number | boolean | string): void {
  const parts = path.split('.');
  let node: Record<string, unknown> = k as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (typeof next !== 'object' || next === null) throw new Error(`no knob ${path}`);
    node = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1] as string;
  if (typeof node[last] !== typeof value) throw new Error(`knob ${path} is not a ${typeof value}`);
  node[last] = value;
}

interface Job { knobs: Knobs; spec: MatchupSpec; first: number; seeds: number }

/** Seeds per job: small enough that three workers share a long matchup evenly. */
const CHUNK = 50;

/** A pool of worker threads that play series; each worker plays what `playSeries` would here. */
export class Pool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Array<{ job: Job; resolve: (r: Played[]) => void; reject: (e: unknown) => void }> = [];

  constructor(size: number) {
    for (let i = 0; i < Math.min(3, Math.max(1, size)); i++) {
      const w = new Worker(new URL(import.meta.url), { execArgv: ['--import', 'tsx'] });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  run(job: Job): Promise<Played[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop() as Worker;
      const { job, resolve, reject } = this.queue.shift() as (typeof this.queue)[number];
      const onMessage = (r: Played[]): void => { w.off('error', onError); this.idle.push(w); resolve(r); this.pump(); };
      const onError = (e: unknown): void => { w.off('message', onMessage); reject(e); };
      w.once('message', onMessage);
      w.once('error', onError);
      w.postMessage(job);
    }
  }

  async play(knobs: Knobs, spec: MatchupSpec, first: number, seeds: number): Promise<Played[]> {
    const jobs: Promise<Played[]>[] = [];
    for (let a = 0; a < seeds; a += CHUNK) jobs.push(this.run({ knobs, spec, first: first + a, seeds: Math.min(CHUNK, seeds - a) }));
    return (await Promise.all(jobs)).flat();
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

export async function measure(pool: Pool, knobs: Knobs, bands: readonly Band[], first: number): Promise<Measured[]> {
  return measureBands(bands, (spec, seeds) => pool.play(knobs, spec, first, seeds), knobs);
}

export function penalty(measured: readonly Measured[]): number {
  return measured.reduce((p, m) => p + bandMiss(m), 0);
}

function print(measured: readonly Measured[]): void {
  for (const m of measured) {
    console.log(`  ${m.ok ? '  ' : 'XX'} ${m.band.name.padEnd(46)} ${formatValue(m.band, m.value).padStart(7)}   (${formatRange(m.band)})`);
  }
  console.log(`  penalty ${penalty(measured).toFixed(3)}, ${measured.filter((m) => !m.ok).length} of ${measured.length} bands missed`);
}

interface SearchSpec { scale?: number; rounds?: number; only?: string; first?: number; knobs: Record<string, number[]> }

async function search(pool: Pool, spec: SearchSpec, start: Knobs): Promise<void> {
  const bands = select(allBands(spec.scale ?? 0.5), spec.only);
  const first = spec.first ?? 1;
  const current = cloneKnobs(start);
  const chosen: Record<string, number> = {};
  let best = penalty(await measure(pool, current, bands, first));
  console.log(`start: penalty ${best.toFixed(3)}`);
  for (let round = 1; round <= (spec.rounds ?? 1); round++) {
    for (const [path, values] of Object.entries(spec.knobs)) {
      let bestValue: number | undefined = chosen[path];
      for (const value of values) {
        const trial = cloneKnobs(current);
        setKnob(trial, path, value);
        const p = penalty(await measure(pool, trial, bands, first));
        console.log(`  round ${round} ${path} = ${value}: penalty ${p.toFixed(3)}`);
        if (p < best) {
          best = p;
          bestValue = value;
        }
      }
      if (bestValue !== undefined) {
        setKnob(current, path, bestValue);
        chosen[path] = bestValue;
      }
      console.log(`round ${round} keeps ${path} = ${chosen[path] ?? '(as started)'}; penalty ${best.toFixed(3)}`);
    }
  }
  console.log('\nchosen:', JSON.stringify(chosen));
  print(await measure(pool, current, bands, first));
}

function select(bands: Band[], only: string | undefined): Band[] {
  if (only === undefined) return bands;
  const re = new RegExp(only);
  return bands.filter((b) => re.test(b.name) || re.test(b.group));
}

function arg(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const start = cloneKnobs(SHIPPED);
  const set = arg(args, '--set');
  if (set !== undefined) {
    for (const pair of set.split(',')) {
      const [path, value] = pair.split('=');
      setKnob(start, path as string, value === 'true' ? true : value === 'false' ? false : Number(value));
    }
  }
  const pool = new Pool(Number(arg(args, '--workers') ?? 3));
  try {
    const searchFile = arg(args, '--search');
    if (searchFile !== undefined) {
      await search(pool, JSON.parse(readFileSync(searchFile, 'utf8')) as SearchSpec, start);
      return;
    }
    const scale = Number(arg(args, '--scale') ?? 1);
    const first = Number(arg(args, '--first') ?? 1);
    const bands = select(allBands(scale), arg(args, '--only'));
    console.log(`Bands, ${set === undefined ? 'shipped knobs' : `shipped knobs with ${set}`}, seeds from ${first}, scale ${scale}`);
    const t0 = Date.now();
    print(await measure(pool, start, bands, first));
    if (args.includes('--casts')) {
      const mm = summarise('', await pool.play(start, { kind: 'bot', plants: 'medium', zombies: 'medium' }, first, 400), start.balance);
      console.log('\nUses per dealt match, Medium v Medium, 400 seeds (heroes per match):');
      for (const [k, v] of Object.entries(castsPerMatch(mm)).sort()) console.log(`  ${k.padEnd(16)} ${v.toFixed(2)}`);
    }
    if (args.includes('--merge')) {
      console.log('\nMerge value (mean over N = 2..5, band 0.95-1.25):');
      for (const unit of FIGHTERS) {
        const v = unitMergeValue(unit, start.balance);
        const ok = v.mean >= 0.95 && v.mean <= 1.25;
        console.log(`  ${ok ? '  ' : 'XX'} ${`${unit} v ${v.enemy}`.padEnd(36)} ${v.mean.toFixed(2)}   (${v.values.map((x) => x.toFixed(2)).join(' ')})`);
      }
    }
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } finally {
    await pool.close();
  }
}

if (!isMainThread) {
  parentPort?.on('message', (job: Job) => {
    parentPort?.postMessage(playSeries(matchupOf(job.spec), job.seeds, job.knobs, job.first).results);
  });
} else if (process.argv[1]?.endsWith('tune.ts')) {
  void main();
}

