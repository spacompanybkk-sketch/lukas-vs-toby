import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.necromancer;

export function createNecromancer(id: string): UnitState {
  return new UnitState(id, 'necromancer', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const NECRO_HEAL_AMOUNT = 15;
export const NECRO_HEAL_INTERVAL = 4000;
