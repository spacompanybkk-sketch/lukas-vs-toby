import type { Faction } from '../../sim/types';
import { FLAG } from '../screens/adventurePictures';
import { HEADS } from './levelPictures';
import { PixelIcon } from './PixelIcon';
import './level.css';

/** The head moves in this many visible steps along the bar. */
export const WAVE_STEPS = 32;

export interface WaveBarProps {
  /** Seconds played. */
  seconds: number;
  /** When the script's last unit comes (seconds). */
  last: number;
  /** When each big wave comes (seconds): a flag on the bar. */
  flags: readonly number[];
  /** Whose units the waves are: their head marches along. */
  enemy: Faction;
}

/** How far through the script, in the bar's steps (0..1). */
export function waveProgress(seconds: number, last: number): number {
  if (!(last > 0)) return 1;
  return Math.floor(Math.min(1, Math.max(0, seconds / last)) * WAVE_STEPS) / WAVE_STEPS;
}

/**
 * A level's scripted waves: a boxy bar filling from left to right as the script plays, a flag on
 * it at each big wave (it drops once that wave has come), and the enemy's small head marching
 * along to show where the waves are now.
 */
export function WaveBar({ seconds, last, flags, enemy }: WaveBarProps) {
  const done = waveProgress(seconds, last);
  return (
    <div data-hud="wave-bar" data-progress={done} class={`lvl-waves px pal-stone side-${enemy}`} aria-label="Waves">
      <span class="lvl-waves__bar">
        <span class="lvl-waves__fill" style={{ width: `${done * 100}%` }} />
        {flags.map((f) => {
          const passed = seconds >= f;
          return (
            <span
              key={f} class={`lvl-waves__flag${passed ? ' is-passed' : ''}`} data-flag={f}
              data-passed={passed ? '' : undefined} style={{ left: `${Math.min(1, f / last) * 100}%` }}
            >
              <PixelIcon art={FLAG} />
            </span>
          );
        })}
        <span class="lvl-waves__head" data-head={enemy} style={{ left: `${done * 100}%` }}>
          <PixelIcon art={HEADS[enemy]} />
        </span>
      </span>
    </div>
  );
}
