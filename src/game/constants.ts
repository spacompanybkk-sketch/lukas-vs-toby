export const GRID_ROWS = 5;
export const GRID_COLS = 10;
export const TILE_SIZE = 64;
export const GRID_OFFSET_X = 80;
export const GRID_OFFSET_Y = 100;

export const GAME_WIDTH = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + 80;
export const GAME_HEIGHT = GRID_OFFSET_Y + GRID_ROWS * TILE_SIZE + 120;

export const ENERGY_TICK_INTERVAL = 2000;
export const ENERGY_TICK_AMOUNT = 5;
export const ENERGY_KILL_REWARD = 10;
export const STARTING_ENERGY = 50;

export const BASE_HP = 1000;

export const UNIT_COSTS: Record<string, number> = {
  peashooter: 100,
  sunflower: 50,
  walnutBomb: 125,
  brainEater: 100,
  veryFastWalker: 50,
  skeletonWarrior: 125,
};

export const UNIT_STATS: Record<string, { hp: number; damage: number; attackSpeed: number; range: number; moveSpeed: number }> = {
  peashooter:      { hp: 100, damage: 20, attackSpeed: 1000, range: 9, moveSpeed: 0 },
  sunflower:       { hp: 75,  damage: 10, attackSpeed: 1500, range: 3, moveSpeed: 0 },
  walnutBomb:      { hp: 300, damage: 80, attackSpeed: 0,    range: 0, moveSpeed: 0 },
  brainEater:      { hp: 120, damage: 25, attackSpeed: 2000, range: 4, moveSpeed: 1 },
  veryFastWalker:  { hp: 60,  damage: 15, attackSpeed: 800,  range: 0, moveSpeed: 3 },
  skeletonWarrior: { hp: 200, damage: 30, attackSpeed: 1200, range: 0, moveSpeed: 1.5 },
};
