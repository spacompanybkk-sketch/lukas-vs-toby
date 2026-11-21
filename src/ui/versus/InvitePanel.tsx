import { useEffect } from 'preact/hooks';
import { PixelIcon } from '../hud/PixelIcon';
import { SWORDS } from '../screens/boardPictures';
import { CHECK, CROSS } from '../screens/pictures';
import { uiSound } from '../uiSound';
import { HeadPics, headSide } from './InviteCard';
import { PANEL_EDGE_PX, PANEL_TOUCH_PX, otherSide } from './types';
import type { IncomingVM } from './types';
import { VersusFace } from './WhoIsHere';
import './versus.css';

/** The panel's faces are a little smaller than "who is here"'s, so the tick and cross fit beside them. */
const PANEL_FACE_PX = 96;

/** The tick and cross: big, pinned to the panel's two ends so a small hand cannot hit both. */
const end = (side: 'left' | 'right') => ({
  width: `${PANEL_TOUCH_PX}px`, height: `${PANEL_TOUCH_PX}px`, [side]: `${PANEL_EDGE_PX}px`,
});

/**
 * An invite arriving, on any menu screen: a full-width panel sliding in from the top with the
 * inviter's face, the crossed swords, my own face with my side's icon, the head start pictures,
 * a big green tick at the right end and a big red cross at the left. A two-note chime plays as
 * it arrives. (Closing it after 60 s is the lobby's.)
 */
export function InvitePanel({ invite, portraits, onAccept, onDecline }: { invite: IncomingVM; portraits: Record<string, string>; onAccept(): void; onDecline(): void }) {
  const { from, me, mySide, head } = invite;
  useEffect(() => { uiSound('chime'); }, []);
  return (
    <div class="vs-panel panel px pal-cream" data-invite-panel role="dialog" aria-label={`${from.name} wants to play`}>
      <button
        type="button" data-action="decline" aria-label="No" class="btn pal-red vs-panel__btn" style={end('left')}
        onClick={() => { uiSound('click'); onDecline(); }}
      >
        <PixelIcon art={CROSS} class="vs-icon" />
      </button>
      <div class="vs-panel__middle">
        <span class="vs-panel__face" data-from><VersusFace face={from} portraits={portraits} side={otherSide(mySide)} size={PANEL_FACE_PX} /></span>
        <span class="vs-panel__swords" data-vs-swords aria-hidden="true"><PixelIcon art={SWORDS} class="vs-icon" /></span>
        <span class="vs-panel__face" data-me><VersusFace face={me} portraits={portraits} side={mySide} size={PANEL_FACE_PX} /></span>
        {head !== null && (
          <span class="vs-head vs-panel__head" data-head data-head-slot={head.slot}>
            <HeadPics head={head} side={headSide(head, me, mySide)} />
          </span>
        )}
      </div>
      <button
        type="button" data-action="accept" aria-label="Yes" class="btn pal-leaf vs-panel__btn" style={end('right')}
        onClick={() => { uiSound('click'); onAccept(); }}
      >
        <PixelIcon art={CHECK} class="vs-icon" />
      </button>
    </div>
  );
}
