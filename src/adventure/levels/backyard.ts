import type { LevelDef, Spawn } from '../types';

/**
 * The Backyard: eight plant levels (`p1-*`) and eight zombie levels (`z1-*`), both on the Backyard
 * arena (ruling A2). Kind, cards, unlocks and spells follow the plan's Task 8 table; the numbers
 * (waves, clocks, bases, incomes, gardens) are measured with `tools/levels.ts` against the level
 * stand-ins (Task 8 report). Levels 1–3 of each side are also the tutorial: one or two lanes,
 * slow first arrivals, nothing can be lost in the first 20 s.
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

/** A flag wave: `count` of `unit` at once (`gap` seconds apart), across `lanes`. */
function flag(unit: Spawn['unit'], at: number, lanes: number[], gap = 0.5, level = 1): Spawn[] {
  return lanes.map((lane, i) => ({ at: at + i * gap, unit, lane, level }));
}

/** Plants standing at the start: `[lane, col]` pairs of `unit`. */
const garden = (unit: Spawn['unit'], tiles: [number, number][], level = 1): Spawn[] =>
  tiles.map(([lane, col]) => ({ at: 0, unit, lane, col, level }));

/** Plants arriving later on their tiles (a garden that regrows): `[at, lane, col]`. */
const regrow = (unit: Spawn['unit'], at: [number, number, number][]): Spawn[] =>
  at.map(([t, lane, col]) => ({ at: t, unit, lane, col }));

