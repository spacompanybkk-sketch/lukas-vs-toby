import { factionOf } from '../../data/units';
import type { CardKey } from '../../sim/types';
import { PixelIcon } from '../hud/PixelIcon';
import { SILHOUETTES } from '../hud/CardTray';
import { session } from '../../app/session';
import { go } from '../../app/store';
import { uiSound } from '../uiSound';
import { CLOUD_OFF } from './pictures';

/**
 * A player's picture: the unit's card portrait (the same image the cards use), on its side's
 * colour. Until that portrait is drawn, the card's boxy silhouette, never a letter. With `frame`,
 * a thick boxy frame of the player's own colour goes around it.
 */
export function PlayerPicture({ picture, portraits, class: cls = '', frame }: { picture: CardKey; portraits: Record<string, string>; class?: string; frame?: string }) {
  const side = factionOf(picture);
  const src = portraits[picture];
  if (frame !== undefined) {
    // The player's own frame colour around the picture (see frameColor).
    return (
      <span class={`pic-frame ${cls}`.trim()} style={{ '--frame': frame }} data-frame={frame}>
        <PlayerPicture picture={picture} portraits={portraits} />
      </span>
    );
  }
  return (
    <span class={`pic side-${side} ${cls}`.trim()} data-picture={picture}>
      {src !== undefined
        ? <img class="pic__img" src={src} alt="" draggable={false} />
        : <PixelIcon art={SILHOUETTES[side]} class="pic__silhouette" />}
    </span>
  );
}

/**
 * Play without a player, when the cloud cannot be reached (a fresh device, an iPad whose storage
 * was wiped): a stone Play with a crossed-out cloud on its corner. A guest battle pays no coins,
 * goes on no leaderboard, and its result returns to the title. A guest has Quick Battle only.
 */
export function GuestPlay({ class: cls = '' }: { class?: string }) {
  return (
    <button
      type="button" data-action="guest" aria-label="Play without a player" class={`btn btn--big pal-stone guest-play ${cls}`.trim()}
      onClick={() => {
        uiSound('click');
        session.logout();
        go({ name: 'play' });
      }}
    >
      <span class="ico ico--play guest-play__icon" aria-hidden="true" />
      <span class="guest-play__badge px pal-slate"><PixelIcon art={CLOUD_OFF} /></span>
    </button>
  );
}

