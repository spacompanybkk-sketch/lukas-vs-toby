import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.skeletonArcher;

export function createSkeletonArcher(id: string): UnitState {
  return new UnitState(id, 'skeletonArcher', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const BONE_ARROW_PROJECTILE = 'boneArrow';
