import type { Faction } from '../../sim/types';
import { BOYS } from './BaseBars';
import './hud.css';

export interface HeroButtonProps {
  faction: Faction;
  /** The power can be used now. */
  ready: boolean;
  /** How far it has charged, 0..1 (shown in whole steps). */
  fraction: number;
  /** The power is picked and waits for a lane. */
  selected: boolean;
  /** Every tap; the controller decides what it means (pick, cancel, or a refusal while charging). */
  onPress(): void;
  /** The boy's portrait (an image URL); without it a flat chip with his initial. */
  portrait?: string;
}

/** What each boy's power is called (the button's accessible name). */
export const HERO_NAMES: Record<Faction, string> = { plants: 'Mega Mower', zombies: 'Bone Storm' };

/** Charge fills in this many visible steps. */
export const CHARGE_STEPS = 8;

/** The charge in whole eighths, rounded down so a button never looks readier than it is. */
export function chargeStep(fraction: number): number {
  if (!(fraction > 0)) return 0;
  return Math.floor(Math.min(1, fraction) * CHARGE_STEPS) / CHARGE_STEPS;
}

/**
 * The boy's hero power: a big square with his portrait. While it charges a dark veil over the
 * portrait drops away in steps from the top; when ready a boxy gold frame pulses round it.
 */
export function HeroButton({ faction, ready, fraction, selected, onPress, portrait }: HeroButtonProps) {
  const boy = BOYS[faction];
  const veil = ready ? 0 : 1 - chargeStep(fraction);
  const cls = ['power', 'power--hero', 'px', `power--${faction}`, ready ? 'is-ready' : 'is-charging'];
  if (selected) cls.push('is-selected');
  return (
    <button
      type="button" data-hero={faction} class={cls.join(' ')}
      aria-label={HERO_NAMES[faction]} aria-pressed={selected} aria-disabled={ready ? undefined : 'true'}
      onClick={() => onPress()}
    >
      <span class="power__art">
        {portrait !== undefined
          ? <img class="power__img" src={portrait} alt="" draggable={false} />
          : <span class="power__initial" aria-hidden="true">{boy.name.charAt(0)}</span>}
      </span>
      {veil > 0 && <PowerVeil veil={veil} />}
      {!ready && <ChargePips fraction={fraction} />}
      {ready && <span class="power__frame" aria-hidden="true" />}
    </button>
  );
}

/** The dark veil over the part still to charge, from the top down. */
export function PowerVeil({ veil }: { veil: number }) {
  return <span class="power__veil" style={{ height: `${veil * 100}%` }} aria-hidden="true" />;
}

/** A row of CHARGE_STEPS blocks along the bottom, lit one by one as the power charges. */
export function ChargePips({ fraction }: { fraction: number }) {
  const lit = Math.round(chargeStep(fraction) * CHARGE_STEPS);
  const pips = [];
  for (let i = 0; i < CHARGE_STEPS; i++) pips.push(<span key={i} class={i < lit ? 'is-lit' : undefined} />);
  return <span class="power__pips" aria-hidden="true">{pips}</span>;
}
