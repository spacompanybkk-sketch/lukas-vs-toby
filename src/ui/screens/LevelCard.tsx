import type { Skill } from '../../ai/bot';
import { levelHasEnergy } from '../../adventure/campaign';
import { ADVENTURE } from '../../adventure/rewards';
import type { LevelDef, LevelKind } from '../../adventure/types';
import { factionOf, isCard } from '../../data/units';
import type { Save } from '../../progress/save';
import type { UnitKey } from '../../sim/types';
import { SILHOUETTES } from '../hud/CardTray';
import { GLOVE } from '../hud/PointingHand';
import { PixelIcon } from '../hud/PixelIcon';
import type { PixelArt } from '../hud/PixelIcon';
import { BOW, CLOCK, DIFF_EASY, DIFF_HARD, DIFF_NORMAL, FLAG, KIND_ART, SKULL_CROWN, TOWER } from './adventurePictures';
import { STAR, SWORDS } from './boardPictures';
import { dealtCards, enemyUnits, starGoals } from './mapModel';
import type { StarGoal } from './mapModel';
import { ARROW, CROSS, DIGITS, LOCK, PLUS } from './pictures';

/** A level kind's picture: the main one, and a smaller one (the clock) on its corner. */
export function KindPicture({ kind, class: cls = '' }: { kind: LevelKind; class?: string }) {
  const [main, corner] = KIND_ART[kind];
  return (
    <span class={`kind ${cls}`.trim()} data-kind={kind} aria-hidden="true">
      <PixelIcon art={main!} class="kind__main" />
      {corner !== undefined && <PixelIcon art={corner} class="kind__corner" />}
    </span>
  );
}

/** A number in the pixel font (each digit a picture). */
export function Digits({ n, class: cls = '' }: { n: number; class?: string }) {
  return (
    <span class={`digits ${cls}`.trim()} aria-hidden="true">
      {String(n).split('').map((d, i) => <PixelIcon key={i} art={DIGITS[d] as PixelArt} />)}
    </span>
  );
}

/** A unit's card portrait, or its side's boxy silhouette until the portrait is drawn. */
export function UnitPic({ unit, portraits, class: cls = '' }: { unit: UnitKey; portraits: Record<string, string>; class?: string }) {
  const side = factionOf(unit);
  const src = portraits[unit];
  return (
    <span class={`pic side-${side} ${cls}`.trim()} data-picture={unit}>
      {src !== undefined
        ? <img class="pic__img" src={src} alt="" draggable={false} />
        : <PixelIcon art={SILHOUETTES[side]} class="pic__silhouette" />}
    </span>
  );
}

const FACES: { skill: Skill; art: PixelArt; label: string }[] = [
  { skill: 'easy', art: DIFF_EASY, label: 'Easy' },
  { skill: 'medium', art: DIFF_NORMAL, label: 'Normal' },
  { skill: 'hard', art: DIFF_HARD, label: 'Hard' },
];

/**
 * What a star asks, drawn: a flag (win); or a tower (the base) or a clock (time left) over a big
 * bar. The second star's bar is half full and yellow, the third's nearly full and green, so the two
 * never look alike.
 */
function Goal({ goal, step }: { goal: StarGoal; step: 1 | 2 | 3 }) {
  const art = goal.kind === 'win' ? FLAG : goal.kind === 'base' ? TOWER : CLOCK;
  return (
    <span class={`goal goal--${step === 2 ? 'half' : step === 3 ? 'full' : 'win'}`} data-goal={goal.kind} data-share={goal.share} aria-hidden="true">
      <PixelIcon art={art} class="goal__icon" />
      {goal.kind !== 'win' && (
        <span class={`goal__bar goal__bar--${goal.kind}`}>
          <span class="goal__fill" data-fill={step === 2 ? 'yellow' : 'green'} style={{ width: `${goal.share * 100}%` }} />
        </span>
      )}
    </span>
  );
}

export interface LevelCardProps {
  def: LevelDef;
  save: Save;
  portraits: Record<string, string>;
  onPlay(): void;
  /** Plays the level with its whole tutorial again (the small glove button; only when it has one). */
  onTutorial?(): void;
  onSkill(skill: Skill): void;
  onClose(): void;
}

/**
 * An open level's card: its kind and number, the cards to be dealt (portraits), the enemy's
 * pictures, the three stars with what each asks drawn under it (filled as won), a reward
 * silhouette when the level unlocks a unit, a big play button and three skull pictures for the difficulty
 * (the player's saved one ringed). No words needed.
 */
