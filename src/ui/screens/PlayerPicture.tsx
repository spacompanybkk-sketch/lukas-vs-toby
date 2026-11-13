import { factionOf } from '../../data/units';
import type { CardKey } from '../../sim/types';
import { PixelIcon } from '../hud/PixelIcon';
import { SILHOUETTES } from '../hud/CardTray';

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
