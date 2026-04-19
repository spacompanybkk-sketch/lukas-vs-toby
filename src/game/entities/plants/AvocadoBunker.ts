import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.avocadoBunker;

export function createAvocadoBunker(id: string): UnitState {
  return new UnitState(id, 'avocadoBunker', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}
