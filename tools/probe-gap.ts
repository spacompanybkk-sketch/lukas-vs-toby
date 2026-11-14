/**
 * The skill-gap probe (worlds plan, Task 8a, ruling 11): a throwaway late-campaign battle (campaign
 * level 40: all ten cards a side, a lawn twist, the level's computer with all ten of its cards) and
 * how far apart the average and the expert stand-ins can be pushed by the computer's strength. The
 * average player comes with the Marketplace levels his coins would have bought by level 40 at the
 * real prices (unlocks at campaign levels 3, 6, 11, 14, 19, 22, 27); the expert with none. Not a
 * level: nothing here ships. Deterministic, at most three worker threads.
 *
 *   npx tsx tools/probe-gap.ts                                 plants, lava, hard + medium, incomes 1..2.5
 *   npx tsx tools/probe-gap.ts --side zombies                  the zombie campaign's level 40
 *   npx tsx tools/probe-gap.ts --twist none|lava|fog|ice|rocks the lawn
 *   npx tsx tools/probe-gap.ts --skills hard --incomes 1.4,1.6 the computer's settings to try
 *   npx tsx tools/probe-gap.ts --base 3000                     the player's base health (default: balance)
 *   npx tsx tools/probe-gap.ts --blind lava                    the average player does not see the lava (or fog, ice):
 *                                                              a knowledge lever (rocks always refuse, so never hidden)
 *   npx tsx tools/probe-gap.ts --seeds 200 --first 1           seeds
 */

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import type { Skill } from '../src/ai/bot';
import { averageUpgrades, playLevel, summariseLevel } from '../src/ai/levelChecks';
import type { LevelPlayed } from '../src/ai/levelChecks';
import type { LevelStandIn } from '../src/ai/levelStandIns';
import type { LevelDef, LevelTwist } from '../src/adventure/types';
import { ALL_CARDS } from '../src/data/units';
import type { Bot } from '../src/ai/bot';
import type { Match } from '../src/sim/match';
import type { CardKey, Command, Faction } from '../src/sim/types';

type TwistName = 'none' | 'lava' | 'fog' | 'ice' | 'rocks';

/** The level-40 lawns: the twist used lightly on both flanks and fully in the middle. */
export const PROBE_TWISTS: Readonly<Record<TwistName, LevelTwist | undefined>> = {
  none: undefined,
  // Lava (lane*10+col): lane 1 col 3, lane 2 cols 4-5, lane 3 col 3.
  lava: { lavaTiles: [13, 24, 25, 33] },
  fog: { fog: true },
  ice: { iceLanes: [1, 3] },
  // Rocks (lane*8+col): lane 0 col 2, lane 2 cols 1 and 3, lane 4 col 2.
  rocks: { rocks: [2, 17, 19, 34] },
};

/** Campaign levels that unlock a card (worlds plan ruling 7, plus the Backyard's 3 and 6). */
export const UNLOCK_AT: readonly number[] = [3, 6, 11, 14, 19, 22, 27];

interface Setup { side: Faction; twist: TwistName; skill: Skill; income: number; base: number | null; blind: string[] }

/** The 39 levels before level 40 (only what the stand-in's save reads) and level 40 itself. */
export function probeLevels(s: Setup): { def: LevelDef; levels: LevelDef[] } {
  const prefix = s.side === 'plants' ? 'p' : 'z';
  const later = ALL_CARDS[s.side].slice(3);
  const stub = (i: number): LevelDef => {
    const world = (Math.floor((i - 1) / 8) + 1) as 1 | 2 | 3 | 4 | 5;
    const n = ((i - 1) % 8) + 1;
    const k = UNLOCK_AT.indexOf(i);
    return {
      id: `${prefix}${world}-${n}`, side: s.side, world, n, kind: 'battle', cards: [], opponent: null,
      waves: [], prepared: [], seconds: null, belt: null, boss: null, startEnergy: null, spells: true,
      unlocks: k < 0 ? null : (later[k] as CardKey), teaches: null,
    };
  };
  const enemy: Faction = s.side === 'plants' ? 'zombies' : 'plants';
  const twist = PROBE_TWISTS[s.twist];
  const def: LevelDef = {
    ...stub(40), cards: [...ALL_CARDS[s.side]],
    opponent: { skill: s.skill, cards: [...ALL_CARDS[enemy]], incomeScale: s.income },
    ...(twist === undefined ? {} : { twist }),
    ...(s.base === null ? {} : { baseHp: { [s.side]: s.base } }),
  };
  return { def, levels: [...Array.from({ length: 39 }, (_, k) => stub(k + 1)), def] };
}

interface Job { setup: Setup; who: LevelStandIn; first: number; seeds: number }

