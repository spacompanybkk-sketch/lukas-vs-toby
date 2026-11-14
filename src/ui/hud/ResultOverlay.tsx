import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { BattleResult } from '../../app/BattleController';
import type { RankUp } from '../../app/board';
import type { LevelOutcome } from '../../app/levelSession';
import type { UnitKey } from '../../sim/types';
import { CLOCK, KIND_ART, PATH_FLAG, TOWER } from '../screens/adventurePictures';
import { levelById } from '../../adventure/levels';
import { starRule } from '../../adventure/rewards';
import { STAR } from '../screens/boardPictures';
import { ARROW, COIN, DIGITS } from '../screens/pictures';
import { BURST } from './levelPictures';
import './level.css';
import { RankUpBadge } from '../screens/RankBlock';
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
  /** The player moved up a leaderboard table: its picture, an up arrow and the new place, by the coins. */
  rankUp?: RankUp | null;
  /**
   * An Adventure level's result (applied to the save): its stars pop in one by one, the coins fall,
   * an unlocked unit turns on the turntable; the buttons are next level, replay and the map.
   */
  level?: LevelOutcome | null;
  /** The next level (shown when `level.next` is open). */
  onNext?(): void;
  /** Back to the level's map. */
  onMap?(): void;
  /** The turntable on the stage, for the unlocked unit (none: its card picture). */
  turntable?: Turntable;
  /** Card portraits by unit key (the unlocked unit's picture without a turntable). */
  cards?: Record<string, string>;
}

/** The Almanac's turntable, as the result uses it. */
export interface Turntable { open(key: UnitKey, level: number, framing?: 'almanac' | 'reveal'): void; close(): void }

/** The first star pops this long after the panel shows, the next ones `STAR_STAGGER_MS` apart. */
export const STAR_FIRST_MS = 650;
export const STAR_STAGGER_MS = 450;
/** The merge sound's pitch for star 1, 2 and 3: rising. */
export const STAR_PITCH = [1, 1.25, 1.5] as const;

/** At most this many coin blocks fall, one per 5 coins. */
const MAX_BLOCKS = 14;
/** Each block lands this long after the one before. */
export const COIN_STAGGER_MS = 90;

/** The coins earned, falling as blocks one after another into a row, with their sum and a blip each. */
export function CoinRain({ coins, children }: { coins: number; children?: ComponentChildren }) {
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
      {children}
    </div>
  );
}

export function resultWord(result: NonNullable<BattleResult>): 'VICTORY!' | 'DEFEAT' | 'DRAW' {
  if (result.winner === 'draw') return 'DRAW';
  return result.playerWon ? 'VICTORY!' : 'DEFEAT';
}

