import type { CardKey } from '../../sim/types';
import type { LevelDef } from '../types';
import { flag, trickle } from './helpers';

/**
 * The Frozen Tundra: the plants' fourth world (`p4-*`), ice. Whatever walks an icy lane
 * (`twist.iceLanes`) comes ×1.6 as fast, so the icy lane is defended first and further forward.
 * Kinds, ice lanes, ideas, opponents and cards follow the content design's §1 Step 4 table; the
 * numbers (waves, clocks, bases, incomes) are measured with `tools/levels.ts --world 4` against the
 * level stand-ins (worlds-4 plan Task 6 report). Heroes on and spells on everywhere. Unlocks: the
 * Pumpkin Squash after p4-3. From p4-4 on the average player's win band is a recorded miss (plan
 * ruling 1): those levels are tuned to the lowest average win the expert floor allows.
 */

/** A level with nothing scripted; each entry below says only what differs. */
const base = (id: string, n: number): Omit<LevelDef, 'kind' | 'cards' | 'side'> => ({
  id, world: 4, n, opponent: null, waves: [], prepared: [], seconds: null, belt: null, boss: null,
  startEnergy: null, spells: true, unlocks: null, teaches: null,
});

const NINE: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber'];
const TEN: CardKey[] = [...NINE, 'pumpkinSquash'];
/** P W M K T: Peashooter, Walnut Bomb, Potato Mine, Kernel-pult, Torchwood. */
const BELT: CardKey[] = ['peashooter', 'walnutBomb', 'potatoMine', 'kernelPult', 'torchwood'];

export const P4: LevelDef[] = [
  {
    // The one idea: zombies slide fast on the shiny lane, so guard it first. Brain Eaters and Very Fast
    // Walkers trickle in, half of them down the iced lane 2; a flag at 105 s. The Brain Eaters thin out
    // for the first minute and then come every 3.5 s (a ramp keeps the beginner past 1.5 min and still
    // separates the expert from the average player; a flat trickle did not).
    ...base('p4-1', 1), side: 'plants', kind: 'survive', cards: NINE,
    seconds: 150, baseHp: { plants: 3700 }, twist: { iceLanes: [2] },
    waves: [
      ...trickle('brainEater', 20, 8, 5, [2, 1, 2, 3]),
      ...trickle('brainEater', 60, 3.5, 25, [2, 1, 2, 3]),
      ...trickle('veryFastWalker', 40, 14, 7, [2, 3, 2, 1]),
      ...flag('brainEater', 105, [1, 2, 3]), ...flag('veryFastWalker', 107, [2, 2, 3]),
    ],
  },
  {
    // The one idea: a Potato Mine on the ice catches a slider.
    ...base('p4-2', 2), side: 'plants', kind: 'battle', cards: NINE,
    baseHp: { zombies: 2400 }, twist: { iceLanes: [1, 3] },
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'hotTopic'], incomeScale: 0.64 },
  },
  {
    // The one idea: belt cards go to the fast lanes first. Scripted waves in all five lanes, the iced
    // lanes (0 and 4) busier; the base falls to them unaided. Unlocks the Pumpkin Squash. A belt is played
    // alike by the average player and the expert, so the average win stays near the expert's (a recorded miss).
    ...base('p4-3', 3), side: 'plants', kind: 'conveyor', cards: BELT,
    belt: { everySeconds: 5, cards: BELT },
    seconds: 150, baseHp: { plants: 6250 }, twist: { iceLanes: [0, 4] },
    waves: [
      ...trickle('brainEater', 15, 4, 21, [0, 4, 2, 0, 4, 1, 3]),
      ...trickle('veryFastWalker', 50, 12, 5, [0, 4, 2, 0, 4]),
      ...flag('brainEater', 105, [0, 1, 2, 3, 4]), ...flag('brainEater', 109, [0, 0, 4, 4, 2]),
    ],
    unlocks: 'pumpkinSquash',
  },
  {
    // The one idea: the Pumpkin Squash leaps on whatever slides in. A scripted Brain Eater trickle
    // down lane 1 (the glove's tile [1,3], iced) guarantees a foe reaches x 3.5-5.5 early (plan ruling 12).
    ...base('p4-4', 4), side: 'plants', kind: 'battle', cards: TEN,
    baseHp: { zombies: 2000, plants: 6300 }, twist: { iceLanes: [1, 3] },
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'hotTopic', 'cowboyZombie', 'necromancer'], incomeScale: 0.75 },
    waves: trickle('brainEater', 20, 6, 4, [1]),
  },
  {
    // The one idea: Kernel butter stops a slider in its tracks. Hot Topics, and Very Fast Walker rush
    // flags down the iced lanes at 60 s and 110 s.
    ...base('p4-5', 5), side: 'plants', kind: 'survive', cards: TEN,
    seconds: 170, baseHp: { plants: 2100 }, twist: { iceLanes: [0, 2, 4] },
    waves: [
      ...trickle('hotTopic', 25, 14, 8, [2, 0, 4, 1, 3]),
      ...flag('veryFastWalker', 60, [0, 2, 4, 0, 2, 4]), ...flag('veryFastWalker', 110, [0, 2, 4, 0, 2, 4]),
    ],
  },
  {
    // The one idea: a Cherry on the icy rush.
    ...base('p4-6', 6), side: 'plants', kind: 'battle', cards: TEN,
    baseHp: { zombies: 2000, plants: 6700 }, twist: { iceLanes: [0, 2, 4] },
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'hotTopic', 'necromancer', 'tridentZombie'], incomeScale: 0.75 },
  },
  {
    // The one idea: the Trident pierces a row, so stagger plants across lanes. Trident Zombies and
    // Skeleton Warrior flags at 80 s and 140 s; Necromancers trickle.
    ...base('p4-7', 7), side: 'plants', kind: 'survive', cards: TEN,
    seconds: 180, baseHp: { plants: 6500 }, twist: { iceLanes: [0, 1, 3, 4] },
    waves: [
      ...trickle('tridentZombie', 30, 18, 8, [1, 3, 2, 0, 4]),
      ...flag('skeletonWarrior', 80, [0, 1, 2, 3, 4]), ...flag('skeletonWarrior', 140, [0, 1, 2, 3, 4]),
      ...trickle('necromancer', 50, 25, 5, [2, 1, 3, 0, 4]),
    ],
  },
  {
    // Boss: the Yeti walks the iced middle lane; Very Fast Walker "snow pups" trickle down lanes 0 and 4.
    // 600 start energy. The base is 14000, not the spec's 5500: the plants' base hits back at the Yeti, so an
    // idle player wins any base much above 1.4 times the Yeti's hp (10000, `Balance.bosses.yeti`).
    ...base('p4-8', 8), side: 'plants', kind: 'boss', cards: TEN,
    boss: { key: 'yeti', lane: 2 }, baseHp: { plants: 14000 }, startEnergy: 600,
    twist: { iceLanes: [0, 2, 4] },
    waves: trickle('veryFastWalker', 30, 20, 8, [0, 4]),
  },
];
