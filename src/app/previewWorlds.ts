import type { LevelDef, LevelTwist } from '../adventure/types';
import { WORLDS, arenaOf } from '../data/worlds';
import type { TwistKind } from '../data/worlds';

/** A small twist of each kind, for stand-in levels only. */
const SAMPLE_TWIST: Record<TwistKind, LevelTwist | undefined> = {
  none: undefined,
  fog: { fog: true },
  rocks: { rocks: [13, 21] },
  ice: { iceLanes: [1, 3] },
  lava: { lavaTiles: [13, 24] },
};

/**
 * `levels` with each side's world 1 copied into `worlds` (ids `p2-1` …), each copy carrying its
 * arena's twist and no unlock or tutorial. Not content: the map's multi-world tests (and the map
 * e2e, through the debug hook) use it until the real worlds 2–5 have their level files.
 */
export function previewWorlds(levels: readonly LevelDef[], worlds: readonly (2 | 3 | 4 | 5)[] = [2, 3]): LevelDef[] {
  const out = [...levels];
  for (const w of worlds) {
    for (const def of levels) {
      if (def.world !== 1) continue;
      const twist = SAMPLE_TWIST[WORLDS[arenaOf(def.side, w)].twist];
      const copy: LevelDef = { ...def, id: `${def.side === 'plants' ? 'p' : 'z'}${w}-${def.n}`, world: w, unlocks: null, teaches: null };
      if (twist === undefined) delete copy.twist;
      else copy.twist = twist;
      out.push(copy);
    }
  }
  return out;
}