const PLANTS: LevelDef[] = [
  {
    // Teaches: a Peashooter stops a zombie. Brain Eaters walk down the middle lane only, the first
    // after 20 s; the zombie base is small, so peas in the empty lanes win it.
    ...base('p1-1', 1), side: 'plants', kind: 'battle', cards: ['peashooter'],
    startEnergy: 300, baseHp: { zombies: 1500 },
    waves: trickle('brainEater', 20, 14, 14, [2]),
  },
  {
    // Teaches: Sunflowers pay for more Peashooters; the hero's button lights up. Brain Eaters in
    // two lanes (1 and 3), the first after 20 s, a pair now and then.
    ...base('p1-2', 2), side: 'plants', kind: 'battle', cards: ['peashooter', 'sunflower'],
    baseHp: { plants: 12000, zombies: 2500 },
    waves: [...trickle('brainEater', 20, 9, 16, [1, 3]), ...flag('brainEater', 75, [1, 3])],
  },
  {
    // Teaches: the Walnut Bomb holds a lane while the Peashooters work. 90 s of waves in lanes
    // 1–3, a flag wave at the end. Unlocks the Potato Mine.
    ...base('p1-3', 3), side: 'plants', kind: 'survive', cards: ['peashooter', 'sunflower', 'walnutBomb'],
    seconds: 90, baseHp: { plants: 4000 },
    waves: [...trickle('brainEater', 20, 6, 9, [2, 1, 3]), ...flag('brainEater', 72, [1, 2, 3, 2])],
    unlocks: 'potatoMine',
  },
  {
    // Tests: the four cards together against a real (Easy) computer; first spells.
    ...base('p1-4', 4), side: 'plants', kind: 'battle', cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine'],
    baseHp: { zombies: 3000 },
    opponent: { skill: 'easy', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior'], incomeScale: 0.5 },
    spells: true,
  },
  {
    // Teaches: no energy, take what the belt brings - a shooter where they come, a wall in front,
    // a mine for the next one. Scripted waves in all five lanes for two minutes.
    ...base('p1-5', 5), side: 'plants', kind: 'conveyor', cards: ['peashooter', 'walnutBomb', 'potatoMine'],
    belt: { everySeconds: 5, cards: ['peashooter', 'walnutBomb', 'potatoMine'] },
    seconds: 120, baseHp: { plants: 6000 },
    waves: [...trickle('brainEater', 15, 7, 12, [2, 0, 4, 1, 3]), ...trickle('veryFastWalker', 55, 14, 3, [1, 3, 0]), ...flag('brainEater', 100, [0, 2, 4])],
    spells: true,
  },
  {
    // Tests: a full defence for 150 s, ending with a flag wave of Skeleton Warriors in every lane.
    // Unlocks the Kernel-pult.
    ...base('p1-6', 6), side: 'plants', kind: 'survive', cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine'],
    seconds: 150, baseHp: { plants: 3500 },
    waves: [
      ...trickle('brainEater', 20, 7, 14, [2, 1, 3, 0, 4]),
      ...flag('skeletonWarrior', 120, [0, 1, 2, 3, 4]),
    ],
    spells: true, unlocks: 'kernelPult',
  },
  {
    // Tests: everything against the Medium computer's choices - on a quarter of the zombies' usual
    // income (×0.25), so it plays well but sends little.
    ...base('p1-7', 7), side: 'plants', kind: 'battle',
    cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'],
    baseHp: { zombies: 3000 },
    opponent: { skill: 'medium', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'], incomeScale: 0.25 },
    spells: true,
  },
  {
    // Boss: the Brain Titan walks the middle lane - its shield bounces peas, pults still hurt it.
    // A few Brain Eaters keep the other lanes busy.
    ...base('p1-8', 8), side: 'plants', kind: 'boss',
    cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'],
    boss: { key: 'brainTitan', lane: 2 },
    waves: trickle('brainEater', 30, 16, 9, [0, 4, 1, 3]),
    spells: true,
  },
];

const ZOMBIES: LevelDef[] = [
  {
    // Teaches: send a Brain Eater, it eats the plant in its way. Two Peashooters guard lanes 1 and
    // 3; a small plant base.
    ...base('z1-1', 1), side: 'zombies', kind: 'battle', cards: ['brainEater'],
    baseHp: { plants: 3500 },
    prepared: garden('peashooter', [[1, 2], [3, 2]]),
  },
  {
    // Teaches: the Very Fast Walker runs past where nothing shoots; the hero's button lights up.
    // Peashooters guard lanes 1 and 3 and more grow there now and then; the other lanes are open.
    ...base('z1-2', 2), side: 'zombies', kind: 'battle', cards: ['brainEater', 'veryFastWalker'],
    baseHp: { plants: 3500, zombies: 14000 },
    prepared: garden('peashooter', [[1, 3], [3, 3]]),
    waves: regrow('peashooter', [[30, 1, 2], [30, 3, 2], [60, 1, 1], [60, 3, 1], [90, 1, 4], [90, 3, 4], [120, 1, 0], [120, 3, 0]]),
  },
  {
    // Teaches: a Skeleton Warrior walks in front and takes the peas. Crack a small garden (lanes
    // 1 and 3) in two minutes. Unlocks the Desert Zombie.
    ...base('z1-3', 3), side: 'zombies', kind: 'breakthrough', cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior'],
    seconds: 120, baseHp: { plants: 1000 },
    prepared: garden('peashooter', [[1, 2], [1, 3], [3, 2], [3, 3]]).concat(garden('walnutBomb', [[1, 5], [3, 5]])),
    unlocks: 'desertZombie',
  },
  {
    // Tests: the four cards together against a real (Easy) computer; first spells.
    ...base('z1-4', 4), side: 'zombies', kind: 'battle',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'],
    baseHp: { plants: 4000 },
    opponent: { skill: 'easy', cards: ['peashooter', 'sunflower', 'walnutBomb'], incomeScale: 1 },
    spells: true,
  },
  {
    // Teaches: no energy, send what the belt brings, together. A garden that regrows its
    // Peashooters every 40 s; break the base in 150 s.
    ...base('z1-5', 5), side: 'zombies', kind: 'conveyor',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'],
    belt: { everySeconds: 5, cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'] },
    seconds: 150, baseHp: { plants: 4600, zombies: 10000 },
    prepared: garden('peashooter', [[0, 3], [1, 2], [2, 3], [3, 2], [4, 3]]),
    waves: regrow('peashooter', [[40, 1, 1], [40, 3, 1], [80, 0, 1], [80, 4, 1], [120, 2, 1], [120, 1, 0]]),
    spells: true,
  },
  {
    // Tests: break through a wall of Walnut Bombs (their blasts!) in 150 s. Unlocks the Skeleton Archer.
    ...base('z1-6', 6), side: 'zombies', kind: 'breakthrough',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie'],
    seconds: 150, baseHp: { plants: 600 },
    prepared: garden('walnutBomb', [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5]]).concat(garden('peashooter', [[0, 2], [2, 2], [4, 2]])),
    spells: true, unlocks: 'skeletonArcher',
  },
  {
    // Tests: everything against the Medium computer's choices - on ×0.4 of the plants' income and a
    // 2800 base, so it plays well but builds slowly.
    ...base('z1-7', 7), side: 'zombies', kind: 'battle',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'],
    baseHp: { plants: 2800 },
    opponent: { skill: 'medium', cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine'], incomeScale: 0.4 },
    spells: true,
  },
  {
    // Boss: the Elder Oak guards the plant base across lanes 1–3 - lob acorns, grows Peashooters,
    // armours up at half health. Peashooters in the outer lanes.
    ...base('z1-8', 8), side: 'zombies', kind: 'boss',
    cards: ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'],
    boss: { key: 'elderOak', lane: 2 },
    prepared: garden('peashooter', [[0, 3], [4, 3], [1, 4], [3, 4]]),
    spells: true,
  },
];

export const BACKYARD: LevelDef[] = [...PLANTS, ...ZOMBIES];