/**
 * The stand-in shown a lawn without the `blind` twists: his match's config has them off, while
 * the match itself (its `check`, its steps) still has them.
 */
function blindTo(blind: readonly string[]): (bot: Bot) => Bot {
  if (blind.length === 0) return (bot) => bot;
  return (bot) => ({
    faction: bot.faction,
    think(match: Match) {
      const s = match.state;
      const lawn = { ...s.config.lawn, ...(blind.includes('lava') ? { lava: null } : {}), ...(blind.includes('fog') ? { fog: null } : {}), ...(blind.includes('ice') ? { ice: null } : {}) };
      const seen = { state: { ...s, config: { ...s.config, lawn } }, balance: match.balance, check: (c: Command) => match.check(c) } as unknown as Match;
      return bot.think(seen);
    },
  });
}

function work(job: Job): LevelPlayed[] {
  const { def, levels } = probeLevels(job.setup);
  const wrap = job.who === 'average' ? blindTo(job.setup.blind) : (bot: Bot) => bot;
  const out: LevelPlayed[] = [];
  for (let seed = job.first; seed < job.first + job.seeds; seed++) out.push(playLevel(def, job.who, seed, undefined, levels, wrap));
  return out;
}

const CHUNK = 25;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const side = (arg('--side') ?? 'plants') as Faction;
  const twist = (arg('--twist') ?? 'lava') as TwistName;
  const skills = (arg('--skills') ?? 'medium,hard').split(',') as Skill[];
  const incomes = (arg('--incomes') ?? '1,1.25,1.5,1.75,2,2.5').split(',').map(Number);
  const who = (arg('--who') ?? 'average,expert').split(',') as LevelStandIn[];
  const base = arg('--base') === undefined ? null : Number(arg('--base'));
  const blind = arg('--blind')?.split(',') ?? [];
  const first = Number(arg('--first') ?? 1);
  const seeds = Number(arg('--seeds') ?? 200);
  if (!(twist in PROBE_TWISTS)) throw new Error(`no twist ${twist}`);
  const workers = Array.from({ length: 3 }, () => new Worker(new URL(import.meta.url), { execArgv: ['--import', 'tsx'] }));
  const idle = [...workers];
  const queue: Array<{ job: Job; done: (r: LevelPlayed[]) => void }> = [];
  const pump = (): void => {
    while (idle.length > 0 && queue.length > 0) {
      const w = idle.pop() as Worker;
      const { job, done } = queue.shift() as (typeof queue)[number];
      w.once('message', (r: LevelPlayed[]) => { idle.push(w); done(r); pump(); });
      w.postMessage(job);
    }
  };
  const run = (job: Job): Promise<LevelPlayed[]> => new Promise((done) => { queue.push({ job, done }); pump(); });
  const t0 = Date.now();
  const sample = probeLevels({ side, twist, skill: 'hard', income: 1, base, blind });
  const ups = averageUpgrades(sample.def, sample.levels);
  console.log(`probe: ${side} level 40, twist ${twist}, seeds ${first}..${first + seeds - 1}${base === null ? '' : `, base ${base}`}${blind.length === 0 ? '' : `, average blind to ${blind.join('+')}`}`);
  console.log(`average upgrades: ${Object.entries(ups).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('skill   income  avg win%  avg 3*%  avg min  exp win%  exp 3*%  exp min   gap');
  try {
    const setups = skills.flatMap((skill) => incomes.map((income) => ({ side, twist, skill, income, base, blind })));
    const all = await Promise.all(setups.map((setup) => Promise.all(who.map(async (w) => {
      const parts: Promise<LevelPlayed[]>[] = [];
      for (let a = 0; a < seeds; a += CHUNK) parts.push(run({ setup, who: w, first: first + a, seeds: Math.min(CHUNK, seeds - a) }));
      return summariseLevel((await Promise.all(parts)).flat());
    }))));
    setups.forEach((setup, i) => {
      const [a, e] = all[i] as ReturnType<typeof summariseLevel>[];
      const cell = (x: number | undefined, d = 1): string => (x === undefined ? '-' : x.toFixed(d)).padStart(8);
      console.log(`${setup.skill.padEnd(7)} ${setup.income.toFixed(2).padStart(6)}  ${cell(a?.win)} ${cell(a?.threeStars)} ${cell(a?.minutes, 2)}  ${cell(e?.win)} ${cell(e?.threeStars)} ${cell(e?.minutes, 2)} ${cell(a !== undefined && e !== undefined ? e.win - a.win : undefined)}`);
    });
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
    console.error(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
}

if (isMainThread) {
  void main();
} else {
  parentPort?.on('message', (job: Job) => parentPort?.postMessage(work(job)));
}
