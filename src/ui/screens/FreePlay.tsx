import { useEffect, useState } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import type { EndlessSignals } from '../../app/BattleController';
import { RING_STEPS } from '../../app/BattleController';
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
import { COIN, outlined } from './pictures';
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

/** The hourglass's frame; '.' inside the glass is filled by `hourglass` (sand or empty glass). */
const GLASS = [
  'oooooooooooooo',
  'obbbbbbbbbbbbo',
  'oooooooooooooo',
  '.o..........o.',
  '.o..........o.',
  '..o........o..',
  '...o......o...',
  '....o....o....',
  '.....o..o.....',
  '.....o..o.....',
  '....o....o....',
  '...o......o...',
  '..o........o..',
  '.o..........o.',
  '.o..........o.',
  'oooooooooooooo',
  'obbbbbbbbbbbbo',
  'oooooooooooooo',
];

/** The inside cells of a glass row (between its two walls), as column indexes. */
function inside(row: string): number[] {
  const first = row.indexOf('o');
  const last = row.lastIndexOf('o');
  const out: number[] = [];
  for (let x = first + 1; x < last; x++) out.push(x);
  return out;
}

/**
 * The hourglass with `left` of `RING_STEPS` still to run: the top bulb holds that share of the sand
 * (settled at its bottom), the bottom bulb the rest (piled from its floor), and a thin stream runs
 * through the neck while it drains.
 */
function hourglass(left: number, steps: number): PixelArt {
  const rows = GLASS.map((r) => [...r]);
  const topRows = [7, 6, 5, 4, 3]; // the top bulb, bottom row first
  const bottomRows = [14, 13, 12, 11, 10]; // the bottom bulb, floor first
  const topCells = topRows.flatMap((y) => inside(GLASS[y]!).map((x) => [y, x] as const));
  const bottomCells = bottomRows.flatMap((y) => inside(GLASS[y]!).map((x) => [y, x] as const));
  const total = topCells.length;
  const sandTop = Math.round((total * Math.max(0, Math.min(steps, left))) / steps);
  for (const [y, x] of [...topCells, ...bottomCells]) rows[y]![x] = 'c';
  topCells.slice(0, sandTop).forEach(([y, x]) => { rows[y]![x] = 'y'; });
  bottomCells.slice(0, total - sandTop).forEach(([y, x]) => { rows[y]![x] = 'y'; });
  for (const y of [8, 9]) for (const x of inside(GLASS[y]!)) rows[y]![x] = 'c';
  if (left > 0 && left < steps) { rows[8]![6] = 'Y'; rows[9]![6] = 'Y'; }
  return art(rows.map((r) => r.join('')));
}

/** The hourglass at each of its steps, drawn once. */
const HOURGLASSES: readonly PixelArt[] = Array.from({ length: RING_STEPS + 1 }, (_, k) => hourglass(k, RING_STEPS));

/** The next wave's countdown: an hourglass that drains, `left` of `RING_STEPS` still to go. */
export function WaveTimer({ left }: { left: number }) {
  const k = Math.max(0, Math.min(RING_STEPS, left));
  return (
    <span class="fp-glass" data-hud="next-wave" data-left={k} aria-hidden="true">
      <PixelIcon art={HOURGLASSES[k]!} />
    </span>
  );
}

/** A garden: a picket fence on grass, with a flower. Breakthrough's banner shows it ("garden N"). */
export const GARDEN: PixelArt = art(outlined([
  '................',
  '.............n..',
  '............nyn.',
  '..h....h.....nG.',
  '.hhh..hhh..hhhG.',
  '.hBh..hBh..hBhG.',
  'hhhhhhhhhhhhhhhh',
  'BBBBBBBBBBBBBBBB',
  '.hBh..hBh..hBh..',
  '.hBh..hBh..hBh..',
  'hhhhhhhhhhhhhhhh',
  'BBBBBBBBBBBBBBBB',
  '.hBh..hBh..hBh..',
  'gggggggggggggggg',
  'GGGGGGGGGGGGGGGG',
  '................',
]));

/** How long the "+30" stays over the clock after a garden is broken. */
export const BONUS_MS = 1200;

/** The top of a Free Play run: the flag counter, and the ring (survive) or the clock (breakthrough). */
export function FreePlayTop({ endless, bonusSeconds }: { endless: EndlessSignals; bonusSeconds: number }) {
  return (
    <div class="fp-top" data-hud="free-top" data-mode={endless.mode}>
      <FlagCounter wave={endless.wave} />
      {endless.mode === 'survive' ? <LiveTimer next={endless.nextWave} /> : <LiveClock clock={endless.clock} bonus={endless.bonus} bonusSeconds={bonusSeconds} />}
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

function LiveTimer({ next }: { next: ReadonlySignal<number> }) {
  return <span class="fp-glass-box px pal-stone"><WaveTimer left={next.value} /></span>;
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
 * A wave or a garden has started: a plaque with its picture and number — survive: the flag and
 * the wave (the counter's own picture and number); breakthrough: a garden and "garden N" (the
 * counter there counts gardens broken, with the flag). On every tenth the big one's black
 * silhouette stands beside it. It takes no taps.
 */
export function WaveBanner({ banner, side, mode, big, portraits }: {
  banner: ReadonlySignal<{ wave: number; big: boolean; n: number } | null>; side: Faction; mode: 'survive' | 'breakthrough';
  big: CardKey | null; portraits: Record<string, string>;
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
    <div key={now.n} class={`fp-banner px pal-stone side-${side}${now.big ? ' is-big' : ''}`} data-banner="wave" data-kind={mode === 'breakthrough' ? 'garden' : 'wave'} data-wave={now.wave} data-big={now.big ? '' : undefined}>
      <PixelIcon art={mode === 'breakthrough' ? GARDEN : FLAG} class="fp-banner__flag" />
      <Digits n={now.wave} class="fp-banner__n" />
      {now.big && big !== null && <UnitPic unit={big} portraits={portraits} class="fp-banner__big" />}
    </div>
  );
}

/** What ending a run now would bank, shown on the pause menu's armed Quit: the flag and number, and the coins. */
export function RunBank({ wave, coins }: { wave: number; coins: number }) {
  return (
    <span class="fp-bank" data-bank-wave={wave} data-bank-coins={coins} aria-label={`${coins} coins`}>
      <span class="fp-bank__flag"><PixelIcon art={FLAG} /><Digits n={wave} class="fp-bank__n" /></span>
      <span class="fp-bank__coins px pal-wood"><PixelIcon art={COIN} class="fp-bank__coin" /><span class="inked">+{coins}</span></span>
    </span>
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
