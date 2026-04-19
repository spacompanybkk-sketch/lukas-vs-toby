import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.brainRot;

export function createBrainRot(id: string): UnitState {
  return new UnitState(id, 'brainRot', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const ROT_BRAIN_PROJECTILE = 'rotBrain';
