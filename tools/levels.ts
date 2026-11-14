/**
 * The level tool: plays every Adventure level (`LEVELS`, all worlds) with every level stand-in (`src/ai/levelStandIns.ts`)
 * on N seeds, on a pool of at most three worker threads, and prints per level and stand-in the win
 * rate, the median stars, the share of 3-star seeds, the median length and how the seeds ended
 * (clock / base / boss / not at all). Also Free Play's first steps. Deterministic.
 *
 *   npx tsx tools/levels.ts                    every level, 200 seeds, seeds 1..200
 *   npx tsx tools/levels.ts --first 1001       the second block (1001..), --first 2001 the third
 *   npx tsx tools/levels.ts --seeds 50         fewer seeds (quicker, noisier)
 *   npx tsx tools/levels.ts --world 2          only world 2's levels (both sides)
 *   npx tsx tools/levels.ts --only p1-3,z1-8   only these levels (a regex also works: --only 'p1-')
 *   npx tsx tools/levels.ts --who average      only these stand-ins (comma list)
 *   npx tsx tools/levels.ts --free             Free Play instead of the levels
 *   npx tsx tools/levels.ts --set path=value   a Balance number changed (e.g. bosses.brainTitan.hp=5000)
 *   --workers N                                worker threads (default 3, never more than 3)
 */

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { LEVELS } from '../src/adventure/levels';
import { BALANCE, cloneBalance } from '../src/data/balance';
import type { Balance } from '../src/data/balance';
import {
  playFreePlay, playLevel, summariseFreePlay, summariseLevel,
} from '../src/ai/levelChecks';
import type { FreePlayed, LevelPlayed } from '../src/ai/levelChecks';
import { LEVEL_STAND_INS } from '../src/ai/levelStandIns';
import type { LevelStandIn } from '../src/ai/levelStandIns';
import type { Faction } from '../src/sim/types';

type Job =
  | { kind: 'level'; id: string; who: LevelStandIn; first: number; seeds: number; sets: string[] }
  | { kind: 'free'; side: Faction; who: LevelStandIn; first: number; seeds: number; sets: string[] };

/** A balance with `path=value` changes (paths from the Balance's root). */
export function patchedBalance(sets: readonly string[]): Balance {
  if (sets.length === 0) return BALANCE;
  const b = cloneBalance(BALANCE);
  for (const set of sets) {
    const [path, raw] = set.split('=');
    if (path === undefined || raw === undefined) throw new Error(`bad --set ${set}`);
    const parts = path.split('.');
    let node = b as unknown as Record<string, unknown>;
    for (const p of parts.slice(0, -1)) node = node[p] as Record<string, unknown>;
    const last = parts[parts.length - 1] as string;
    const value = raw.startsWith('[') ? JSON.parse(raw) as unknown : Number(raw);
    if (node[last] === undefined) throw new Error(`no balance number ${path}`);
    node[last] = value;
  }
  return b;
}

function work(job: Job): LevelPlayed[] | FreePlayed[] {
  const b = patchedBalance(job.sets);
  const out: Array<LevelPlayed | FreePlayed> = [];
  for (let seed = job.first; seed < job.first + job.seeds; seed++) {
    if (job.kind === 'level') {
      const def = LEVELS.find((l) => l.id === job.id);
      if (def === undefined) throw new Error(`no level ${job.id}`);
      out.push(playLevel(def, job.who, seed, b));
    } else {
      out.push(playFreePlay(job.side, job.who, seed, b));
    }
  }
  return out as LevelPlayed[] | FreePlayed[];
}

/** Seeds per job. */
const CHUNK = 25;

