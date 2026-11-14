import { WORLD_ORDER, type WorldKey } from '../data/worlds';
import { NO_TWIST, SAMPLE_LAWNS, type LawnConfig } from '../render/world/TwistTiles';

/**
 * The world a tool scene is dressed as: `&world=<key>` (default the Backyard) with that world's
 * sample twist tiles, or none with `&twist=0`.
 */
export function worldParams(params: URLSearchParams): { world: WorldKey; lawn: LawnConfig } {
  const asked = params.get('world');
  const world = WORLD_ORDER.find((key) => key === asked) ?? 'backyard';
  return { world, lawn: params.get('twist') === '0' ? NO_TWIST : SAMPLE_LAWNS[world] };
}
