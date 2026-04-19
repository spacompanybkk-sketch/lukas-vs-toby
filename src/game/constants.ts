export const GRID_ROWS = 5;
export const GRID_COLS = 10;
export const TILE_SIZE = 64;
export const GRID_OFFSET_X = 80;
export const GRID_OFFSET_Y = 100;

export const GAME_WIDTH = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + 100;
export const GAME_HEIGHT = GRID_OFFSET_Y + GRID_ROWS * TILE_SIZE + 140;

export const ENERGY_TICK_INTERVAL = 2000;
export const ENERGY_TICK_AMOUNT = 5;
export const ENERGY_KILL_REWARD = 10;
export const STARTING_ENERGY = 500;

export const BASE_HP = 2000;

export const UNIT_COSTS: Record<string, number> = {
  peashooter: 100,
  sunflower: 50,
  walnutBomb: 125,
  brainEater: 100,
  veryFastWalker: 50,
  skeletonWarrior: 125,
};

export const UNIT_STATS: Record<string, { hp: number; damage: number; attackSpeed: number; range: number; moveSpeed: number }> = {
  peashooter:      { hp: 100, damage: 20, attackSpeed: 1400, range: 9, moveSpeed: 0 },   // slower shooting, steady damage
  sunflower:       { hp: 75,  damage: 8,  attackSpeed: 2000, range: 3, moveSpeed: 0 },   // slower shooting
  walnutBomb:      { hp: 300, damage: 80, attackSpeed: 0,    range: 0, moveSpeed: 0 },
  brainEater:      { hp: 100, damage: 18, attackSpeed: 2500, range: 4, moveSpeed: 0.6 }, // slower walk + shoot
  veryFastWalker:  { hp: 50,  damage: 10, attackSpeed: 1000, range: 0, moveSpeed: 1.8 }, // slower (was 3)
  skeletonWarrior: { hp: 180, damage: 22, attackSpeed: 1500, range: 0, moveSpeed: 0.8 }, // slower walk
};