class Pool {
  private readonly idle: Worker[] = [];
  private readonly all: Worker[] = [];
  private readonly queue: Array<{ job: Job; resolve: (r: unknown[]) => void; reject: (e: unknown) => void }> = [];
  constructor(size: number) {
    for (let i = 0; i < Math.min(3, Math.max(1, size)); i++) {
      const w = new Worker(new URL(import.meta.url), { execArgv: ['--import', 'tsx'] });
      this.all.push(w);
      this.idle.push(w);
    }
  }
  run(job: Job): Promise<unknown[]> {
    return new Promise((resolve, reject) => { this.queue.push({ job, resolve, reject }); this.pump(); });
  }
  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop() as Worker;
      const { job, resolve, reject } = this.queue.shift() as (typeof this.queue)[number];
      const onMessage = (r: unknown[]): void => { w.off('error', onError); this.idle.push(w); resolve(r); this.pump(); };
      const onError = (e: unknown): void => { w.off('message', onMessage); reject(e); };
      w.once('message', onMessage);
      w.once('error', onError);
      w.postMessage(job);
    }
  }
  async series(make: (first: number, seeds: number) => Job, first: number, seeds: number): Promise<unknown[]> {
    const jobs: Promise<unknown[]>[] = [];
    for (let a = 0; a < seeds; a += CHUNK) jobs.push(this.run(make(first + a, Math.min(CHUNK, seeds - a))));
    return (await Promise.all(jobs)).flat();
  }
  async close(): Promise<void> { await Promise.all(this.all.map((w) => w.terminate())); }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const first = Number(arg('--first') ?? 1);
  const seeds = Number(arg('--seeds') ?? 200);
  const only = arg('--only');
  const who = (arg('--who')?.split(',') ?? LEVEL_STAND_INS) as LevelStandIn[];
  const sets = process.argv.flatMap((a, i) => (process.argv[i - 1] === '--set' ? a.split(',') : []));
  const pool = new Pool(Number(arg('--workers') ?? 3));
  const t0 = Date.now();
  try {
    if (process.argv.includes('--free')) {
      for (const side of ['plants', 'zombies'] as const) {
        for (const w of who) {
          const r = (await pool.series((f, n) => ({ kind: 'free', side, who: w, first: f, seeds: n, sets }), first, seeds)) as FreePlayed[];
          const s = summariseFreePlay(r);
          const scores = r.map((x) => x.score).sort((a, b) => a - b);
          console.log(`free ${side.padEnd(7)} ${w.padEnd(8)} median ${String(s.medianScore).padStart(4)}  >=1 ${s.atLeastOne.toFixed(1).padStart(5)}%  p10 ${scores[Math.floor(scores.length * 0.1)]} p90 ${scores[Math.floor(scores.length * 0.9)]}  ${s.minutes.toFixed(2)} min  >20min ${s.over20.toFixed(1)}%`);
        }
      }
      return;
    }
    const world = arg('--world');
    const inWorld = world === undefined ? LEVELS : LEVELS.filter((l) => l.world === Number(world));
    if (inWorld.length === 0) throw new Error(`no levels in world ${world}`);
    const pick = only === undefined ? inWorld
      : inWorld.filter((l) => only.split(',').some((o) => l.id === o || new RegExp(o).test(l.id)));
    // Every series at once, so the three workers stay busy.
    const runs = pick.flatMap((def) => who.map((w) => ({ def, w })));
    const results = await Promise.all(runs.map(({ def, w }) =>
      pool.series((f, n) => ({ kind: 'level', id: def.id, who: w, first: f, seeds: n, sets }), first, seeds)));
    console.log(`seeds ${first}..${first + seeds - 1}${sets.length > 0 ? `  set ${sets.join(',')}` : ''}`);
    console.log('level  stand-in   win%  stars  3*%   min   clock  base  boss  none');
    runs.forEach(({ def, w }, i) => {
      const s = summariseLevel(results[i] as LevelPlayed[]);
      const e = s.ends;
      console.log(`${def.id.padEnd(6)} ${w.padEnd(9)} ${s.win.toFixed(1).padStart(5)}  ${String(s.medianStars).padStart(4)}  ${s.threeStars.toFixed(0).padStart(4)}  ${s.minutes.toFixed(2).padStart(4)}  ${e.clock.toFixed(0).padStart(5)} ${e.base.toFixed(0).padStart(5)} ${e.boss.toFixed(0).padStart(5)} ${e.none.toFixed(0).padStart(5)}`);
    });
  } finally {
    await pool.close();
    console.error(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
}

if (isMainThread) {
  void main();
} else {
  parentPort?.on('message', (job: Job) => parentPort?.postMessage(work(job)));
}
