import type { CardKey } from '../../sim/types';
import type { LevelDef } from '../types';
import { garden, regrow } from './helpers';
import type { Spawn } from '../types';

/**
 * The Frozen Tundra: the zombies' second world (`z2-*`), ice - zombies walk the icy lanes
 * (`twist.iceLanes`) ×1.6 as fast. Kinds, ideas, gardens and cards follow the content design's §1
 * table; the numbers (gardens, clocks, bases, incomes) are measured with `tools/levels.ts --world 2`
 * against the level stand-ins (step-2 plan Task 7 report). Short and forgiving: these are the
 * younger player's levels. Heroes on and spells on everywhere. Unlocks: Hot Topic after z2-3, the
 * Cowboy Zombie after z2-6.
 */

/** A level with nothing scripted; each entry below says only what differs. */
const base = (id: string, n: number): Omit<LevelDef, 'kind' | 'cards' | 'side'> => ({
  id, world: 2, n, opponent: null, waves: [], prepared: [], seconds: null, belt: null, boss: null,
  startEnergy: null, spells: true, unlocks: null, teaches: null,
});

const FIVE: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'];
const SIX: CardKey[] = [...FIVE, 'hotTopic'];
const SEVEN: CardKey[] = [...SIX, 'cowboyZombie'];

/** z2-5 and z2-6: the two outer lanes and the middle one are iced. */
const ICY_THREE = [0, 2, 4];

/**
 * z2-5's garden grows: a Peashooter every 12 s from 20 s, lanes 1, 3, 0, 4, 2 in turn, each round of
 * five on the next column of 1, 0, 4, 5 (20 new tiles, the last at 248 s). A 21st comes at 260 s on
 * lane 1, column 2, a tile the starting garden holds: it grows only where that first Peashooter has
 * been eaten (the sim skips a scripted plant whose tile is taken).
 */
const GROWING: Spawn[] = regrow('peashooter', Array.from({ length: 21 }, (_, i): [number, number, number] =>
  [20 + i * 12, [1, 3, 0, 4, 2][i % 5]!, [1, 0, 4, 5, 2][Math.floor(i / 5)]!]));

