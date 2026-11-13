import { useEffect, useState } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import type { EndlessSignals } from '../../app/BattleController';
import type { RankUp } from '../../app/board';
import type { FreePlayOutcome } from '../../app/levelSession';
import { UNIT_INFO } from '../../data/units';
import type { CardKey, Faction } from '../../sim/types';
import { PixelIcon } from '../hud/PixelIcon';
import type { PixelArt } from '../hud/PixelIcon';
import { formatClock } from '../hud/TopBar';
import { CoinRain } from '../hud/ResultOverlay';
import { RankUpBadge } from './RankBlock';
import { CLOCK, FLAG } from './adventurePictures';
import { art } from './boardPictures';
import { outlined } from './pictures';
import { Digits, UnitPic } from './LevelCard';
import './freeplay.css';

/**
 * Free Play's screen parts (plan Task 7): the flag counter at the top (with the next wave's
 * countdown ring in survive, or the clock with its "+30" in breakthrough), the wave banner, and
 * the result. Pictures and numbers only. Each part reads only the signals it shows, so a long run
 * re-renders a part only when what it shows changes; nothing here runs per frame.
 */

/** A gold crown: the best wave yet. */
export const CROWN: PixelArt = art(outlined([
  '................',
  '................',
  '..y....y....y...',
  '..yy..yyy..yy...',
  '..yyy.yyy.yyy...',
  '..yyyyyyyyyyy...',
  '..ylyyyryyyyY...',
  '..yyyyyyyyyyY...',
  '..yyyyyyyyyyY...',
  '..YYYYYYYYYYY...',
  '................',
]));

/** The 12 cells of the ring, clockwise from the top left, as [row, col] on a 4 × 4 grid. */
const RING_CELLS: readonly (readonly [number, number])[] = [
  [0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0],
];

/** The next wave's countdown: a ring of `RING_STEPS` boxy cells, lit for the gap still to go. */
export function WaveRing({ left }: { left: number }) {
  return (
    <span class="fp-ring" data-hud="next-wave" data-left={left} aria-hidden="true">
      {RING_CELLS.map(([r, c], i) => (
        <span key={i} class={`fp-ring__cell${i < left ? ' is-on' : ''}`} style={{ gridRow: r + 1, gridColumn: c + 1 }} />
      ))}
    </span>
  );
}

/** How long the "+30" stays over the clock after a garden is broken. */
export const BONUS_MS = 1200;

/** The top of a Free Play run: the flag counter, and the ring (survive) or the clock (breakthrough). */
export function FreePlayTop({ endless, bonusSeconds }: { endless: EndlessSignals; bonusSeconds: number }) {
  return (
    <div class="fp-top" data-hud="free-top" data-mode={endless.mode}>
      <FlagCounter wave={endless.wave} />
      {endless.mode === 'survive' ? <LiveRing next={endless.nextWave} /> : <LiveClock clock={endless.clock} bonus={endless.bonus} bonusSeconds={bonusSeconds} />}
    </div>
  );
}

function FlagCounter({ wave }: { wave: ReadonlySignal<number> }) {
  const n = wave.value;
  return (
    <span class="fp-flags px pal-wood" data-hud="free-wave" data-wave={n} aria-label={`Wave ${n}`}>
      <PixelIcon art={FLAG} class="fp-flags__flag" />
      <Digits n={n} class="fp-flags__n" />
    </span>
  );
}

function LiveRing({ next }: { next: ReadonlySignal<number> }) {
  return <span class="fp-ring-box px pal-stone"><WaveRing left={next.value} /></span>;
}

