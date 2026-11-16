import type { CardKey } from '../../sim/types';
import type { LevelDef } from '../types';
import { flag, trickle } from './helpers';

/**
 * The Moonlit Meadow: the plants' second world (`p2-*`), fog - every shot reaches only so many
 * tiles (`twist.fog`: 7, 7, 6, 6, 5, 5, 5, 5). Kinds, ideas, opponents and cards follow the content
 * design's §1 table; the numbers (waves, clocks, bases, incomes) are measured with
 * `tools/levels.ts --world 2` against the level stand-ins (step-2 plan Task 6 report). Heroes on and
 * spells on everywhere. Unlocks: the Mango-pult after p2-3, the Avocado Bunker after p2-6.
 */

/** A level with nothing scripted; each entry below says only what differs. */
const base = (id: string, n: number): Omit<LevelDef, 'kind' | 'cards' | 'side'> => ({
  id, world: 2, n, opponent: null, waves: [], prepared: [], seconds: null, belt: null, boss: null,
  startEnergy: null, spells: true, unlocks: null, teaches: null,
});

const FIVE: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'];
const SIX: CardKey[] = [...FIVE, 'mangoPult'];
const SEVEN: CardKey[] = [...SIX, 'avocadoBunker'];

export const P2: LevelDef[] = [
  {
    // The one idea: peas fly only 7 tiles in the mist, so shooters go further forward. Brain Eaters
    // trickle down lanes 1-3 from 20 s; a flag of Brain Eaters and Desert Zombies near the end.
    ...base('p2-1', 1), side: 'plants', kind: 'survive', cards: FIVE,
    // Clock 150 s (100 s gave a 1.67 min median, under the
    // 2.5 min target) and the flag at 130 s; an idle player loses, the beginner wins ~84%.
    seconds: 150, baseHp: { plants: 3500 }, twist: { fog: 7 },
    waves: [
      ...trickle('brainEater', 20, 7, 15, [2, 1, 3]),
      ...flag('brainEater', 130, [1, 2, 3]), ...flag('desertZombie', 132, [2, 1, 3]),
    ],
  },
  {
    // The one idea: to hit the zombie base a shooter must stand at column 3 or further. The Easy
    // computer on ×0.7 income, a small zombie base (800: the beginner, whose shooters stand in
    // columns 0-3, breaks it in under 4 minutes).
    ...base('p2-2', 2), side: 'plants', kind: 'battle', cards: FIVE,
    baseHp: { zombies: 800 }, twist: { fog: 7 },
    opponent: { skill: 'easy', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'], incomeScale: 0.7 },
  },
  {
    // The one idea: belt cards - walls in front of forward shooters. Scripted waves in all five
    // lanes; the base falls to them unaided (an idle player loses, as p1-5). Unlocks the Mango-pult.
    ...base('p2-3', 3), side: 'plants', kind: 'conveyor', cards: ['peashooter', 'walnutBomb', 'potatoMine', 'kernelPult'],
    belt: { everySeconds: 5, cards: ['peashooter', 'walnutBomb', 'potatoMine', 'kernelPult'] },
    // A 150 s belt (120 s: a 2-minute level, under the 2.5-minute target).
    seconds: 150, baseHp: { plants: 4500 }, twist: { fog: 6 },
    waves: [
      ...trickle('brainEater', 15, 6, 19, [2, 0, 4, 1, 3]),
      ...trickle('desertZombie', 50, 15, 6, [1, 3, 0, 4]),
      ...flag('brainEater', 120, [0, 1, 2, 3, 4]),
    ],
    unlocks: 'mangoPult',
  },
  {
    // The one idea: the Mango-pult's splash on clumps of zombies. The Medium computer on ×0.35 income,
    // now with Skeleton Archers. Fog battles drag (content design §7.2), so: a small zombie base (800,
    // a shooter forward enough to reach it ends the match) and 400 start energy (a quick first line;
    // the default 190 left 11% of the average player's matches running into sudden death).
    ...base('p2-4', 4), side: 'plants', kind: 'battle', cards: SIX,
    baseHp: { zombies: 800 }, twist: { fog: 6 }, startEnergy: 400,
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'], incomeScale: 0.35 },
  },
  {
    // The one idea: shields stop peas, lob over them. Flags of Skeleton Warriors at 70 s and 130 s
    // with Skeleton Archers mixed in (their range is capped at 5 by the fog too).
    ...base('p2-5', 5), side: 'plants', kind: 'survive', cards: SIX,
    seconds: 150, baseHp: { plants: 4700 }, twist: { fog: 5 },
    waves: [
      ...trickle('brainEater', 20, 11, 10, [2, 1, 3, 0, 4]),
      ...trickle('skeletonArcher', 45, 20, 3, [1, 3, 2, 0, 4]),
      ...flag('skeletonWarrior', 70, [1, 2, 3]),
      ...flag('skeletonWarrior', 130, [0, 1, 2, 3, 4]),
    ],
  },
  {
    // The one idea: guard your forward shooters with a wall. The Medium computer on ×0.25, now with
    // Hot Topics; a small zombie base and 400 start energy as p2-4. Unlocks the Avocado Bunker.
    ...base('p2-6', 6), side: 'plants', kind: 'battle', cards: SIX,
    baseHp: { zombies: 800 }, twist: { fog: 5 }, startEnergy: 400,
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'hotTopic'], incomeScale: 0.25 },
    unlocks: 'avocadoBunker',
  },
  {
    // The one idea: a bunker holds the line while the lassos fly. Desert Zombies and Cowboy Zombies
    // trickle in; a flag at 150 s.
    ...base('p2-7', 7), side: 'plants', kind: 'survive', cards: SEVEN,
    seconds: 170, baseHp: { plants: 4000 }, twist: { fog: 5 },
    waves: [
      ...trickle('desertZombie', 20, 10, 13, [2, 1, 3, 0, 4]),
      ...trickle('cowboyZombie', 40, 20, 6, [1, 3, 2, 4, 0]),
      ...flag('brainEater', 150, [0, 1, 2, 3, 4]), ...flag('cowboyZombie', 152, [1, 3]),
    ],
  },
  {
    // Boss: the Moon Howler walks the middle lane - its moon dome bounces peas, pults still hurt it;
    // its howl blinds a lane. Very Fast Walker "pups" trickle down the other lanes. A 5300 base, so
    // the base's own strikes do not fell the Howler before it falls (an idle player loses), and 600
    // start energy (what a player who plays gets and an idle one does not use).
    ...base('p2-8', 8), side: 'plants', kind: 'boss', cards: SEVEN,
    boss: { key: 'moonHowler', lane: 2 }, baseHp: { plants: 5300 }, twist: { fog: 5 }, startEnergy: 600,
    waves: trickle('veryFastWalker', 30, 20, 8, [0, 4, 1, 3]),
  },
];
