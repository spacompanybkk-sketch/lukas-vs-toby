import { useEffect } from 'preact/hooks';
import type { BattleResult } from '../../app/BattleController';
import { COIN } from '../screens/pictures';
import { uiSound } from '../uiSound';
import { PixelIcon } from './PixelIcon';
import type { Faction } from '../../sim/types';
import { BOYS } from './BaseBars';
import type { BoyPortraits } from './BaseBars';
import { formatClock } from './TopBar';
import './hud.css';

export interface ResultOverlayProps {
  result: NonNullable<BattleResult>;
  playerFaction: Faction;
  seconds: number;
  portraits?: BoyPortraits;
  onPlayAgain(): void;
  onMenu(): void;
  /** Coins earned (a logged-in player): they fall as coin blocks under the word. */
  coins?: number | null;
}

/** At most this many coin blocks fall, one per 5 coins. */
const MAX_BLOCKS = 14;
/** Each block lands this long after the one before. */
export const COIN_STAGGER_MS = 90;

/** The coins earned, falling as blocks one after another into a row, with their sum and a blip each. */
export function CoinRain({ coins }: { coins: number }) {
  const blocks = Math.max(1, Math.min(MAX_BLOCKS, Math.round(coins / 5)));
  useEffect(() => {
    const ids = Array.from({ length: blocks }, (_, i) => setTimeout(() => uiSound('bounty'), 300 + i * COIN_STAGGER_MS));
    return () => ids.forEach(clearTimeout);
  }, [blocks]);
  return (
    <div class="coin-rain" data-coins-earned={coins} aria-label={`${coins} coins`}>
      <div class="coin-rain__blocks" aria-hidden="true">
        {Array.from({ length: blocks }, (_, i) => (
          <span key={i} class="coin-rain__block" style={{ animationDelay: `${i * COIN_STAGGER_MS}ms` }}>
            <PixelIcon art={COIN} />
          </span>
        ))}
      </div>
      <span class="coin-rain__sum px pal-wood">
        <PixelIcon art={COIN} class="coin-rain__icon" />
        <span class="inked">+{coins}</span>
      </span>
    </div>
  );
}

export function resultWord(result: NonNullable<BattleResult>): 'VICTORY!' | 'DEFEAT' | 'DRAW' {
  if (result.winner === 'draw') return 'DRAW';
  return result.playerWon ? 'VICTORY!' : 'DEFEAT';
}

/** VICTORY! / DEFEAT / DRAW, the winner's portrait, the match time, Play again and Menu. */
export function ResultOverlay({ result, playerFaction, seconds, portraits = {}, onPlayAgain, onMenu, coins = null }: ResultOverlayProps) {
  const word = resultWord(result);
  const tone = word === 'VICTORY!' ? 'win' : word === 'DEFEAT' ? 'lose' : 'draw';
  const winners: Faction[] = result.winner === 'draw' ? ['plants', 'zombies'] : [result.winner];
  return (
    <div data-screen="result" class={`layer layer--dim result result--${tone}`} role="dialog" aria-label={word}>
      <div class={`result__panel panel px pal-side side-${playerFaction}`}>
        <h2 class="result__word inked">{word}</h2>
        <div class="row result__winners">
          {winners.map((f) => {
            const boy = BOYS[f];
            const src = portraits[boy.key];
            return (
              <span key={f} class={`result__chip chip px pal-side side-${f}`}>
                {src !== undefined ? <img src={src} alt={boy.name} draggable={false} /> : <span>{boy.name.charAt(0)}</span>}
              </span>
            );
          })}
        </div>
        <div class="result__time px pal-stone">
          <span class="hud-top__face" aria-hidden="true" />
          <span class="inked">{formatClock(seconds)}</span>
        </div>
        {coins !== null && coins > 0 && <CoinRain coins={coins} />}
        <div class="row">
          <button type="button" data-action="play-again" class="btn btn--big pal-leaf" onClick={onPlayAgain}>
            <span class="ico ico--restart" aria-hidden="true" /><span class="btn__label inked">Play again</span>
          </button>
          <button type="button" data-action="menu" class="btn btn--big pal-cream" onClick={onMenu}>
            <span class="ico ico--home" aria-hidden="true" /><span class="btn__label">Menu</span>
          </button>
        </div>
      </div>
    </div>
  );
}
