import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.cowboyZombie;

export function createCowboyZombie(id: string): UnitState {
  return new UnitState(id, 'cowboyZombie', 'zombies', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const COWBOY_PROJECTILE = 'brain';
