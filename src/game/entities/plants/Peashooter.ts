import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.peashooter;

export function createPeashooter(id: string): UnitState {
  return new UnitState(id, 'peashooter', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const PEASHOOTER_PROJECTILE = 'pea';
