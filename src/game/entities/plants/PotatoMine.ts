import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.potatoMine;

export function createPotatoMine(id: string): UnitState {
  return new UnitState(id, 'potatoMine', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const POTATO_MINE_EXPLOSION_DAMAGE = 200;
export const POTATO_MINE_EXPLOSION_RADIUS = 1;
