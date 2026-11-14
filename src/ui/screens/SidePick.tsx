import { useState } from 'preact/hooks';
import type { Skill } from '../../ai/bot';
import type { BattleOptions } from '../../app/BattleController';
import { go } from '../../app/store';
import type { CardKey, Faction } from '../../sim/types';
import type { BoyPortraits } from '../hud/BaseBars';
import './screens.css';
import { BackButton } from '../BackButton';

export interface SidePickProps {
  portraits?: BoyPortraits;
  /** Seed for the battle; defaults to the clock. */
  seed?: () => number;
  /**
   * The logged-in player's difficulty per side: picking a side selects it (instead of
   * `DEFAULT_SKILL`), and `onSkill` hears every change so it can be saved.
   */
  difficulty?: Record<Faction, Skill>;
  /** The side picked from the start (Lukas plants, Toby zombies). */
  side?: Faction | null;
  onSkill?(side: Faction, skill: Skill): void;
  /** The back arrow (default: the title). */
  onBack?(): void;
  /** The logged-in player's Marketplace levels, passed on to the battle (it keeps the picked side's). */
  upgrades?: Partial<Record<CardKey, number>>;
}

const SKILLS: { skill: Skill; label: string; stars: number }[] = [
  { skill: 'easy', label: 'Easy', stars: 1 },
  { skill: 'medium', label: 'Medium', stars: 2 },
  { skill: 'hard', label: 'Hard', stars: 3 },
];

const SIDES: { side: Faction; boy: string; team: string; key: keyof BoyPortraits; icon: string }[] = [
  { side: 'plants', boy: 'LUKAS', team: 'Plants', key: 'lukas', icon: 'sun' },
  { side: 'zombies', boy: 'TOBY', team: 'Zombies', key: 'toby', icon: 'brain' },
];

/**
 * The difficulty a boy's card selects (still changeable afterwards): Easy for Toby, who is almost
 * five; Medium for Lukas.
 */
export const DEFAULT_SKILL: Record<Faction, Skill> = { plants: 'medium', zombies: 'easy' };

/**
 * Two big boy cards, three difficulty buttons, START, and a back arrow. Picking a boy also picks
 * his difficulty (`DEFAULT_SKILL`). START before a boy is picked makes the two cards hop.
 */
export function SidePick({ portraits = {}, seed = () => Date.now(), difficulty, side: firstSide = null, onSkill, onBack = () => go({ name: 'title' }), upgrades }: SidePickProps) {
  const skillFor = (f: Faction): Skill => (difficulty ?? DEFAULT_SKILL)[f];
  const [side, setSide] = useState<Faction | null>(firstSide);
  const [skill, setSkill] = useState<Skill>(firstSide !== null ? skillFor(firstSide) : 'medium');
  const [nudges, setNudges] = useState(0);
  const pick = (picked: Faction): void => {
    setSide(picked);
    setSkill(skillFor(picked));
  };
  const choose = (k: Skill): void => {
    setSkill(k);
    if (side !== null && k !== skill) onSkill?.(side, k);
  };
  const start = (): void => {
    if (side === null) {
      setNudges((n) => n + 1); // the boy cards hop: "pick one of us first"
      return;
    }
    const options: BattleOptions = { playerFaction: side, skill, seed: seed() >>> 0 };
    if (upgrades !== undefined) options.upgrades = { ...upgrades };
    go({ name: 'battle', options });
  };
  // Two alternating animation classes, so every tap restarts the hop.
  const nudge = nudges === 0 ? '' : nudges % 2 === 1 ? ' is-nudged-a' : ' is-nudged-b';
  return (
    <div data-screen="sidepick" class="layer layer--menu sidepick">
      <BackButton data-action="back" class="sidepick__back" onClick={onBack} />
      <div class="sidepick__body stack">
        <div class="sidepick__sides">
          {SIDES.map((s) => {
            const src = portraits[s.key];
            const on = side === s.side;
            return (
              <button
                key={s.side} type="button" data-side={s.side} aria-pressed={on}
                class={`boy px pal-side side-${s.side}${on ? ' is-selected' : ''}${side !== null && !on ? ' is-other' : ''}${side === null ? nudge : ''}`}
                onClick={() => pick(s.side)}
              >
                <span class="boy__art">
                  {src !== undefined
                    ? <img src={src} alt="" draggable={false} />
                    : <span class="boy__placeholder inked" aria-hidden="true">{s.boy.charAt(0)}</span>}
                </span>
                <span class="boy__name inked">{s.boy}</span>
                <span class="boy__team"><span class={`ico ico--${s.icon}`} aria-hidden="true" />{s.team}</span>
              </button>
            );
          })}
        </div>
        <div class="row sidepick__skills" role="group" aria-label="Difficulty">
          {SKILLS.map((k) => (
            <button
              key={k.skill} type="button" data-skill={k.skill} aria-pressed={skill === k.skill}
              class={`btn pal-${skill === k.skill ? 'wood' : 'stone'} skill`} onClick={() => choose(k.skill)}
            >
              <span class="skill__stars" aria-hidden="true">
                {Array.from({ length: k.stars }, (_, i) => <span key={i} class="ico ico--star" />)}
              </span>
              <span class="btn__label inked">{k.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button" data-action="start" aria-disabled={side === null}
          class={`btn btn--big pal-leaf sidepick__start${side === null ? '' : ' is-ready'}`} onClick={start}
        >
          <span class="ico ico--play" aria-hidden="true" /><span class="btn__label inked">START</span>
        </button>
      </div>
    </div>
  );
}
