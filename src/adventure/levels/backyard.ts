import type { LevelDef, Spawn } from '../types';

/**
 * The Backyard: eight plant levels (`p1-*`) and eight zombie levels (`z1-*`), both on the Backyard
 * arena (ruling A2). Kind, cards, unlocks and spells follow the plan's Task 8 table exactly; every
 * number (waves, clocks, incomes, gardens) is a placeholder that Task 8 tunes with the level tool.
 */

/** A level with nothing scripted; each entry below says only what differs. */
const base = (id: string, n: number): Omit<LevelDef, 'kind' | 'cards' | 'side'> => ({
  id, world: 1, n, opponent: null, waves: [], prepared: [], seconds: null, belt: null, boss: null,
  startEnergy: null, spells: false, unlocks: null, teaches: null,
});

/** `count` arrivals of `unit`, `every` seconds apart from `from`, cycling through `lanes`. */
function trickle(unit: Spawn['unit'], from: number, every: number, count: number, lanes: number[], level = 1): Spawn[] {
  return Array.from({ length: count }, (_, i) => ({ at: from + i * every, unit, lane: lanes[i % lanes.length]!, level }));
}

/** Plants standing at the start: `[lane, col]` pairs of `unit`. */
const garden = (unit: Spawn['unit'], tiles: [number, number][], level = 1): Spawn[] =>
  tiles.map(([lane, col]) => ({ at: 0, unit, lane, col, level }));

