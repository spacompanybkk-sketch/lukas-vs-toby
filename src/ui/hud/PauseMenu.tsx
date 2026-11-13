import { useEffect, useState } from 'preact/hooks';
import { PATH_FLAG } from '../screens/adventurePictures';
import './level.css';
import { PixelIcon } from './PixelIcon';
import type { PixelArt } from './PixelIcon';
import './hud.css';

export interface PauseMenuProps {
  onResume(): void;
  onRestart(): void;
  onSettings(): void;
  onQuit(): void;
  /** In an Adventure level: back to the map (two taps, like Quit). */
  onMap?(): void;
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
 * Dimmed overlay with four big picture buttons; Resume is the biggest. Quit takes two taps (the
 * first shows a tick on it), so a stray finger never throws a match away.
 */
export function PauseMenu({ onResume, onRestart, onSettings, onQuit, onMap }: PauseMenuProps) {
  // Which leaving button waits for its second tap: Quit or the map.
  const [armedFor, setArmed] = useState<'quit' | 'map' | null>(null);
  const armed = armedFor === 'quit';
  useEffect(() => {
    if (armedFor === null) return undefined;
    const t = setTimeout(() => setArmed(null), QUIT_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armedFor]);
  const other = (f: () => void) => () => { setArmed(null); f(); };
  return (
    <div data-screen="pause" class="layer layer--dim" role="dialog" aria-label="Paused">
      <div class="pause panel px pal-wood stack">
        <span class="pause__badge ico ico--pause" aria-hidden="true" />
        <button type="button" data-action="resume" class="btn btn--big pal-leaf pause__resume" onClick={other(onResume)}>
          <span class="ico ico--play" aria-hidden="true" /><span class="btn__label inked">Resume</span>
        </button>
        <div class="pause__grid">
          <button type="button" data-action="restart" class="btn pal-cream" onClick={other(onRestart)}>
            <span class="ico ico--restart" aria-hidden="true" /><span class="btn__label">Restart</span>
          </button>
          <button type="button" data-action="settings" class="btn pal-cream" onClick={other(onSettings)}>
            <span class="ico ico--gear" aria-hidden="true" /><span class="btn__label">Settings</span>
          </button>
          <button
            type="button" data-action="quit" class={`btn pal-red pause__quit${armed ? ' is-armed' : ''}`}
            aria-label={armed ? 'Quit: tap again' : 'Quit'}
            onClick={() => { if (armed) onQuit(); else setArmed('quit'); }}
          >
            <span class="ico ico--home" aria-hidden="true" />
            {armed && <PixelIcon art={TICK} class="pause__tick" />}
            <span class="btn__label inked">Quit</span>
          </button>
          {onMap !== undefined && (
            <button
              type="button" data-action="map" class={`btn pal-cream pause__quit pause__map${armedFor === 'map' ? ' is-armed' : ''}`}
              aria-label={armedFor === 'map' ? 'Map: tap again' : 'Map'}
              onClick={() => { if (armedFor === 'map') onMap(); else setArmed('map'); }}
            >
              <PixelIcon art={PATH_FLAG} class="pause__map-icon" />
              {armedFor === 'map' && <PixelIcon art={TICK} class="pause__tick" />}
              <span class="btn__label">Map</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
