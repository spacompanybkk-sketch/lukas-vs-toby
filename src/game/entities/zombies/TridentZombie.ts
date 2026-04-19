import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.tridentZombie;

export function createTridentZombie(id: string): UnitState {
  return new UnitState(id, 'tridentZombie', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const TRIDENT_PROJECTILE = 'trident';
