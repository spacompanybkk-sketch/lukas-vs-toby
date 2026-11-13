import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { unlockedCards } from '../adventure/campaign';
import type { LevelDef } from '../adventure/types';
import type { Save, Slot } from '../progress/save';
import type { Faction } from '../sim/types';
import type { BattleOptions } from './BattleController';

export type Screen =
  | { name: 'title' }
  /** The pictures of the players; with `login`, the number pad for that player is open. */
  | { name: 'players'; login?: Slot }
  /** A new player; with `boy` (Lukas `p01` or Toby `p02`), straight to choosing his number. */
  | { name: 'create'; boy?: Slot }
  | { name: 'home' }
  | { name: 'leaderboard' }
  | { name: 'marketplace' }
  | { name: 'almanac' }
  | { name: 'grownup' }
  /** Quick Battle: the side and difficulty pick. */
  | { name: 'sidepick' }
  /** The Play menu: Adventure, Quick Battle, Free Play. */
  | { name: 'play' }
  /** Adventure or Free Play: which side (the two boys). */
  | { name: 'side'; mode: 'adventure' | 'free' }
  /** The Adventure map of `side`; with `card`, that level's card is open over it. */
  | { name: 'map'; side: Faction; card?: string }
  /** Free Play on `side`: a "coming soon" picture until Task 7. */
  | { name: 'freeplay'; side: Faction }
  | { name: 'battle'; options: BattleOptions }
  | { name: 'unsupported'; reason: 'webgl2' | 'context-lost' };

/** Which screen the app shows. `App` switches on it; screens change it through `go`. */
export const screen: Signal<Screen> = signal<Screen>({ name: 'title' });

export function go(s: Screen): void {
  screen.value = s;
}

/**
 * Starts Adventure level `def` for the owner of `save`: the battle on the level's side with the
 * level's cards the player holds and their Marketplace upgrades. The map is where its result
 * returns to.
 */
export function startLevel(def: LevelDef, save: Save, seed: number = Date.now()): void {
  // TODO(Task 5): level modes. This is an ordinary battle against the level's computer (or an Easy
  // one for a scripted level); Task 5 builds the match from `levelConfig(def, save, seed)` instead
  // (scripted waves, the clock, the belt, the boss) and applies the result with `applyLevelResult`.
  const options: BattleOptions = {
    playerFaction: def.side,
    skill: def.opponent?.skill ?? 'easy',
    seed: seed >>> 0,
    upgrades: { ...save.upgrades },
    cards: def.cards.filter((k) => unlockedCards(save, def.side).includes(k)),
    level: def.id,
  };
  go({ name: 'battle', options });
}
