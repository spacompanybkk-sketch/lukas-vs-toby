import type { CardKey } from '../../sim/types';
import type { LevelDef, Spawn } from '../types';
import { garden, growing, regrow } from './helpers';

/**
 * The Moonlit Meadow: the zombies' fourth world (`z4-*`), fog. The plants can only shoot as far as
 * the fog reaches (7, 7, 6, 6, 5, 5, 5, 5 tiles), so a zombie walks safe in the mist until it is
 * close; Archers, Tridents and Brain Rot must walk closer too. Kinds, fog, ideas, gardens and cards
 * follow the content design's §1 Step 4 table; the numbers (computer incomes, clocks, bases, the
 * Glowcap's hp) are measured with `tools/levels.ts --world 4` against the level stand-ins
 * (worlds-4 plan Task 7 report). Short and forgiving: these are the younger player's levels.
 * Heroes on and spells on everywhere. Unlocks: Brain Rot after z4-3.
 */

/** A level with nothing scripted; each entry below says only what differs. */
const base = (id: string, n: number): Omit<LevelDef, 'kind' | 'cards' | 'side'> => ({
  id, world: 4, n, opponent: null, waves: [], prepared: [], seconds: null, belt: null, boss: null,
  startEnergy: null, spells: true, unlocks: null, teaches: null,
});

const NINE: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie'];
const TEN: CardKey[] = [...NINE, 'brainRot'];
/** BE VFW SW HT N BR. */
const BELT: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'hotTopic', 'necromancer', 'brainRot'];

/** The computer's cards: P S W M K Mg Av T (z4-2), + Cherry Bomber (z4-4), the nine (z4-7). */
const EIGHT_PLANTS: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood'];
const NINE_PLANTS: CardKey[] = [...EIGHT_PLANTS, 'cherryBomber'];

/** z4-5's starting garden (as z3-5's), and its growth order: lanes 1, 3, 0, 4, 2; columns 1, 0, 4, 5, 2, 3, 6, 7. */
const BELT_GARDEN: [number, number][] = [[1, 2], [3, 2], [2, 3]];

/**
 * z4-5's garden grows as z3-5's does, without rocks: a Peashooter every 12 s from 20 s on the next
 * free tile, never one the garden already holds (20 new tiles, the last at 248 s; the clock is 270 s).
 */
const growingGarden = (): Spawn[] =>
  growing('peashooter', BELT_GARDEN, [1, 3, 0, 4, 2], [1, 0, 4, 5, 2, 3, 6, 7]);

export const Z4: LevelDef[] = [
  {
    // The one idea: in the mist the plants can't shoot far - sneak close. No computer: Peashooters at
    // [1,1] [2,1] [3,1] [2,2], and the garden regrows every 40 s in columns 0-2.
    ...base('z4-1', 1), side: 'zombies', kind: 'battle', cards: NINE,
    baseHp: { plants: 5500, zombies: 7000 }, twist: { fog: 7 },
    prepared: garden('peashooter', [[1, 1], [2, 1], [3, 1], [2, 2]]),
    waves: regrow('peashooter', [[40, 1, 2], [80, 3, 2], [120, 2, 0], [160, 1, 0], [200, 3, 0], [240, 0, 1]]),
  },
  {
    // The one idea: Archers and Tridents have to walk closer too. The Easy computer on x1.8.
    ...base('z4-2', 2), side: 'zombies', kind: 'battle', cards: NINE,
    baseHp: { plants: 5000, zombies: 3800 }, twist: { fog: 7 },
    opponent: { skill: 'easy', cards: EIGHT_PLANTS, incomeScale: 1.8 },
  },
  {
    // The one idea: shooters at the back can't reach the front plants - eat the front first. A Walnut
    // Bomb at column 6 in every lane, Peashooters and Kernel-pults at columns 0-1. Unlocks Brain Rot.
    ...base('z4-3', 3), side: 'zombies', kind: 'breakthrough', cards: NINE,
    seconds: 240, baseHp: { plants: 5000, zombies: 14000 }, twist: { fog: 6 },
    prepared: [
      ...garden('walnutBomb', [[0, 6], [1, 6], [2, 6], [3, 6], [4, 6]]),
      ...garden('peashooter', [[0, 1], [1, 1], [3, 1], [4, 1]]),
      ...garden('kernelPult', [[2, 0], [1, 0], [3, 0]]),
    ],
    unlocks: 'brainRot',
  },
  {
    // The one idea: Brain Rot leaves poison puddles under the plants. The Easy computer on x1.8, now
    // with the Cherry Bomber.
    ...base('z4-4', 4), side: 'zombies', kind: 'battle', cards: TEN,
    baseHp: { plants: 5000, zombies: 4000 }, twist: { fog: 6 },
    opponent: { skill: 'easy', cards: [...EIGHT_PLANTS, 'cherryBomber'], incomeScale: 1.8 },
  },
  {
    // The one idea: the belt in the mist. Three Peashooters at the start and one more every 12 s.
    ...base('z4-5', 5), side: 'zombies', kind: 'conveyor', cards: BELT,
    belt: { everySeconds: 5, cards: BELT },
    seconds: 270, baseHp: { plants: 7000, zombies: 9300 }, twist: { fog: 5 },
    prepared: garden('peashooter', BELT_GARDEN),
    waves: growingGarden(),
  },
  {
    // The one idea: the Necromancer heals the pack, and Brain Rot melts the Kernel-pults. An Avocado
    // Bunker at column 5 in lanes 1-3 with a Kernel-pult behind it; mines in lanes 0 and 4.
    ...base('z4-6', 6), side: 'zombies', kind: 'breakthrough', cards: TEN,
    seconds: 240, baseHp: { plants: 4000, zombies: 14000 }, twist: { fog: 5 },
    prepared: [
      ...garden('avocadoBunker', [[1, 5], [2, 5], [3, 5]]),
      ...garden('kernelPult', [[1, 3], [2, 3], [3, 3]]),
      ...garden('potatoMine', [[0, 5], [4, 5]]),
    ],
  },
  {
    // The one idea: everything at once. The Easy computer on x2.0 with every plant card but the Squash.
    ...base('z4-7', 7), side: 'zombies', kind: 'battle', cards: TEN,
    baseHp: { plants: 4000, zombies: 4000 }, twist: { fog: 5 },
    opponent: { skill: 'easy', cards: NINE_PLANTS, incomeScale: 2.0 },
  },
  {
    // Boss: the Glowcap guards the plant base across lanes 1-3, on the middle lane. Prepared
    // Peashooters at [0,3] [4,3] and Kernel-pults at [1,1] [3,1].
    ...base('z4-8', 8), side: 'zombies', kind: 'boss', cards: TEN,
    boss: { key: 'glowcap', lane: 2 }, baseHp: { zombies: 11000 }, twist: { fog: 5 },
    prepared: [...garden('peashooter', [[0, 3], [4, 3]]), ...garden('kernelPult', [[1, 1], [3, 1]])],
  },
];
