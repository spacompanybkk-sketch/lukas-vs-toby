export const GRID_ROWS = 5;
export const GRID_COLS = 10;
export const TILE_SIZE = 80;
export const GRID_OFFSET_X = 100;
export const GRID_OFFSET_Y = 80;

export const GAME_WIDTH = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + 120;
export const GAME_HEIGHT = GRID_OFFSET_Y + GRID_ROWS * TILE_SIZE + 160;

export const ENERGY_TICK_INTERVAL = 2000;
export const ENERGY_TICK_AMOUNT = 5;
export const ENERGY_KILL_REWARD = 10;
export const STARTING_ENERGY = 500;

export const BASE_HP = 5000;

export const UNIT_COSTS: Record<string, number> = {
  peashooter: 100,
  sunflower: 50,
  walnutBomb: 75,
  potatoMine: 25,
  cherryBomber: 150,
  avocadoBunker: 125,
  mangoPult: 100,
  kernelPult: 75,
  pumpkinSquash: 175,
  torchwood: 100,
  brainEater: 100,
  veryFastWalker: 50,
  skeletonWarrior: 125,
  skeletonArcher: 100,
  necromancer: 150,
  hotTopic: 75,
  tridentZombie: 150,
  desertZombie: 100,
  cowboyZombie: 125,
  brainRot: 175,
};

// Auto-balanced via 15 rounds of AI vs AI simulation (~50/50 win rate, ~2 min games)
export const UNIT_STATS: Record<string, { hp: number; damage: number; attackSpeed: number; range: number; moveSpeed: number }> = {
  peashooter:      { hp: 180, damage: 7,  attackSpeed: 2700, range: 9, moveSpeed: 0 },
  sunflower:       { hp: 100, damage: 5,  attackSpeed: 3000, range: 3, moveSpeed: 0 },
  walnutBomb:      { hp: 640, damage: 150, attackSpeed: 0,    range: 0, moveSpeed: 0 },
  potatoMine:      { hp: 50,  damage: 200, attackSpeed: 0,    range: 0, moveSpeed: 0 },
  cherryBomber:    { hp: 50,  damage: 300, attackSpeed: 0,    range: 0, moveSpeed: 0 },
  avocadoBunker:   { hp: 960, damage: 0,  attackSpeed: 0,    range: 0, moveSpeed: 0 },
  mangoPult:       { hp: 120, damage: 15, attackSpeed: 2500, range: 9, moveSpeed: 0 },
  kernelPult:      { hp: 120, damage: 8,  attackSpeed: 2000, range: 9, moveSpeed: 0 },
  pumpkinSquash:   { hp: 200, damage: 50, attackSpeed: 3000, range: 3, moveSpeed: 0 },
  torchwood:       { hp: 150, damage: 0,  attackSpeed: 0,    range: 0, moveSpeed: 0 },
  brainEater:      { hp: 150, damage: 7,  attackSpeed: 3000, range: 4, moveSpeed: 0.3 },
  veryFastWalker:  { hp: 130, damage: 8,  attackSpeed: 1500, range: 0, moveSpeed: 0.65 },
  skeletonWarrior: { hp: 325, damage: 15, attackSpeed: 2000, range: 0, moveSpeed: 0.4 },
  skeletonArcher:  { hp: 80,  damage: 12, attackSpeed: 2500, range: 8, moveSpeed: 0.3 },
  necromancer:     { hp: 100, damage: 5,  attackSpeed: 3500, range: 2, moveSpeed: 0.2 },
  hotTopic:        { hp: 100, damage: 10, attackSpeed: 1200, range: 0, moveSpeed: 0.5 },
  tridentZombie:   { hp: 150, damage: 20, attackSpeed: 3000, range: 9, moveSpeed: 0.3 },
  desertZombie:    { hp: 120, damage: 8,  attackSpeed: 2500, range: 2, moveSpeed: 0.4 },
  cowboyZombie:    { hp: 130, damage: 12, attackSpeed: 2000, range: 3, moveSpeed: 0.45 },
  brainRot:        { hp: 80,  damage: 10, attackSpeed: 3000, range: 8, moveSpeed: 0.2 },
};

