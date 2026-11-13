// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import { ADVENTURE } from '../../src/adventure/rewards';
import { BattleController } from '../../src/app/BattleController';
import { readPending } from '../../src/app/levelSession';
import { session } from '../../src/app/session';
import { go, screen, startLevel } from '../../src/app/store';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { Save } from '../../src/progress/save';
import { App } from '../../src/ui/App';
import type { BattleSessionLike, SessionFactory } from '../../src/ui/screens/BattleScreen';
import { resetSeenStars } from '../../src/ui/screens/Map';
import { MemoryStorage } from '../progress/memoryStorage';

// Task 5: a level played through the app: the result is applied once, through the level path only.

const NOW = 1_762_900_000_000;
let root: HTMLElement;
let made: { c: BattleController; s: BattleSessionLike }[];

/** The real controller with no view; the test steps it. */
const factory: SessionFactory = (options) => {
  const c = new BattleController(options);
  const s: BattleSessionLike = { controller: c, begin() {}, dispose() {}, skipIntro: true };
  made.push({ c, s });
  return s;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  made = [];
  resetSeenStars();
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
const tap = (sel: string): void => { act(() => { need(sel).click(); }); };

/** Starts `id`, then decides it: the enemy base (or, to lose, the player's) falls on the next step. */
function playLevel(id: string, win = true): BattleController {
  act(() => { expect(startLevel(levelById(id)!, me(), 5)).toBe(true); });
  const { c } = made[made.length - 1]!;
  const side = c.playerFaction;
  c.match.state.baseHp[win ? (side === 'plants' ? 'zombies' : 'plants') : side] = 0;
  act(() => { c.step(); });
  return c;
}

describe('a level through the app', () => {
  it('a first win: the level result with its stars, 90 coins once (no Quick Battle reward), p1-2 open, nothing pending', () => {
    const coins = me().coins;
    const wins = me().computerWins;
    playLevel('p1-1');
    expect(need('[data-level-result="p1-1"]').dataset.stars).toBe('3');
    expect(me().coins).toBe(coins + 3 * ADVENTURE.perNewStar);
    expect(me().computerWins).toBe(wins);
    expect(me().plants.stars['p1-1']).toBe(3);
    expect(readPending(session, me().slot)).toBeNull();
    // The panel's steps (stars, coins) change nothing more in the save.
    for (let i = 0; i < 40; i++) act(() => { vi.advanceTimersByTime(100); });
    expect(me().coins).toBe(coins + 90);
    expect(need('[data-action="next-level"]').dataset.next).toBe('p1-2');
  });

  it('next level starts p1-2; replay starts p1-1 again with a new battle id; map goes to the map', () => {
    const first = playLevel('p1-1').play!.battleId;
    tap('[data-action="replay"]');
    const s = screen.value;
    expect(s.name === 'battle' && s.options.play?.def.id).toBe('p1-1');
    expect(s.name === 'battle' && s.options.play?.battleId).not.toBe(first);
    playLevel('p1-1');
    tap('[data-action="next-level"]');
    const n = screen.value;
    expect(n.name === 'battle' && n.options.play?.def.id).toBe('p1-2');
    playLevel('p1-2', false);
    expect(q('[data-action="next-level"]')).toBeNull();
    tap('[data-action="map"]');
    expect(screen.value).toEqual({ name: 'map', side: 'plants' });
  });

  it('a loss pays the consolation coins once and opens nothing', () => {
    const coins = me().coins;
    playLevel('p1-1', false);
    expect(me().coins).toBe(coins + ADVENTURE.loss);
    expect(me().plants.stars['p1-1']).toBeUndefined();
    expect(need('[data-coins-earned]').dataset.coinsEarned).toBe(String(ADVENTURE.loss));
  });

  it('pause in a level: map (two taps) leaves with nothing stored or paid', () => {
    const coins = me().coins;
    act(() => { startLevel(levelById('p1-1')!, me(), 5); });
    const { c } = made[0]!;
    for (let i = 0; i < 50; i++) act(() => { c.step(); });
    tap('[data-hud="pause"]');
    tap('[data-screen="pause"] [data-action="map"]');
    expect(screen.value.name).toBe('battle');
    tap('[data-screen="pause"] [data-action="map"]');
    expect(screen.value).toEqual({ name: 'map', side: 'plants' });
    expect(me().coins).toBe(coins);
    expect(readPending(session, me().slot)).toBeNull();
  });

  it('a Quick Battle still pays its own reward and never touches Adventure', () => {
    const coins = me().coins;
    act(() => go({ name: 'battle', options: { playerFaction: 'plants', skill: 'easy', seed: 3 } }));
    const { c } = made[0]!;
    expect(c.play).toBeNull();
    c.match.state.baseHp.zombies = 0;
    act(() => { c.step(); });
    expect(me().coins).toBeGreaterThan(coins);
    expect(me().plants.stars).toEqual({});
    expect(q('[data-level-result]')).toBeNull();
    expect(q('[data-action="play-again"]')).not.toBeNull();
  });
});
