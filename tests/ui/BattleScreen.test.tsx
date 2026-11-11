// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { CardVM, HudSignals } from '../../src/app/BattleController';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { Faction, UnitKey } from '../../src/sim/types';
import { BANNER_MS, BattleScreen } from '../../src/ui/screens/BattleScreen';
import type { BattleSessionLike } from '../../src/ui/screens/BattleScreen';

const renders = vi.hoisted(() => ({ tray: 0, clock: 0 }));

vi.mock('../../src/ui/hud/CardTray', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/ui/hud/CardTray')>();
  return {
    ...m,
    CardTray: (p: Parameters<typeof m.CardTray>[0]) => {
      renders.tray += 1;
      return m.CardTray(p);
    },
  };
});
vi.mock('../../src/ui/hud/TopBar', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/ui/hud/TopBar')>();
  return {
    ...m,
    TopBar: (p: Parameters<typeof m.TopBar>[0]) => {
      renders.clock += 1;
      return m.TopBar(p);
    },
  };
});

const card = (unit: UnitKey, rechargeFraction = 0): CardVM => ({
  unit, name: unit, price: 100, hotkey: '1', affordable: true, rechargeFraction,
});

function fakeSession(): BattleSessionLike & { begin: Mock<() => void>; dispose: Mock<() => void> } {
  const hud: HudSignals = {
    energy: signal(50),
    cards: signal([card('peashooter'), card('sunflower', 0.5)]),
    base: signal({ plants: { hp: 1000, max: 1000 }, zombies: { hp: 1000, max: 1000 } }),
    seconds: signal(0), suddenDeath: signal(false), paused: signal(false),
    selected: signal<UnitKey | null>(null), shovel: signal(false),
    result: signal<null | { winner: Faction | 'draw'; playerWon: boolean }>(null), denied: signal(0),
  };
  return {
    controller: {
      hud, playerFaction: 'plants',
      select: vi.fn((u: UnitKey | null) => { hud.selected.value = u; }),
      toggleShovel: vi.fn(),
      setPaused: vi.fn((p: boolean) => { hud.paused.value = p; }),
    },
    begin: vi.fn(), dispose: vi.fn(),
  };
}

let root: HTMLElement;
const onQuit = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  renders.tray = 0;
  renders.clock = 0;
  onQuit.mockReset();
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  vi.useRealTimers();
});

function mount(session: BattleSessionLike): void {
  act(() => render(
    <BattleScreen
      session={session} settings={DEFAULT_SETTINGS} onSettingsChange={vi.fn()} onRestart={vi.fn()} onQuit={onQuit}
    />,
    root,
  ));
}
const need = (sel: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) throw new Error(`missing ${sel}`);
  return el;
};

describe('BattleScreen', () => {
  it('updates the HUD live when a signal changes', () => {
    const s = fakeSession();
    mount(s);
    const hud = s.controller.hud;
    act(() => {
      hud.energy.value = 175;
      hud.seconds.value = 61;
      hud.base.value = { plants: { hp: 400, max: 1000 }, zombies: { hp: 1000, max: 1000 } };
      hud.suddenDeath.value = true;
    });
    expect(need('[data-hud="energy"]').textContent).toContain('175');
    expect(need('[data-hud="topbar"]').textContent).toContain('1:01');
    expect(need('[data-hud="topbar"]').textContent).toContain('SUDDEN DEATH');
    expect(need('[data-hud="base-plants"] .hud-base__fill').style.width).toBe('40%');
    act(() => { hud.cards.value = [card('peashooter'), card('sunflower', 0.25)]; });
    expect(need('[data-card="sunflower"] .card__recharge').style.height).toBe('25%');
  });

  it('a clock tick does not re-render the tray, and a card recharge does not re-render the clock', () => {
    const s = fakeSession();
    mount(s);
    const hud = s.controller.hud;
    const tray0 = renders.tray;
    const clock0 = renders.clock;
    act(() => { hud.seconds.value = 1; });
    expect(renders.clock).toBe(clock0 + 1);
    expect(renders.tray).toBe(tray0);
    act(() => { hud.cards.value = [card('peashooter'), card('sunflower', 0.375)]; });
    expect(renders.tray).toBe(tray0 + 1);
    expect(renders.clock).toBe(clock0 + 1);
    act(() => { hud.energy.value = 75; });
    expect(renders.tray).toBe(tray0 + 1);
    expect(renders.clock).toBe(clock0 + 1);
  });

  it('the intro banners hold while paused and resume where they stopped', () => {
    const s = fakeSession();
    mount(s);
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { s.controller.setPaused(true); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(need('[data-banner]').getAttribute('data-banner')).toBe('ready');
    expect(s.begin).not.toHaveBeenCalled();
    act(() => { s.controller.setPaused(false); });
    act(() => { vi.advanceTimersByTime(BANNER_MS - 300 - 10); });
    expect(need('[data-banner]').getAttribute('data-banner')).toBe('ready');
    act(() => { vi.advanceTimersByTime(20); });
    expect(need('[data-banner]').getAttribute('data-banner')).toBe('fight');
    act(() => { vi.advanceTimersByTime(BANNER_MS); });
    expect(root.querySelector('[data-banner]')).toBeNull();
    expect(s.begin).toHaveBeenCalledTimes(1);
  });

  it('Quit during the banners never begins the session', () => {
    const s = fakeSession();
    mount(s);
    act(() => { vi.advanceTimersByTime(BANNER_MS + 100); });
    act(() => need('[data-hud="pause"]').click());
    act(() => need('[data-action="quit"]').click());
    expect(onQuit).toHaveBeenCalledTimes(1);
    act(() => render(null, root)); // the app unmounts the battle on quit
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(s.begin).not.toHaveBeenCalled();
  });
});
