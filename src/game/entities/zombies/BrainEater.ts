import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.brainEater;

export function createBrainEater(id: string): UnitState {
  return new UnitState(id, 'brainEater', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const BRAIN_EATER_PROJECTILE = 'brain';
export const BRAIN_EATER_BITE_DAMAGE = 40;
