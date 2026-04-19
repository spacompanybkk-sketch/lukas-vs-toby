import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.veryFastWalker;

export function createVeryFastWalker(id: string): UnitState {
  return new UnitState(id, 'veryFastWalker', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}
