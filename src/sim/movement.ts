import type { Balance } from '../data/balance';
import { nearestEnemyAhead, statsFor } from './lookup';
import { BASE_STOP_X, TICKS_PER_SECOND } from './types';
import type { SimState } from './types';

/**
 * Step stage 3: zombies advance or halt, in ascending id.
 *
 * A zombie is `blocked` while a living plant in its lane stands ahead of it (plant.x <= zombie.x)
 * within its melee reach, or while it stands at the plant base (x <= BASE_STOP_X). The test uses
 * where it stands when the stage starts: a blocked zombie stays put, any other walks
 * speed / 30 tiles left, never past BASE_STOP_X. One that walks into reach is blocked from the
 * next tick. Shooting plays no part here: a zombie throws while it walks.
 */
export function tickMovement(s: SimState, b: Balance): void {
  for (const z of s.units) {
    if (z.faction !== 'zombies') continue;
    const stats = statsFor(b, z.key);
    const reach = stats.melee?.reach ?? 0;
    z.blocked = z.x <= BASE_STOP_X || nearestEnemyAhead(s, z.faction, z.lane, z.x, reach) !== null;
    if (!z.blocked) z.x = Math.max(BASE_STOP_X, z.x - stats.speed / TICKS_PER_SECOND);
  }
}
