import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.mangoPult;

export function createMangoPult(id: string): UnitState {
  return new UnitState(id, 'mangoPult', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const MANGO_PROJECTILE = 'mango';
