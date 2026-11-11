import type { BaseVM } from '../../app/BattleController';
import type { Faction } from '../../sim/types';
import './hud.css';

/** Portrait data URLs of the two boys, when rendered; otherwise flat chips with their initials. */
export interface BoyPortraits { lukas?: string; toby?: string }

export interface BaseBarsProps {
  base: Record<Faction, BaseVM>;
  playerFaction: Faction;
  portraits?: BoyPortraits;
}

/** The health bar fills in this many visible blocks. */
const BAR_STEPS = 20;

export function hpStep(hp: number, max: number): number {
  if (max <= 0) return 0;
  return Math.ceil(Math.min(1, Math.max(0, hp / max)) * BAR_STEPS) / BAR_STEPS;
}

export const BOYS: Record<Faction, { name: string; key: keyof BoyPortraits }> = {
  plants: { name: 'LUKAS', key: 'lukas' },
  zombies: { name: 'TOBY', key: 'toby' },
};

/** Lukas's base health top left and Toby's top right, each under his portrait chip. */
export function BaseBars({ base, playerFaction, portraits = {} }: BaseBarsProps) {
  return (
    <>
      <BaseBar faction="plants" vm={base.plants} you={playerFaction === 'plants'} portrait={portraits.lukas} />
      <BaseBar faction="zombies" vm={base.zombies} you={playerFaction === 'zombies'} portrait={portraits.toby} />
    </>
  );
}

interface BaseBarProps { faction: Faction; vm: BaseVM; you: boolean; portrait: string | undefined }

export function BaseBar({ faction, vm, you, portrait }: BaseBarProps) {
  const frac = hpStep(vm.hp, vm.max);
  const level = frac <= 0.25 ? 'low' : frac <= 0.5 ? 'mid' : 'good';
  const boy = BOYS[faction];
  return (
    <div
      data-hud={`base-${faction}`}
      class={`hud-base hud-base--${faction} side-${faction}${you ? ' is-player' : ''}`}
    >
      <span class="hud-base__chip chip px pal-side">
        {portrait !== undefined ? <img src={portrait} alt="" draggable={false} /> : <span aria-hidden="true">{boy.name.charAt(0)}</span>}
      </span>
      <span class="hud-base__name inked">{boy.name}</span>
      <span
        class={`hud-base__bar px hud-base__bar--${level}`}
        role="meter" aria-label={`${boy.name} base`} aria-valuemin={0} aria-valuemax={vm.max} aria-valuenow={vm.hp}
      >
        <span class="hud-base__fill" style={{ width: `${frac * 100}%` }} />
        <span class="hud-base__ticks" aria-hidden="true" />
      </span>
    </div>
  );
}
