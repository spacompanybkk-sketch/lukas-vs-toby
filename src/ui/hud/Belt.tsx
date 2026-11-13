import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BeltCardVM } from '../../app/BattleController';
import type { Faction } from '../../sim/types';
import { SILHOUETTES } from './CardTray';
import { PixelIcon } from './PixelIcon';
import { useTrayLayout } from './trayLayout';
import './hud.css';
import './level.css';

export interface BeltProps {
  cards: BeltCardVM[];
  /** How many cards fit on the belt (the level's slots). */
  slots: number;
  /** The picked card's slot, or null. */
  selected: number | null;
  portraits: Record<string, string>;
  side: Faction;
  /** Increments on each refused action; every change shakes the belt. */
  denied: number;
  /** A card picked (pointer down, so a drag onto the lawn can start from it), or null: put down. */
  onSelect(slot: number | null): void;
  /** Plants only: the shovel, as on the tray. */
  shovel?: boolean;
  onShovel?(): void;
}

const SHAKE_MS = 300;

/**
 * The conveyor belt, in place of the card tray when the level's belt is the player's. Cards
 * arrive on their own and slide in from the right end; they cost nothing and never recharge, so a
 * card shows only its picture. Tap a card, then a tile; or drag it onto the lawn. A tap on the
 * picked card puts it down. When a card is played the ones behind it slide down the belt.
 */
export function Belt(props: BeltProps) {
  const { cards, slots, selected, portraits, side, denied, shovel = false, onShovel } = props;
  const latest = useRef(props);
  latest.current = props;
  const layout = useTrayLayout(slots);
  const shake = useShake(denied);
  const { down, click } = useMemo(() => {
    let pressSelected: number | null = null;
    return {
      down(slot: number): void {
        const p = latest.current;
        if (p.selected === slot) {
          pressSelected = null;
          return;
        }
        pressSelected = slot;
        p.onSelect(slot);
      },
      click(slot: number): void {
        if (pressSelected === slot) {
          pressSelected = null;
          return;
        }
        pressSelected = null;
        const p = latest.current;
        p.onSelect(p.selected === slot ? null : slot);
      },
    };
  }, []);
  const shakeClass = shake === 0 ? '' : shake % 2 === 1 ? ' is-denied is-denied-a' : ' is-denied is-denied-b';
  return (
    <div
      data-hud="belt" class={`hud-belt px pal-wood side-${side}${shakeClass}`}
      style={{ '--slots': String(slots), '--tray-gap': `${layout.gap}px`, '--card-w': `${layout.card}px` }}
      role="toolbar" aria-label="Belt"
    >
      <div class="hud-belt__track">
        <span class="hud-belt__rubber" aria-hidden="true" />
        {cards.map((c, i) => (
          <button
            key={c.id} type="button" data-card={c.card} data-belt={c.id} data-slot={i}
            class={`card belt-card px pal-side card--${side}${selected === i ? ' is-selected' : ''}`}
            style={{ '--slot': String(i), '--from': String(Math.max(1, slots - i)) }}
            aria-pressed={selected === i} aria-label={c.card}
            onPointerDown={(e) => {
              if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
              down(i);
            }}
            onClick={() => click(i)}
          >
            <span class="card__art">
              {portraits[c.card] !== undefined
                ? <img class="card__img" src={portraits[c.card]} alt="" draggable={false} />
                : <span class="card__placeholder" aria-hidden="true"><PixelIcon art={SILHOUETTES[side]} class="card__silhouette" /></span>}
            </span>
          </button>
        ))}
      </div>
      {side === 'plants' && onShovel !== undefined && (
        <button
          type="button" data-shovel class={`hud-shovel btn btn--square pal-stone${shovel ? ' is-selected' : ''}`}
          aria-pressed={shovel} aria-label="Shovel" onClick={() => onShovel()}
        >
          <span class="ico ico--shovel" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function useShake(denied: number): number {
  const first = useRef(denied);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (denied === first.current) return undefined;
    first.current = denied;
    setN((v) => (v % 2) + 1);
    const t = setTimeout(() => setN(0), SHAKE_MS);
    return () => clearTimeout(t);
  }, [denied]);
  return n;
}
