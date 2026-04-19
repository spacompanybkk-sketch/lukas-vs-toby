import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.desertZombie;

export function createDesertZombie(id: string): UnitState {
  return new UnitState(id, 'desertZombie', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const SAND_PROJECTILE = 'sand';
export const BLIND_DURATION = 3000;
