import type { Match } from '../sim/match';
import type { Lockstep } from './lockstep';

/**
 * Rejoin after a reload (spec 6.7): a fresh `Match` from the same setup replays every stored turn
 * from tick 0, headless (no drawing). The game loop caps a frame at a few steps (spec 12), and a
 * long match is 10,000+ ticks, so the replay runs a slice a frame instead of in one go.
 */

/** Where a replay goes: a lockstep holding the stored turns (own adopted, the other's received), up to `toTick`. */
export interface ReplaySource { lockstep: Lockstep; toTick: number }

/** Ticks one replay slice steps (one call a frame): 600 ticks, 20 s of play. */
export const REPLAY_SLICE_TICKS = 600;

/**
 * Steps `match` headless with the commands `src.lockstep` holds, at most `maxTicks` ticks and not
 * past `src.toTick`. It stops early at a tick whose turns are not both held. True when
 * `match.state.tick === src.toTick`.
 */
export function replaySlice(match: Match, src: ReplaySource, maxTicks: number): boolean {
  const { lockstep, toTick } = src;
  for (let n = 0; n < maxTicks && match.state.tick < toTick; n++) {
    const tick = match.state.tick;
    if (!lockstep.canRun(tick)) break;
    match.step(lockstep.commandsAt(tick));
  }
  return match.state.tick === toTick;
}