function LiveClock({ clock, bonus, bonusSeconds }: { clock: ReadonlySignal<number>; bonus: ReadonlySignal<number>; bonusSeconds: number }) {
  const n = bonus.value;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (n === 0) return undefined;
    setShown(n);
    const t = setTimeout(() => setShown(0), BONUS_MS);
    return () => clearTimeout(t);
  }, [n]);
  const seconds = clock.value;
  return (
    <span class={`fp-clock px pal-stone${seconds <= 15 ? ' is-low' : ''}`} data-hud="free-clock" data-left={seconds} role="timer">
      <PixelIcon art={CLOCK} class="fp-clock__icon" />
      <span class="fp-clock__time inked">{formatClock(seconds)}</span>
      {shown > 0 && <span key={shown} class="fp-bonus inked" data-bonus={bonusSeconds}>+{bonusSeconds}</span>}
    </span>
  );
}

/** How long a wave's banner shows. */
export const WAVE_BANNER_MS = 1600;

/** The priciest of `cards` (the first on a tie): the big one of every tenth wave. */
export function bigOne(cards: readonly CardKey[]): CardKey | null {
  let best: CardKey | null = null;
  for (const c of cards) if (best === null || UNIT_INFO[c].price > UNIT_INFO[best].price) best = c;
  return best;
}

/**
 * A wave (or garden) has started: a band across the sky with the flag and its number; on every
 * tenth the big one's black silhouette stands beside it. It takes no taps.
 */
export function WaveBanner({ banner, side, big, portraits }: {
  banner: ReadonlySignal<{ wave: number; big: boolean; n: number } | null>; side: Faction; big: CardKey | null; portraits: Record<string, string>;
}) {
  const now = banner.value;
  const [gone, setGone] = useState(0);
  useEffect(() => {
    if (now === null) return undefined;
    const t = setTimeout(() => setGone(now.n), WAVE_BANNER_MS);
    return () => clearTimeout(t);
  }, [now]);
  if (now === null || gone === now.n) return null;
  return (
    <div key={now.n} class={`fp-banner px pal-stone side-${side}${now.big ? ' is-big' : ''}`} data-banner="wave" data-wave={now.wave} data-big={now.big ? '' : undefined}>
      <PixelIcon art={FLAG} class="fp-banner__flag" />
      <Digits n={now.wave} class="fp-banner__n" />
      {now.big && big !== null && <UnitPic unit={big} portraits={portraits} class="fp-banner__big" />}
    </div>
  );
}

/**
 * The end of a run: the wave reached as a big flag number, a crown when it is the best yet, the
 * coins falling (5 a wave cleared), and two buttons by picture: again, and Home.
 */
export function FreePlayResult({ outcome, side, rankUp, onAgain, onHome }: {
  outcome: FreePlayOutcome | null; side: Faction; rankUp: RankUp | null;
  onAgain(): void; onHome(): void;
}) {
  const wave = outcome?.wave ?? 0;
  return (
    <div
      data-screen="result" data-free-result={side} data-wave={wave} data-best={outcome?.best === true ? '' : undefined}
      class="layer layer--dim result result--free" role="dialog" aria-label={`Wave ${wave}`}
    >
      <div class={`result__panel panel px pal-side side-${side} fp-result`}>
        <div class="fp-result__wave" aria-hidden="true">
          {outcome?.best === true && <PixelIcon art={CROWN} class="fp-result__crown" />}
          <PixelIcon art={FLAG} class="fp-result__flag" />
          <Digits n={wave} class="fp-result__n" />
        </div>
        {outcome !== null && outcome.coins > 0
          ? <CoinRain coins={outcome.coins}>{rankUp !== null && <RankUpBadge up={rankUp} />}</CoinRain>
          : rankUp !== null && <div class="coin-rain"><RankUpBadge up={rankUp} /></div>}
        <div class="row lresult__buttons">
          <button type="button" data-action="play-again" class="btn btn--big pal-leaf lresult__btn" aria-label="Play again" onClick={onAgain}>
            <span class="ico ico--restart" aria-hidden="true" />
          </button>
          <button type="button" data-action="menu" class="btn btn--big pal-cream lresult__btn" aria-label="Home" onClick={onHome}>
            <span class="ico ico--home" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
