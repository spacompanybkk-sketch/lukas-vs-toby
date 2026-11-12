// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO_NAMES, HeroButton, chargeStep } from '../../src/ui/hud/HeroButton';
import type { HeroButtonProps } from '../../src/ui/hud/HeroButton';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

function mount(over: Partial<HeroButtonProps> = {}): HeroButtonProps {
  const props: HeroButtonProps = { faction: 'plants', ready: false, fraction: 0.4, selected: false, onPress: vi.fn(), ...over };
  act(() => render(<HeroButton {...props} />, root));
  return props;
}

const btn = (): HTMLButtonElement => {
  const el = root.querySelector<HTMLButtonElement>('[data-hero]');
  if (el === null) throw new Error('no hero button');
  return el;
};

describe('HeroButton', () => {
  it('is a button named after the power, which calls onPress on a tap', () => {
    const props = mount();
    expect(btn().tagName).toBe('BUTTON');
    expect(btn().getAttribute('type')).toBe('button');
    expect(btn().getAttribute('aria-label')).toBe('Mega Mower');
    act(() => btn().click());
    expect(props.onPress).toHaveBeenCalledTimes(1);
    mount({ faction: 'zombies' });
    expect(btn().getAttribute('aria-label')).toBe('Bone Storm');
    expect(btn().getAttribute('data-hero')).toBe('zombies');
    expect(HERO_NAMES).toEqual({ plants: 'Mega Mower', zombies: 'Bone Storm' });
  });

  it('while charging: a stepped fill, no ready pulse, aria-disabled', () => {
    mount({ fraction: 0.4 });
    expect(btn().classList.contains('is-charging')).toBe(true);
    expect(btn().classList.contains('is-ready')).toBe(false);
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    // 0.4 charged shows as 3 of 8 blocks: the veil over the rest covers 5/8.
    expect(btn().querySelector<HTMLElement>('.power__veil')?.style.height).toBe('62.5%');
  });

  it('when ready: the pulsing frame and no veil', () => {
    mount({ ready: true, fraction: 1 });
    expect(btn().classList.contains('is-ready')).toBe(true);
    expect(btn().classList.contains('is-charging')).toBe(false);
    expect(btn().getAttribute('aria-disabled')).toBeNull();
    expect(btn().querySelector('.power__veil')).toBeNull();
    expect(btn().querySelector('.power__frame')).not.toBeNull();
  });

  it('selected: is-selected and aria-pressed', () => {
    mount({ ready: true, fraction: 1, selected: true });
    expect(btn().classList.contains('is-selected')).toBe(true);
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    mount({ ready: true, fraction: 1, selected: false });
    expect(btn().getAttribute('aria-pressed')).toBe('false');
  });

  it("shows the boy's portrait when given, else his side's pixel emblem (never a letter)", () => {
    mount({ portrait: '/portraits/lukas.png' });
    expect(btn().querySelector('img')?.getAttribute('src')).toBe('/portraits/lukas.png');
    mount({ faction: 'zombies' });
    expect(btn().querySelector('img')).toBeNull();
    expect(btn().querySelector('svg.power__emblem')).not.toBeNull();
    expect(btn().textContent).toBe('');
  });

  it('re-renders only on a whole charge step, ready or selected; a tap still reaches the latest onPress', () => {
    const first = mount({ fraction: 0.4 });
    const renders = vi.spyOn(HeroButton.prototype, 'render');
    const later = vi.fn();
    act(() => render(<HeroButton {...first} fraction={0.45} onPress={later} />, root));
    expect(renders).not.toHaveBeenCalled();
    expect(btn().querySelector<HTMLElement>('.power__veil')?.style.height).toBe('62.5%');
    act(() => btn().click());
    expect(later).toHaveBeenCalledTimes(1);
    expect(first.onPress).not.toHaveBeenCalled();
    act(() => render(<HeroButton {...first} fraction={0.5} onPress={later} />, root));
    expect(renders).toHaveBeenCalledTimes(1);
    renders.mockRestore();
    expect(btn().querySelector<HTMLElement>('.power__veil')?.style.height).toBe('50%');
    expect(btn().querySelector<HTMLElement>('.power__pips')?.style.getPropertyValue('--lit')).toBe('4');
  });

  it('chargeStep rounds the charge down to whole eighths, so it never looks readier than it is', () => {
    expect(chargeStep(0)).toBe(0);
    expect(chargeStep(0.1)).toBe(0);
    expect(chargeStep(0.125)).toBe(0.125);
    expect(chargeStep(0.4)).toBe(0.375);
    expect(chargeStep(0.99)).toBe(0.875);
    expect(chargeStep(1)).toBe(1);
    expect(chargeStep(3)).toBe(1);
    expect(chargeStep(-1)).toBe(0);
    expect(chargeStep(Number.NaN)).toBe(0);
  });
});
