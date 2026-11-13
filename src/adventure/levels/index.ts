import type { Faction } from '../../sim/types';
import type { LevelDef } from '../types';
import { BACKYARD } from './backyard';

/** Every Adventure level there is (the Backyard for now; worlds 2–5 join with their content plans). */
export const LEVELS: readonly LevelDef[] = BACKYARD;

/** `side`'s levels in `world`, in campaign order. */
export function levelsFor(side: Faction, world: number, levels: readonly LevelDef[] = LEVELS): LevelDef[] {
  return levels.filter((l) => l.side === side && l.world === world).sort((a, b) => a.n - b.n);
}

export function levelById(id: string, levels: readonly LevelDef[] = LEVELS): LevelDef | null {
  return levels.find((l) => l.id === id) ?? null;
}