/** VICTORY! / DEFEAT / DRAW, the winner's portrait, the match time, Play again and Menu. */
export function ResultOverlay(props: ResultOverlayProps) {
  if (props.level !== undefined && props.level !== null) return <LevelResultOverlay {...props} level={props.level} />;
  const { result, playerFaction, seconds, portraits = {}, onPlayAgain, onMenu, coins = null, rankUp = null } = props;
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
        {coins !== null && coins > 0
          ? <CoinRain coins={coins}>{rankUp !== null && <RankUpBadge up={rankUp} />}</CoinRain>
          : rankUp !== null && <div class="coin-rain"><RankUpBadge up={rankUp} /></div>}
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

type Step = 'stars' | 'coins' | 'unlock';

/**
 * Why a star was won or lost, without words: the level's own star rule (`starRule`) drawn as its
 * picture (the base's tower, or the clock for Breakthrough), a bar filled to what was kept at the
 * end, and a star standing on the bar at each share the second and third stars ask - gold when the
 * fill reached it, grey when it stopped short. Shown for a win whose share is known.
 */
export function StarMeter({ levelId, stars, share }: { levelId: string; stars: number; share: number }) {
  const def = levelById(levelId);
  if (def === null) return null;
  const rule = starRule(def);
  const marks: [2 | 3, number][] = [[2, rule.two], [3, rule.three]];
  return (
    <div class={`lmeter lmeter--${rule.measure}`} data-star-meter={rule.measure} data-share={share} aria-hidden="true">
      <PixelIcon art={rule.measure === 'clock' ? CLOCK : TOWER} class="lmeter__icon" />
      <span class="lmeter__bar">
        <span class="lmeter__fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` }} />
        {marks.map(([n, at]) => (
          <span
            key={n} class={`lmeter__mark${stars >= n ? ' is-reached' : ''}`} data-mark={n}
            data-reached={stars >= n ? '' : undefined} style={{ left: `${at * 100}%` }}
          >
            <PixelIcon art={STAR} />
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * The result of an Adventure level, step by step: the stars (0–3) pop in one by one with the
 * merge sound at a rising pitch; then the coins fall; then a newly unlocked unit turns on the
 * turntable with a golden burst. A loss shows its consolation coins at once. Buttons by picture:
 * the next level (when open), replay, the map.
 */
function LevelResultOverlay(props: ResultOverlayProps & { level: LevelOutcome }) {
  const { result, playerFaction, portraits = {}, level, onPlayAgain, onNext, onMap, onMenu, turntable, cards = {}, rankUp = null } = props;
  const word = resultWord(result);
  const tone = word === 'VICTORY!' ? 'win' : word === 'DEFEAT' ? 'lose' : 'draw';
  const winners: Faction[] = result.winner === 'draw' ? ['plants', 'zombies'] : [result.winner];
  const [lit, setLit] = useState(0);
  const [step, setStep] = useState<Step>(level.stars === 0 ? 'coins' : 'stars');

  // The stars, one by one; then the coins.
  useEffect(() => {
    const ids: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < level.stars; i++) {
      ids.push(setTimeout(() => {
        setLit(i + 1);
        uiSound('merge', { pitch: STAR_PITCH[i] });
      }, STAR_FIRST_MS + i * STAR_STAGGER_MS));
    }
    if (level.stars > 0) ids.push(setTimeout(() => setStep('coins'), STAR_FIRST_MS + level.stars * STAR_STAGGER_MS));
    return () => ids.forEach(clearTimeout);
  }, [level]);

  // After the coins, the unlocked unit.
  useEffect(() => {
    if (step !== 'coins' || level.unlocked === null) return undefined;
    const t = setTimeout(() => setStep('unlock'), 1200);
    return () => clearTimeout(t);
  }, [step, level]);

  const unlocked = step === 'unlock' ? level.unlocked : null;
  useEffect(() => {
    if (unlocked === null || turntable === undefined) return undefined;
    turntable.open(unlocked, 1, 'reveal');
    uiSound('win');
    return () => turntable.close();
  }, [unlocked, turntable]);

  const nextKind = level.next === null ? null : KIND_ART[level.next.kind][0];
  const onStage = unlocked !== null && turntable !== undefined;
  return (
    <div
      data-screen="result" data-level-result={level.levelId} data-stars={level.stars} data-step={step}
      class={`layer layer--dim result result--${tone}${onStage ? ' has-turntable' : ''}`} role="dialog" aria-label={word}
    >
      {onStage && (
        // Over the stage, at the unit's shoulder (the turntable stands in the left of the screen).
        <div class="lresult__unlock lresult__unlock--stage" data-unlock={unlocked}>
          <span class="lresult__burst"><PixelIcon art={BURST} /></span>
        </div>
      )}
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
        <div class="lresult">
          <div class="lresult__stars" data-lit={lit} aria-label={`${level.stars} of 3 stars`}>
            {[0, 1, 2].map((i) => (
              <span key={i} class={`lresult__star${i < lit ? ' is-on' : ''}`} data-star={i + 1} data-on={i < lit ? '' : undefined}>
                <PixelIcon art={STAR} />
              </span>
            ))}
          </div>
          {level.won && level.share !== undefined && level.share !== null && (
            <StarMeter levelId={level.levelId} stars={level.stars} share={level.share} />
          )}
          {step !== 'stars' && (
            level.coins > 0
              ? <CoinRain coins={level.coins}>{rankUp !== null && <RankUpBadge up={rankUp} />}</CoinRain>
              : rankUp !== null && <div class="coin-rain"><RankUpBadge up={rankUp} /></div>
          )}
          {unlocked !== null && !onStage && (
            <div class="lresult__unlock" data-unlock={unlocked}>
              <span class="lresult__burst"><PixelIcon art={BURST} /></span>
              {cards[unlocked] !== undefined && (
                <span class="lresult__unit card px pal-side"><img src={cards[unlocked]} alt="" draggable={false} /></span>
              )}
            </div>
          )}
          <div class="row lresult__buttons">
            {level.next !== null && onNext !== undefined && nextKind !== null && nextKind !== undefined && (
              <button type="button" data-action="next-level" data-next={level.next.id} class="btn btn--big pal-leaf lresult__btn" aria-label="Next level" onClick={onNext}>
                <span class="lresult__next">
                  <PixelIcon art={nextKind} />
                  <PixelIcon art={DIGITS[String(level.next.n)] ?? ARROW} />
                  <PixelIcon art={ARROW} />
                </span>
              </button>
            )}
            <button type="button" data-action="replay" class={`btn btn--big ${level.next === null ? 'pal-leaf' : 'pal-cream'} lresult__btn`} aria-label="Play again" onClick={onPlayAgain}>
              <span class="ico ico--restart" aria-hidden="true" />
            </button>
            <button type="button" data-action="map" class="btn btn--big pal-cream lresult__btn" aria-label="Map" onClick={onMap ?? onMenu}>
              <PixelIcon art={PATH_FLAG} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
