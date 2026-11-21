import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { PAUSE_SIGN } from './pictures';
import { touch } from './types';
import type { FaceVM } from './types';
import { VersusFace } from './WhoIsHere';
import { STALL_FACE_PX } from './Waiting';
import './versus.css';

/**
 * The other boy pressed pause: his face, big, with a pause sign on it, and a big Play button.
 * Either boy's Play resumes the match for both.
 */
export function RemotePause({ who, portraits, onResume }: { who: FaceVM; portraits: Record<string, string>; onResume(): void }) {
  return (
    <div data-screen="vs-paused" class="layer layer--dim vs-stall" role="dialog" aria-label="Paused">
      <div class="vs-stall__who">
        <VersusFace face={who} portraits={portraits} size={STALL_FACE_PX} />
        <span class="vs-stall__sign" data-pause-sign aria-hidden="true"><PixelIcon art={PAUSE_SIGN} /></span>
      </div>
      <button
        type="button" data-action="resume" aria-label="Play" class="btn btn--big pal-leaf vs-stall__play" style={touch(96)}
        onClick={() => { uiSound('click'); onResume(); }}
      >
        <span class="ico ico--play" aria-hidden="true" />
      </button>
    </div>
  );
}
