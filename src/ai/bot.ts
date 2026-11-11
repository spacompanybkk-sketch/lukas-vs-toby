import type { Match } from '../sim/match';
import type { Command, Faction } from '../sim/types';

/** How well a computer player plays. */
export type Skill = 'easy' | 'medium' | 'hard';

/**
 * A computer player for one side. `think` is called once per tick, before `match.step`, with the
 * match as it stands, and returns the commands for that step (usually none). It only reads the
 * match: it never changes it and never draws on the match's random numbers.
 */
export interface Bot {
  readonly faction: Faction;
  think(match: Match): Command[];
}
