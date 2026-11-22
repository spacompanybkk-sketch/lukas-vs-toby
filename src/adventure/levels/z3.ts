import type { CardKey } from '../../sim/types';
import { PLANT_COLS } from '../../sim/types';
import type { LevelDef, Spawn } from '../types';
import { garden, regrow, rocks } from './helpers';

/**
 * The Desert Canyon: the zombies' third world (`z3-*`), rocks. On a zombie level the rocks stand in
 * the computer's garden, so they help Toby: a plant cannot grow on a rock and the rocky lanes hold
 * fewer plants - "go where the rocks are". Kinds, rocks, ideas, gardens and cards follow the content
 * design's §1 Step 3 table; the numbers (computer incomes, clocks, bases) are measured with
 * `tools/levels.ts --world 3` against the level stand-ins (step-3 plan Task 7 report). Short and
 * forgiving: these are the younger player's levels. Heroes on and spells on everywhere. Unlocks:
 * the Necromancer after z3-3, the Trident Zombie after z3-6.
 */

/** A level with nothing scripted; each entry below says only what differs. */
const base = (id: string, n: number): Omit<LevelDef, 'kind' | 'cards' | 'side'> => ({
  id, world: 3, n, opponent: null, waves: [], prepared: [], seconds: null, belt: null, boss: null,
  startEnergy: null, spells: true, unlocks: null, teaches: null,
});

const SEVEN: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie'];
const EIGHT: CardKey[] = [...SEVEN, 'necromancer'];
const NINE: CardKey[] = [...EIGHT, 'tridentZombie'];
const BELT: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'hotTopic', 'necromancer'];

/** The computer's cards: the first five plants (z3-2), + Mango Pult (z3-4), + Avocado Bunker (z3-7). */
const FIVE_PLANTS: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'];
const SIX_PLANTS: CardKey[] = [...FIVE_PLANTS, 'mangoPult'];
const SEVEN_PLANTS: CardKey[] = [...SIX_PLANTS, 'avocadoBunker'];

/** The plants' rocky back row (z3-2, as p3-2) and z3-4/z3-7's rocks. */
const BACK_ROW: [number, number][] = [[0, 1], [1, 0], [2, 1], [3, 0], [4, 1]];
const BACK_ROW_PLUS: [number, number][] = [...BACK_ROW, [2, 6]];

/** z3-5's rocks, and its starting garden. */
const BELT_ROCKS: [number, number][] = [[0, 1], [1, 3], [2, 0], [3, 3], [4, 1], [2, 5]];
const BELT_GARDEN: [number, number][] = [[1, 2], [3, 2], [2, 3]];

/**
 * z3-5's garden grows: a Peashooter every 12 s from 20 s on the next free non-rock tile - lanes 1, 3,
 * 0, 4, 2 in turn, the columns 1, 0, 4, 5, 2, 3, 6, 7 in turn, skipping a rock or a tile already
 * taken: 20 new tiles, the last at 248 s (the clock is 270 s).
 */
function growing(): Spawn[] {
  const taken = new Set([...BELT_ROCKS, ...BELT_GARDEN].map(([lane, col]) => lane * PLANT_COLS + col));
  const free: [number, number][] = [];
  for (const lane of [1, 3, 0, 4, 2]) {
    for (const col of [1, 0, 4, 5, 2, 3, 6, 7]) if (!taken.has(lane * PLANT_COLS + col)) free.push([lane, col]);
  }
  return regrow('peashooter', free.slice(0, 20).map(([lane, col], i): [number, number, number] => [20 + i * 12, lane, col]));
}

