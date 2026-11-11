import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { BattleOptions } from './BattleController';

export type Screen =
  | { name: 'title' }
  | { name: 'sidepick' }
  | { name: 'battle'; options: BattleOptions }
  | { name: 'unsupported'; reason: 'webgl2' | 'context-lost' };

/** Which screen the app shows. `App` switches on it; screens change it through `go`. */
export const screen: Signal<Screen> = signal<Screen>({ name: 'title' });

export function go(s: Screen): void {
  screen.value = s;
}
