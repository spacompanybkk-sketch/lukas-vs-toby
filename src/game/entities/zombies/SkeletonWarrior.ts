import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.skeletonWarrior;

export function createSkeletonWarrior(id: string): UnitState {
  return new UnitState(id, 'skeletonWarrior', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const SKELETON_BLOCK_COOLDOWN = 4000;
