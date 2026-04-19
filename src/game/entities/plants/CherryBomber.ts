import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.cherryBomber;

export function createCherryBomber(id: string): UnitState {
  return new UnitState(id, 'cherryBomber', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const CHERRY_EXPLOSION_DAMAGE = 300;
export const CHERRY_EXPLOSION_RADIUS = 2;
