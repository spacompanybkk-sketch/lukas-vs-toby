// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE_PLAY } from '../../src/adventure/freePlay';
import { BattleController, RING_STEPS } from '../../src/app/BattleController';
import { readPending } from '../../src/app/levelSession';
import { session } from '../../src/app/session';
import { go, screen, startFreePlay } from '../../src/app/store';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { BALANCE, seconds } from '../../src/data/balance';
import type { Save } from '../../src/progress/save';
import type { Faction } from '../../src/sim/types';
import { App } from '../../src/ui/App';
import type { BattleSessionLike, SessionFactory } from '../../src/ui/screens/BattleScreen';
import { WAVE_BANNER_MS } from '../../src/ui/screens/FreePlay';
import { MemoryStorage } from '../progress/memoryStorage';

// Task 7b: a Free Play run through the app: the HUD, the banner, the result paid once.

const NOW = 1_762_900_000_000;
let root: HTMLElement;
let made: BattleController[];

const factory: SessionFactory = (options) => {
  const c = new BattleController(options);
  made.push(c);
  const s: BattleSessionLike = { controller: c, begin() {}, dispose() {}, skipIntro: true };
  return s;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  made = [];
  session.configure({ cloud: createFakeCloud(new FakeDatabase({ now: () => NOW })), storage: new MemoryStorage(), now: () => NOW, window: null, document: null });
  const p = await session.create('Mia', 'peashooter', '123');
  if (typeof p === 'string') throw new Error(p);
  root = document.createElement('div');
  document.body.appendChild(root);
  act(() => render(<App createSession={factory} />, root));
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  session.dispose();
  go({ name: 'title' });
  vi.useRealTimers();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 800)}`);
  return el;
};
const me = (): Save => session.player.peek()!;
const steps = (c: BattleController, n: number): void => { act(() => { for (let i = 0; i < n; i++) c.step(); }); };

function start(side: Faction): BattleController {
  act(() => startFreePlay(side, me(), 5));
  return made[made.length - 1]!;
}

describe('a Free Play run through the app', () => {
  it('survive: the flag counter, the ring, the wave banner; the clock and level bars are not shown', () => {
    const c = start('plants');
    expect(need('[data-hud="free-wave"]').dataset.wave).toBe('0');
    expect(need('[data-hud="next-wave"]').dataset.left).toBe(String(RING_STEPS));
    expect(q('[data-hud="topbar"]')).toBeNull();
    expect(q('[data-hud="free-clock"]')).toBeNull();
    expect(q('[data-hud="level"]')).toBeNull();
    steps(c, seconds(FREE_PLAY.firstWaveSeconds) + 1);
    expect(need('[data-hud="free-wave"]').dataset.wave).toBe('1');
    expect(need('[data-banner="wave"]').dataset.wave).toBe('1');
    expect(q('[data-banner="wave"][data-big]')).toBeNull();
    act(() => { vi.advanceTimersByTime(WAVE_BANNER_MS + 10); });
    expect(q('[data-banner="wave"]')).toBeNull();
  });

  it('breakthrough: the clock, and +30 when a garden breaks', () => {
    const c = start('zombies');
    steps(c, 1);
    expect(need('[data-hud="free-clock"]').dataset.left).toBe(String(BALANCE.endless.clockSeconds));
    expect(need('[data-banner="wave"]').dataset.wave).toBe('1');
    act(() => { c.match.state.baseHp.plants = 0; });
    steps(c, 1);
    expect(need('[data-hud="free-wave"]').dataset.wave).toBe('1');
    expect(need('[data-bonus]').textContent).toBe(`+${BALANCE.endless.clockBonusSeconds}`);
  });

  it('the end: the wave reached, best with a crown, 10 coins for two waves cleared, bestWave; again and Home', () => {
    const coins = me().coins;
    const c = start('plants');
    steps(c, seconds(FREE_PLAY.firstWaveSeconds + BALANCE.endless.gapSeconds * 2) + 1);
    expect(c.match.state.wave).toBe(3);
    act(() => { c.match.state.baseHp.plants = 0; });
    steps(c, 1);
    const result = need('[data-free-result="plants"]');
    expect(result.dataset.wave).toBe('3');
    expect(result.dataset.best).toBe('');
    expect(need('[data-coins-earned]').dataset.coinsEarned).toBe('10');
    expect(me().coins).toBe(coins + 10);
    expect(me().bestWave).toBe(3);
    expect(readPending(session, me().slot)).toBeNull();
    expect(q('[data-hud="free-top"]')).toBeNull(); // the HUD's top clears for the result
    // Again: a fresh run on the same side; it pays on its own, once.
    act(() => { need('[data-action="play-again"]').click(); });
    const again = made[made.length - 1]!;
    expect(again).not.toBe(c);
    expect(again.free?.side).toBe('plants');
    expect(again.free?.battleId).not.toBe(c.free?.battleId);
    act(() => { again.match.state.baseHp.plants = 0; });
    steps(again, 1);
    expect(need('[data-free-result]').dataset.wave).toBe('0');
    expect(q('[data-free-result][data-best]')).toBeNull();
    expect(me().bestWave).toBe(3);
    expect(me().coins).toBe(coins + 10);
    act(() => { need('[data-action="menu"]').click(); });
    expect(screen.value).toEqual({ name: 'home' });
  });

  it('Quit from pause ends the run and banks it like losing: the armed Quit shows the flag and coins first', () => {
    const coins = me().coins;
    const c = start('plants');
    steps(c, seconds(FREE_PLAY.firstWaveSeconds + BALANCE.endless.gapSeconds * 2) + 1);
    act(() => { need('[data-hud="pause"]').click(); });
    expect(q('[data-bank]')).toBeNull();
    // One way out of a run: Quit, which banks it. No Restart that would throw the run away unpaid.
    expect(q('[data-screen="pause"] [data-action="restart"]')).toBeNull();
    expect(q('[data-screen="pause"] [data-action="resume"]')).not.toBeNull();
    act(() => { need('[data-screen="pause"] [data-action="quit"]').click(); });
    expect(need('[data-bank] [data-bank-wave]').dataset.bankWave).toBe('3');
    expect(need('[data-bank] [data-bank-wave]').dataset.bankCoins).toBe('10');
    act(() => { need('[data-screen="pause"] [data-action="quit"]').click(); });
    const result = need('[data-free-result="plants"]');
    expect(result.dataset.wave).toBe('3');
    expect(result.dataset.best).toBe('');
    expect(me().coins).toBe(coins + 10);
    expect(me().bestWave).toBe(3);
    expect(readPending(session, me().slot)).toBeNull();
    act(() => { need('[data-action="menu"]').click(); });
    expect(screen.value).toEqual({ name: 'home' });
  });

  it('survive has no zombie base bar; breakthrough keeps both bars and announces gardens with the garden picture', () => {
    start('plants');
    expect(q('[data-hud="base-zombies"]')).toBeNull();
    expect(q('[data-hud="base-plants"]')).not.toBeNull();
    const c = start('zombies');
    steps(c, 1);
    expect(q('[data-hud="base-zombies"]')).not.toBeNull();
    expect(need('[data-hud="free-wave"]').dataset.wave).toBe('0'); // gardens broken
    expect(need('[data-banner="wave"]').dataset.kind).toBe('garden');
    expect(need('[data-banner="wave"]').dataset.wave).toBe('1'); // garden 1
  });

  it('a run whose player is no longer the one logged in stays pending; the result shows the run\'s own numbers', () => {
    const c = start('plants');
    const slot = me().slot;
    steps(c, seconds(FREE_PLAY.firstWaveSeconds + BALANCE.endless.gapSeconds) + 1);
    act(() => { session.logout(); });
    act(() => { c.match.state.baseHp.plants = 0; });
    steps(c, 1);
    const result = need('[data-free-result="plants"]');
    expect(result.dataset.wave).toBe('2');
    expect(need('[data-coins-earned]').dataset.coinsEarned).toBe('5');
    expect(readPending(session, slot)).toMatchObject({ kind: 'free', wave: 2, cleared: 1 });
  });
});
