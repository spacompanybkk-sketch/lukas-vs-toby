import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { Slot } from '../progress/save';
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
  | { name: 'sidepick' }
  | { name: 'battle'; options: BattleOptions }
  | { name: 'unsupported'; reason: 'webgl2' | 'context-lost' };

/** Which screen the app shows. `App` switches on it; screens change it through `go`. */
export const screen: Signal<Screen> = signal<Screen>({ name: 'title' });

export function go(s: Screen): void {
  screen.value = s;
}
