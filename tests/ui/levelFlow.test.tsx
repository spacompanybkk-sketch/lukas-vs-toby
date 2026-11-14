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
    // The battle HUD's top is cleared while the level's result is up.
    expect(q('[data-hud="energy"]')).toBeNull();
    expect(q('[data-hud="topbar"]')).toBeNull();
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

  it('pause in a level: Quit (two taps) goes to the map, with nothing stored or paid', () => {
    const coins = me().coins;
    act(() => { startLevel(levelById('p1-1')!, me(), 5); });
    const { c } = made[0]!;
    for (let i = 0; i < 50; i++) act(() => { c.step(); });
    tap('[data-hud="pause"]');
    expect(q('[data-screen="pause"] [data-action="map"]')).toBeNull();
    tap('[data-screen="pause"] [data-action="quit"]');
    expect(screen.value.name).toBe('battle');
    tap('[data-screen="pause"] [data-action="quit"]');
    expect(screen.value).toEqual({ name: 'map', side: 'plants' });
    expect(me().coins).toBe(coins);
    expect(readPending(session, me().slot)).toBeNull();
  });

  it('a Quick Battle\'s Quit still goes Home', () => {
    act(() => go({ name: 'battle', options: { playerFaction: 'plants', skill: 'easy', seed: 3 } }));
    tap('[data-hud="pause"]');
    tap('[data-screen="pause"] [data-action="quit"]');
    tap('[data-screen="pause"] [data-action="quit"]');
    expect(screen.value).toEqual({ name: 'home' });
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
    expect(q('[data-hud="topbar"]')).not.toBeNull(); // a Quick Battle's result keeps the HUD
  });
});

describe('the tutorial through the app (Task 6)', () => {
  it('a first p1-1 shows the glove on the card; each step done goes into the save once; the next start has none', () => {
    act(() => { expect(startLevel(levelById('p1-1')!, me(), 5)).toBe(true); });
    const { c } = made[made.length - 1]!;
    expect(need('[data-tutorial] [data-glove]').dataset.glove).toBe('card');
    expect(need('[data-glove]').dataset.gloveStep).toBe('p1-1.card');
    act(() => { c.step(); c.step(); });
    expect(c.match.state.tick).toBe(1); // held
    tap('[data-hud="tray"] [data-card="peashooter"]');
    expect(me().teached).toEqual(['p1-1.card']);
    expect(need('[data-glove]').dataset.glove).toBe('tile');
    expect(need('[data-tutorial]').classList.contains('is-holding')).toBe(true);
    act(() => { c.click({ lane: 2, col: 1 }, null); c.step(); });
    expect(me().teached).toEqual(['p1-1.card', 'p1-1.tile']);
    expect(q('[data-tutorial]')).toBeNull();
    // Quit and start again: nothing left to teach.
    act(() => { expect(startLevel(levelById('p1-1')!, me(), 6)).toBe(true); });
    expect(made[made.length - 1]!.c.tutorial).toBeNull();
    expect(q('[data-tutorial]')).toBeNull();
  });

  it('the glove hides under the pause menu', () => {
    act(() => { startLevel(levelById('z1-1')!, me(), 5); });
    expect(need('[data-tutorial]').classList.contains('is-hidden')).toBe(false);
    tap('[data-hud="pause"]');
    expect(need('[data-tutorial]').classList.contains('is-hidden')).toBe(true);
  });

  it('the level card\'s glove button plays the whole tutorial again; a level with none has no button', () => {
    session.update((s) => ({ ...s, teached: ['p1-1.card', 'p1-1.tile'] }));
    act(() => go({ name: 'map', side: 'plants', card: 'p1-1' }));
    tap('[data-action="replay-tutorial"]');
    const { c } = made[made.length - 1]!;
    expect(c.tutorial?.current?.id).toBe('p1-1.card');
    act(() => go({ name: 'map', side: 'plants', card: 'p1-1' }));
    tap('[data-action="start-level"]');
    expect(made[made.length - 1]!.c.tutorial).toBeNull();
    const stars = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p1-${i + 1}`, 1 as const]));
    session.update((s) => ({ ...s, plants: { stars, unlocked: ['potatoMine'] } }));
    // The conveyor level teaches the belt now; the survive level after it teaches nothing.
    act(() => go({ name: 'map', side: 'plants', card: 'p1-5' }));
    expect(q('[data-action="replay-tutorial"]')).not.toBeNull();
    act(() => go({ name: 'map', side: 'plants', card: 'p1-6' }));
    expect(q('[data-screen="level-card"]')).not.toBeNull();
    expect(q('[data-action="replay-tutorial"]')).toBeNull();
  });
});
