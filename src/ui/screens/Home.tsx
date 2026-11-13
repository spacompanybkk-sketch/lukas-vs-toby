import { useEffect, useState } from 'preact/hooks';
import { session } from '../../app/session';
import { go } from '../../app/store';
import { factionOf } from '../../data/units';
import type { Screen } from '../../app/store';
import { PixelIcon } from '../hud/PixelIcon';
import type { PixelArt } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { PlayerPicture } from './PlayerPicture';
import { ARROW, BOOK, CLOUD, CLOUD_OFF, COIN, DOOR, LAPTOP, MARKET, TABLET, TROPHY } from './pictures';
import './players.css';

type Place = 'marketplace' | 'almanac' | 'leaderboard';

const PLACES: { name: Place; art: PixelArt; label: string; pal: string }[] = [
  { name: 'marketplace', art: MARKET, label: 'Marketplace', pal: 'pal-wood' },
  { name: 'almanac', art: BOOK, label: 'Almanac', pal: 'pal-cream' },
  { name: 'leaderboard', art: TROPHY, label: 'Leaderboard', pal: 'pal-slate' },
];

/** How long the two-devices cue stays after progress from another device was merged in. */
const MERGED_CUE_MS = 4000;

/** True for a few seconds each time another device's progress was merged in (`merged`, earlier `replaced`). */
function useMergedCue(sync: string): boolean {
  const [shown, setShown] = useState(false);
  const merged = sync === 'merged' || sync === 'replaced';
  useEffect(() => {
    if (!merged) return undefined;
    setShown(true);
    const t = setTimeout(() => setShown(false), MERGED_CUE_MS);
    return () => clearTimeout(t);
  }, [merged]);
  return shown;
}

/**
 * The logged-in player's home: their picture, name and coins; one huge Play; three big picture
 * buttons (Marketplace, Almanac, Leaderboard); a small door to log out. Reading is never needed.
 */
export function Home({ portraits = {} }: { portraits?: Record<string, string> }) {
  const player = session.player.value;
  const sync: string = session.syncState.value;
  const mergedCue = useMergedCue(sync);
  const loggedOut = player === null;
  // Logged out (the door, or a grown-up removed this player): back to the pictures, after render.
  useEffect(() => {
    if (loggedOut) go({ name: 'players' });
  }, [loggedOut]);
  if (player === null) return null;
  const to = (s: Screen): void => {
    uiSound('click');
    go(s);
  };
  return (
    <div data-screen="home" class="layer layer--menu home">
      <div class={`home__me px pal-side side-${factionOf(player.picture)}`} data-me={player.slot}>
        <PlayerPicture picture={player.picture} portraits={portraits} class="home__pic" />
        <span class="home__name inked">{player.name}</span>
        <span class="home__coins" data-coins={player.coins} aria-label={`${player.coins} coins`}>
          <PixelIcon art={COIN} class="home__coin" />
          <span class="inked">{player.coins}</span>
        </span>
        {mergedCue && (
          <span class="home__merged px pal-cream" data-merged aria-label="Progress from another device">
            <PixelIcon art={TABLET} class="home__merged-dev" />
            <PixelIcon art={ARROW} class="home__merged-arrow" />
            <PixelIcon art={LAPTOP} class="home__merged-dev" />
          </span>
        )}
        <span class={`home__sync is-${sync}`} data-sync={sync} aria-label={sync === 'offline' ? 'Not saved online yet' : 'Saved'}>
          <PixelIcon art={sync === 'offline' ? CLOUD_OFF : CLOUD} />
        </span>
      </div>
      <button
        type="button" data-action="logout" aria-label="Log out" class="btn btn--square pal-wood home__door"
        onClick={() => {
          uiSound('click');
          session.logout();
          go({ name: 'players' });
        }}
      >
        <PixelIcon art={DOOR} class="home__door-icon" />
      </button>
      <div class="home__menu">
        <button type="button" data-home="play" aria-label="Play" class="btn btn--big pal-leaf home__play" onClick={() => to({ name: 'sidepick' })}>
          <span class="ico ico--play home__play-icon" aria-hidden="true" />
        </button>
        <div class="home__places">
          {PLACES.map((p) => (
            <button key={p.name} type="button" data-home={p.name} aria-label={p.label} class={`btn home__place ${p.pal}`} onClick={() => to({ name: p.name })}>
              <PixelIcon art={p.art} class="home__place-icon" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
