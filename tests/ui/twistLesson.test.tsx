// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVELS } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { BattleController } from '../../src/app/BattleController';
import { session } from '../../src/app/session';
import { go, startLevel } from '../../src/app/store';
import { TWIST_HINT_SECONDS } from '../../src/app/tutorial';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { seconds } from '../../src/data/balance';
import type { Save } from '../../src/progress/save';
import { App } from '../../src/ui/App';
import type { BattleSessionLike, SessionFactory } from '../../src/ui/screens/BattleScreen';
import { mapLevels, resetSeenStars } from '../../src/ui/screens/Map';
import { MemoryStorage } from '../progress/memoryStorage';
import { W2 } from '../app/world2Lessons';

// Step 2, Task 3: the twist pan through the app - the screen-wide catcher, the dimmed cards, Pause
// above it, the "tap" glove after 3 s, remembered once, and HELP on the level card plays it again.
// The Tundra's ice pan (z2-1) goes through the same steps, and the two zombie card lessons (z2-4 the
// Hot Topic, z2-7 the Cowboy Zombie) point at the card, then at its lane.

const NOW = 1_762_900_000_000;
let root: HTMLElement;
let made: { c: BattleController; s: BattleSessionLike }[];
const LEVELS_W2 = [...LEVELS, ...Object.values(W2)];

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
  // World 1 won on both sides: world 2's first levels are open.
  const stars = (l: string) => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${l}1-${i + 1}`, 2 as const]));
  session.update((s) => ({
    ...s,
    plants: { stars: stars('p'), unlocked: ['potatoMine', 'kernelPult', 'mangoPult'] },
    zombies: { stars: stars('z'), unlocked: ['desertZombie', 'skeletonArcher', 'hotTopic'] },
  }));
  mapLevels.value = LEVELS_W2;
  root = document.createElement('div');
  document.body.appendChild(root);
  act(() => render(<App createSession={factory} />, root));
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  session.dispose();
  mapLevels.value = LEVELS;
  go({ name: 'title' });
  vi.useRealTimers();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 600)}`);
  return el;
};
const me = (): Save => session.player.peek()!;
const tap = (sel: string): void => { act(() => { need(sel).click(); }); };
const steps = (c: BattleController, n: number): void => { act(() => { for (let i = 0; i < n; i++) c.step(); }); };

function startP21(): BattleController {
  act(() => { expect(startLevel(W2['p2-1']!, me(), 5, LEVELS_W2)).toBe(true); });
  return made[made.length - 1]!.c;
}

function startZ21(): BattleController {
  act(() => { expect(startLevel(W2['z2-1']!, me(), 5, LEVELS_W2)).toBe(true); });
  return made[made.length - 1]!.c;
}

