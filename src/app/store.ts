import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { isOpen } from '../adventure/campaign';
import { LEVELS } from '../adventure/levels';
import type { LevelDef } from '../adventure/types';
import type { Save, Slot } from '../progress/save';
import type { Faction } from '../sim/types';
import type { BattleOptions } from './BattleController';
import { applyPending, freePlayOptions, levelOptions, levelProblem, prepareFreePlay, prepareLevel } from './levelSession';
import type { LevelHost } from './levelSession';
import { session } from './session';
import { stepsToTeach } from './tutorial';

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
  /**
   * The Adventure map of `side`; with `card`, that level's card is open over it. `world`: the
   * island shown (left out: the card's world, else the world of the next level).
   */
  | { name: 'map'; side: Faction; card?: string; world?: LevelDef['world'] }
  | { name: 'battle'; options: BattleOptions }
  | { name: 'unsupported'; reason: 'webgl2' | 'context-lost' };

/** Which screen the app shows. `App` switches on it; screens change it through `go`. */
export const screen: Signal<Screen> = signal<Screen>({ name: 'title' });

export function go(s: Screen): void {
  screen.value = s;
}

/**
 * Starts Adventure level `def` for the owner of `save`: the level's own match (`levelConfig`:
 * scripted waves, the clock, the belt, its computer or none, the save's difficulty and unlocks)
 * with a fresh battle id. A result still waiting on the device is applied first. A level that is
 * not open for `save` (or not a known level) is refused: nothing happens and the answer is false.
 * A level that cannot be played (`levelProblem`: a computer with no energy) throws in development
 * and is refused, with a console error, in a build.
 *
 * The level's tutorial comes with it: the steps of `def.teaches` this player has not done yet, or
 * all of them with `replayTutorial` (the glove button on the level card).
 */
export function startLevel(
  def: LevelDef, save: Save, seed: number = Date.now(), levels: readonly LevelDef[] = LEVELS, host: LevelHost = session,
  opts: { replayTutorial?: boolean } = {},
): boolean {
  if (!isOpen(save, def, levels)) return false;
  const problem = levelProblem(def);
  if (problem !== null) {
    if (import.meta.env.DEV) throw new Error(problem);
    console.error(problem);
    return false;
  }
  // The save as it is once any pending result is in (it may unlock a card this level deals).
  const me = host.player.peek()?.slot === save.slot ? (applyPending(host, levels), host.player.peek() ?? save) : save;
  const play = { ...prepareLevel(def, me, seed, me.slot), teach: stepsToTeach(def.teaches, me, opts.replayTutorial === true) };
  go({ name: 'battle', options: levelOptions(play) });
  return true;
}

/**
 * Starts a Free Play run on `side` for the owner of `save`, straight into the battle (no card):
 * endless waves (plants) or gardens (zombies) from the cards the player has met, with a fresh
 * battle id. A result still waiting on the device is applied first.
 */
export function startFreePlay(side: Faction, save: Save, seed: number = Date.now(), host: LevelHost = session): void {
  const me = host.player.peek()?.slot === save.slot ? (applyPending(host), host.player.peek() ?? save) : save;
  go({ name: 'battle', options: freePlayOptions(prepareFreePlay(me, side, seed, me.slot)) });
}
