// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardVM } from '../../src/app/BattleController';
import { PLANT_KEYS, UNIT_INFO } from '../../src/data/units';
import { CardTray, rechargeStep, trayRows } from '../../src/ui/hud/CardTray';
import type { CardTrayProps } from '../../src/ui/hud/CardTray';

const CARDS: CardVM[] = [
  { unit: 'peashooter', name: 'Peashooter', price: 100, hotkey: '1', affordable: true, rechargeFraction: 0 },
  { unit: 'sunflower', name: 'Sunflower', price: 50, hotkey: '2', affordable: true, rechargeFraction: 0.5 },
  { unit: 'cherryBomber', name: 'Cherry Bomber', price: 150, hotkey: '3', affordable: false, rechargeFraction: 0 },
];

const TEN: CardVM[] = PLANT_KEYS.map((unit, i) => ({
  unit, name: UNIT_INFO[unit].name, price: 50 + i * 25, hotkey: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'][i] ?? '',
  affordable: i % 3 !== 2, rechargeFraction: i === 4 ? 0.5 : 0,
}));

/** Sets the window size the tray lays itself out for, and tells it so. */
function viewport(width: number, height: number): void {
  act(() => {
    (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height });
    window.dispatchEvent(new Event('resize'));
  });
}

let root: HTMLElement;

beforeEach(() => {
  viewport(1440, 900);
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  vi.useRealTimers();
});

function mount(over: Partial<CardTrayProps> = {}): CardTrayProps {
  const props: CardTrayProps = {
    cards: CARDS, selected: null, portraits: {}, side: 'plants', denied: 0, onSelect: vi.fn(), ...over,
  };
  act(() => render(<CardTray {...props} />, root));
  return props;
}

