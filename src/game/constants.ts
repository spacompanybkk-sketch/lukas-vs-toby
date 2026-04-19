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
  walnutBomb: 125,
  brainEater: 100,
  veryFastWalker: 50,
  skeletonWarrior: 125,
};

export const UNIT_STATS: Record<string, { hp: number; damage: number; attackSpeed: number; range: number; moveSpeed: number }> = {
  peashooter:      { hp: 150, damage: 12, attackSpeed: 2200, range: 9, moveSpeed: 0 },
  sunflower:       { hp: 100, damage: 5,  attackSpeed: 3000, range: 3, moveSpeed: 0 },
  walnutBomb:      { hp: 500, damage: 80, attackSpeed: 0,    range: 0, moveSpeed: 0 },
  brainEater:      { hp: 150, damage: 10, attackSpeed: 3000, range: 4, moveSpeed: 0.3 },
  veryFastWalker:  { hp: 80,  damage: 8,  attackSpeed: 1500, range: 0, moveSpeed: 0.8 },
  skeletonWarrior: { hp: 250, damage: 15, attackSpeed: 2000, range: 0, moveSpeed: 0.4 },
};
