import { BALANCE, seconds } from '../data/balance';
import type { Balance, BossPattern } from '../data/balance';
import { ALL_CARDS } from '../data/units';
import { Match, defaultConfig } from '../sim/match';
import type { BossConfig, BossKey, MatchConfig, PreparedUnit, ScriptEntry, StatusKind } from '../sim/types';

// The boss demo's match (`?scene=boss-demo`): a level in mode 'boss' where every pattern of the
// boss shows within a minute and the boss falls a little after, against a plain opponent made
// of prepared units and scripted waves (no computer, no player commands). No DOM, no Three.js:
// a test runs it too.
//
//   brainTitan  the plants' boss: a garden of Peashooters behind a wall of Walnuts on column 7,
//               which its first slam (12 s) lands on; plain Brain Eaters come down the outer lanes.
//   elderOak    the zombies' boss: waves of zombies down every lane (its acorns land on them,
//               its roots are bitten in lanes 0 and 4); a few plain Peashooters stand in front.

export const BOSS_DEMO: Record<BossKey, BossConfig> = {
  brainTitan: { key: 'brainTitan', faction: 'zombies', lane: 2 },
  elderOak: { key: 'elderOak', faction: 'plants', lane: 2 },
};

const plant = (unit: PreparedUnit['unit'], lane: number, col: number, level = 1): PreparedUnit =>
  ({ unit, faction: 'plants', lane, x: col + 0.5, level });
const zombie = (at: number, unit: ScriptEntry['unit'], lane: number, level = 1): ScriptEntry =>
  ({ tick: seconds(at), unit, faction: 'zombies', lane, level });

function titanLevel(): Pick<MatchConfig, 'prepared' | 'script'> {
  const prepared: PreparedUnit[] = [];
  for (const lane of [1, 2, 3]) prepared.push(plant('walnutBomb', lane, 7, 2));
  for (const lane of [1, 2, 3]) for (const col of [1, 3]) prepared.push(plant('peashooter', lane, col, 3));
  for (const lane of [0, 4]) prepared.push(plant('peashooter', lane, 2, 2), plant('sunflower', lane, 0));
  const script: ScriptEntry[] = [];
  for (let at = 4; at < 60; at += 9) script.push(zombie(at, 'brainEater', at % 2 === 0 ? 0 : 4));
  return { prepared, script };
}

function oakLevel(): Pick<MatchConfig, 'prepared' | 'script'> {
  const prepared: PreparedUnit[] = [plant('peashooter', 0, 3), plant('peashooter', 4, 3), plant('peashooter', 2, 5, 2)];
  const script: ScriptEntry[] = [];
  const kinds: ScriptEntry['unit'][] = ['brainEater', 'skeletonWarrior', 'brainEater', 'veryFastWalker', 'brainEater'];
  for (let wave = 0; wave < 14; wave++) {
    for (let lane = 0; lane < 5; lane++) {
      if ((wave + lane) % 2 === 1) continue;
      script.push(zombie(1 + wave * 4 + lane * 0.3, kinds[(wave + lane) % kinds.length] as ScriptEntry['unit'], lane, 3));
    }
  }
  return { prepared, script };
}

/** The demo's setup: mode 'boss' with `boss`, the plain opponent above, no energy to spend, sudden death off. */
export function bossDemoConfig(boss: BossKey, seed: number): MatchConfig {
  const level = boss === 'brainTitan' ? titanLevel() : oakLevel();
  return {
    ...defaultConfig(seed),
    mode: 'boss',
    boss: BOSS_DEMO[boss],
    ...level,
    cards: { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] },
    heroes: { plants: false, zombies: false },
    spells: { plants: 0, zombies: 0 },
    suddenDeath: false,
  };
}

/** The demo's match; `balance` for a test-only boss (`strikeDemoBalance`). */
export function bossDemoMatch(boss: BossKey, seed: number, balance: Balance = BALANCE as Balance): Match {
  return new Match(bossDemoConfig(boss, seed), balance);
}

/** The statuses the strike demo can show (`&strike=`), 'none' for a plain blow. */
export const STRIKE_DEMOS: readonly (StatusKind | 'none')[] = ['stun', 'blind', 'burn', 'none'];

/**
 * A test-only boss for the demo (`&strike=<status>`, no shipped boss strikes): the Brain Titan with
 * two strikes leaving `status` in front of its own patterns: first four tiles where plants stand
 * (wind-up from 3 s, the blow at 5 s), then one whole lane (wind-up from 9 s, the blow at 11 s).
 * The shipped table (`Balance.bosses`) is not touched: this returns a copy.
 */
export function strikeDemoBalance(status: StatusKind | 'none'): Balance {
  const b = structuredClone(BALANCE) as Balance;
  const leaves = status === 'none' ? undefined
    : status === 'burn' ? { kind: status, seconds: 3, dps: 15 }
      : { kind: status, seconds: status === 'stun' ? 1.5 : 3 };
  const strike = (target: 'tiles' | 'lanes', count: number, everySeconds: number): BossPattern =>
    ({ kind: 'strike', everySeconds, windupSeconds: 2, target, count, damage: 60, ...(leaves ? { status: leaves } : {}) });
  const titan = b.bosses.brainTitan;
  b.bosses.brainTitan = { ...titan, patterns: [strike('tiles', 4, 5), strike('lanes', 1, 6), ...titan.patterns] };
  return b;
}