const cards = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-card]')];
const card = (unit: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-card="${unit}"]`);
  if (el === null) throw new Error(`no card ${unit}`);
  return el;
};
const tray = (): HTMLElement => {
  const el = root.querySelector<HTMLElement>('[data-hud="tray"]');
  if (el === null) throw new Error('no tray');
  return el;
};

describe('CardTray', () => {
  it('renders one card per CardVM with its name, price and hotkey', () => {
    mount();
    expect(cards()).toHaveLength(3);
    const pea = card('peashooter');
    expect(pea.textContent).toContain('Peashooter');
    expect(pea.querySelector('.card__price')?.textContent).toContain('100');
    expect(pea.querySelector('.card__hotkey')?.textContent).toBe('1');
    expect(card('cherryBomber').querySelector('.card__price')?.textContent).toContain('150');
  });

  it('marks an unaffordable card is-disabled', () => {
    mount();
    expect(card('cherryBomber').classList.contains('is-disabled')).toBe(true);
    expect(card('peashooter').classList.contains('is-disabled')).toBe(false);
  });

  it('clicking a card calls onSelect with its unit', () => {
    const props = mount();
    act(() => card('sunflower').click());
    expect(props.onSelect).toHaveBeenCalledWith('sunflower');
  });

  it('gives the selected card is-selected', () => {
    mount({ selected: 'sunflower' });
    expect(card('sunflower').classList.contains('is-selected')).toBe(true);
    expect(card('peashooter').classList.contains('is-selected')).toBe(false);
  });

  it('tapping the selected card again deselects it', () => {
    const onDeselect = vi.fn();
    const props = mount({ selected: 'sunflower', onDeselect });
    act(() => card('sunflower').click());
    expect(props.onSelect).toHaveBeenCalledWith('sunflower');
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('pointer down on a card selects it at once, and the click that follows does not deselect', () => {
    const onDeselect = vi.fn();
    const props = mount({ onDeselect });
    const pea = card('peashooter');
    act(() => { pea.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true })); });
    expect(props.onSelect).toHaveBeenCalledWith('peashooter');
    mount({ ...props, selected: 'peashooter', onDeselect }); // the parent re-renders with the selection
    act(() => card('peashooter').click());
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('shakes (is-denied) for 300 ms each time denied changes, not on first render', () => {
    vi.useFakeTimers();
    const props = mount({ denied: 4 });
    expect(tray().classList.contains('is-denied')).toBe(false);
    mount({ ...props, denied: 5 });
    expect(tray().classList.contains('is-denied')).toBe(true);
    act(() => { vi.advanceTimersByTime(310); });
    expect(tray().classList.contains('is-denied')).toBe(false);
  });

  it('shows the portrait image when given, else a boxy silhouette in the side\'s colour, never a letter', () => {
    // Partial portraits (some still being drawn): each card shows what it has.
    mount({ portraits: { peashooter: 'data:image/png;base64,AAAA' } });
    expect(card('peashooter').querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(card('sunflower').querySelector('img')).toBeNull();
    const placeholder = card('sunflower').querySelector('.card__placeholder');
    expect(placeholder?.querySelector('svg')).not.toBeNull();
    // No letter anywhere a child sees: the card's visible text is its price and hotkey only.
    for (const el of tray().querySelectorAll('[data-card]')) {
      const art = el.querySelector('.card__art') as HTMLElement;
      expect(art.textContent?.trim()).toBe('');
    }
  });

  it('drains the recharge overlay in steps', () => {
    mount();
    const veil = card('sunflower').querySelector<HTMLElement>('.card__recharge');
    expect(veil?.style.height).toBe('50%');
    expect(card('peashooter').querySelector('.card__recharge')).toBeNull();
  });

  it('shows a shovel button for plants only, which calls onShovel', () => {
    const onShovel = vi.fn();
    mount({ onShovel, shovel: true });
    const btn = root.querySelector<HTMLElement>('[data-shovel]');
    expect(btn?.classList.contains('is-selected')).toBe(true);
    act(() => btn?.click());
    expect(onShovel).toHaveBeenCalledTimes(1);
    mount({ side: 'zombies', onShovel });
    expect(root.querySelector('[data-shovel]')).toBeNull();
  });

  it('ignores a right-button mouse press and a second finger', () => {
    const props = mount();
    const pea = card('peashooter');
    act(() => {
      pea.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerType: 'mouse', button: 2 }));
      pea.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: false, pointerType: 'touch', button: 0 }));
    });
    expect(props.onSelect).not.toHaveBeenCalled();
    act(() => {
      pea.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerType: 'touch', button: 0 }));
    });
    expect(props.onSelect).toHaveBeenCalledWith('peashooter');
  });

  it('quantises the recharge veil up to eighths', () => {
    expect(rechargeStep(0)).toBe(0);
    expect(rechargeStep(0.01)).toBe(0.125);
    expect(rechargeStep(0.125)).toBe(0.125);
    expect(rechargeStep(0.3)).toBe(0.375);
    expect(rechargeStep(0.51)).toBe(0.625);
    expect(rechargeStep(1)).toBe(1);
    expect(rechargeStep(1.7)).toBe(1);
    expect(rechargeStep(-0.2)).toBe(0);
    mount({ cards: [{ ...CARDS[0]!, rechargeFraction: 0.3 }] });
    expect(card('peashooter').querySelector<HTMLElement>('.card__recharge')?.style.height).toBe('37.5%');
  });

  it('renders ten cards, each selectable, with the hotkeys 1 to 0', () => {
    const props = mount({ cards: TEN });
    expect(cards()).toHaveLength(10);
    expect(cards().map((c) => c.querySelector('.card__hotkey')?.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    for (const c of TEN) {
      act(() => card(c.unit).click());
      expect(props.onSelect).toHaveBeenLastCalledWith(c.unit);
    }
    expect(props.onSelect).toHaveBeenCalledTimes(10);
    mount({ ...props, selected: 'pumpkinSquash' });
    expect(card('pumpkinSquash').classList.contains('is-selected')).toBe(true);
    expect(cards().filter((c) => c.classList.contains('is-selected'))).toHaveLength(1);
  });

  it('lays ten cards in one row on a wide window and in two rows of five at 1024 x 768, sized by trayLayout', () => {
    mount({ cards: TEN });
    expect(tray().classList.contains('hud-tray--rows-2')).toBe(false);
    expect(tray().style.getPropertyValue('--tray-cols')).toBe('10');
    viewport(1024, 768);
    expect(tray().classList.contains('hud-tray--rows-2')).toBe(true);
    expect(tray().style.getPropertyValue('--tray-cols')).toBe('5');
    viewport(1180, 820);
    expect(tray().classList.contains('hud-tray--rows-2')).toBe(true);
    viewport(1280, 800);
    expect(tray().classList.contains('hud-tray--rows-2')).toBe(false);
    viewport(1024, 768);
    expect(tray().style.getPropertyValue('--card-w')).toBe('67.5px');
  });

  it('keeps a short hand in one row at any size', () => {
    viewport(1024, 768);
    mount();
    expect(tray().classList.contains('hud-tray--rows-2')).toBe(false);
    expect(tray().style.getPropertyValue('--tray-cols')).toBe('3');
  });

  it('trayRows: two rows only when they give bigger cards than one row (the iPad sizes)', () => {
    expect(trayRows(10, 1024, 768)).toBe(2);
    expect(trayRows(10, 1024, 704)).toBe(2);
    expect(trayRows(10, 1180, 820)).toBe(2);
    // Safari with its bars showing: too short for two rows above the lawn's edge.
    expect(trayRows(10, 1024, 650)).toBe(1);
    expect(trayRows(10, 1180, 746)).toBe(1);
    expect(trayRows(10, 1194, 760)).toBe(1);
    expect(trayRows(10, 1366, 950)).toBe(1);
    expect(trayRows(10, 1440, 900)).toBe(1);
    expect(trayRows(10, 1152, 648)).toBe(1);
    expect(trayRows(5, 1024, 768)).toBe(1);
    expect(trayRows(6, 1024, 768)).toBe(1);
    expect(trayRows(0, 1024, 768)).toBe(1);
  });
});