export const Z2: LevelDef[] = [
  {
    // The one idea: the shiny lane is fast - zombies sent there arrive first. No computer: three
    // Peashooters stand guard and two more grow every 40 s. The Peashooters shoot the zombie base
    // down any lane no zombie walks: a 7000 base keeps the third star for most who keep sending.
    ...base('z2-1', 1), side: 'zombies', kind: 'battle', cards: FIVE,
    baseHp: { plants: 5500, zombies: 7000 }, twist: { iceLanes: [2] },
    prepared: garden('peashooter', [[1, 3], [3, 3], [2, 4]]),
    waves: regrow('peashooter', [[40, 1, 2], [40, 3, 2], [80, 0, 3], [80, 4, 3], [120, 2, 2], [120, 1, 1], [160, 3, 1], [160, 2, 1]]),
  },
  {
    // The one idea: pick the icy lanes. The Easy computer with Peashooters, Sunflowers and Walnut
    // Bombs; a 3800 zombie base, so its Peashooters cost stars where no zombie keeps them busy.
    ...base('z2-2', 2), side: 'zombies', kind: 'battle', cards: FIVE,
    baseHp: { plants: 5000, zombies: 3800 }, twist: { iceLanes: [1, 3] },
    opponent: { skill: 'easy', cards: ['peashooter', 'sunflower', 'walnutBomb'], incomeScale: 1 },
  },
  {
    // The one idea: the icy lane gets you there before the peas do their work. A Walnut Bomb walls
    // each of lanes 0, 1, 3 and 4; the iced middle lane has two Peashooters and a wall. A 240 s
    // clock (three stars inside 2 minutes; 120 s made a level of under a minute) and a zombie base
    // the two Peashooters cannot shoot down before it runs out. Unlocks Hot Topic.
    ...base('z2-3', 3), side: 'zombies', kind: 'breakthrough', cards: FIVE,
    seconds: 240, baseHp: { plants: 5000, zombies: 14000 }, twist: { iceLanes: [2] },
    prepared: [
      ...garden('walnutBomb', [[0, 5], [1, 5], [3, 5], [4, 5]]),
      ...garden('peashooter', [[2, 1], [2, 2]]), ...garden('walnutBomb', [[2, 4]]),
    ],
    unlocks: 'hotTopic',
  },
  {
    // The one idea: Hot Topic grows by eating plants; send it where the plants are weak. The Easy
    // computer on ×1.25 income, now with Potato Mines; a 4000 zombie base.
    ...base('z2-4', 4), side: 'zombies', kind: 'battle', cards: SIX,
    baseHp: { plants: 5500, zombies: 4000 }, twist: { iceLanes: [1, 3] },
    opponent: { skill: 'easy', cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine'], incomeScale: 1.25 },
  },
  {
    // The one idea: the belt, plus choosing a fast lane. Three Peashooters at the start and one more
    // every 12 s (`GROWING`): the longer it takes, the more of them shoot the zombie base (9300), so
    // the fast lanes keep the stars. Break the 7000 base in 270 s (9000: the beginner needs 3.4 min).
    ...base('z2-5', 5), side: 'zombies', kind: 'conveyor',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'hotTopic'],
    belt: { everySeconds: 5, cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'hotTopic'] },
    seconds: 270, baseHp: { plants: 7000, zombies: 9300 }, twist: { iceLanes: ICY_THREE },
    prepared: garden('peashooter', [[1, 2], [3, 2], [2, 3]]),
    waves: GROWING,
  },
  {
    // The one idea: a cheap Walker first sets off the mines under the ice. Each icy lane has a
    // Potato Mine, a Peashooter and a Kernel-pult; each plain lane a single big (level 3) Walnut
    // Bomb - the lane with the fewest plants is the trap: a long chew and a blast that fells a
    // crowd. A 240 s clock, as z2-3. Unlocks the Cowboy Zombie.
    ...base('z2-6', 6), side: 'zombies', kind: 'breakthrough', cards: SIX,
    seconds: 240, baseHp: { plants: 3800, zombies: 14000 }, twist: { iceLanes: ICY_THREE },
    prepared: [
      ...garden('potatoMine', [[0, 6], [2, 6], [4, 6]]),
      ...garden('kernelPult', [[0, 1], [2, 1], [4, 1]]),
      ...garden('peashooter', [[0, 3], [2, 3], [4, 3]]),
      ...garden('walnutBomb', [[1, 5], [3, 5]], 3),
    ],
    unlocks: 'cowboyZombie',
  },
  {
    // The one idea: the Cowboy lassos the big plant; a Skeleton walks behind. The Medium computer on
    // ×0.45 income; a 4000 zombie base.
    ...base('z2-7', 7), side: 'zombies', kind: 'battle', cards: SEVEN,
    baseHp: { plants: 3000, zombies: 4000 }, twist: { iceLanes: [0, 1, 3, 4] },
    opponent: { skill: 'medium', cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'], incomeScale: 0.45 },
  },
  {
    // Boss: the Frost Melon guards the plant base across lanes 1-3, on the plain middle lane -
    // lobs frozen melons, grows Peashooters, ice plates at half health, then freezes two whole lanes.
    // An 11000 zombie base: the fight is long, and the garden shoots it all the while.
    ...base('z2-8', 8), side: 'zombies', kind: 'boss', cards: SEVEN,
    boss: { key: 'frostMelon', lane: 2 }, baseHp: { zombies: 11000 }, twist: { iceLanes: [0, 1, 3, 4] },
    prepared: [...garden('peashooter', [[0, 3], [4, 3], [1, 4], [3, 4]]), ...garden('kernelPult', [[0, 1], [4, 1]])],
  },
];
