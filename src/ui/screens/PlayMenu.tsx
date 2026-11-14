import { useState } from 'preact/hooks';
import { session } from '../../app/session';
import { go, startFreePlay } from '../../app/store';
import { factionOf } from '../../data/units';
import type { Faction } from '../../sim/types';
import type { BoyPortraits } from '../hud/BaseBars';
import { SILHOUETTES } from '../hud/CardTray';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { PATH_FLAG } from './adventurePictures';
import { ROBOT, SWORDS, WAVE } from './boardPictures';
import { LOCK } from './pictures';
import './players.css';
import './adventure.css';

type Mode = 'adventure' | 'quick' | 'free';

/** A small "needs a player" badge: a player's silhouette with a padlock on it. */
function PlayerLock() {
  return (
    <span class="play__lock px pal-slate" data-player-lock aria-hidden="true">
      <span class="pic side-plants play__lock-pic"><PixelIcon art={SILHOUETTES.plants} class="pic__silhouette" /></span>
      <PixelIcon art={LOCK} class="play__lock-icon" />
    </span>
  );
}

/**
 * The Play menu: three big picture buttons. Adventure (a path up to a flag), Quick Battle (crossed
 * swords and a robot: the side pick and a computer), Free Play (a wave). A guest (nobody logged in)
 * has Quick Battle only: the other two carry a player picture with a padlock and refuse with a buzz.
 */
export function PlayMenu() {
  const me = session.player.value;
  const guest = me === null;
  const [nudge, setNudge] = useState<{ mode: Mode; n: number } | null>(null);
  const choose = (mode: Mode): void => {
    if (guest && mode !== 'quick') {
      uiSound('deny');
      setNudge((was) => ({ mode, n: (was?.n ?? 0) + 1 }));
      return;
    }
    uiSound('click');
    if (mode === 'quick') go({ name: 'sidepick' });
    else go({ name: 'side', mode });
  };
  const hop = (mode: Mode): string => (nudge?.mode === mode ? (nudge.n % 2 === 1 ? ' is-nudged-a' : ' is-nudged-b') : '');
  return (
    <div data-screen="play" class="layer layer--menu play">
      <button
        type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back"
        onClick={() => { uiSound('click'); go({ name: guest ? 'title' : 'home' }); }}
      >
        <span class="ico ico--back" aria-hidden="true" />
      </button>
      <div class="play__modes">
        <button
          type="button" data-play="adventure" aria-label="Adventure" data-locked={guest ? '' : undefined}
          class={`btn play__mode pal-leaf${guest ? ' is-locked' : ''}${hop('adventure')}`} onClick={() => choose('adventure')}
        >
          <PixelIcon art={PATH_FLAG} class="play__art" />
          {guest && <PlayerLock />}
        </button>
        <button
          type="button" data-play="quick" aria-label="Quick Battle"
          class="btn play__mode pal-wood" onClick={() => choose('quick')}
        >
          <span class="play__duo">
            <PixelIcon art={SWORDS} class="play__art" />
            <PixelIcon art={ROBOT} class="play__corner" />
          </span>
        </button>
        <button
          type="button" data-play="free" aria-label="Free Play" data-locked={guest ? '' : undefined}
          class={`btn play__mode pal-slate${guest ? ' is-locked' : ''}${hop('free')}`} onClick={() => choose('free')}
        >
          <PixelIcon art={WAVE} class="play__art" />
          {guest && <PlayerLock />}
        </button>
      </div>
    </div>
  );
}

const SIDES: { side: Faction; boy: keyof BoyPortraits; unit: string; label: string }[] = [
  { side: 'plants', boy: 'lukas', unit: 'peashooter', label: 'Lukas’s plants' },
  { side: 'zombies', boy: 'toby', unit: 'brainEater', label: 'Toby’s zombies' },
];

/** A boy's portrait standing in front of his side's first unit. */
export function BoyAndUnit({ side, boys, portraits, class: cls = '' }: {
  side: Faction; boys: BoyPortraits; portraits: Record<string, string>; class?: string;
}) {
  const s = SIDES.find((x) => x.side === side)!;
  const boy = boys[s.boy];
  const unit = portraits[s.unit];
  return (
    <span class={`duo side-${side} ${cls}`.trim()} aria-hidden="true">
      <span class="duo__unit pic">
        {unit !== undefined ? <img class="pic__img" src={unit} alt="" draggable={false} /> : <PixelIcon art={SILHOUETTES[side]} class="pic__silhouette" />}
      </span>
      <span class="duo__boy">
        {boy !== undefined ? <img src={boy} alt="" draggable={false} /> : <PixelIcon art={SILHOUETTES[side]} class="pic__silhouette" />}
      </span>
    </span>
  );
}

/**
 * Adventure or Free Play: which side. Two big pictures, Lukas in front of a Peashooter and Toby in
 * front of a Brain Eater. Any player may play either side; the side of the player's own picture
 * gently bounces.
 */
export function PlaySide({ mode, boys = {}, portraits = {} }: { mode: 'adventure' | 'free'; boys?: BoyPortraits; portraits?: Record<string, string> }) {
  const me = session.player.value;
  const mine: Faction | null = me === null ? null : factionOf(me.picture);
  const pick = (side: Faction): void => {
    uiSound('click');
    if (mode === 'adventure') go({ name: 'map', side });
    else if (me !== null) startFreePlay(side, me);
  };
  return (
    <div data-screen="side" data-mode={mode} class="layer layer--menu play">
      <button
        type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back"
        onClick={() => { uiSound('click'); go({ name: 'play' }); }}
      >
        <span class="ico ico--back" aria-hidden="true" />
      </button>
      <span class="play__mode-mark px pal-cream" aria-hidden="true">
        <PixelIcon art={mode === 'adventure' ? PATH_FLAG : WAVE} />
      </span>
      <div class="play__sides">
        {SIDES.map((s) => (
          <button
            key={s.side} type="button" data-side={s.side} aria-label={s.label}
            class={`btn play__side px pal-side side-${s.side}${mine === s.side ? ' is-mine' : ''}`} onClick={() => pick(s.side)}
          >
            <BoyAndUnit side={s.side} boys={boys} portraits={portraits} class="play__duo-big" />
            <span class={`ico ico--${s.side === 'plants' ? 'sun' : 'brain'} play__side-mark`} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
