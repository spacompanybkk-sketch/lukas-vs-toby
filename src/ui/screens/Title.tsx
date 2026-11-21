import type { ReadonlySignal } from '@preact/signals';
import { go } from '../../app/store';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { touch } from '../versus/types';
import { SWORDS } from './boardPictures';
import { FakeBadge } from './FakeBadge';
import './screens.css';
import '../versus/versus.css';

export interface TitleProps {
  onSettings(): void;
  /** A Versus match this device left (a reload) can still be rejoined: the "back to the battle" button shows. */
  canRejoin?: ReadonlySignal<boolean>;
  onRejoin?(): void;
}

/** The "back to the battle" button's size: well over the 64 px of any Versus button. */
export const REJOIN_PX = 96;

/** The game's name, one big PLAY (to the players' pictures), and a gear. The bot battle plays behind it. */
export function Title({ onSettings, canRejoin, onRejoin }: TitleProps) {
  return (
    <div data-screen="title" class="layer layer--menu title">
      <h1 class="logo" aria-label="Lukas Plants vs Toby Zombies">
        <span class="logo__line logo__line--plants inked">LUKAS PLANTS</span>
        <span class="logo__vs inked">vs</span>
        <span class="logo__line logo__line--zombies inked">TOBY ZOMBIES</span>
      </h1>
      <button type="button" data-action="play" class="btn btn--big pal-leaf title__play" onClick={() => go({ name: 'players' })}>
        <span class="ico ico--play" aria-hidden="true" /><span class="btn__label inked">PLAY</span>
      </button>
      {canRejoin?.value === true && onRejoin !== undefined && (
        <button
          type="button" data-action="rejoin" aria-label="Back to the battle" class="btn btn--square pal-purple title__rejoin"
          style={touch(REJOIN_PX)} onClick={() => { uiSound('click'); onRejoin(); }}
        >
          <PixelIcon art={SWORDS} class="vs-icon" />
        </button>
      )}
      <FakeBadge />
      <button type="button" data-action="settings" class="btn btn--square pal-stone title__gear" aria-label="Settings" onClick={onSettings}>
        <span class="ico ico--gear" aria-hidden="true" />
      </button>
    </div>
  );
}
