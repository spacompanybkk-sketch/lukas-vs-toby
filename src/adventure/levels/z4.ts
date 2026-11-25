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
 *
 * Fog changes what the stars measure. A zombie level's stars count the zombie base's health kept
 * (a breakthrough: the clock left), and the only shots that hurt that base are plant shots that
 * reach x 10: under fog `f` a shooter's shot reaches `min(range, f)` tiles, so only a plant at
 * column `10 - f - 0.5` or further forward can hit the base at all (column 3 under fog 7, 4 under
 * 6, 5 under 5). At the designed bases (3800-9300) no stand-in ever lost a star on z4-1..z4-8 (100%
 * three stars everywhere, the expert no better than the beginner), so on the battles, the belt and
 * the boss the zombie base is small (2000-6000 since Task 10, 450-2000 before): a handful of stray shots
 * costs a star, and the band, not the base's size, is what the tuning aims at. The computers'
 * incomes are x1.0 (z4-2), x1.8 (z4-4) and x2.0 (z4-7): the table's x1.8 / x1.8 / x2.0 except z4-2's,
 * which is lower; before Task 10 they were x3.6 / x2.7 / x3.3 (higher than the table, for the same
 * reason: more plants forward, more stray shots).
 *
 * Eased for a five-year-old (worlds-4 Task 10, Michal 2026-11-25): Toby's tap walk lost 12 of 12, and
 * the child stand-in (`tools/levels.ts --who child --pace 6`) won only 48 / 45 / 50% of z4-1..3 and
 * 12 / 8 / 7.5% of z4-4, z4-5, z4-7. The small bases were what sank him (a few stray shots ended the
 * match), so they grew to 2000-6000, the computers' incomes fell, z4-5's garden grows slower and
 * z4-3 / z4-5 run longer. The child now wins 94-100% of z4-1 and z4-2, 69.5-80% of z4-3 and 43.5-57% of z4-4, 5, 7 on every
 * block (z4-6 86-89%, the Glowcap 70-78% as before). The cost: the average player and the expert
 * three-star almost always, so those star bands and the expert's lead are recorded misses in
 * `KNOWN_MISSES`, not loosened.
 *
 * The child's difficulty order is not a ramp: his win share on z4-1..8 is roughly 100, 97, 70-80, 44-56, 46-57,
 * 86-89, 50-54, 70-78, so z4-6 and z4-8 are easier for him than z4-4, z4-5 and z4-7 (their targets were already
 * met, so they were not tuned; `child` is a recorded signal, not a gated stand-in). The browser tap walk
 * (`LVT_W4_WALK`, Medium income, one random-lane card every 3.4 s) won z4-1, won 0 of 9 tries on z4-2 and 0 of 8 on z4-3.
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
 * z4-5's garden grows as z3-5's does, without rocks: a Peashooter every 24 s from 20 s on the next
 * free tile, never one the garden already holds (11 new tiles, the last at 260 s; the clock is 330 s). z3-5 grows every
 * 12 s (20 tiles); Task 10 slowed this one for the five-year-old.
 */
const growingGarden = (): Spawn[] =>
  growing('peashooter', BELT_GARDEN, [1, 3, 0, 4, 2], [1, 0, 4, 5, 2, 3, 6, 7], { every: 24, count: 11 });

