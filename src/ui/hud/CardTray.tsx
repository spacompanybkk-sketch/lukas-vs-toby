import { Component } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CardVM } from '../../app/BattleController';
import type { Faction, UnitKey } from '../../sim/types';
import './hud.css';

export interface CardTrayProps {
  cards: CardVM[];
  selected: UnitKey | null;
  /** Data URLs by unit key; a card without one shows a flat placeholder with the unit's initial. */
  portraits: Record<string, string>;
  side: Faction;
  /** Increments on each refused action; every change shakes the tray for 300 ms. */
  denied: number;
  /** Called with the card's unit on every tap, including a tap on the selected card. */
  onSelect(unit: UnitKey): void;
  /** Called after `onSelect` when the tapped card was already selected (a second tap deselects). */
  onDeselect?(): void;
  /** Plants only: whether the shovel is on, and its toggle. No `onShovel`, no shovel button. */
  shovel?: boolean;
  onShovel?(): void;
}

/** The recharge veil drains in this many visible steps. */
const RECHARGE_STEPS = 8;
const SHAKE_MS = 300;

export function rechargeStep(fraction: number): number {
  return Math.ceil(Math.min(1, Math.max(0, fraction)) * RECHARGE_STEPS) / RECHARGE_STEPS;
}

/**
 * The hand of cards at the bottom of the battle. Touch-first: pointer down on a card selects it
 * at once (so a drag onto the lawn can start from it); a plain tap on the selected card deselects.
 */
export function CardTray(props: CardTrayProps) {
  const { cards, selected, portraits, side, denied, shovel = false, onShovel } = props;
  // Latest props for the handlers below, which stay the same function across renders so that a
  // card whose own entry did not change can skip re-rendering without holding stale callbacks.
  const latest = useRef(props);
  latest.current = props;
  const shake = useShake(denied);
  const { down, click } = useMemo(() => {
    // The unit that this press selected on pointer down, so its click does not deselect it again.
    let pressSelected: UnitKey | null = null;
    return {
      down(unit: UnitKey): void {
        const p = latest.current;
        if (p.selected === unit) {
          pressSelected = null;
          return;
        }
        pressSelected = unit;
        p.onSelect(unit);
      },
      click(unit: UnitKey): void {
        if (pressSelected === unit) {
          pressSelected = null;
          return;
        }
        pressSelected = null;
        const p = latest.current;
        const was = p.selected === unit;
        p.onSelect(unit);
        if (was) p.onDeselect?.();
      },
    };
  }, []);

  const shakeClass = shake === 0 ? '' : shake % 2 === 1 ? ' is-denied is-denied-a' : ' is-denied is-denied-b';
  return (
    <div data-hud="tray" class={`hud-tray px pal-wood side-${side}${shakeClass}`} role="toolbar" aria-label="Cards">
      <div class="hud-tray__cards">
        {cards.map((c) => (
          <Card
            key={c.unit} card={c} side={side} selected={selected === c.unit} portrait={portraits[c.unit]}
            onDown={down} onClick={click}
          />
        ))}
      </div>
      {side === 'plants' && onShovel !== undefined && (
        <button
          type="button" data-shovel
          class={`hud-shovel btn btn--square pal-stone${shovel ? ' is-selected' : ''}`}
          aria-pressed={shovel} aria-label="Shovel"
          onClick={() => onShovel()}
        >
          <span class="ico ico--shovel" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface CardProps {
  card: CardVM; side: Faction; selected: boolean; portrait: string | undefined;
  onDown(unit: UnitKey): void; onClick(unit: UnitKey): void;
}

const sameCard = (a: CardVM, b: CardVM): boolean =>
  a.unit === b.unit && a.name === b.name && a.price === b.price && a.hotkey === b.hotkey
  && a.affordable === b.affordable && a.rechargeFraction === b.rechargeFraction;

/** Re-renders only when its own entry (or its selection, side or portrait) changes. */
class Card extends Component<CardProps> {
  override shouldComponentUpdate(next: CardProps): boolean {
    const p = this.props;
    return !(sameCard(p.card, next.card) && p.selected === next.selected && p.side === next.side
      && p.portrait === next.portrait && p.onDown === next.onDown && p.onClick === next.onClick);
  }

  override render() {
    return renderCard(this.props);
  }
}

function renderCard({ card, side, selected, portrait, onDown, onClick }: CardProps) {
  const veil = rechargeStep(card.rechargeFraction);
  const cls = ['card', 'px', 'pal-side', `card--${side}`];
  if (!card.affordable) cls.push('is-disabled');
  if (selected) cls.push('is-selected');
  if (veil > 0) cls.push('is-recharging');
  return (
    <button
      type="button" data-card={card.unit} class={cls.join(' ')}
      aria-pressed={selected} aria-label={`${card.name}, ${card.price}`}
      onPointerDown={(e) => {
        // First finger or pen, or the main mouse button; never a right click or a second finger.
        if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
        onDown(card.unit);
      }}
      onClick={() => onClick(card.unit)}
    >
      <span class="card__art">
        {portrait !== undefined
          ? <img class="card__img" src={portrait} alt="" draggable={false} />
          : <span class="card__placeholder" aria-hidden="true">{card.name.charAt(0).toUpperCase()}</span>}
      </span>
      <span class="card__name">{card.name}</span>
      <span class="card__price">
        <span class={`ico ico--${side === 'plants' ? 'sun' : 'brain'}`} aria-hidden="true" />
        <span class="card__price-num">{card.price}</span>
      </span>
      {card.hotkey !== '' && <span class="card__hotkey" aria-hidden="true">{card.hotkey}</span>}
      {veil > 0 && <span class="card__recharge" style={{ height: `${veil * 100}%` }} aria-hidden="true" />}
    </button>
  );
}

/**
 * 0 until `denied` first changes after mount; then a counter that bumps on each change and drops
 * back to 0 after SHAKE_MS. The parity lets CSS restart the animation on back-to-back denials.
 */
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