export const Z3: LevelDef[] = [
  {
    // The one idea: plants can't grow on rocks, so the rocky lanes (0 and 4) are thin - send zombies
    // there. No computer: Peashooters stand at [1,3] [2,3] [3,3] [2,4] and one at [0,2] and [4,2]; the
    // garden regrows every 40 s in lanes 1-3 only.
    ...base('z3-1', 1), side: 'zombies', kind: 'battle', cards: SEVEN,
    baseHp: { plants: 8000, zombies: 4400 }, twist: { rocks: rocks([[0, 1], [0, 3], [4, 1], [4, 3]]) },
    prepared: garden('peashooter', [[1, 3], [2, 3], [3, 3], [2, 4], [0, 2], [4, 2]]),
    waves: regrow('peashooter', [[40, 1, 2], [80, 3, 2], [120, 2, 2], [160, 1, 4], [200, 3, 4], [240, 2, 1]]),
  },
  {
    // The one idea: the plants' back row is rocky, so they have few Sunflowers. The Easy computer
    // on x2.0 (the pilot: rocks are a gift, the beginner still wins 91.5).
    ...base('z3-2', 2), side: 'zombies', kind: 'battle', cards: SEVEN,
    baseHp: { plants: 5000, zombies: 3800 }, twist: { rocks: rocks(BACK_ROW) },
    opponent: { skill: 'easy', cards: FIVE_PLANTS, incomeScale: 2.0 },
  },
  {
    // The one idea: a rock where a wall should stand leaves a hole - push the lane with the hole.
    // Unlocks the Necromancer.
    ...base('z3-3', 3), side: 'zombies', kind: 'breakthrough', cards: SEVEN,
    seconds: 275, baseHp: { plants: 7500, zombies: 14000 }, twist: { rocks: rocks([[1, 5], [3, 5], [1, 2], [3, 2]]) },
    prepared: [
      ...garden('walnutBomb', [[0, 5], [2, 5], [4, 5]]),
      ...garden('peashooter', [[0, 2], [2, 2], [4, 2], [1, 1], [3, 1]]),
      ...garden('kernelPult', [[2, 0]]),
    ],
    unlocks: 'necromancer',
  },
  {
    // The one idea: the Necromancer stays back and mends; its Bone Minions walk in front. Easy x1.8.
    ...base('z3-4', 4), side: 'zombies', kind: 'battle', cards: EIGHT,
    baseHp: { plants: 5000, zombies: 4000 }, twist: { rocks: rocks(BACK_ROW_PLUS) },
    opponent: { skill: 'easy', cards: SIX_PLANTS, incomeScale: 1.8 },
  },
  {
    // The one idea: the belt, and the garden can't grow on rocks. Three Peashooters at the start and
    // one more every 12 s (`growing`).
    ...base('z3-5', 5), side: 'zombies', kind: 'conveyor', cards: BELT,
    belt: { everySeconds: 5, cards: BELT },
    seconds: 270, baseHp: { plants: 20000, zombies: 15500 }, twist: { rocks: rocks(BELT_ROCKS) },
    prepared: garden('peashooter', BELT_GARDEN),
    waves: growing(),
  },
  {
    // The one idea: a Skeleton in front and a Necromancer behind - the pair outlasts a Bunker. An
    // Avocado Bunker with a Peashooter behind it in lanes 1 and 3; mines at [0,5] and [4,5] (the thin
    // flank is the trap); a Kernel-pult at [2,1]. Unlocks the Trident Zombie.
    ...base('z3-6', 6), side: 'zombies', kind: 'breakthrough', cards: EIGHT,
    seconds: 255, baseHp: { plants: 7200, zombies: 14000 },
    twist: { rocks: rocks([[0, 4], [4, 4], [1, 1], [3, 1], [0, 6], [4, 6]]) },
    prepared: [
      ...garden('avocadoBunker', [[1, 5], [3, 5]]),
      ...garden('peashooter', [[1, 4], [3, 4]]),
      ...garden('potatoMine', [[0, 5], [4, 5]]),
      ...garden('kernelPult', [[2, 1]]),
    ],
    unlocks: 'tridentZombie',
  },
  {
    // The one idea: the Trident's throw pierces three plants in a row. Easy x2.2.
    ...base('z3-7', 7), side: 'zombies', kind: 'battle', cards: NINE,
    baseHp: { plants: 4000, zombies: 4000 }, twist: { rocks: rocks(BACK_ROW_PLUS) },
    opponent: { skill: 'easy', cards: SEVEN_PLANTS, incomeScale: 2.5 },
  },
  {
    // Boss: the Cactus King guards the plant base across lanes 1-3, on the middle lane - rocks stand
    // only in lanes 0 and 4, none under the boss's col 0. Prepared Kernel-pults and Peashooters.
    ...base('z3-8', 8), side: 'zombies', kind: 'boss', cards: NINE,
    boss: { key: 'cactusKing', lane: 2 }, baseHp: { zombies: 11000 },
    twist: { rocks: rocks([[0, 2], [4, 2], [0, 5], [4, 5]]) },
    prepared: [...garden('kernelPult', [[0, 1], [4, 1]]), ...garden('peashooter', [[1, 4], [3, 4]])],
  },
];