// Campaign levels — progressive difficulty
export const CAMPAIGN_LEVELS = [
  { level: 1,  name: 'Backyard',          waveInterval: 10000, firstDelay: 15000, baseHp: 3000, reward: 50,  maxWaves: 8 },
  { level: 2,  name: 'Front Yard',        waveInterval: 9000,  firstDelay: 14000, baseHp: 3500, reward: 75,  maxWaves: 10 },
  { level: 3,  name: 'Garden Path',       waveInterval: 8500,  firstDelay: 13000, baseHp: 4000, reward: 100, maxWaves: 12 },
  { level: 4,  name: 'The Hedge',         waveInterval: 8000,  firstDelay: 12000, baseHp: 4500, reward: 125, maxWaves: 14 },
  { level: 5,  name: 'Moonlit Meadow',    waveInterval: 7500,  firstDelay: 12000, baseHp: 5000, reward: 150, maxWaves: 16 },
  { level: 6,  name: 'Dark Forest',       waveInterval: 7000,  firstDelay: 11000, baseHp: 5000, reward: 175, maxWaves: 18 },
  { level: 7,  name: 'Graveyard Gate',    waveInterval: 6500,  firstDelay: 11000, baseHp: 5500, reward: 200, maxWaves: 20 },
  { level: 8,  name: 'Crypt Entrance',    waveInterval: 6000,  firstDelay: 10000, baseHp: 5500, reward: 225, maxWaves: 22 },
  { level: 9,  name: 'Bone Corridor',     waveInterval: 5500,  firstDelay: 10000, baseHp: 6000, reward: 250, maxWaves: 24 },
  { level: 10, name: 'Skull Chamber',     waveInterval: 5000,  firstDelay: 9000,  baseHp: 6000, reward: 300, maxWaves: 26 },
  { level: 11, name: 'Poison Swamp',      waveInterval: 5000,  firstDelay: 9000,  baseHp: 6500, reward: 350, maxWaves: 28 },
  { level: 12, name: 'Spider Nest',       waveInterval: 4500,  firstDelay: 8000,  baseHp: 6500, reward: 400, maxWaves: 30 },
  { level: 13, name: 'Lava Bridge',       waveInterval: 4500,  firstDelay: 8000,  baseHp: 7000, reward: 450, maxWaves: 32 },
  { level: 14, name: 'Dragon Lair',       waveInterval: 4000,  firstDelay: 8000,  baseHp: 7000, reward: 500, maxWaves: 34 },
  { level: 15, name: 'Shadow Realm',      waveInterval: 4000,  firstDelay: 7000,  baseHp: 7500, reward: 550, maxWaves: 36 },
  { level: 16, name: 'Frozen Tundra',     waveInterval: 3500,  firstDelay: 7000,  baseHp: 7500, reward: 600, maxWaves: 38 },
  { level: 17, name: 'Storm Peak',        waveInterval: 3500,  firstDelay: 7000,  baseHp: 8000, reward: 650, maxWaves: 40 },
  { level: 18, name: 'Dark Citadel',      waveInterval: 3000,  firstDelay: 6000,  baseHp: 8000, reward: 700, maxWaves: 42 },
  { level: 19, name: 'Throne Room',       waveInterval: 3000,  firstDelay: 6000,  baseHp: 8500, reward: 800, maxWaves: 44 },
  { level: 20, name: 'Final Showdown',    waveInterval: 2500,  firstDelay: 5000,  baseHp: 9000, reward: 1000, maxWaves: 50 },
];

// Unit unlock progression — which level unlocks each unit
// Level 1 = available from the start
export const UNIT_UNLOCK_LEVELS: Record<string, number> = {
  // Plants — start with 3, unlock rest through campaign
  peashooter: 1,    // starter
  sunflower: 1,     // starter
  walnutBomb: 1,    // starter
  potatoMine: 3,
  kernelPult: 5,
  mangoPult: 7,
  avocadoBunker: 10,
  torchwood: 12,
  cherryBomber: 15,
  pumpkinSquash: 18,
  // Zombies — start with 3, unlock rest through campaign
  brainEater: 1,    // starter
  veryFastWalker: 1, // starter
  skeletonWarrior: 1, // starter
  desertZombie: 3,
  skeletonArcher: 5,
  hotTopic: 7,
  cowboyZombie: 10,
  necromancer: 12,
  tridentZombie: 15,
  brainRot: 18,
};

// Losing a level gives 2-3% of the win reward
export const LOSS_REWARD_PERCENT = 0.025;

// Merge system
export const MERGE_OVERLAP_DURATION = 1000; // ms for zombie auto-merge