describe('the twist pan through the app', () => {
  it('a screen-wide catcher while held, the cards dimmed; the glove taps the lawn after 3 s; a tap ends it, remembered once', () => {
    const c = startP21();
    expect(q('[data-twist]')).toBeNull(); // not before the match holds
    steps(c, 3);
    const catcher = need('[data-twist="fog"]');
    expect(catcher.dataset.twistStep).toBe('p2-1.fog');
    expect(q('[data-glove]')).toBeNull();
    steps(c, seconds(TWIST_HINT_SECONDS));
    expect(need('[data-tutorial] [data-glove]').dataset.glove).toBe('tap');
    expect(c.match.state.tick).toBe(1);
    act(() => { catcher.click(); });
    expect(me().teached).toEqual(['p2-1.fog']);
    expect(q('[data-twist]')).toBeNull();
    expect(q('[data-tutorial]')).toBeNull();
    steps(c, 10);
    expect(c.match.state.tick).toBe(11);
    // Started again: shown once only.
    const again = startP21();
    expect(again.tutorial).toBeNull();
  });

  it('Pause works during the pan: the menu comes over it (no catcher), Resume brings the pan back', () => {
    const c = startP21();
    steps(c, 3);
    tap('[data-hud="pause"]');
    expect(q('[data-screen="pause"]')).not.toBeNull();
    expect(q('[data-twist]')).toBeNull();
    expect(c.tutorial!.current?.id).toBe('p2-1.fog');
    tap('[data-screen="pause"] [data-action="resume"]');
    expect(q('[data-twist="fog"]')).not.toBeNull();
    tap('[data-twist="fog"]');
    expect(c.tutorial!.current).toBeNull();
  });

  it('HELP on the level card plays the pan again for a player who has seen it', () => {
    session.update((s) => ({ ...s, teached: ['p2-1.fog'] }));
    act(() => go({ name: 'map', side: 'plants', card: 'p2-1' }));
    tap('[data-action="start-level"]');
    expect(made[made.length - 1]!.c.tutorial).toBeNull();
    act(() => go({ name: 'map', side: 'plants', card: 'p2-1' }));
    tap('[data-action="replay-tutorial"]');
    const c = made[made.length - 1]!.c;
    expect(c.tutorial?.current?.id).toBe('p2-1.fog');
    steps(c, 3);
    expect(q('[data-twist="fog"]')).not.toBeNull();
  });

  it('z2-1 shows the ice the same way', () => {
    act(() => { expect(startLevel(W2['z2-1']!, me(), 5, LEVELS_W2)).toBe(true); });
    const c = made[made.length - 1]!.c;
    steps(c, 3);
    tap('[data-twist="ice"]');
    expect(me().teached).toEqual(['z2-1.ice']);
  });

  it('the ice pan through the app, step for step as the fog: nothing before the hold; the catcher and is-twist; the tap glove after 3 s; Pause above it; a tap ends it, remembered once', () => {
    const c = startZ21();
    const battle = (): HTMLElement => need('[data-screen="battle"]');
    expect(q('[data-twist]')).toBeNull();
    expect(battle().classList.contains('is-twist')).toBe(false);
    steps(c, 3);
    const catcher = need('[data-twist="ice"]');
    expect(catcher.dataset.twistStep).toBe('z2-1.ice');
    expect(battle().classList.contains('is-twist')).toBe(true);
    expect(battle().classList.contains('side-zombies')).toBe(true);
    // No picture to read, no glove yet: the pan itself is the lesson.
    expect(q('[data-glove]')).toBeNull();
    steps(c, seconds(TWIST_HINT_SECONDS));
    expect(need('[data-tutorial] [data-glove]').dataset.glove).toBe('tap');
    expect(need('[data-glove]').dataset.gloveStep).toBe('z2-1.ice');
    expect(c.match.state.tick).toBe(1); // held all the while
    // Pause still pauses (it is above the catcher); the pan waits under the menu.
    tap('[data-hud="pause"]');
    expect(q('[data-screen="pause"]')).not.toBeNull();
    expect(q('[data-twist]')).toBeNull();
    expect(c.tutorial!.current?.id).toBe('z2-1.ice');
    expect(battle().classList.contains('is-twist')).toBe(true);
    tap('[data-screen="pause"] [data-action="resume"]');
    // A tap anywhere ends it: nothing is sent, nothing is picked.
    const selected = c.hud.selected.peek();
    tap('[data-twist="ice"]');
    expect(me().teached).toEqual(['z2-1.ice']);
    expect(q('[data-twist]')).toBeNull();
    expect(q('[data-tutorial]')).toBeNull();
    expect(battle().classList.contains('is-twist')).toBe(false);
    expect(c.hud.selected.peek()).toBe(selected);
    expect(c.match.state.units.filter((u) => u.faction === 'zombies')).toHaveLength(0);
    steps(c, 10);
    expect(c.match.state.tick).toBe(11);
    // Started again: shown once only.
    expect(startZ21().tutorial).toBeNull();
  });

  it('HELP on z2-1\'s card plays the ice pan again for a player who has seen it', () => {
    session.update((s) => ({ ...s, teached: ['z2-1.ice'] }));
    act(() => go({ name: 'map', side: 'zombies', card: 'z2-1' }));
    tap('[data-action="start-level"]');
    expect(made[made.length - 1]!.c.tutorial).toBeNull();
    act(() => go({ name: 'map', side: 'zombies', card: 'z2-1' }));
    tap('[data-action="replay-tutorial"]');
    const c = made[made.length - 1]!.c;
    expect(c.tutorial?.current?.id).toBe('z2-1.ice');
    steps(c, 3);
    expect(q('[data-twist="ice"]')).not.toBeNull();
    // Seen again, it is not written twice.
    tap('[data-twist="ice"]');
    expect(me().teached).toEqual(['z2-1.ice']);
  });

  it('a pointer dragged across the ice catcher does nothing; the next plain tap ends the pan', () => {
    const c = startZ21();
    steps(c, 3);
    const catcher = need('[data-twist="ice"]');
    act(() => {
      catcher.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 700, pointerId: 1, isPrimary: true }));
      catcher.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 520, clientY: 500, pointerId: 1, isPrimary: true }));
      catcher.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 540, clientY: 300, pointerId: 1, isPrimary: true }));
      catcher.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 540, clientY: 300 }));
    });
    expect(c.tutorial!.current?.id).toBe('z2-1.ice');
    steps(c, 10);
    expect(c.match.state.tick).toBe(1);
    expect(c.match.state.units.filter((u) => u.faction === 'zombies')).toHaveLength(0);
    act(() => {
      catcher.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 400, pointerId: 2, isPrimary: true }));
      catcher.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 404, clientY: 402, pointerId: 2, isPrimary: true }));
      catcher.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 404, clientY: 402 }));
    });
    expect(c.tutorial!.current).toBeNull();
    expect(q('[data-twist]')).toBeNull();
  });

  for (const [id, card, lane] of [['z2-4', 'hotTopic', 0], ['z2-7', 'cowboyZombie', 2]] as const) {
    it(`${id}: the glove points at the ${card} card, then at its lane; two taps send it down there; remembered; no pan on this level`, () => {
      // A player who has won the Tundra's levels before this one (and so holds its new card).
      const won = Object.fromEntries(Array.from({ length: Number(id.split('-')[1]) - 1 }, (_, i) => [`z2-${i + 1}`, 2 as const]));
      session.update((s) => ({
        ...s, teached: ['z2-1.ice'],
        zombies: { stars: { ...s.zombies.stars, ...won }, unlocked: ['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie'] },
      }));
      act(() => { expect(startLevel(W2[id]!, me(), 5, LEVELS_W2)).toBe(true); });
      const c = made[made.length - 1]!.c;
      // Once the card can be paid for the match holds on it, the glove on the card.
      act(() => {
        c.match.state.players.zombies.energy = 500;
        for (let i = 0; i < seconds(10) && !c.tutorial!.holding; i++) c.step();
      });
      expect(q('[data-twist]')).toBeNull();
      expect(need('[data-screen="battle"]').classList.contains('is-twist')).toBe(false);
      const glove = (): HTMLElement => need('[data-tutorial] [data-glove]');
      expect(glove().dataset.glove).toBe('card');
      expect(glove().dataset.gloveStep).toBe(`${id}.${TEACHES[id]![0]!.id.split('.')[1]}`);
      expect(glove().dataset.holding).toBe('true');
      tap(`[data-hud="tray"] [data-card="${card}"]`);
      expect(glove().dataset.glove).toBe('tile');
      expect(glove().dataset.gloveStep).toBe(TEACHES[id]![1]!.id);
      act(() => { c.click({ lane, col: 9 }, null); c.step(); });
      expect(c.match.state.units.some((u) => u.key === card && u.lane === lane)).toBe(true);
      expect(q('[data-tutorial]')).toBeNull();
      expect(me().teached).toEqual(['z2-1.ice', ...TEACHES[id]!.map((t) => t.id)]);
    });
  }

  it('is-twist on the battle screen (raises Pause over the catcher, dims the cards) comes from the screen\'s render: kept through a re-render, gone when the pan ends', async () => {
    const c = startP21();
    const battle = (): HTMLElement => need('[data-screen="battle"]');
    expect(battle().classList.contains('is-twist')).toBe(false); // not before the hold
    steps(c, 3);
    expect(battle().classList.contains('is-twist')).toBe(true);
    // The screen re-renders (new card pictures arrive): the class stays.
    act(() => render(<App createSession={factory} />, root));
    expect(battle().classList.contains('is-twist')).toBe(true);
    // Pause: the button still pauses (no tap on the pan), the class stays under the menu.
    tap('[data-hud="pause"]');
    expect(c.tutorial!.current?.id).toBe('p2-1.fog');
    expect(battle().classList.contains('is-twist')).toBe(true);
    tap('[data-screen="pause"] [data-action="resume"]');
    tap('[data-twist="fog"]');
    expect(battle().classList.contains('is-twist')).toBe(false);
    // The rules raise Pause and dim by the class, never by :has (Safari before 15.4 has none).
    const fs = await import('node:fs');
    const css = fs.readFileSync(`${process.cwd()}/src/ui/hud/tutorial.css`, 'utf8');
    expect(css).toMatch(/\.battle\.is-twist \.battle__top \{ z-index: 6; \}/);
    expect(css).not.toContain(':has(');
  });

  it('a pointer dragged across the catcher does nothing (no pick, no plant, the pan stays); the next plain tap ends it', () => {
    const c = startP21();
    steps(c, 3);
    const catcher = need('[data-twist="fog"]');
    const selected = c.hud.selected.peek();
    act(() => {
      catcher.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 700, pointerId: 1, isPrimary: true }));
      catcher.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 520, clientY: 500, pointerId: 1, isPrimary: true }));
      catcher.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 540, clientY: 300, pointerId: 1, isPrimary: true }));
      catcher.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 540, clientY: 300 }));
    });
    expect(c.tutorial!.current?.id).toBe('p2-1.fog');
    expect(c.hud.selected.peek()).toBe(selected);
    steps(c, 10);
    expect(c.match.state.tick).toBe(1);
    expect(c.match.state.units).toHaveLength(0);
    act(() => {
      catcher.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 400, pointerId: 2, isPrimary: true }));
      catcher.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 404, clientY: 402, pointerId: 2, isPrimary: true }));
      catcher.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 404, clientY: 402 }));
    });
    expect(c.tutorial!.current).toBeNull();
    expect(q('[data-twist]')).toBeNull();
  });
});