const PLANTS: LevelDef[] = [
  {
    // Tutorial: the Peashooter alone, one lane used, a trickle of Brain Eaters. Steps come in Task 6.
    ...base('p1-1', 1), side: 'plants', kind: 'battle', cards: ['peashooter'],
    opponent: { skill: 'easy', cards: ['brainEater'], incomeScale: 0.5 }, // placeholder: tuned in Task 8
  },
  {
    // + Sunflower: teaches Sun; the hero appears.
    ...base('p1-2', 2), side: 'plants', kind: 'battle', cards: ['peashooter', 'sunflower'],
    opponent: { skill: 'easy', cards: ['brainEater', 'veryFastWalker'], incomeScale: 0.6 }, // placeholder: tuned in Task 8
  },
  {
    // Survive: + Walnut Bomb, three lanes of waves. Unlocks the Potato Mine.
    ...base('p1-3', 3), side: 'plants', kind: 'survive', cards: ['peashooter', 'sunflower', 'walnutBomb'],
    seconds: 90, // placeholder: tuned in Task 8
    waves: trickle('brainEater', 8, 6, 12, [1, 2, 3]), // placeholder: tuned in Task 8
    unlocks: 'potatoMine',
  },
  {
    // Battle against the Easy computer, four cards; spells start.
    ...base('p1-4', 4), side: 'plants', kind: 'battle', cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine'],
    opponent: { skill: 'easy', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior'], incomeScale: 0.8 }, // placeholder: tuned in Task 8
    spells: true,
  },
  {
    // Conveyor: Peashooters, Walnuts and Mines on the belt against scripted waves.
    ...base('p1-5', 5), side: 'plants', kind: 'conveyor', cards: ['peashooter', 'walnutBomb', 'potatoMine'],
    belt: { everySeconds: 5, cards: ['peashooter', 'walnutBomb', 'potatoMine'] }, // placeholder: tuned in Task 8
    seconds: 120, // placeholder: tuned in Task 8
    waves: [...trickle('brainEater', 10, 7, 10, [0, 2, 4, 1, 3]), ...trickle('veryFastWalker', 40, 12, 5, [2, 0, 4])], // placeholder
    spells: true,
  },
  {
    // Survive 150 s with a flag wave of Skeleton Warriors. Unlocks the Kernel-pult.
    ...base('p1-6', 6), side: 'plants', kind: 'survive', cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine'],
    seconds: 150, // placeholder: tuned in Task 8
    waves: [...trickle('brainEater', 8, 6, 14, [0, 1, 2, 3, 4]), ...trickle('skeletonWarrior', 110, 0.5, 6, [0, 1, 2, 3, 4])], // placeholder
    spells: true, unlocks: 'kernelPult',
  },
  {
    // Battle against the Medium computer, five cards.
    ...base('p1-7', 7), side: 'plants', kind: 'battle',
    cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'],
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'], incomeScale: 1 }, // placeholder
    spells: true,
  },
  {
    // Boss: the Brain Titan.
    ...base('p1-8', 8), side: 'plants', kind: 'boss',
    cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'],
    boss: { key: 'brainTitan', lane: 2 },
    waves: trickle('brainEater', 15, 10, 10, [0, 1, 3, 4]), // placeholder: tuned in Task 8
    spells: true,
  },
];

const ZOMBIES: LevelDef[] = [
  {
    // Tutorial: the Brain Eater alone against two Peashooters. Steps come in Task 6.
    ...base('z1-1', 1), side: 'zombies', kind: 'battle', cards: ['brainEater'],
    prepared: garden('peashooter', [[1, 2], [3, 2]]), // placeholder: tuned in Task 8
  },
  {
    // + Very Fast Walker; the hero appears.
    ...base('z1-2', 2), side: 'zombies', kind: 'battle', cards: ['brainEater', 'veryFastWalker'],
    opponent: { skill: 'easy', cards: ['peashooter', 'sunflower'], incomeScale: 0.6 }, // placeholder: tuned in Task 8
  },
  {
    // Breakthrough: crack a small prepared garden. Unlocks the Desert Zombie.
    ...base('z1-3', 3), side: 'zombies', kind: 'breakthrough', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior'],
    seconds: 120, // placeholder: tuned in Task 8
    prepared: garden('peashooter', [[0, 2], [2, 3], [4, 2]]).concat(garden('walnutBomb', [[1, 5], [3, 5]])), // placeholder
    unlocks: 'desertZombie',
  },
  {
    // Battle against the Easy computer, four cards; spells start.
    ...base('z1-4', 4), side: 'zombies', kind: 'battle',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'],
    opponent: { skill: 'easy', cards: ['peashooter', 'sunflower', 'walnutBomb'], incomeScale: 0.8 }, // placeholder
    spells: true,
  },
  {
    // Conveyor: a belt of zombies against a prepared garden that regrows.
    ...base('z1-5', 5), side: 'zombies', kind: 'conveyor',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'],
    belt: { everySeconds: 5, cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'] }, // placeholder
    seconds: 150, // placeholder: tuned in Task 8
    prepared: garden('peashooter', [[0, 3], [1, 2], [2, 3], [3, 2], [4, 3]]), // placeholder
    // The garden regrows: plants arrive on their tiles again (placeholder: tuned in Task 8).
    waves: [40, 80, 120].flatMap((at) => [{ at, unit: 'peashooter' as const, lane: 1, col: 1 }, { at, unit: 'peashooter' as const, lane: 3, col: 1 }]),
    spells: true,
  },
  {
    // Breakthrough 150 s through Walnut walls. Unlocks the Skeleton Archer.
    ...base('z1-6', 6), side: 'zombies', kind: 'breakthrough',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'],
    seconds: 150, // placeholder: tuned in Task 8
    prepared: garden('walnutBomb', [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5]]).concat(garden('peashooter', [[0, 2], [2, 2], [4, 2]])), // placeholder
    spells: true, unlocks: 'skeletonArcher',
  },
  {
    // Battle against the Medium computer, five cards.
    ...base('z1-7', 7), side: 'zombies', kind: 'battle',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'],
    opponent: { skill: 'medium', cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine'], incomeScale: 1 }, // placeholder
    spells: true,
  },
  {
    // Boss: the Elder Oak.
    ...base('z1-8', 8), side: 'zombies', kind: 'boss',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'],
    boss: { key: 'elderOak', lane: 2 },
    prepared: garden('peashooter', [[0, 3], [4, 3]]), // placeholder: tuned in Task 8
    spells: true,
  },
];

export const BACKYARD: LevelDef[] = [...PLANTS, ...ZOMBIES];
