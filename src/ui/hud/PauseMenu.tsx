import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { PixelIcon } from './PixelIcon';
import type { PixelArt } from './PixelIcon';
import { PATH_FLAG } from '../screens/adventurePictures';
import { WHITE_FLAG } from '../versus/pictures';
import './hud.css';

export interface PauseMenuProps {
  onResume(): void;
  /** None: no Restart button (a Free Play run, whose one way out is Quit, which banks it). */
  onRestart?(): void;
  onSettings(): void;
  onQuit(): void;
  /** Shown once Quit is armed: what quitting banks (a Free Play run's flag and coins). */
  bank?: ComponentChildren;
  /** Where Quit leads, drawn on it: home (a house, the default) or the Adventure map (the path with its flag). */
  quitTo?: 'home' | 'map';
  /** What Quit is: leaving (the door, the default; its picture is `quitTo`) or, in Versus, giving up (a white flag). */
  quitKind?: 'door' | 'flag';
}

/** How long an armed Quit waits for its second tap before it goes back to normal. */
export const QUIT_CONFIRM_MS = 3000;

/** A green tick, shown on Quit after the first tap: "tap again to go". */
const TICK: PixelArt = {
  rows: [
    '..........oo',
    '.........ogo',
    '........oglo',
    '.......oggo.',
    '.oo...oggo..',
    'oggo.oggo...',
    'olggoggo....',
    '.ogggggo....',
    '..ogggo.....',
    '...ogo......',
    '....o.......',
    '............',
  ],
  palette: { o: '#2A1B0E', g: '#58C13B', l: '#8BE05A' },
};

/**
 * Dimmed overlay with four big picture buttons (three without Restart); Resume is the biggest. Quit takes two taps (the
 * first shows a tick on it), so a stray finger never throws a match away.
 */
export function PauseMenu({ onResume, onRestart, onSettings, onQuit, bank, quitTo = 'home', quitKind = 'door' }: PauseMenuProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), QUIT_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  const other = (f: () => void) => () => { setArmed(false); f(); };
  return (
    <div data-screen="pause" class="layer layer--dim" role="dialog" aria-label="Paused">
      <div class="pause panel px pal-wood stack">
        <span class="pause__badge ico ico--pause" aria-hidden="true" />
        <button type="button" data-action="resume" class="btn btn--big pal-leaf pause__resume" onClick={other(onResume)}>
          <span class="ico ico--play" aria-hidden="true" /><span class="btn__label inked">Resume</span>
        </button>
        <div class="pause__grid">
          {onRestart !== undefined && (
            <button type="button" data-action="restart" class="btn pal-cream" onClick={other(onRestart)}>
              <span class="ico ico--restart" aria-hidden="true" /><span class="btn__label">Restart</span>
            </button>
          )}
          <button type="button" data-action="settings" class="btn pal-cream" onClick={other(onSettings)}>
            <span class="ico ico--gear" aria-hidden="true" /><span class="btn__label">Settings</span>
          </button>
          <button
            type="button" data-action="quit" class={`btn pal-red pause__quit${armed ? ' is-armed' : ''}`}
            aria-label={armed ? 'Quit: tap again' : 'Quit'}
            onClick={() => { if (armed) onQuit(); else setArmed(true); }}
          >
            {quitKind === 'flag'
              ? <span class="pause__where" data-quit-kind="flag" aria-hidden="true"><PixelIcon art={WHITE_FLAG} /></span>
              : quitTo === 'map'
                ? <span class="pause__where" data-quit-to="map" aria-hidden="true"><PixelIcon art={PATH_FLAG} /></span>
                : <span class="ico ico--home" data-quit-to="home" aria-hidden="true" />}
            {armed && <PixelIcon art={TICK} class="pause__tick" />}
            <span class="btn__label inked">{quitKind === 'flag' ? 'Give up' : 'Quit'}</span>
          </button>
        </div>
        {armed && bank !== undefined && <div class="pause__bank" data-bank>{bank}</div>}
      </div>
    </div>
  );
}
