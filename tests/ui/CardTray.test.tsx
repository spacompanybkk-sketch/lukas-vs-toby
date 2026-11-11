// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardVM } from '../../src/app/BattleController';
import { CardTray } from '../../src/ui/hud/CardTray';
import type { CardTrayProps } from '../../src/ui/hud/CardTray';

const CARDS: CardVM[] = [
  { unit: 'peashooter', name: 'Peashooter', price: 100, hotkey: '1', affordable: true, rechargeFraction: 0 },
  { unit: 'sunflower', name: 'Sunflower', price: 50, hotkey: '2', affordable: true, rechargeFraction: 0.5 },
  { unit: 'cherryBomber', name: 'Cherry Bomber', price: 150, hotkey: '3', affordable: false, rechargeFraction: 0 },
];

let root: HTMLElement;

beforeEach(() => {
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

  it('shows the portrait image when given, else a placeholder with the initial', () => {
    mount({ portraits: { peashooter: 'data:image/png;base64,AAAA' } });
    expect(card('peashooter').querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(card('sunflower').querySelector('img')).toBeNull();
    expect(card('sunflower').querySelector('.card__placeholder')?.textContent).toBe('S');
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
});