export function LevelCard({ def, save, portraits, onPlay, onTutorial, onSkill, onClose }: LevelCardProps) {
  const stars = save[def.side].stars[def.id] ?? 0;
  const goals = starGoals(def, { base: ADVENTURE.baseStars, clock: ADVENTURE.clockStars });
  const cards = dealtCards(save, def);
  const enemies = enemyUnits(def);
  const skill = save.difficulty[def.side];
  const reward = def.unlocks !== null && stars === 0 ? def.unlocks : null;
  return (
    <div class="card-veil" data-veil onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        data-screen="level-card" data-level={def.id} data-kind={def.kind} data-stars={stars}
        class={`lcard px pal-side side-${def.side}`} role="dialog" aria-label={`Level ${def.n}`}
      >
        <button type="button" data-action="close-card" aria-label="Close" class="btn btn--square pal-wood lcard__close" onClick={onClose}>
          <PixelIcon art={CROSS} class="lcard__close-icon" />
        </button>
        <div class="lcard__head">
          <span class="lcard__kind px pal-cream"><KindPicture kind={def.kind} /></span>
          <Digits n={def.n} class="lcard__n" />
        </div>
        <div class="lcard__sides">
          <div class="lcard__row" data-dealt aria-label="Your cards">
            {cards.map((k) => <UnitPic key={k} unit={k} portraits={portraits} class="lcard__pic" />)}
          </div>
          <span class="lcard__vs" aria-hidden="true"><PixelIcon art={SWORDS} /></span>
          <div class="lcard__row lcard__row--enemy" data-enemy aria-label="Enemies">
            {def.boss !== null && (
              <span class="lcard__boss px pal-red" data-boss={def.boss.key}><PixelIcon art={SKULL_CROWN} /></span>
            )}
            {enemies.slice(0, def.boss !== null ? 3 : 5).map((k) => <UnitPic key={k} unit={k} portraits={portraits} class="lcard__pic" />)}
          </div>
        </div>
        <div class="lcard__stars" aria-label={`${stars} of 3 stars`}>
          {goals.map((g, i) => (
            <span key={i} class={`lcard__star${i < stars ? ' is-won' : ''}`} data-star={i + 1} data-won={i < stars ? '' : undefined}>
              <PixelIcon art={STAR} class="lcard__star-icon" />
              <Goal goal={g} step={(i + 1) as 1 | 2 | 3} />
            </span>
          ))}
          {reward !== null && isCard(reward) && (
            <span class="lcard__plus" aria-hidden="true"><PixelIcon art={PLUS} /></span>
          )}
          {reward !== null && isCard(reward) && (
            // A gift: the new unit's grey silhouette in a box with a bow, apart from the stars.
            <span class="lcard__reward" data-reward={reward} aria-label="A new unit">
              <PixelIcon art={BOW} class="lcard__bow" />
              <span class="lcard__gift px pal-red">
                <UnitPic unit={reward} portraits={portraits} class="lcard__reward-pic" />
              </span>
            </span>
          )}
        </div>
        <div class="lcard__foot">
          {/* The difficulty changes only the player's income: no faces on a level with no energy. */}
          {levelHasEnergy(def) && <div class="lcard__faces" role="group" aria-label="Difficulty">
            {FACES.map((f) => (
              <button
                key={f.skill} type="button" data-skill={f.skill} aria-label={f.label} aria-pressed={f.skill === skill}
                class={`btn lcard__face ${f.skill === skill ? 'pal-cream is-on' : 'pal-stone'}`}
                onClick={() => { if (f.skill !== skill) onSkill(f.skill); }}
              >
                <PixelIcon art={f.art} />
              </button>
            ))}
          </div>}
          {onTutorial !== undefined && def.teaches !== null && def.teaches.length > 0 && (
            <button type="button" data-action="replay-tutorial" aria-label="Show me how" class="btn btn--square pal-cream lcard__teach" onClick={onTutorial}>
              <PixelIcon art={GLOVE} />
            </button>
          )}
          <button type="button" data-action="start-level" aria-label="Play" class="btn btn--big pal-leaf lcard__play" onClick={onPlay}>
            <span class="ico ico--play" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A closed level: its picture behind a padlock, and a big arrow that goes to the level to play
 * now (null: nothing open on this path).
 */
export function LockedCard({ def, next, onNext, onClose }: { def: LevelDef; next: LevelDef | null; onNext(): void; onClose(): void }) {
  return (
    <div class="card-veil" data-veil onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div data-screen="level-card" data-level={def.id} data-locked class={`lcard lcard--locked px pal-side side-${def.side}`} role="dialog" aria-label="Locked">
        <button type="button" data-action="close-card" aria-label="Close" class="btn btn--square pal-wood lcard__close" onClick={onClose}>
          <PixelIcon art={CROSS} class="lcard__close-icon" />
        </button>
        <div class="lcard__locked">
          <span class="lcard__kind px pal-stone is-dim"><KindPicture kind={def.kind} /></span>
          <span class="lcard__padlock"><PixelIcon art={LOCK} /></span>
        </div>
        {next !== null && (
          <button type="button" data-action="go-next" data-next={next.id} aria-label="To the next level" class="btn btn--big pal-leaf lcard__go" onClick={onNext}>
            <PixelIcon art={ARROW} class="lcard__go-arrow" />
            <span class="lcard__go-kind"><KindPicture kind={next.kind} /></span>
            <Digits n={next.n} class="lcard__go-n" />
          </button>
        )}
      </div>
    </div>
  );
}
