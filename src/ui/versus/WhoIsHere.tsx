import type { Slot } from '../../progress/save';
import type { Faction } from '../../sim/types';
import { BackButton } from '../BackButton';
import { frameColor } from '../frameColor';
import { PixelIcon } from '../hud/PixelIcon';
import { SWORDS } from '../screens/boardPictures';
import { PlayerPicture } from '../screens/PlayerPicture';
import { HOURGLASS } from '../screens/pictures';
import { uiSound } from '../uiSound';
import { BENCH } from './pictures';
import { FACE_PX } from './types';
import type { FaceVM, HereVM } from './types';
import '../screens/players.css';
import './versus.css';

/**
 * A player's face on the Versus screens: his picture in his own frame colour at `size` px, his
 * side's icon (sun or brain) on its corner when `side` is given, and his name underneath.
 */
export function VersusFace({ face, portraits, side, size = FACE_PX }: { face: FaceVM; portraits: Record<string, string>; side?: Faction; size?: number }) {
  return (
    <span class="vs-face" data-face-of={face.slot}>
      <span class="vs-face__pic" data-face-pic style={{ width: `${size}px`, height: `${size}px` }}>
        <PlayerPicture picture={face.picture} portraits={portraits} frame={frameColor(face.slot)} />
        {side !== undefined && (
          <span class={`ico ico--${side === 'plants' ? 'sun' : 'brain'} vs-face__side`} data-side-icon={side} aria-hidden="true" />
        )}
      </span>
      <span class="vs-face__name" data-face-name>{face.name}</span>
    </span>
  );
}

/**
 * "Who is here": a row of big faces, the players allowed Versus whose device is on a menu now.
 * A face in a battle is greyed with a small swords badge and does nothing. Nobody here: an empty
 * bench and a softly bouncing hourglass (the list fills itself as `faces` changes).
 */
export function WhoIsHere({ faces, portraits, onPick, onBack }: { faces: HereVM[]; portraits: Record<string, string>; onPick(slot: Slot): void; onBack(): void }) {
  return (
    <div data-screen="whoishere" class="layer layer--menu vs-here">
      <BackButton data-action="back" class="screen-back" onClick={() => { uiSound('click'); onBack(); }} />
      {faces.length === 0
        ? (
          <div class="vs-bench" data-empty-bench aria-label="Nobody is here yet">
            <span class="vs-bench__seat" data-bench><PixelIcon art={BENCH} /></span>
            <span class="vs-bench__glass" data-hourglass data-anim="bounce"><PixelIcon art={HOURGLASS} /></span>
          </div>
        )
        : (
          <div class="vs-here__row">
            {faces.map((f) => (
              <button
                key={f.slot} type="button" data-face={f.slot} data-busy={f.busy ? '' : undefined} aria-label={f.name}
                aria-disabled={f.busy ? 'true' : undefined}
                class={`btn pal-cream vs-here__face${f.busy ? ' is-busy' : ''}`}
                onClick={() => {
                  if (f.busy) return;
                  uiSound('click');
                  onPick(f.slot);
                }}
              >
                <VersusFace face={f} portraits={portraits} />
                {f.busy && <span class="vs-here__badge px pal-slate" data-busy-badge aria-hidden="true"><PixelIcon art={SWORDS} /></span>}
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
