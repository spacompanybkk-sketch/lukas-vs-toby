import { Component } from 'preact';
import type { Faction } from '../../sim/types';
import { PixelIcon } from './PixelIcon';
import type { PixelArt } from './PixelIcon';
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
  /** The boy's portrait (an image URL); without it his side's emblem. */
  portrait?: string;
  /** Its last press was refused: 0 still; 1 and 2 alternate so each refusal restarts the shake. */
  shake?: number;
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

/** Each side's emblem, shown when there is no portrait: a sunflower, a zombie's face. */
export const FACTION_EMBLEMS: Record<Faction, PixelArt> = {
  plants: {
    rows: [
      '.....oo.....',
      '..oooyyooo..',
      '.oyyoyyoyyo.',
      '.oyyyyyyyyo.',
      '.ooybBbbyoo.',
      'oyyyBbbByyyo',
      'oYYYbbBbYYYo',
      '.ooYbBbbYoo.',
      '.oYYYYYYYYo.',
      '.oYYoYYoYYo.',
      '..oooYYooo..',
      '.....oo.....',
    ],
    palette: { o: '#2A1B0E', y: '#FFD54A', Y: '#F59F0B', b: '#8B5A2B', B: '#6B4423' },
  },
  zombies: {
    rows: [
      '............',
      '..ooooooo...',
      '.ogggggggo..',
      '.ogggggggo..',
      '.oWWgggWWo..',
      '.oWkgggkWo..',
      '.ogggggggo..',
      '.ogoooooGo..',
      '.ogwowowGo..',
      '.oGGGGGGGo..',
      '..ooooooo...',
      '............',
    ].map((r) => `.${r.slice(0, 11)}`),
    palette: { o: '#2A1B0E', g: '#9ACD8A', G: '#6FA364', W: '#FFFFFF', k: '#2A1B0E', w: '#EDE6D3' },
  },
};

/** What a power button draws from: the props that change its look, in whole charge steps. */
export interface PowerLook { ready: boolean; step: number; selected: boolean; shake: number }

export const sameLook = (a: PowerLook, b: PowerLook): boolean =>
  a.ready === b.ready && a.step === b.step && a.selected === b.selected && a.shake === b.shake;

/** The shake classes for a refused press (see `HeroButtonProps.shake`). */
export const shakeClass = (shake: number): string => (shake === 0 ? '' : shake % 2 === 1 ? ' is-denied is-denied-a' : ' is-denied is-denied-b');

/**
 * Press handling for the power buttons, touch first, as the cards do it: a press counts on
 * pointer down, so a drag from the button onto the lawn starts with the power already picked,
 * and the click that ends that same press is swallowed. A button already picked does nothing on
 * the down; its click puts it down. A click with no down before it (a key) presses.
 */
export class PressGate {
  private downed = false;

  down(e: PointerEvent, selected: boolean, press: () => void): void {
    // First finger or pen, or the main mouse button; never a right click or a second finger.
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.downed = !selected;
    if (!selected) press();
  }

  click(press: () => void): void {
    if (this.downed) {
      this.downed = false;
      return;
    }
    press();
  }
}

/**
 * The boy's hero power: a big square with his portrait. While it charges a dark veil over the
 * portrait drops away in steps from the top; when ready a boxy gold frame pulses round it.
 * Re-renders only when what it shows changes (a whole charge step, ready, selected), not on
 * every tick of the charge.
 */
export class HeroButton extends Component<HeroButtonProps> {
  override shouldComponentUpdate(next: HeroButtonProps): boolean {
    const p = this.props;
    return !(p.faction === next.faction && p.portrait === next.portrait
      && sameLook(lookOf(p), lookOf(next)));
  }

  private readonly gate = new PressGate();
  private readonly press = (): void => this.props.onPress();
  private readonly down = (e: PointerEvent): void => this.gate.down(e, this.props.selected, this.press);
  private readonly click = (): void => this.gate.click(this.press);

  override render() {
    const { faction, ready, selected, portrait } = this.props;
    const { step } = lookOf(this.props);
    const cls = ['power', 'power--hero', 'px', `power--${faction}`, ready ? 'is-ready' : 'is-charging'];
    if (selected) cls.push('is-selected');
    return (
      <button
        type="button" data-hero={faction} class={cls.join(' ') + shakeClass(this.props.shake ?? 0)}
        aria-label={HERO_NAMES[faction]} aria-pressed={selected} aria-disabled={ready ? undefined : 'true'}
        onPointerDown={this.down} onClick={this.click}
      >
        <span class="power__art">
          {portrait !== undefined
            ? <img class="power__img" src={portrait} alt="" draggable={false} />
            : <PixelIcon art={FACTION_EMBLEMS[faction]} class="power__emblem" />}
        </span>
        <PowerCharge ready={ready} step={step} />
      </button>
    );
  }
}

const lookOf = (p: { ready: boolean; fraction: number; selected: boolean; shake?: number }): PowerLook =>
  ({ ready: p.ready, step: p.ready ? 1 : chargeStep(p.fraction), selected: p.selected, shake: p.shake ?? 0 });

/**
 * The charge overlay shared by the hero and spell buttons: while charging, a dark veil over the
 * part still to charge (top down) and a bar of CHARGE_STEPS blocks lit by CSS from `--lit`; when
 * ready, the pulsing frame.
 */
export function PowerCharge({ ready, step }: { ready: boolean; step: number }) {
  if (ready) return <span class="power__frame" aria-hidden="true" />;
  return (
    <>
      {step < 1 && <span class="power__veil" style={{ height: `${(1 - step) * 100}%` }} aria-hidden="true" />}
      <span class="power__pips" style={{ '--lit': String(Math.round(step * CHARGE_STEPS)) }} aria-hidden="true" />
    </>
  );
}
