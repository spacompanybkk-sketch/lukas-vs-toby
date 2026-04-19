import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.torchwood;

export function createTorchwood(id: string): UnitState {
  return new UnitState(id, 'torchwood', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const TORCH_DAMAGE_MULTIPLIER = 2;
