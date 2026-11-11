import { useState } from 'preact/hooks';
import type { Skill } from '../../ai/bot';
import { go } from '../../app/store';
import type { Faction } from '../../sim/types';
import type { BoyPortraits } from '../hud/BaseBars';
import './screens.css';

export interface SidePickProps {
  portraits?: BoyPortraits;
  /** Seed for the battle; defaults to the clock. */
  seed?: () => number;
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

/** Two big boy cards, three difficulty buttons (Medium first), START, and a back arrow. */
export function SidePick({ portraits = {}, seed = () => Date.now() }: SidePickProps) {
  const [side, setSide] = useState<Faction | null>(null);
  const [skill, setSkill] = useState<Skill>('medium');
  const start = (): void => {
    if (side === null) return;
    go({ name: 'battle', options: { playerFaction: side, skill, seed: seed() >>> 0 } });
  };
  return (
    <div data-screen="sidepick" class="layer layer--menu sidepick">
      <button type="button" data-action="back" class="btn btn--square pal-wood sidepick__back" aria-label="Back" onClick={() => go({ name: 'title' })}>
        <span class="ico ico--back" aria-hidden="true" />
      </button>
      <div class="sidepick__body stack">
        <div class="sidepick__sides">
          {SIDES.map((s) => {
            const src = portraits[s.key];
            const on = side === s.side;
            return (
              <button
                key={s.side} type="button" data-side={s.side} aria-pressed={on}
                class={`boy px pal-side side-${s.side}${on ? ' is-selected' : ''}${side !== null && !on ? ' is-other' : ''}`}
                onClick={() => setSide(s.side)}
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
              class={`btn pal-${skill === k.skill ? 'wood' : 'stone'} skill`} onClick={() => setSkill(k.skill)}
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
