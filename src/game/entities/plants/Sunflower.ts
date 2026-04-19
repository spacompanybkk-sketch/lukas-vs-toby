import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.sunflower;

export function createSunflower(id: string): UnitState {
  return new UnitState(id, 'sunflower', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const SUNFLOWER_PROJECTILE = 'kernel';
export const SUNFLOWER_ENERGY_INTERVAL = 5000;
export const SUNFLOWER_ENERGY_AMOUNT = 25;
