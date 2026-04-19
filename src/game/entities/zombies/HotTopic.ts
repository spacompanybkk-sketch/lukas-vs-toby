import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.hotTopic;

export function createHotTopic(id: string): UnitState {
  return new UnitState(id, 'hotTopic', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const HP_GAIN_PER_EAT = 20;
export const DAMAGE_GAIN_PER_EAT = 3;
