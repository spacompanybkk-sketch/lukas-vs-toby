import type { Faction } from '../sim/types';

/** The five arenas of the Adventure. Data only: render, audio and the map read this table. */
export type WorldKey = 'backyard' | 'meadow' | 'desert' | 'tundra' | 'citadel';

/** What a world does to the lawn (the numbers live in `Balance.twists`). */
export type TwistKind = 'none' | 'fog' | 'rocks' | 'ice' | 'lava';

/** The plants' order; the zombies travel it in reverse. */
export const WORLD_ORDER: readonly WorldKey[] = ['backyard', 'meadow', 'desert', 'tundra', 'citadel'];

/** The arena of `side`'s `world`-th campaign world: plants forward, zombies reversed. */
export function arenaOf(side: Faction, world: 1 | 2 | 3 | 4 | 5): WorldKey {
  const i = side === 'plants' ? world - 1 : WORLD_ORDER.length - world;
  return WORLD_ORDER[i] as WorldKey;
}

export const WORLDS: Record<WorldKey, { twist: TwistKind; theme: WorldKey; weather: 'none' | 'fireflies' | 'dust' | 'snow' | 'embers' }> = {
  backyard: { twist: 'none', theme: 'backyard', weather: 'none' },
  meadow: { twist: 'fog', theme: 'meadow', weather: 'fireflies' },
  desert: { twist: 'rocks', theme: 'desert', weather: 'dust' },
  tundra: { twist: 'ice', theme: 'tundra', weather: 'snow' },
  citadel: { twist: 'lava', theme: 'citadel', weather: 'embers' },
};
