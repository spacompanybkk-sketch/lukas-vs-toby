import { UnitState } from '../Unit';
import { UNIT_STATS } from '../../constants';

const stats = UNIT_STATS.kernelPult;

export function createKernelPult(id: string): UnitState {
  return new UnitState(id, 'kernelPult', 'plants', stats.hp, stats.damage, stats.attackSpeed, stats.range, stats.moveSpeed);
}

export const KERNEL_PULT_PROJECTILE = 'kernel';
export const BUTTER_STUN_CHANCE = 0.3;
export const BUTTER_STUN_DURATION = 2000;
