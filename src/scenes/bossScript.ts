import { BALANCE, seconds } from '../data/balance';
import type { Balance, BossPattern } from '../data/balance';
import { rocks } from '../adventure/levels/helpers';
import { ALL_CARDS } from '../data/units';
import { Match, defaultConfig } from '../sim/match';
import { NO_TWIST } from '../sim/lawn';
import type { BossConfig, BossKey, LawnConfig, MatchConfig, PreparedUnit, ScriptEntry, StatusKind } from '../sim/types';

// The boss demo's match (`?scene=boss-demo`): a level in mode 'boss' where every pattern of the
// boss shows within a minute and the boss falls a little after, against a plain opponent made
// of prepared units and scripted waves (no computer, no player commands). No DOM, no Three.js:
// a test runs it too.
//
//   brainTitan  the plants' boss: a garden of Peashooters behind a wall of Walnuts on column 7,
//               which its first slam (12 s) lands on; plain Brain Eaters come down the outer lanes.
//   elderOak    the zombies' boss: waves of zombies down every lane (its acorns land on them,
//               its roots are bitten in lanes 0 and 4); a few plain Peashooters stand in front.
//   moonHowler  the plants' world-2 boss, in the Meadow's fog (reach 5): Peashooters planted
//               forward (columns 4 and 5, so they reach it) and Kernel-pults behind a Walnut wall
//               on column 7; Brain Eaters down the outer lanes.
//   frostMelon  the zombies' world-2 boss, on the Tundra's ice (lanes 0, 1, 3, 4, as at z2-8):
//               the Oak's waves of zombies.
//
//   sandPharaoh the plants' world-3 boss, in the Desert's rocks (as at p3-8): the Titan's garden (Peashooters,
//               a Walnut wall on column 7), Desert Zombies down the outer lanes.
//   cactusKing  the zombies' world-3 boss, with the rocks thinning its flanks (as at z3-8): the Oak's waves.
//
// The world-2 bosses fight with a demo table of their own (`demoBalance`): two phases and a strike
// (the Howler's blinding howl, the Melon's freeze) on a quick clock, so every show of theirs can be
// seen in a minute whatever `Balance.bosses` holds. The world-3 bosses fight their shipped numbers
// (every show of the Pharaoh is up by 62 s, the Cactus King's by 47 s), except that the Cactus King's
// phase 2 is reordered so its Walnuts show before it falls.

export const BOSS_DEMO: Record<BossKey, BossConfig> = {
  brainTitan: { key: 'brainTitan', faction: 'zombies', lane: 2 },
  elderOak: { key: 'elderOak', faction: 'plants', lane: 2 },
  moonHowler: { key: 'moonHowler', faction: 'zombies', lane: 2 },
  frostMelon: { key: 'frostMelon', faction: 'plants', lane: 2 },
  sandPharaoh: { key: 'sandPharaoh', faction: 'zombies', lane: 2 },
  cactusKing: { key: 'cactusKing', faction: 'plants', lane: 2 },
  // STUBS (worlds-4 plan Task 1); Task 2 writes their demos.
  yeti: { key: 'yeti', faction: 'zombies', lane: 2 },
  glowcap: { key: 'glowcap', faction: 'plants', lane: 2 },
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

function howlerLevel(): Pick<MatchConfig, 'prepared' | 'script'> {
  const prepared: PreparedUnit[] = [];
  for (const lane of [1, 2, 3]) prepared.push(plant('walnutBomb', lane, 7, 2));
  for (const lane of [1, 2, 3]) for (const col of [4, 5]) prepared.push(plant('peashooter', lane, col, 3));
  for (const lane of [1, 2, 3]) prepared.push(plant('kernelPult', lane, 3, 2));
  for (const lane of [0, 4]) prepared.push(plant('peashooter', lane, 4, 2), plant('sunflower', lane, 0));
  const script: ScriptEntry[] = [];
  for (let at = 4; at < 60; at += 9) script.push(zombie(at, 'brainEater', at % 2 === 0 ? 0 : 4));
  return { prepared, script };
}

function melonLevel(): Pick<MatchConfig, 'prepared' | 'script'> {
  const prepared: PreparedUnit[] = [plant('peashooter', 0, 3), plant('peashooter', 4, 3), plant('peashooter', 2, 5, 2)];
  const script: ScriptEntry[] = [];
  const kinds: ScriptEntry['unit'][] = ['brainEater', 'skeletonWarrior', 'brainEater', 'veryFastWalker', 'brainEater'];
  for (let wave = 0; wave < 12; wave++) {
    for (let lane = 0; lane < 5; lane++) {
      if ((wave + lane) % 2 === 1) continue;
      script.push(zombie(1 + wave * 5 + lane * 0.3, kinds[(wave + lane) % kinds.length] as ScriptEntry['unit'], lane, 2));
    }
  }
  return { prepared, script };
}

/** Each demo's lawn: the world-2 bosses fight in their own world's twist (the Meadow's fog, the Tundra's ice). */
const DEMO_LAWN: Record<BossKey, LawnConfig> = {
  brainTitan: NO_TWIST,
  elderOak: NO_TWIST,
  moonHowler: { ...NO_TWIST, fog: 5 },
  frostMelon: { ...NO_TWIST, ice: { lanes: [0, 1, 3, 4], speed: 1.6 } },
  // The rocks of p3-8 (two in its own lane, four round the garden) and of z3-8 (on its flanks).
  sandPharaoh: { ...NO_TWIST, rocks: rocks([[2, 2], [2, 4], [0, 1], [4, 1], [1, 5], [3, 5]]) },
  cactusKing: { ...NO_TWIST, rocks: rocks([[0, 2], [4, 2], [0, 5], [4, 5]]) },
  yeti: NO_TWIST,
  glowcap: NO_TWIST,
};

/** The demo's setup: mode 'boss' with `boss`, the plain opponent above, no energy to spend, sudden death off. */
export function bossDemoConfig(boss: BossKey, seed: number): MatchConfig {
  const level = boss === 'moonHowler' ? howlerLevel() : boss === 'frostMelon' ? melonLevel() : BOSS_DEMO[boss].faction === 'zombies' ? titanLevel() : oakLevel();
  return {
    ...defaultConfig(seed),
    mode: 'boss',
    boss: BOSS_DEMO[boss],
    lawn: DEMO_LAWN[boss],
    ...level,
    cards: { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] },
    heroes: { plants: false, zombies: false },
    spells: { plants: 0, zombies: 0 },
    suddenDeath: false,
  };
}

