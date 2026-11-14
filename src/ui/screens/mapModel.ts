import { isOpen, nextLevel, unlockedCards } from '../../adventure/campaign';
import { LEVELS, levelsFor } from '../../adventure/levels';
import type { LevelDef } from '../../adventure/types';
import { factionOf, isCard } from '../../data/units';
import { WORLDS, arenaOf } from '../../data/worlds';
import type { WorldKey } from '../../data/worlds';
import type { Theme } from '../../audio/music';
import type { Save } from '../../progress/save';
import type { CardKey, Faction, UnitKey } from '../../sim/types';

/**
 * A stone on the map: `closed` (padlock), `next` (the one to play now: it bounces and the
 * player's marker stands on it), `open` (playable, not won yet, not the next one), `done` (won,
 * with 1–3 stars).
 */
/** The next stone's hop, in milliseconds: the 3D stone and the HTML over it keep this beat. */
export const HOP_MS = 625;

export type StoneState = 'closed' | 'open' | 'next' | 'done';

export interface Stone {
  def: LevelDef;
  state: StoneState;
  stars: number;
  /** The unit this level unlocks, shown as a silhouette above the stone until it is won. */
  unlock: CardKey | null;
}

/** A campaign world's number in a side's own order (its arena is `arenaOf(side, world)`). */
export type World = LevelDef['world'];
export const WORLD_NUMBERS: readonly World[] = [1, 2, 3, 4, 5];

/**
 * One island of the map: `side`'s `world`-th world, its arena (look), whether it is locked (no
 * levels yet, or its first level not open) and the stars won on it.
 */
export interface Island { world: World; arena: WorldKey; locked: boolean; stars: number }

/**
 * The tune of the island the map shows: an open island plays its world's theme, a locked one (or
 * none) the menu theme.
 */
export function mapTheme(island: Pick<Island, 'arena' | 'locked'> | null): Theme {
  return island === null || island.locked ? 'menu' : WORLDS[island.arena].theme;
}

/** `side`'s five islands for the owner of `save`, in the side's own order (the zombies' reversed). */
export function mapIslands(save: Save, side: Faction, levels: readonly LevelDef[] = LEVELS): Island[] {
  return WORLD_NUMBERS.map((world) => {
    const mine = levelsFor(side, world, levels);
    const first = mine[0];
    let stars = 0;
    for (const def of mine) stars += save[side].stars[def.id] ?? 0;
    return { world, arena: arenaOf(side, world), locked: first === undefined || !isOpen(save, first, levels), stars };
  });
}

/**
 * The island the map opens on: the world of `side`'s next level; with every level won, the last
 * world that has levels; with none at all, world 1.
 */
export function openingWorld(save: Save, side: Faction, levels: readonly LevelDef[] = LEVELS): World {
  const next = nextLevel(save, side, levels);
  if (next !== null) return next.world;
  let last: World = 1;
  for (const def of levels) if (def.side === side && def.world > last) last = def.world;
  return last;
}

/** The twists a level card draws, in this order: fog, rocks, ice, lava (an empty list is none). */
export type TwistPicture = 'fog' | 'rocks' | 'ice' | 'lava';

export function twistKinds(def: LevelDef): TwistPicture[] {
  const t = def.twist;
  if (t === undefined) return [];
  const out: TwistPicture[] = [];
  if (t.fog === true) out.push('fog');
  if ((t.rocks?.length ?? 0) > 0) out.push('rocks');
  if ((t.iceLanes?.length ?? 0) > 0) out.push('ice');
  if ((t.lavaTiles?.length ?? 0) > 0) out.push('lava');
  return out;
}

/** The stones of `side`'s `world` for the owner of `save`, in path order (none on a world without levels). */
export function mapStones(save: Save, side: Faction, world: World = 1, levels: readonly LevelDef[] = LEVELS): Stone[] {
  const mine = levelsFor(side, world, levels);
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
