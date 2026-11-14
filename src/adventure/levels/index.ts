import type { Faction } from '../../sim/types';
import type { LevelDef } from '../types';
import { BACKYARD } from './backyard';

import { TEACHES } from './teaches';

/** The per-world level files, joined (the Backyard for now; worlds 2–5 join with their content plans). */
const ALL: readonly LevelDef[] = [...BACKYARD];

/** Every Adventure level there is, each with its tutorial from `TEACHES` (a level's own `teaches` when the map has none). */
export const LEVELS: readonly LevelDef[] = ALL.map((def) => {
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

/**
 * The hero power is hidden in `def`: it comes before the level of its side and world whose lesson
 * brings the hero (a child would find a lit button a level before being shown what it does).
 * Read from the lessons themselves, so moving the lesson moves this too.
 */
export function heroHidden(def: LevelDef, levels: readonly LevelDef[] = LEVELS): boolean {
  const teacher = levelsFor(def.side, def.world, levels).find((l) => l.teaches?.some((s) => s.show === 'hero') === true);
  return teacher !== undefined && def.n < teacher.n;
}
