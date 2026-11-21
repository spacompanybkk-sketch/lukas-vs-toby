import type { Faction } from '../../sim/types';
import { PixelIcon } from '../hud/PixelIcon';
import { HOURGLASS } from '../screens/pictures';
import { uiSound } from '../uiSound';
import { WHITE_FLAG, ZZZ } from './pictures';
import { touch } from './types';
import type { FaceVM, StallStage } from './types';
import { VersusFace } from './WhoIsHere';
import './versus.css';

/** The sleeping face on the dimmed lawn. */
export const STALL_FACE_PX = 200;

/**
 * The other device has gone quiet (spec §6.7):
 * - `none`: nothing.
 * - `hourglass` (1 s): a small hourglass on his base bar (`side`: whose bar; none: the plants' side).
 * - `face` (3 s): the lawn dims, his face big with a sleeping "Zzz" and a slowly turning hourglass.
 * - `flag` (90 s): the same, plus a white flag button under the face: giving up ends the match with
 *   no winner (`onFlag`).
 * - `unfinished`: nothing (the match has ended; the end screen takes over).
 * `line` is one short line for the boy who reads ("Lukas's iPad is asleep"); nothing depends on it.
 */
export function Waiting({ who, stage, portraits, onFlag, line, side }: {
  who: FaceVM; stage: StallStage; portraits: Record<string, string>; onFlag(): void; line?: string; side?: Faction;
}) {
  if (stage === 'none' || stage === 'unfinished') return null;
  if (stage === 'hourglass') {
    const bar = side ?? 'plants';
    return (
      <span class={`vs-stall-glass vs-stall-glass--${bar}`} data-stall="hourglass" data-side={bar} aria-label="Waiting">
        <PixelIcon art={HOURGLASS} />
      </span>
    );
  }
  return (
    <div class="layer layer--dim vs-stall" data-stall-veil data-stall={stage} role="dialog" aria-label="Waiting">
      <div class="vs-stall__who">
        <VersusFace face={who} portraits={portraits} size={STALL_FACE_PX} />
        <span class="vs-stall__zzz" data-zzz aria-hidden="true"><PixelIcon art={ZZZ} /></span>
        <span class="vs-stall__glass" data-slow-hourglass data-anim="slow" aria-hidden="true"><PixelIcon art={HOURGLASS} /></span>
      </div>
      {line !== undefined && <span class="vs-stall__line inked" data-line>{line}</span>}
      {stage === 'flag' && (
        <button
          type="button" data-action="flag" aria-label="Give up" class="btn btn--square pal-cream vs-stall__flag" style={touch(96)}
          onClick={() => { uiSound('click'); onFlag(); }}
        >
          <PixelIcon art={WHITE_FLAG} class="vs-icon" />
        </button>
      )}
    </div>
  );
}
