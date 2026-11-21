import { useEffect } from 'preact/hooks';
import type { Faction } from '../../sim/types';
import { PixelIcon } from '../hud/PixelIcon';
import { SWORDS } from '../screens/boardPictures';
import { CROSS, PLUS } from '../screens/pictures';
import { uiSound } from '../uiSound';
import { MINUS, SWAP } from './pictures';
import { HEAD_MAX, otherSide, touch } from './types';
import type { FaceVM, HeadVM, InviteCardState, InviteDraftVM } from './types';
import { VersusFace } from './WhoIsHere';
import './versus.css';

/** The head boy's side: mine when the head start is mine, else the other one. */
export function headSide(head: HeadVM, me: FaceVM, mySide: Faction): Faction {
  return head.slot === me.slot ? mySide : otherSide(mySide);
}

/** The head start as pictures: `step` suns or brains (the head boy's side), then empty slots up to five. */
export function HeadPics({ head, side }: { head: HeadVM; side: Faction }) {
  const step = Math.max(0, Math.min(HEAD_MAX, head.step));
  return (
    <span class="vs-head__pics" aria-label={`Head start ${step}`}>
      {Array.from({ length: HEAD_MAX }, (_, i) => (i < step
        ? <span key={i} class={`ico ico--${side === 'plants' ? 'sun' : 'brain'} vs-head__pic`} data-head-pic aria-hidden="true" />
        : <span key={i} class="vs-head__empty" data-head-empty aria-hidden="true" />))}
    </span>
  );
}

/**
 * The invite card, over "who is here": my face on my side, his on the other (sun and brain show
 * who is plants and who zombies), a swap button between them, the head start as 0–5 pictures with
 * a big minus and plus, a huge green swords button to send and a red cross to close.
 *
 * - `waiting`: his face pulses with three dots; only the cross (cancel) is left.
 * - `refused`: his face shakes and a red cross stamps over it, with the "uh-uh".
 * - `expired`: the whole card shakes once (the lobby closes it).
 */
export function InviteCard({ draft, state, portraits, onSwap, onHead, onSend, onClose }: {
  draft: InviteDraftVM; state: InviteCardState; portraits: Record<string, string>;
  onSwap(): void; onHead(step: number): void; onSend(): void; onClose(): void;
}) {
  const { me, them, mySide, head } = draft;
  const editing = state === 'draft';
  useEffect(() => { if (state === 'refused') uiSound('deny'); }, [state]);
  const press = (fn: () => void) => () => { uiSound('click'); fn(); };
  const stepTo = (to: number): void => {
    if (head === null || to < 0 || to > HEAD_MAX || to === head.step) return;
    uiSound('click');
    onHead(to);
  };
  const themAnim = state === 'waiting' ? 'pulse' : state === 'refused' ? 'shake' : undefined;
  return (
    <div class="vs-veil" data-invite-veil>
      <div
        class="vs-card panel px pal-cream" data-invite-card data-state={state}
        data-anim={state === 'expired' ? 'shake' : undefined}
      >
        <button type="button" data-action="close" aria-label="Close" class="btn btn--square pal-red vs-card__close" style={touch()} onClick={press(onClose)}>
          <PixelIcon art={CROSS} class="vs-icon" />
        </button>
        <div class="vs-card__faces">
          <span class="vs-card__face" data-me><VersusFace face={me} portraits={portraits} side={mySide} /></span>
          {editing
            ? (
              <button type="button" data-action="swap" aria-label="Swap sides" class="btn btn--square pal-wood vs-card__swap" style={touch()} onClick={press(onSwap)}>
                <PixelIcon art={SWAP} class="vs-icon" />
              </button>
            )
            : <span class="vs-card__vs" aria-hidden="true"><PixelIcon art={SWORDS} class="vs-icon" /></span>}
          <span class="vs-card__face" data-them data-anim={themAnim}>
            <VersusFace face={them} portraits={portraits} side={otherSide(mySide)} />
            {state === 'waiting' && (
              <span class="vs-dots" data-dots aria-label="Waiting">
                <span class="vs-dots__dot" data-dot /><span class="vs-dots__dot" data-dot /><span class="vs-dots__dot" data-dot />
              </span>
            )}
            {state === 'refused' && <span class="vs-stamp" data-stamp aria-label="No"><PixelIcon art={CROSS} /></span>}
          </span>
        </div>
        {head !== null && (
          <div class="vs-head" data-head data-head-slot={head.slot}>
            {editing && (
              <button
                type="button" data-action="head-minus" aria-label="Less head start" aria-disabled={head.step <= 0 ? 'true' : undefined}
                class="btn btn--square pal-stone vs-head__btn" style={touch()} onClick={() => stepTo(head.step - 1)}
              >
                <PixelIcon art={MINUS} class="vs-icon" />
              </button>
            )}
            <HeadPics head={head} side={headSide(head, me, mySide)} />
            {editing && (
              <button
                type="button" data-action="head-plus" aria-label="More head start" aria-disabled={head.step >= HEAD_MAX ? 'true' : undefined}
                class="btn btn--square pal-leaf vs-head__btn" style={touch()} onClick={() => stepTo(head.step + 1)}
              >
                <PixelIcon art={PLUS} class="vs-icon" />
              </button>
            )}
          </div>
        )}
        {editing && (
          <button type="button" data-action="send" aria-label="Send" class="btn btn--big pal-leaf vs-card__send" style={touch(96)} onClick={press(onSend)}>
            <PixelIcon art={SWORDS} class="vs-icon" />
          </button>
        )}
      </div>
    </div>
  );
}
