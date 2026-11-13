// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { session } from '../../src/app/session';
import { go, screen } from '../../src/app/store';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { CardKey } from '../../src/sim/types';
import { App } from '../../src/ui/App';
import { ADVENTURE_PICTURES } from '../../src/ui/screens/adventurePictures';
import { setUiSound } from '../../src/ui/uiSound';
import { MemoryStorage } from '../progress/memoryStorage';

let root: HTMLElement;
let sounds: string[];
const NOW = 1_762_900_000_000;

beforeEach(() => {
  session.configure({ cloud: createFakeCloud(new FakeDatabase({ now: () => NOW })), storage: new MemoryStorage(), now: () => NOW, window: null, document: null });
  sounds = [];
  setUiSound((n) => sounds.push(n));
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  setUiSound(null);
  session.dispose();
  go({ name: 'title' });
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 600)}`);
  return el;
};
const tap = (sel: string): void => { act(() => { need(sel).click(); }); };
const mount = (): void => void act(() => render(<App boys={{ lukas: '/l.png', toby: '/t.png' }} onSound={(n) => sounds.push(n)} />, root));

async function player(picture: CardKey = 'peashooter'): Promise<void> {
  const made = await session.create('Mia', picture, '123');
  if (typeof made === 'string') throw new Error(made);
}

describe('Play menu', () => {
  it('Home\'s Play opens three big picture buttons: Adventure, Quick Battle, Free Play', async () => {
    await player();
    mount();
    act(() => go({ name: 'home' }));
    tap('[data-home="play"]');
    expect(screen.value.name).toBe('play');
    const modes = [...root.querySelectorAll<HTMLElement>('[data-play]')];
    expect(modes.map((m) => m.dataset.play)).toEqual(['adventure', 'quick', 'free']);
    for (const m of modes) {
      expect(m.querySelector('svg.pixel-icon')).not.toBeNull();
      expect(m.textContent?.trim()).toBe(''); // pictures only
      expect(m.hasAttribute('data-locked')).toBe(false);
    }
  });

  it('Quick Battle goes to the side pick, whose back arrow comes back here; back here goes Home', async () => {
    await player();
    mount();
    act(() => go({ name: 'play' }));
    tap('[data-play="quick"]');
    expect(screen.value.name).toBe('sidepick');
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('play');
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('home');
    expect(sounds).toContain('click');
  });

  it('Adventure: the two boys with their unit behind; a boy opens his side\'s map', async () => {
    await player('brainEater');
    mount();
    act(() => go({ name: 'play' }));
    tap('[data-play="adventure"]');
    expect(screen.value).toEqual({ name: 'side', mode: 'adventure' });
    expect(need('[data-side="plants"] .duo__boy img').getAttribute('src')).toBe('/l.png');
    expect(need('[data-side="zombies"] .duo__boy img').getAttribute('src')).toBe('/t.png');
    expect(need('[data-side="zombies"] .duo__unit')).toBeDefined();
    // The side of the player's own picture bounces.
    expect(need('[data-side="zombies"]').classList.contains('is-mine')).toBe(true);
    tap('[data-side="zombies"]');
    expect(screen.value).toEqual({ name: 'map', side: 'zombies' });
  });

  it('Free Play: the side, then a wave behind a padlock (coming soon); back goes to the side', async () => {
    await player();
    mount();
    act(() => go({ name: 'play' }));
    tap('[data-play="free"]');
    expect(screen.value).toEqual({ name: 'side', mode: 'free' });
    tap('[data-side="plants"]');
    expect(screen.value).toEqual({ name: 'freeplay', side: 'plants' });
    expect(need('[data-soon]')).toBeDefined();
    tap('[data-action="back"]');
    expect(screen.value).toEqual({ name: 'side', mode: 'free' });
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('play');
  });

  it('a guest has Quick Battle only: Adventure and Free Play carry a player padlock and buzz', () => {
    mount();
    act(() => go({ name: 'play' }));
    for (const mode of ['adventure', 'free']) {
      const b = need(`[data-play="${mode}"]`);
      expect(b.hasAttribute('data-locked')).toBe(true);
      expect(b.querySelector('[data-player-lock]')).not.toBeNull();
      tap(`[data-play="${mode}"]`);
      expect(screen.value.name).toBe('play');
      expect(sounds.at(-1)).toBe('deny');
      expect(b.className).toMatch(/is-nudged-/);
    }
    expect(q('[data-play="quick"] [data-player-lock]')).toBeNull();
    tap('[data-play="quick"]');
    expect(screen.value.name).toBe('sidepick');
    tap('[data-action="back"]');
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('title');
  });
});

describe('Adventure pictures', () => {
  it.each(Object.entries(ADVENTURE_PICTURES))('%s: 16 × 16, every colour in the palette', (_name, art) => {
    expect(art.rows).toHaveLength(16);
    for (const row of art.rows) {
      expect(row.length).toBe(16);
      for (const ch of row) if (ch !== '.') expect(art.palette[ch], `colour ${ch}`).toBeDefined();
    }
  });
});
