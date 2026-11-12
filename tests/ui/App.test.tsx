// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { BattleOptions, HudSignals } from '../../src/app/BattleController';
import { go, screen } from '../../src/app/store';
import type { Faction, UnitKey } from '../../src/sim/types';
import { App, hudOnlySession } from '../../src/ui/App';
import type { BattleSessionLike, SessionFactory } from '../../src/ui/screens/BattleScreen';

interface FakeSession extends BattleSessionLike {
  begin: Mock<() => void>;
  dispose: Mock<() => void>;
  controller: BattleSessionLike['controller'] & { setPaused: Mock<(paused: boolean) => void> };
}

function fakeHud(): HudSignals {
  return {
    energy: signal(150),
    cards: signal([
      { unit: 'brainEater' as UnitKey, name: 'Brain Eater', price: 100, hotkey: '1', affordable: true, rechargeFraction: 0 },
    ]),
    base: signal({ plants: { hp: 900, max: 1000 }, zombies: { hp: 1000, max: 1000 } }),
    seconds: signal(75), suddenDeath: signal(false), paused: signal(false),
    selected: signal<UnitKey | null>(null), shovel: signal(false),
    result: signal<null | { winner: Faction | 'draw'; playerWon: boolean }>(null), denied: signal(0),
    hero: signal({ ready: false, fraction: 0 }),
  };
}

function fakeFactory(): { factory: Mock<SessionFactory>; sessions: FakeSession[] } {
  const sessions: FakeSession[] = [];
  const factory = vi.fn<SessionFactory>((opts: BattleOptions): BattleSessionLike => {
    const hud = fakeHud();
    const s: FakeSession = {
      controller: {
        hud, playerFaction: opts.playerFaction,
        select: vi.fn((u: UnitKey | null) => { hud.selected.value = u; }),
        toggleShovel: vi.fn(),
        setPaused: vi.fn((p: boolean) => { hud.paused.value = p; }),
      },
      begin: vi.fn(), dispose: vi.fn(),
    };
    sessions.push(s);
    return s;
  });
  return { factory, sessions };
}

let root: HTMLElement;
let hidden = false;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

