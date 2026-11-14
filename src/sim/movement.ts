import type { Balance } from '../data/balance';
import { isWindingUp } from './boss';
import { nearestEnemyAhead, statsFor } from './lookup';
import { canAct } from './status';
import { BASE_STOP_X, TICKS_PER_SECOND } from './types';
import type { SimState } from './types';

/**
 * Step stage 3: zombies advance or halt, in ascending id.
 *
 * A zombie is `blocked` while a living plant in its lane stands ahead of it (plant.x <= zombie.x)
 * within its melee reach, or while it stands at the plant base (x <= BASE_STOP_X). The test uses
 * where it stands when the stage starts: a blocked zombie stays put, any other walks
 * speed / 30 tiles left, never past BASE_STOP_X. One that walks into reach is blocked from the
 * next tick. Shooting plays no part here: a zombie throws while it walks, and `tickAttacks`
 * reads `blocked` to keep a blocked zombie to its bite.
 *
 * Two more things keep a zombie where it is without making it `blocked`: it cannot act (stunned or
 * tied, see `canAct`), it is a boss winding up a slam (`isWindingUp`), or it `holds` and a standing plant is ahead within `holdRange`, or its
 * shot's range when it has no `holdRange`, so it stays and shoots.
 *
 * A hasted zombie (Frenzy) walks `Balance.spells.frenzy.factor` times its speed. In fog
 * (`LawnConfig.fog`) a shooter's hold range is at most the fog, as its shot's reach is.
 */
export function tickMovement(s: SimState, b: Balance): void {
  for (const z of s.units) {
    if (z.faction !== 'zombies') continue;
    const stats = statsFor(b, z.key);
    const reach = stats.melee?.reach ?? 0;
    z.blocked = z.x <= BASE_STOP_X || nearestEnemyAhead(s, z.faction, z.lane, z.x, reach) !== null;
    if (z.blocked || !canAct(z) || isWindingUp(b, z)) continue;
    if (stats.holds) {
      const fog = s.config.lawn.fog;
      const hold = stats.holdRange ?? stats.shot?.range ?? 0;
      // In fog a shooter walks on until it can shoot (a Necromancer, with no shot, keeps its distance).
      const holdRange = fog === null || stats.shot === undefined ? hold : Math.min(hold, fog);
      if (nearestEnemyAhead(s, z.faction, z.lane, z.x, holdRange) !== null) continue;
    }
    const speed = z.haste > 0 ? stats.speed * (b.spells.frenzy.factor ?? 1) : stats.speed;
    z.x = Math.max(BASE_STOP_X, z.x - speed / TICKS_PER_SECOND);
  }
}
