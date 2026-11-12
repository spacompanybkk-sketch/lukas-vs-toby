// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPELL_ICONS, SPELL_NAMES, SpellButtons } from '../../src/ui/hud/SpellButtons';
import type { SpellButtonsProps } from '../../src/ui/hud/SpellButtons';

const ALL = ['thunderbolt', 'vines', 'sunShower', 'healingRain', 'rockWall', 'meteor', 'fog', 'brainFeast', 'frenzy', 'graveRise'];

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

function mount(over: Partial<SpellButtonsProps> = {}): SpellButtonsProps {
  const props: SpellButtonsProps = {
    spells: [{ key: 'thunderbolt', ready: true, fraction: 1 }, { key: 'sunShower', ready: false, fraction: 0.3 }],
    selected: null, onPress: vi.fn(), ...over,
  };
  act(() => render(<SpellButtons {...props} />, root));
  return props;
}

const spell = (key: string): HTMLButtonElement => {
  const el = root.querySelector<HTMLButtonElement>(`[data-spell="${key}"]`);
  if (el === null) throw new Error(`no spell ${key}`);
  return el;
};

describe('SpellButtons', () => {
  it('one button per dealt spell, named, calling onPress with its key', () => {
    const props = mount();
    const all = [...root.querySelectorAll('[data-spell]')];
    expect(all).toHaveLength(2);
    expect(all.every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button')).toBe(true);
    expect(spell('thunderbolt').getAttribute('aria-label')).toBe('Thunderbolt');
    expect(spell('sunShower').getAttribute('aria-label')).toBe('Sun Shower');
    act(() => spell('sunShower').click());
    expect(props.onPress).toHaveBeenCalledWith('sunShower');
    act(() => spell('thunderbolt').click());
    expect(props.onPress).toHaveBeenLastCalledWith('thunderbolt');
  });

  it('shows ready, charging (stepped veil) and selected states', () => {
    mount({ selected: 'thunderbolt' });
    expect(spell('thunderbolt').classList.contains('is-ready')).toBe(true);
    expect(spell('thunderbolt').classList.contains('is-selected')).toBe(true);
    expect(spell('thunderbolt').getAttribute('aria-pressed')).toBe('true');
    expect(spell('sunShower').classList.contains('is-charging')).toBe(true);
    expect(spell('sunShower').getAttribute('aria-pressed')).toBe('false');
    expect(spell('sunShower').getAttribute('aria-disabled')).toBe('true');
    // 0.3 charged = 2 of 8 blocks; the veil covers the other 6/8.
    expect(spell('sunShower').querySelector<HTMLElement>('.power__veil')?.style.height).toBe('75%');
  });

  it('every one of the ten spells has a name and its own pixel icon, with no words in it', () => {
    mount({ spells: ALL.map((key) => ({ key, ready: true, fraction: 1 })) });
    const drawn = new Set<string>();
    for (const key of ALL) {
      expect(SPELL_NAMES[key]).toBeTruthy();
      const svg = spell(key).querySelector('svg');
      expect(svg, key).not.toBeNull();
      expect(svg?.getAttribute('shape-rendering')).toBe('crispEdges');
      expect(svg?.querySelector('text')).toBeNull();
      expect(svg?.querySelectorAll('path').length, key).toBeGreaterThan(1);
      drawn.add(svg?.innerHTML ?? '');
    }
    expect(drawn.size).toBe(10);
    expect(Object.keys(SPELL_ICONS).sort()).toEqual([...ALL].sort());
  });

  it('every icon grid is square and uses only colours in its palette', () => {
    for (const [key, icon] of Object.entries(SPELL_ICONS)) {
      const size = icon.rows.length;
      expect(icon.rows.every((r) => r.length === size), key).toBe(true);
      for (const ch of icon.rows.join('')) {
        if (ch !== '.') expect(icon.palette[ch], `${key} '${ch}'`).toBeTruthy();
      }
    }
  });

  it('a spell button skips renders between charge steps, and draws each icon from one cached path set', () => {
    const props = mount();
    const veil = spell('sunShower').querySelector<HTMLElement>('.power__veil');
    const pathEl = spell('thunderbolt').querySelector('path');
    mount({ ...props, spells: [{ key: 'thunderbolt', ready: true, fraction: 1 }, { key: 'sunShower', ready: false, fraction: 0.32 }] });
    expect(spell('sunShower').querySelector('.power__veil')).toBe(veil);
    expect(veil?.style.height).toBe('75%');
    mount({ ...props, spells: [{ key: 'thunderbolt', ready: true, fraction: 1 }, { key: 'sunShower', ready: false, fraction: 0.38 }] });
    expect(spell('sunShower').querySelector<HTMLElement>('.power__veil')?.style.height).toBe('62.5%');
    expect(spell('thunderbolt').querySelector('path')).toBe(pathEl);
  });

  it('an unknown spell still gets a button (a plain block), never a crash', () => {
    mount({ spells: [{ key: 'mystery', ready: false, fraction: 0 }] });
    expect(spell('mystery').getAttribute('aria-label')).toBe('mystery');
  });
});

describe('SpellButtons press (wiring B)', () => {
  const down = (el: Element): void => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 }));
  };

  it('presses on pointer down and swallows the click that follows; a picked one is put down by its click', () => {
    const props = mount();
    act(() => down(spell('thunderbolt')));
    act(() => spell('thunderbolt').click());
    expect(props.onPress).toHaveBeenCalledTimes(1);
    const picked = mount({ selected: 'thunderbolt' });
    act(() => down(spell('thunderbolt')));
    expect(picked.onPress).not.toHaveBeenCalled();
    act(() => spell('thunderbolt').click());
    expect(picked.onPress).toHaveBeenCalledWith('thunderbolt');
  });

  it('only the refused spell shakes', () => {
    mount({ shake: { key: 'sunShower', n: 1 } });
    expect(spell('sunShower').classList.contains('is-denied-a')).toBe(true);
    expect(spell('thunderbolt').classList.contains('is-denied')).toBe(false);
  });
});
