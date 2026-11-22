// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HudSignals } from '../../src/app/BattleController';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { Faction, UnitKey } from '../../src/sim/types';
import { SpeedButton } from '../../src/ui/hud/SpeedButton';
import { setUiSound } from '../../src/ui/uiSound';
import { BattleScreen } from '../../src/ui/screens/BattleScreen';
import type { BattleSessionLike, SpeedLike } from '../../src/ui/screens/BattleScreen';

let root: HTMLElement | null = null;
const mountIn = (): HTMLElement => {
  root = document.createElement('div');
  document.body.appendChild(root);
  return root;
};
afterEach(() => { if (root !== null) { act(() => render(null, root!)); root.remove(); root = null; } });

describe('SpeedButton', () => {
  it('a square button like Pause: the double-arrow picture and the word 2X in the pixel font', () => {
    const r = mountIn();
    const onToggle = vi.fn();
    act(() => render(<SpeedButton fast={false} onToggle={onToggle} />, r));
    const b = r.querySelector<HTMLButtonElement>('[data-hud="speed"]')!;
    expect(b.type).toBe('button');
    expect(b.classList.contains('btn')).toBe(true);
    expect(b.classList.contains('btn--square')).toBe(true);
    expect(b.classList.contains('btn--small')).toBe(true);
    expect(b.querySelector('.ico--fast')).not.toBeNull();
    expect(b.querySelector('.hud-speed__word.inked')?.textContent).toBe('2X');
    expect(b.getAttribute('aria-label')).toBe('Double speed');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    act(() => b.click());
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('lit when on: pressed (the buttons\' own aria-pressed look: lighter fill, sun outline)', () => {
    const r = mountIn();
    act(() => render(<SpeedButton fast onToggle={() => {}} />, r));
    const b = r.querySelector<HTMLButtonElement>('[data-hud="speed"]')!;
    expect(b.getAttribute('aria-pressed')).toBe('true');
  });
});

function fakeSession(speed?: SpeedLike): BattleSessionLike {
  const hud: HudSignals = {
    energy: signal(50), cards: signal([]),
    base: signal({ plants: { hp: 1000, max: 1000, safe: false }, zombies: { hp: 1000, max: 1000, safe: false } }),
    seconds: signal(0), suddenDeath: signal(false), paused: signal(false),
    selected: signal<UnitKey | null>(null), shovel: signal(false),
    result: signal<null | { winner: Faction | 'draw'; playerWon: boolean }>(null), denied: signal(0),
    hero: signal({ ready: false, fraction: 0 }),
    heroSelected: signal(false), spells: signal<HudSignals['spells']['value']>([]),
    spellSelected: signal<HudSignals['spellSelected']['value']>(null), boss: signal<HudSignals['boss']['value']>(null),
  };
  return {
    controller: {
      hud, playerFaction: 'plants', select: vi.fn(), toggleShovel: vi.fn(),
      setPaused: vi.fn((p: boolean) => { hud.paused.value = p; }),
    },
    begin: vi.fn(), dispose: vi.fn(), skipIntro: true, speed,
  };
}

function screen(s: BattleSessionLike): HTMLElement {
  const r = mountIn();
  act(() => render(<BattleScreen session={s} settings={DEFAULT_SETTINGS} onSettingsChange={vi.fn()} onRestart={vi.fn()} onQuit={vi.fn()} />, r));
  return r;
}

describe('the 2X button held by a lesson', () => {
  it('held: greyed (aria-disabled), never lit, a tap buzzes and does not toggle', () => {
    const sounds: string[] = [];
    setUiSound((n) => sounds.push(n));
    try {
      const r = mountIn();
      const onToggle = vi.fn();
      act(() => render(<SpeedButton fast held onToggle={onToggle} />, r));
      const b = r.querySelector<HTMLButtonElement>('[data-hud="speed"]')!;
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('aria-pressed')).toBe('false');
      act(() => b.click());
      expect(onToggle).not.toHaveBeenCalled();
      expect(sounds).toEqual(['deny']);
    } finally { setUiSound(null); }
  });
});

describe('the 2X button on the battle screen', () => {
  it('stays put through lesson steps: greyed while one waits (the same button), lit again after; gone at the result', () => {
    const fast = signal(true);
    const shown = signal(true);
    const held = signal(false);
    const s = fakeSession({ fast, shown, held, toggle: vi.fn() });
    const r = screen(s);
    const b = r.querySelector('[data-hud="speed"]')!;
    expect(b.getAttribute('aria-disabled')).toBeNull();
    act(() => { shown.value = false; held.value = true; });
    expect(r.querySelector('[data-hud="speed"]')).toBe(b); // not removed and re-made
    expect(b.getAttribute('aria-disabled')).toBe('true');
    act(() => { shown.value = true; held.value = false; });
    expect(r.querySelector('[data-hud="speed"]')).toBe(b);
    expect(b.getAttribute('aria-disabled')).toBeNull();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    act(() => { s.controller.hud.result.value = { winner: 'plants', playerWon: true }; });
    expect(r.querySelector('[data-hud="speed"]')).toBeNull();
  });

  it('sits beside Pause, in the top right, and a tap toggles the session speed', () => {
    const fast = signal(false);
    const shown = signal(true);
    const toggle = vi.fn(() => { fast.value = !fast.value; });
    const r = screen(fakeSession({ fast, shown, toggle }));
    const right = r.querySelector('.battle__right')!;
    const b = right.querySelector<HTMLButtonElement>('[data-hud="speed"]')!;
    expect(b).not.toBeNull();
    expect(right.querySelector('[data-hud="pause"]')).not.toBeNull();
    // Pause keeps the corner: the 2X button comes before it.
    expect(right.firstElementChild).toBe(b);
    act(() => b.click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    act(() => b.click());
    expect(b.getAttribute('aria-pressed')).toBe('false');
  });

  it('gone while a lesson waits (shown false), back after it; gone at the result; absent without a speed (Versus)', () => {
    const fast = signal(true);
    const shown = signal(false);
    const s = fakeSession({ fast, shown, toggle: vi.fn() });
    const r = screen(s);
    expect(r.querySelector('[data-hud="speed"]')).toBeNull();
    act(() => { shown.value = true; });
    expect(r.querySelector('[data-hud="speed"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => { s.controller.hud.result.value = { winner: 'plants', playerWon: true }; });
    expect(r.querySelector('[data-hud="speed"]')).toBeNull();
    act(() => render(null, r));
    r.remove();
    root = null;
    const none = screen(fakeSession());
    expect(none.querySelector('[data-hud="speed"]')).toBeNull();
    expect(none.querySelector('[data-hud="pause"]')).not.toBeNull();
  });
});
