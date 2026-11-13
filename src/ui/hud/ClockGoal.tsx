import { ADVENTURE } from '../../adventure/rewards';
import { CLOCK } from '../screens/adventurePictures';
import { STAR } from '../screens/boardPictures';
import { PixelIcon } from './PixelIcon';
import './level.css';

/** The bar drains in this many visible steps (boxy, never smooth). */
export const CLOCK_STEPS = 24;

export interface ClockGoalProps {
  /** Seconds played. */
  seconds: number;
  /** The level's clock in seconds. */
  goal: number;
  /** Breakthrough: the stars hang on the clock left; the bar shows where they are lost. */
  stars: boolean;
}

/** The share of the clock left, rounded up to the bar's steps (a bar never looks emptier than it is). */
export function clockLeft(seconds: number, goal: number): number {
  if (!(goal > 0)) return 0;
  const share = Math.min(1, Math.max(0, (goal - seconds) / goal));
  return Math.ceil(share * CLOCK_STEPS) / CLOCK_STEPS;
}

/**
 * A level's clock (Survive, Breakthrough, Conveyor): a clock picture beside a boxy bar that drains
 * as time passes. For Breakthrough the two star marks stand on the bar at the shares of the clock
 * that keep the second and third star; a mark greys once the bar has drained past it.
 */
export function ClockGoal({ seconds, goal, stars }: ClockGoalProps) {
  const left = clockLeft(seconds, goal);
  const marks = stars ? [ADVENTURE.clockStars.two, ADVENTURE.clockStars.three] : [];
  return (
    <div
      data-hud="clock-goal" data-left={Math.max(0, Math.ceil(goal - seconds))} class={`lvl-clock px pal-stone${left <= 0.25 ? ' is-low' : ''}`}
      role="timer" aria-label="Time left"
    >
      <PixelIcon art={CLOCK} class="lvl-clock__icon" />
      <span class="lvl-clock__bar">
        <span class="lvl-clock__fill" style={{ width: `${left * 100}%` }} />
        {marks.map((m, i) => (
          <span
            key={m} class={`lvl-clock__mark${left >= m ? ' is-kept' : ''}`} data-mark={i + 2}
            data-kept={left >= m ? '' : undefined} style={{ left: `${m * 100}%` }}
          >
            <PixelIcon art={STAR} />
          </span>
        ))}
      </span>
    </div>
  );
}
