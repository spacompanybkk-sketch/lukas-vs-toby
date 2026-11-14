// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVELS } from '../../src/adventure/levels';
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
});
