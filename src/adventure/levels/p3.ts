import type { CardKey } from '../../sim/types';
import type { LevelDef, Spawn } from '../types';
import { flag, garden, rocks, trickle } from './helpers';

/**
 * The Desert Canyon: the plants' third world (`p3-*`), rocks. A plant cannot stand on a rock;
 * zombies and shots pass over it (the shots of the rocks' own lane too, so a Torchwood behind a rock
 * still lights the peas that fly over it). Kinds, rocks, ideas, opponents and cards follow the
 * content design's §1 Step 3 table; the numbers (waves, clocks, bases) are measured with
 * `tools/levels.ts --world 3` against the level stand-ins (step-3 plan Task 6 report). Heroes on and
 * spells on everywhere. Unlocks: the Torchwood after p3-3, the Cherry Bomber after p3-6.
 */

/** A level with nothing scripted; each entry below says only what differs. */
const base = (id: string, n: number): Omit<LevelDef, 'kind' | 'cards' | 'side'> => ({
  id, world: 3, n, opponent: null, waves: [], prepared: [], seconds: null, belt: null, boss: null,
  startEnergy: null, spells: true, unlocks: null, teaches: null,
});

const SEVEN: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker'];
const EIGHT: CardKey[] = [...SEVEN, 'torchwood'];
const NINE: CardKey[] = [...EIGHT, 'cherryBomber'];
const BELT: CardKey[] = ['peashooter', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult'];

/** The rocky back row (p3-2, p3-5): columns 0-1, one rock a lane. */
const BACK_ROW: [number, number][] = [[0, 1], [1, 0], [2, 1], [3, 0], [4, 1]];
/** The six rocks of p3-6 and p3-7. */
const SIX_ROCKS: [number, number][] = [[0, 1], [1, 0], [3, 0], [4, 1], [1, 5], [3, 5]];

/** A clump walking one lane: `be` Brain Eaters at once, `sw` Skeleton Warriors just behind. */
const clump = (at: number, lane: number, be = 3, sw = 1): Spawn[] => [
  ...flag('brainEater', at, Array(be).fill(lane) as number[]), ...flag('skeletonWarrior', at + 1.5, Array(sw).fill(lane) as number[]),
];

export const P3: LevelDef[] = [
  {
    // The one idea: a plant can't stand on a rock (the tap buzzes); zombies walk straight past it.
    // Three middle rocks, gentle (the pilot: middle rocks barely move the average).
    ...base('p3-1', 1), side: 'plants', kind: 'survive', cards: SEVEN,
    seconds: 150, baseHp: { plants: 3000 }, twist: { rocks: rocks([[1, 4], [2, 5], [3, 3]]) },
    waves: [
      ...trickle('brainEater', 20, 6, 14, [2, 1, 3]),
      ...trickle('desertZombie', 45, 12, 6, [2, 1, 3]),
      ...flag('brainEater', 105, [1, 2, 3]), ...flag('desertZombie', 107, [2, 1, 3]),
    ],
  },
  {
    // The one idea: the back row is rocky - Sunflowers go where the ground is free.
    ...base('p3-2', 2), side: 'plants', kind: 'battle', cards: SEVEN,
    baseHp: { zombies: 2200 }, twist: { rocks: rocks(BACK_ROW) },
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'], incomeScale: 0.70 },
  },
  {
    // The one idea: belt walls fill the gaps the rocks leave. Scripted waves in all five lanes; the
    // base falls to them unaided (an idle player loses, as p2-3). Unlocks the Torchwood.
    ...base('p3-3', 3), side: 'plants', kind: 'conveyor', cards: BELT,
    belt: { everySeconds: 5, cards: BELT },
    seconds: 150, baseHp: { plants: 3000 }, twist: { rocks: rocks([[0, 2], [1, 4], [3, 4], [4, 2]]) },
    waves: [
      ...trickle('brainEater', 15, 4, 21, [2, 0, 4, 1, 3]),
      ...trickle('desertZombie', 50, 12, 5, [1, 3, 0, 4]),
      ...flag('brainEater', 105, [0, 1, 2, 3, 4]), ...flag('brainEater', 109, [0, 1, 2, 3, 4]),
    ],
    unlocks: 'torchwood',
  },
  {
    // The one idea: a Torchwood in front of a Peashooter makes fire peas. The player's own
    // Peashooter stands at [2,1] (a head start for the glove, which puts the Torchwood at [2,2]).
    ...base('p3-4', 4), side: 'plants', kind: 'battle', cards: EIGHT,
    baseHp: { zombies: 2500 }, twist: { rocks: rocks([[0, 0], [1, 1], [3, 1], [4, 0], [2, 5]]) },
    prepared: garden('peashooter', [[2, 1]]),
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'hotTopic'], incomeScale: 0.73 },
  },
  {
    // The one idea: fire peas beat shields; a Torchwood behind a rock still lights peas that fly over it.
    ...base('p3-5', 5), side: 'plants', kind: 'survive', cards: EIGHT,
    seconds: 160, baseHp: { plants: 1750 }, twist: { rocks: rocks([...BACK_ROW, [2, 4]]) },
    waves: [
      ...trickle('brainEater', 20, 11, 8, [2, 1, 3, 0, 4]),
      ...trickle('hotTopic', 40, 25, 5, [1, 3, 2, 0, 4]),
      ...trickle('skeletonArcher', 45, 20, 3, [1, 3, 2, 0, 4]),
      ...flag('skeletonWarrior', 70, [1, 2, 3]),
      ...flag('skeletonWarrior', 115, [0, 1, 2, 3, 4]), ...flag('skeletonArcher', 117, [1, 3]),
    ],
  },
  {
    // The one idea: one fire lane per pair of lanes. Unlocks the Cherry Bomber.
    ...base('p3-6', 6), side: 'plants', kind: 'battle', cards: EIGHT,
    baseHp: { zombies: 2300 }, twist: { rocks: rocks(SIX_ROCKS) },
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie'], incomeScale: 0.66 },
    unlocks: 'cherryBomber',
  },
  {
    // The one idea: a Cherry Bomber on a clump. Clumps of Brain Eaters and Skeleton Warriors walk one
    // lane each at 40, 80, 120 and 150 s (the first down lane 2, where the glove's tile waits for it).
    ...base('p3-7', 7), side: 'plants', kind: 'survive', cards: NINE,
    seconds: 170, baseHp: { plants: 1600 }, twist: { rocks: rocks(SIX_ROCKS) },
    waves: [
      ...clump(40, 2, 4, 2), ...clump(80, 1, 4, 2), ...clump(120, 3, 4, 2), ...clump(150, 2, 4, 2),
      ...trickle('cowboyZombie', 25, 12, 12, [1, 3, 2, 0, 4]),
    ],
  },
  {
    // Boss: the Sand Pharaoh walks the middle lane; Very Fast Walkers trickle down the other lanes.
    // A 5300 base and 600 start energy, as p2-8.
    ...base('p3-8', 8), side: 'plants', kind: 'boss', cards: NINE,
    boss: { key: 'sandPharaoh', lane: 2 }, baseHp: { plants: 5300 }, startEnergy: 600,
    twist: { rocks: rocks([[2, 2], [2, 4], [0, 1], [4, 1], [1, 5], [3, 5]]) },
    waves: trickle('veryFastWalker', 30, 20, 8, [0, 4, 1, 3]),
  },
];
