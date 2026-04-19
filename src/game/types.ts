export type Faction = 'plants' | 'zombies';

export interface GridPosition {
  row: number;
  col: number;
}

export interface UnitConfig {
  key: string;
  name: string;
  faction: Faction;
  hp: number;
  damage: number;
  attackSpeed: number;
  range: number;
  moveSpeed: number;
  cost: number;
}