beforeEach(() => {
  vi.useFakeTimers();
  go({ name: 'title' });
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  setViewport(1440, 900);
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  vi.useRealTimers();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 400)}`);
  return el;
};
const tap = (sel: string): void => {
  act(() => need(sel).click());
};

function toBattle(factory: SessionFactory): void {
  act(() => render(<App createSession={factory} />, root));
  tap('[data-action="play"]');
  tap('[data-side="zombies"]');
  tap('[data-skill="hard"]');
  tap('[data-action="start"]');
}

describe('App flow', () => {
  it('starts at the title, which shows PLAY', () => {
    act(() => render(<App />, root));
    expect(need('[data-screen="title"]').textContent).toContain('PLAY');
  });

  it('PLAY opens the side pick, with Medium preselected', () => {
    act(() => render(<App />, root));
    tap('[data-action="play"]');
    expect(screen.value.name).toBe('sidepick');
    const pick = need('[data-screen="sidepick"]');
    expect(pick.textContent).toContain('LUKAS');
    expect(pick.textContent).toContain('TOBY');
    expect(need('[data-skill="medium"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('picking Toby selects Easy and picking Lukas selects Medium, and the choice stays changeable', () => {
    act(() => render(<App />, root));
    tap('[data-action="play"]');
    const pressed = (): string[] => [...root.querySelectorAll('[data-skill][aria-pressed="true"]')]
      .map((el) => el.getAttribute('data-skill') ?? '');
    tap('[data-side="zombies"]');
    expect(pressed()).toEqual(['easy']);
    tap('[data-side="plants"]');
    expect(pressed()).toEqual(['medium']);
    tap('[data-skill="hard"]');
    expect(pressed()).toEqual(['hard']);
    tap('[data-side="zombies"]');
    expect(pressed()).toEqual(['easy']);
    tap('[data-skill="medium"]');
    tap('[data-action="start"]');
    const s = screen.value;
    expect(s.name === 'battle' && s.options).toMatchObject({ playerFaction: 'zombies', skill: 'medium' });
  });

  it('START before a boy is picked stays put and makes both boy cards hop, again on every tap', () => {
    act(() => render(<App />, root));
    tap('[data-action="play"]');
    const hops = (): string[] => [...root.querySelectorAll('[data-side]')]
      .map((el) => [...el.classList].find((c) => c.startsWith('is-nudged')) ?? '');
    expect(hops()).toEqual(['', '']);
    tap('[data-action="start"]');
    expect(screen.value.name).toBe('sidepick');
    expect(hops()).toEqual(['is-nudged-a', 'is-nudged-a']);
    tap('[data-action="start"]');
    expect(hops()).toEqual(['is-nudged-b', 'is-nudged-b']); // a new class restarts the animation
    tap('[data-side="plants"]');
    expect(hops()).toEqual(['', '']);
  });

  it('the back arrow on the side pick returns to the title', () => {
    act(() => render(<App />, root));
    tap('[data-action="play"]');
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('title');
  });

  it('choosing Toby and Hard then START moves to battle with those options', () => {
    const { factory } = fakeFactory();
    toBattle(factory);
    const s = screen.value;
    expect(s.name).toBe('battle');
    if (s.name !== 'battle') return;
    expect(s.options).toMatchObject({ playerFaction: 'zombies', skill: 'hard' });
    expect(typeof s.options.seed).toBe('number');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]?.[0]).toMatchObject({ playerFaction: 'zombies', skill: 'hard' });
    expect(q('[data-screen="battle"]')).not.toBeNull();
  });

  it('shows READY then FIGHT! and only then begins the session', () => {
    const { factory, sessions } = fakeFactory();
    toBattle(factory);
    const s = sessions[0];
    expect(need('[data-banner]').textContent).toContain('READY');
    expect(s?.begin).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(700); });
    expect(need('[data-banner]').textContent).toContain('FIGHT!');
    expect(s?.begin).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(700); });
    expect(q('[data-banner]')).toBeNull();
    expect(s?.begin).toHaveBeenCalledTimes(1);
  });

  it('renders the HUD blocks from the session signals', () => {
    const { factory } = fakeFactory();
    toBattle(factory);
    for (const name of ['energy', 'tray', 'base-plants', 'base-zombies', 'topbar', 'pause']) {
      expect(q(`[data-hud="${name}"]`), name).not.toBeNull();
    }
    expect(need('[data-hud="energy"]').textContent).toContain('150');
    expect(need('[data-hud="topbar"]').textContent).toContain('1:15');
  });

  it('shows the unsupported message when the session factory throws webgl2-unavailable', () => {
    const factory = vi.fn(() => { throw new Error('webgl2-unavailable'); });
    expect(() => toBattle(factory)).not.toThrow();
    expect(screen.value).toEqual({ name: 'unsupported', reason: 'webgl2' });
    expect(need('[data-screen="unsupported"]').textContent).toContain('This game needs a newer browser.');
    expect(q('[data-screen="battle"]')).toBeNull();
  });

  it('a hidden tab pauses the battle and showing it again does not resume', () => {
    const { factory, sessions } = fakeFactory();
    toBattle(factory);
    const ctl = sessions[0]?.controller;
    hidden = true;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(ctl?.setPaused).toHaveBeenCalledWith(true);
    hidden = false;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(ctl?.setPaused).not.toHaveBeenCalledWith(false);
    expect(q('[data-screen="pause"]')).not.toBeNull();
  });

  it('pause button opens the pause menu; Resume closes it; Quit returns to the title and disposes', () => {
    const { factory, sessions } = fakeFactory();
    toBattle(factory);
    act(() => { vi.advanceTimersByTime(1400); });
    tap('[data-hud="pause"]');
    expect(sessions[0]?.controller.setPaused).toHaveBeenCalledWith(true);
    expect(q('[data-screen="pause"]')).not.toBeNull();
    tap('[data-action="resume"]');
    expect(sessions[0]?.controller.setPaused).toHaveBeenCalledWith(false);
    expect(q('[data-screen="pause"]')).toBeNull();
    tap('[data-hud="pause"]');
    tap('[data-action="quit"]');
    expect(screen.value.name).toBe('title');
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('Restart from pause disposes the old session and starts a new one with the same side and skill', () => {
    const { factory, sessions } = fakeFactory();
    toBattle(factory);
    tap('[data-hud="pause"]');
    tap('[data-action="restart"]');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[1]?.[0]).toMatchObject({ playerFaction: 'zombies', skill: 'hard' });
  });

  it('shows the result overlay when the result is set, with Play again and Menu', () => {
    const { factory, sessions } = fakeFactory();
    toBattle(factory);
    act(() => { vi.advanceTimersByTime(1400); });
    act(() => {
      const hud = sessions[0]?.controller.hud;
      if (hud) hud.result.value = { winner: 'zombies', playerWon: true };
    });
    const result = need('[data-screen="result"]');
    expect(result.textContent).toContain('VICTORY!');
    expect(result.textContent).toContain('1:15');
    tap('[data-action="play-again"]');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(q('[data-screen="result"]')).toBeNull();
  });

  it('a lost match shows DEFEAT and Menu returns to the title', () => {
    const { factory, sessions } = fakeFactory();
    toBattle(factory);
    act(() => {
      const hud = sessions[0]?.controller.hud;
      if (hud) hud.result.value = { winner: 'plants', playerWon: false };
    });
    expect(need('[data-screen="result"]').textContent).toContain('DEFEAT');
    tap('[data-action="menu"]');
    expect(screen.value.name).toBe('title');
  });

  it('shows the turn-your-device picture in portrait, instead of the game', () => {
    act(() => render(<App />, root));
    expect(q('[data-screen="rotate"]')).toBeNull();
    setViewport(768, 1024);
    expect(q('[data-screen="rotate"]')).not.toBeNull();
    expect(q('[data-app]')?.getAttribute('aria-hidden')).toBe('true');
    setViewport(1024, 768);
    expect(q('[data-screen="rotate"]')).toBeNull();
  });

  it('the gear on the title opens settings, and changes are saved', () => {
    act(() => render(<App />, root));
    tap('[data-action="settings"]');
    const panel = need('[data-screen="settings"]');
    expect(panel).not.toBeNull();
    tap('[data-quality="low"]');
    expect(need('[data-quality="low"]').getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('lvt2_settings') ?? '{}')).toMatchObject({ quality: 'low' });
    tap('[data-action="close-settings"]');
    expect(q('[data-screen="settings"]')).toBeNull();
  });

  it('turning the device to portrait pauses the battle and makes the game inert', () => {
    const { factory, sessions } = fakeFactory();
    toBattle(factory);
    act(() => { vi.advanceTimersByTime(1400); });
    setViewport(768, 1024);
    expect(sessions[0]?.controller.setPaused).toHaveBeenCalledWith(true);
    expect(q('[data-app]')?.hasAttribute('inert')).toBe(true);
    expect(q('[data-screen="rotate"]')).not.toBeNull();
    setViewport(1024, 768);
    expect(q('[data-app]')?.hasAttribute('inert')).toBe(false);
    expect(sessions[0]?.controller.setPaused).not.toHaveBeenCalledWith(false);
  });

  it('offers onGesture on every activation (not pointerdown), for the life of the page', () => {
    let ok = false;
    const onGesture = vi.fn(() => ok);
    act(() => render(<App onGesture={onGesture} />, root));
    document.dispatchEvent(new Event('pointerdown'));
    expect(onGesture).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('pointerup'));
    document.dispatchEvent(new Event('touchend'));
    expect(onGesture).toHaveBeenCalledTimes(2);
    ok = true;
    document.dispatchEvent(new Event('click'));
    expect(onGesture).toHaveBeenCalledTimes(3);
    // Still offered after a success: Safari may suspend the audio again at any time.
    document.dispatchEvent(new Event('keydown'));
    document.dispatchEvent(new Event('click'));
    expect(onGesture).toHaveBeenCalledTimes(5);
  });

  it('offers one tap once while its promise is pending, and the next tap again once it settles', async () => {
    let settle: (ok: boolean) => void = () => {};
    const onGesture = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    act(() => render(<App onGesture={onGesture} />, root));
    for (const name of ['pointerup', 'touchend', 'click']) document.dispatchEvent(new Event(name)); // one tap
    expect(onGesture).toHaveBeenCalledTimes(1);
    settle(true);
    await Promise.resolve();
    await Promise.resolve();
    for (const name of ['pointerup', 'touchend', 'click']) document.dispatchEvent(new Event(name));
    expect(onGesture).toHaveBeenCalledTimes(2);
  });

  it('stops offering gestures once unmounted', () => {
    const onGesture = vi.fn(() => true);
    act(() => render(<App onGesture={onGesture} />, root));
    act(() => render(null, root));
    document.dispatchEvent(new Event('click'));
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('in a production build without createSession it shows Unsupported and logs an error', () => {
    vi.stubEnv('DEV', false);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      act(() => render(<App />, root));
      tap('[data-action="play"]');
      tap('[data-side="plants"]');
      tap('[data-action="start"]');
      expect(screen.value.name).toBe('unsupported');
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe('hudOnlySession (development stand-in)', () => {
  it('is the default in development and runs the real controller once begun, until disposed', () => {
    expect(import.meta.env.DEV).toBe(true);
    const s = hudOnlySession({ playerFaction: 'plants', skill: 'easy', seed: 7 });
    const hud = s.controller.hud;
    expect(hud.cards.value.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(3000);
    expect(hud.seconds.value).toBe(0);
    s.begin();
    vi.advanceTimersByTime(3000);
    expect(hud.seconds.value).toBeGreaterThanOrEqual(2);
    s.dispose();
    const at = hud.seconds.value;
    vi.advanceTimersByTime(3000);
    expect(hud.seconds.value).toBe(at);
  });

  it('App uses it when no factory is passed in development', () => {
    act(() => render(<App />, root));
    tap('[data-action="play"]');
    tap('[data-side="zombies"]');
    tap('[data-action="start"]');
    expect(q('[data-screen="battle"]')).not.toBeNull();
    expect(q('[data-hud="energy"]')?.className).toContain('side-zombies');
  });
});

describe('?fps readout', () => {
  it('shows the ?fps corner readout only when given a source, and refreshes it', () => {
    vi.useFakeTimers();
    try {
      act(() => render(<App />, root));
      expect(q('[data-hud="fps"]')).toBeNull();
      const stats = { fps: 59.6, scale: 0.85, drawCalls: 212 };
      act(() => render(<App fpsSource={() => stats} />, root));
      const readout = need('[data-hud="fps"]');
      expect(readout.textContent).toContain('60 fps');
      expect(readout.textContent).toContain('0.85 scale');
      expect(readout.textContent).toContain('212 calls');
      stats.fps = 31.2;
      act(() => { vi.advanceTimersByTime(600); });
      expect(need('[data-hud="fps"]').textContent).toContain('31 fps');
    } finally {
      vi.useRealTimers();
    }
  });
});
