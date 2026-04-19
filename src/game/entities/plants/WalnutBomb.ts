import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.walnutBomb;

export function createWalnutBomb(id: string): UnitState {
  return new UnitState(id, 'walnutBomb', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const WALNUT_EXPLOSION_RADIUS = 1;
export const WALNUT_EXPLOSION_DAMAGE = 80;
