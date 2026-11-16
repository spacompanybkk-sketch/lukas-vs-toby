import type { LevelDef, LevelTwist, TutorialStep } from '../adventure/types';
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
 * A side's world that already has real levels (the Moonlit Meadow, `p2-*`) is left as it is: a
 * copy never shadows or duplicates a real level id.
 *
 * With `lessons` (the twist lesson's e2e and screenshots), each copy takes the lesson written for
 * its id (`TEACHES`), and a card that lesson names is added to the copy's cards so it can be shown.
 */
export function previewWorlds(
  levels: readonly LevelDef[], worlds: readonly (2 | 3 | 4 | 5)[] = [2, 3], lessons?: Readonly<Record<string, readonly TutorialStep[]>>,
): LevelDef[] {
  const out = [...levels];
  const real = new Set(levels.map((d) => `${d.side}:${d.world}`));
  for (const w of worlds) {
    for (const def of levels) {
      if (def.world !== 1 || real.has(`${def.side}:${w}`)) continue;
      const twist = SAMPLE_TWIST[WORLDS[arenaOf(def.side, w)].twist];
      const copy: LevelDef = { ...def, id: `${def.side === 'plants' ? 'p' : 'z'}${w}-${def.n}`, world: w, unlocks: null, teaches: null };
      if (twist === undefined) delete copy.twist;
      else copy.twist = twist;
      const lesson = lessons?.[copy.id];
      if (lesson !== undefined) {
        copy.teaches = [...lesson];
        for (const st of lesson) {
          if ((st.show === 'card' || st.show === 'tile') && !copy.cards.includes(st.card)) copy.cards = [...copy.cards, st.card];
        }
      }
      out.push(copy);
    }
  }
  return out;
}
