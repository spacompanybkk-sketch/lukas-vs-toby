import { go } from '../../app/store';
import './screens.css';

export interface TitleProps {
  onSettings(): void;
}

/** The game's name, one big PLAY (to the players' pictures), and a gear. The bot battle plays behind it. */
export function Title({ onSettings }: TitleProps) {
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
      <button type="button" data-action="settings" class="btn btn--square pal-stone title__gear" aria-label="Settings" onClick={onSettings}>
        <span class="ico ico--gear" aria-hidden="true" />
      </button>
    </div>
  );
}
