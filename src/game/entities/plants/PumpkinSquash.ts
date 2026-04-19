import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.pumpkinSquash;

export function createPumpkinSquash(id: string): UnitState {
  return new UnitState(id, 'pumpkinSquash', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}