/** The demo's match; `balance` for a test-only boss (`strikeDemoBalance`), else the boss's own demo table (`demoBalance`). */
export function bossDemoMatch(boss: BossKey, seed: number, balance: Balance = demoBalance(boss)): Match {
  return new Match(bossDemoConfig(boss, seed), balance);
}

/**
 * The world-2 bosses' demo rows: two phases (the second after the shield at half health) and a
 * strike, on a quick clock. A scene's own table, not the shipped numbers (Task 4 writes those).
 *
 *   moonHowler  phase 1: claw slam (wind-up 1.5 s, first at 6.5–8 s), two pups; phase 2: the howl
 *               (one whole lane blinded for 4 s, wind-up 2 s), the slam, two Brain Eaters
 *   frostMelon  phase 1: a barrage of 3 frozen melons, two Peashooters; phase 2: the freeze (two
 *               whole lanes stunned for 2 s, wind-up 2.5 s), a barrage of 4, two Walnuts
 */
const DEMO_BOSSES: Partial<Record<BossKey, Balance['bosses'][BossKey]>> = {
  moonHowler: {
    ...(BALANCE.bosses.moonHowler as Balance['bosses'][BossKey]),
    hp: 5600,
    patterns: [
      { kind: 'slam', everySeconds: 8, windupSeconds: 1.5, damage: 350, sideDamage: 150, reach: 0.6 },
      { kind: 'summon', everySeconds: 5, unit: 'veryFastWalker', count: 2, level: 1 },
      { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 5, damageFactor: 1, bouncesStraight: true },
    ],
    phases: [
      [
        { kind: 'slam', everySeconds: 8, windupSeconds: 1.5, damage: 350, sideDamage: 150, reach: 0.6 },
        { kind: 'summon', everySeconds: 5, unit: 'veryFastWalker', count: 2, level: 1 },
      ],
      [
        { kind: 'strike', everySeconds: 7, windupSeconds: 2, target: 'lanes', count: 1, damage: 60, status: { kind: 'blind', seconds: 4 } },
        { kind: 'slam', everySeconds: 6, windupSeconds: 1.5, damage: 350, sideDamage: 150, reach: 0.6 },
        { kind: 'summon', everySeconds: 5, unit: 'brainEater', count: 2, level: 2 },
      ],
    ],
  },
  frostMelon: {
    ...(BALANCE.bosses.frostMelon as Balance['bosses'][BossKey]),
    hp: 7600,
    patterns: [
      { kind: 'barrage', everySeconds: 7, count: 3, damage: 200, splash: 0.75, speed: 5 },
      { kind: 'summon', everySeconds: 6, unit: 'peashooter', count: 2, level: 1, minCol: 1, maxCol: 4 },
      { kind: 'shield', everySeconds: 0, atHealth: [0.7], seconds: 8, damageFactor: 0.5, bouncesStraight: false },
    ],
    phases: [
      [
        { kind: 'barrage', everySeconds: 7, count: 3, damage: 200, splash: 0.75, speed: 5 },
        { kind: 'summon', everySeconds: 6, unit: 'peashooter', count: 2, level: 1, minCol: 1, maxCol: 4 },
      ],
      [
        { kind: 'strike', everySeconds: 3, windupSeconds: 2.5, target: 'lanes', count: 2, damage: 80, status: { kind: 'stun', seconds: 2 } },
        { kind: 'barrage', everySeconds: 4, count: 4, damage: 200, splash: 0.75, speed: 5 },
        { kind: 'summon', everySeconds: 4, unit: 'walnutBomb', count: 2, level: 1, minCol: 2, maxCol: 5 },
      ],
    ],
  },
};

/**
 * The Cactus King's shipped row with its phase 2 reordered so the Walnuts show before it falls at 47 s:
 * the rockfall, then its summon 3 s after the blow, then the barrage (each pattern waits its own
 * `everySeconds` after the one before).
 */
function cactusDemoRow(): Balance['bosses'][BossKey] {
  const row = structuredClone(BALANCE.bosses.cactusKing) as Balance['bosses'][BossKey];
  const phase2 = row.phases?.[1];
  if (row.phases !== undefined && phase2 !== undefined) {
    const sooner = phase2.map((p) => (p.kind === 'summon' ? { ...p, everySeconds: 3 } : p));
    row.phases = [row.phases[0] as readonly BossPattern[], [...sooner.filter((p) => p.kind !== 'barrage'), ...sooner.filter((p) => p.kind === 'barrage')]];
  }
  return row;
}

/** The table the demo of `boss` fights with: the shipped one, with a world-2 boss's demo row in it. */
export function demoBalance(boss: BossKey): Balance {
  const row = boss === 'cactusKing' ? cactusDemoRow() : DEMO_BOSSES[boss];
  if (row === undefined) return BALANCE as Balance;
  const b = structuredClone(BALANCE) as Balance;
  b.bosses[boss] = structuredClone(row);
  return b;
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
