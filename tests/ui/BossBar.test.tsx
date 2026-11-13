// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bossOf } from '../../src/app/BattleController';
import type { BossVM } from '../../src/app/BattleController';
import { BOSS_BAR_STEPS, BOSS_INTRO_MS, BossBar, bossNotches, bossStep } from '../../src/ui/hud/BossBar';
import { bossDemoMatch } from '../../src/scenes/bossScript';
import { Match, defaultConfig } from '../../src/sim/match';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  vi.useRealTimers();
});

const titan = (over: Partial<BossVM> = {}): BossVM => ({ key: 'brainTitan', hp: 6000, max: 6000, shield: false, ...over });
const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);

describe('BossBar', () => {
  it('shows nothing without a boss', () => {
    act(() => render(<BossBar boss={null} />, root));
    expect(q('[data-hud="boss"]')).toBeNull();
  });

  it('fills in whole blocks, rounding up, never empty while the boss stands', () => {
    expect(bossStep(6000, 6000)).toBe(1);
    expect(bossStep(1, 6000)).toBe(1 / BOSS_BAR_STEPS);
    expect(bossStep(0, 6000)).toBe(0);
    act(() => render(<BossBar boss={titan({ hp: 3000 })} intro={false} />, root));
    expect(q('.hud-boss__fill')!.style.width).toBe('50%');
    expect(q('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('3000');
  });

  it('has a notch at each shield mark, marked passed once the bar is below it', () => {
    expect(bossNotches('brainTitan')).toEqual([0.66, 0.33]);
    expect(bossNotches('elderOak')).toEqual([0.5]);
    act(() => render(<BossBar boss={titan({ hp: 3000 })} intro={false} />, root));
    const notches = [...root.querySelectorAll<HTMLElement>('.hud-boss__notch')];
    expect(notches.map((n) => n.style.left)).toEqual(['66%', '33%']);
    expect(notches.map((n) => n.classList.contains('is-passed'))).toEqual([true, false]);
  });

  it('shows the shield over the bar while it is up', () => {
    act(() => render(<BossBar boss={titan({ shield: true })} intro={false} />, root));
    expect(q('.hud-boss')!.classList.contains('is-shielded')).toBe(true);
    expect(q('.hud-boss__shield')).not.toBeNull();
  });

  it('a beaten boss: the bar empty, its face knocked out', () => {
    act(() => render(<BossBar boss={titan({ hp: 0, max: 1 })} intro={false} />, root));
    expect(q('.hud-boss')!.classList.contains('is-down')).toBe(true);
  });

  it('comes in with a face card for 1.5 s that a tap ends at once (telling the lawn)', () => {
    const onSkip = vi.fn();
    act(() => render(<BossBar boss={null} onSkip={onSkip} />, root));
    act(() => render(<BossBar boss={titan()} onSkip={onSkip} />, root));
    expect(q('[data-hud="boss-intro"]')).not.toBeNull();
    act(() => { q('[data-hud="boss-intro"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(q('[data-hud="boss-intro"]')).toBeNull();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('the face card goes by itself after 1.5 s, and only comes once', () => {
    act(() => render(<BossBar boss={titan()} />, root));
    expect(q('[data-hud="boss-intro"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(BOSS_INTRO_MS + 10); });
    expect(q('[data-hud="boss-intro"]')).toBeNull();
    act(() => render(<BossBar boss={titan({ hp: 10 })} />, root));
    expect(q('[data-hud="boss-intro"]')).toBeNull();
  });
});

describe('bossOf (the controller\'s hud.boss)', () => {
  it('is null in a plain battle and before the boss has come on', () => {
    const m = new Match(defaultConfig(1));
    m.step();
    expect(bossOf(m.state)).toBeNull();
    expect(bossOf(bossDemoMatch('brainTitan', 1).state)).toBeNull();
  });

  it('follows the boss\'s health and shield, and reads 0 once it has fallen', () => {
    const m = bossDemoMatch('brainTitan', 1);
    m.step();
    expect(bossOf(m.state)).toEqual({ key: 'brainTitan', hp: 6000, max: 6000, shield: false });
    const boss = m.state.units.find((u) => u.key === 'brainTitan')!;
    boss.hp = 3000.4;
    boss.shieldLeft = 5;
    expect(bossOf(m.state)).toEqual({ key: 'brainTitan', hp: 3001, max: 6000, shield: true });
    m.state.units.splice(m.state.units.indexOf(boss), 1);
    expect(bossOf(m.state)).toEqual({ key: 'brainTitan', hp: 0, max: 1, shield: false });
  });
});
