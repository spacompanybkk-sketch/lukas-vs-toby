import { useEffect, useRef, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import type { Faction } from '../../sim/types';
import './hud.css';

export interface EnergyCounterProps {
  value: number;
  side: Faction;
  /** The battle session reads this element's rect to fly energy tokens into it. */
  anchorRef?: Ref<HTMLDivElement>;
  /** The tutorial's cue (p1-2): when it turns 1, the counter pulses big, once ("the Sunflower pays"). */
  teach?: number;
}

/** Sun (plants) or brains (zombies) and a big number; it bumps whenever the value goes up. */
export function EnergyCounter({ value, side, anchorRef, teach = 0 }: EnergyCounterProps) {
  const last = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (value > last.current) setBump((b) => (b % 2) + 1);
    last.current = value;
  }, [value]);
  const bumpClass = bump === 0 ? '' : bump === 1 ? ' is-bump-a' : ' is-bump-b';
  return (
    <div
      data-hud="energy" ref={anchorRef}
      class={`hud-energy px pal-side side-${side}${bumpClass}${teach > 0 ? ' is-teach' : ''}`} data-teach={teach > 0 ? '' : undefined}
      aria-label={`${side === 'plants' ? 'Sun' : 'Brains'} ${value}`}
    >
      <span class={`hud-energy__icon ico ico--${side === 'plants' ? 'sun' : 'brain'}`} aria-hidden="true" />
      <span class="hud-energy__value inked">{value}</span>
    </div>
  );
}
