import type { Faction } from '../../sim/types';
import type { LevelDef } from '../types';
import { BACKYARD } from './backyard';

import { TEACHES } from './teaches';

/**
 * Every Adventure level there is (the Backyard for now; worlds 2–5 join with their content plans),
 * each with its tutorial from `TEACHES` (a level's own `teaches` when the map has none).
 */
export const LEVELS: readonly LevelDef[] = BACKYARD.map((def) => {
  const steps = TEACHES[def.id];
  return steps === undefined ? def : { ...def, teaches: [...steps] };
});

/** `side`'s levels in `world`, in campaign order. */
export function levelsFor(side: Faction, world: number, levels: readonly LevelDef[] = LEVELS): LevelDef[] {
  return levels.filter((l) => l.side === side && l.world === world).sort((a, b) => a.n - b.n);
}

export function levelById(id: string, levels: readonly LevelDef[] = LEVELS): LevelDef | null {
  return levels.find((l) => l.id === id) ?? null;
}