export const Z4: LevelDef[] = [
  {
    // The one idea: in the mist the plants can't shoot far - sneak close. No computer: Peashooters at
    // [1,1] [2,1] [3,1] [2,2], and the garden regrows every 40 s. The design grows it in columns 0-2,
    // but under fog 7 those plants can never reach the zombie base (column 3 on), so nobody lost a
    // star (everyone 100% three stars): it regrows in columns 3-4 and the zombie base is 2500 and the plants'
    // 4500 (the design's 7000 is never hit; 500 and 5500 until Task 10: a tap-only walk at Medium income, one
    // random-lane card every 3.4 s, lost 3 of 3 until the zombie base outlasted the garden's stray shots).
    ...base('z4-1', 1), side: 'zombies', kind: 'battle', cards: NINE,
    baseHp: { plants: 4500, zombies: 2500 }, twist: { fog: 7 },
    prepared: garden('peashooter', [[1, 1], [2, 1], [3, 1], [2, 2]]),
    waves: regrow('peashooter', [[40, 1, 3], [80, 3, 3], [120, 2, 3], [160, 1, 4], [200, 3, 4], [240, 2, 4]]),
  },
  {
    // The one idea: Archers and Tridents have to walk closer too. The Easy computer on x1.0 (design x1.8, x3.6 until Task 10) and a zombie base of 6000 (was 600): the stray shots of a computer that weak no longer end the child's matches.
    ...base('z4-2', 2), side: 'zombies', kind: 'battle', cards: NINE,
    baseHp: { plants: 4200, zombies: 6000 }, twist: { fog: 7 },
    opponent: { skill: 'easy', cards: EIGHT_PLANTS, incomeScale: 1.0 },
  },
  {
    // The one idea: shooters at the back can't reach the front plants - eat the front first. A Walnut
    // Bomb at column 6 in every lane, Peashooters and Kernel-pults at columns 0-1. Unlocks Brain Rot.
    // Under fog 6 only column 0 cannot reach a zombie chewing the wall (measured in z4.test.ts, plan
    // ruling 13): the middle lane's only shooter is its column-0 Kernel-pult, the trap lane. The wall
    // stays at column 6. A 300 s clock, not the designed 240 s (Task 10: the child broke the garden
    // before 240 s on 50% of seeds, 70-80% at 300 s; plan ruling 6 allows up to 300); the plants' base is
    // 11000, not 5000, which at 5000 broke in about a minute (average 3 stars 98%).
    ...base('z4-3', 3), side: 'zombies', kind: 'breakthrough', cards: NINE,
    seconds: 300, baseHp: { plants: 11000, zombies: 14000 }, twist: { fog: 6 },
    prepared: [
      ...garden('walnutBomb', [[0, 6], [1, 6], [2, 6], [3, 6], [4, 6]]),
      ...garden('peashooter', [[0, 1], [1, 1], [3, 1], [4, 1]]),
      ...garden('kernelPult', [[2, 0], [1, 0], [3, 0]]),
    ],
    unlocks: 'brainRot',
  },
  {
    // The one idea: Brain Rot leaves poison puddles under the plants. The Easy computer on x1.8 (the
    // design's), now with the Cherry Bomber; income x1.8 and zombie base 2000 since Task 10 (was x2.7 and 550).
    ...base('z4-4', 4), side: 'zombies', kind: 'battle', cards: TEN,
    baseHp: { plants: 4200, zombies: 2000 }, twist: { fog: 6 },
    opponent: { skill: 'easy', cards: NINE_PLANTS, incomeScale: 1.8 },
  },
  {
    // The one idea: the belt in the mist. Three Peashooters at the start and one more every 24 s (11 of
    // them; every 12 s until Task 10). The plants' base is 14000, not the design's 7000 (broken in 1.2
    // min, everyone 100% three stars); the clock 330 s (designed 270) and the zombie base 4000 so the
    // child (who needed more than 4.5 min) can win; the expert still needs 1.5 min.
    ...base('z4-5', 5), side: 'zombies', kind: 'conveyor', cards: BELT,
    belt: { everySeconds: 5, cards: BELT },
    seconds: 330, baseHp: { plants: 14000, zombies: 4000 }, twist: { fog: 5 },
    prepared: garden('peashooter', BELT_GARDEN),
    waves: growingGarden(),
  },
  {
    // The one idea: the Necromancer heals the pack, and Brain Rot melts the Kernel-pults. An Avocado
    // Bunker at column 5 in lanes 1-3 with a Kernel-pult behind it; mines in lanes 0 and 4.
    // A 300 s clock, not the 240 s of the design (plan ruling 6): the stars count the clock left, and
    // at 240 s the base that keeps the average player in his band (7500-8200: three stars 48-42%)
    // lets the expert break the garden in 1.36-1.41 min, under the 1.5 minimum; at 300 s and a 10000
    // base the average player three-stars 51% and the expert needs 1.53 min.
    ...base('z4-6', 6), side: 'zombies', kind: 'breakthrough', cards: TEN,
    seconds: 300, baseHp: { plants: 10000, zombies: 14000 }, twist: { fog: 5 },
    prepared: [
      ...garden('avocadoBunker', [[1, 5], [2, 5], [3, 5]]),
      ...garden('kernelPult', [[1, 3], [2, 3], [3, 3]]),
      ...garden('potatoMine', [[0, 5], [4, 5]]),
    ],
  },
  {
    // The one idea: everything at once. The Easy computer on x2.0 (design x2.0; x3.3 until Task 10) with every plant card but the Squash; zombie base 2000.
    ...base('z4-7', 7), side: 'zombies', kind: 'battle', cards: TEN,
    baseHp: { plants: 3800, zombies: 2000 }, twist: { fog: 5 },
    opponent: { skill: 'easy', cards: NINE_PLANTS, incomeScale: 2.0 },
  },
  {
    // Boss: the Glowcap guards the plant base across lanes 1-3, on the middle lane. Prepared
    // Kernel-pults at [1,1] [3,1]; the Peashooters stand at [0,5] [4,5], not the design's [0,3] [4,3]:
    // under fog 5 a column-3 Peashooter never reaches the zombie base, so the base was never hit and
    // everyone three-starred (100%); from column 5 their stray shots take a star from the average
    // player 60% of the time at a 2000 base. Glowcap hp 19000 (`Balance.bosses.glowcap`).
    ...base('z4-8', 8), side: 'zombies', kind: 'boss', cards: TEN,
    boss: { key: 'glowcap', lane: 2 }, baseHp: { zombies: 2000 }, twist: { fog: 5 },
    prepared: [...garden('peashooter', [[0, 5], [4, 5]]), ...garden('kernelPult', [[1, 1], [3, 1]])],
  },
];
