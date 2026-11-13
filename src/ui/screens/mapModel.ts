import { isOpen, nextLevel, unlockedCards } from '../../adventure/campaign';
import { LEVELS, levelsFor } from '../../adventure/levels';
import type { LevelDef } from '../../adventure/types';
import { factionOf, isCard } from '../../data/units';
import type { Save } from '../../progress/save';
import type { CardKey, Faction, UnitKey } from '../../sim/types';

/**
 * A stone on the map: `closed` (padlock), `next` (the one to play now: it bounces and the
 * player's marker stands on it), `open` (playable, not won yet, not the next one), `done` (won,
 * with 1–3 stars).
 */
export type StoneState = 'closed' | 'open' | 'next' | 'done';

export interface Stone {
  def: LevelDef;
  state: StoneState;
  stars: number;
  /** The unit this level unlocks, shown as a silhouette above the stone until it is won. */
  unlock: CardKey | null;
}

/** The stones of `side`'s Backyard for the owner of `save`, in path order. */
export function mapStones(save: Save, side: Faction, levels: readonly LevelDef[] = LEVELS): Stone[] {
  const mine = levelsFor(side, 1, levels);
  const next = nextLevel(save, side, levels);
  return mine.map((def) => {
    const stars = save[side].stars[def.id] ?? 0;
    const state: StoneState = stars > 0 ? 'done'
      : !isOpen(save, def, levels) ? 'closed'
      : next?.id === def.id ? 'next' : 'open';
    return { def, state, stars, unlock: stars > 0 ? null : def.unlocks };
  });
}

/** The cards the level card shows as dealt: the level's cards the player holds, in level order. */
export function dealtCards(save: Save, def: LevelDef): CardKey[] {
  const held = unlockedCards(save, def.side);
  return def.cards.filter((k) => held.includes(k));
}

/** The enemy's pictures on the level card: the computer's cards, then scripted and prepared units, once each. */
export function enemyUnits(def: LevelDef): UnitKey[] {
  const out: UnitKey[] = [];
  const add = (k: UnitKey): void => { if (!out.includes(k)) out.push(k); };
  for (const k of def.opponent?.cards ?? []) add(k);
  for (const s of def.waves) add(s.unit);
  for (const s of def.prepared) add(s.unit);
  // A plant head start on a plant level is the player's own, not the enemy's.
  return out.filter((k) => isCard(k) && factionOf(k) !== def.side);
}

/** What each of the three stars asks: win; then the base kept at half and nearly full, or time left. */
export interface StarGoal { kind: 'win' | 'base' | 'clock'; share: number }

export function starGoals(def: LevelDef, thresholds: { base: { two: number; three: number }; clock: { two: number; three: number } }): StarGoal[] {
  const [kind, t] = def.kind === 'breakthrough' ? ['clock' as const, thresholds.clock] : ['base' as const, thresholds.base];
  return [{ kind: 'win', share: 1 }, { kind, share: t.two }, { kind, share: t.three }];
}
