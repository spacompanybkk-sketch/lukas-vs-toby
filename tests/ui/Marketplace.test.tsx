// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../../src/app/session';
import { go, screen } from '../../src/app/store';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { ALL_CARDS } from '../../src/data/units';
import { loadLocal } from '../../src/progress/localStore';
import { upgradeCost } from '../../src/progress/upgrades';
import type { CardKey } from '../../src/sim/types';
import { Marketplace } from '../../src/ui/screens/Marketplace';
import { setUiSound } from '../../src/ui/uiSound';
import { MemoryStorage } from '../progress/memoryStorage';

let root: HTMLElement;
let db: FakeDatabase;
let storage: MemoryStorage;
let sounds: string[];
const NOW = 1_762_900_000_000;

beforeEach(async () => {
  db = new FakeDatabase({ now: () => NOW });
  storage = new MemoryStorage();
  session.configure({ cloud: createFakeCloud(db), storage, now: () => NOW, window: null, document: null });
  sounds = [];
  setUiSound((n) => sounds.push(n));
  root = document.createElement('div');
  document.body.appendChild(root);
  go({ name: 'marketplace' });
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  setUiSound(null);
  session.dispose();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const all = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 600)}`);
  return el;
};
const tap = (sel: string): void => { act(() => { need(sel).click(); }); };
const mount = (): void => void act(() => render(<Marketplace />, root));

async function player(picture: CardKey = 'sunflower', coins = 1000, upgrades: Partial<Record<CardKey, number>> = {}): Promise<void> {
  const made = await session.create('Mia', picture, '123');
  if (typeof made === 'string') throw new Error(made);
  session.update((s) => ({ ...s, coins, upgrades }));
}

const coins = (): number => Number(need('[data-coins]').dataset.coins);
const filled = (key: CardKey): number => all(`[data-card="${key}"] [data-pip].is-on`).length;

describe('Marketplace', () => {
  it('shows the coins, two picture tabs and the ten cards of a side, each with a picture, ten pips, a price and a big +', async () => {
    await player('sunflower', 450, { peashooter: 3 });
    mount();
    expect(coins()).toBe(450);
    expect(all('[data-tab]').map((t) => t.dataset.tab)).toEqual(['plants', 'zombies']);
    expect(all('[data-card]').map((c) => c.dataset.card)).toEqual(ALL_CARDS.plants);
    for (const card of all('[data-card]')) {
      expect(card.querySelector('.pic__img, .pic__silhouette')).not.toBeNull();
      expect(card.querySelectorAll('[data-pip]')).toHaveLength(10);
      expect(card.querySelector('[data-buy]')).not.toBeNull();
    }
    expect(filled('peashooter')).toBe(3);
    expect(filled('sunflower')).toBe(0);
    expect(need('[data-card="peashooter"] [data-price]').dataset.price).toBe(String(upgradeCost(4)));
    expect(need('[data-card="sunflower"] [data-price]').dataset.price).toBe(String(upgradeCost(1)));
  });

  it('opens on the side of the player\'s picture; the other tab shows the other ten', async () => {
    await player('brainEater');
    mount();
    expect(need('[data-screen="marketplace"]').dataset.side).toBe('zombies');
    expect(all('[data-card]').map((c) => c.dataset.card)).toEqual(ALL_CARDS.zombies);
    tap('[data-tab="plants"]');
    expect(all('[data-card]').map((c) => c.dataset.card)).toEqual(ALL_CARDS.plants);
    expect(need('[data-tab="plants"]').getAttribute('aria-selected')).toBe('true');
  });

  it('buying: the merge sound, a pip fills, the portrait hops, the coins go down, saved through the session', async () => {
    await player('sunflower', 450, { peashooter: 1 });
    mount();
    tap('[data-buy="peashooter"]');
    expect(sounds.at(-1)).toBe('merge');
    expect(filled('peashooter')).toBe(2);
    expect(coins()).toBe(250);
    expect(need('[data-card="peashooter"] .market__pic').className).toMatch(/is-hop-/);
    expect(need('[data-card="peashooter"] [data-pip="2"]').className).toContain('is-new');
    expect(session.player.value?.upgrades.peashooter).toBe(2);
    expect(loadLocal('p03', storage)).toMatchObject({ coins: 250, upgrades: { peashooter: 2 } });
    // A second buy restarts the hop (the other of the two animation classes).
    const first = need('[data-card="peashooter"] .market__pic').className;
    tap('[data-buy="peashooter"]');
    expect(filled('peashooter')).toBe(2); // 300 needed, 250 left
    expect(need('[data-card="peashooter"] .market__pic').className).toBe(first);
  });

  it('too few coins: the card shakes and the deny sound plays; nothing changes', async () => {
    await player('sunflower', 99);
    mount();
    const before = session.player.value;
    expect(need('[data-card="sunflower"]').className).toContain('is-poor');
    tap('[data-buy="sunflower"]');
    expect(sounds.at(-1)).toBe('deny');
    expect(need('[data-card="sunflower"]').className).toMatch(/is-deny-[ab]/);
    expect(session.player.value).toBe(before);
    expect(coins()).toBe(99);
    const shake = need('[data-card="sunflower"]').className.match(/is-deny-[ab]/)?.[0];
    tap('[data-buy="sunflower"]');
    expect(need('[data-card="sunflower"]').className).not.toContain(shake);
    expect(need('[data-card="sunflower"]').className).toMatch(/is-deny-[ab]/);
  });

  it('level 10: a gold frame, all pips filled, no + and no price', async () => {
    await player('sunflower', 5000, { walnutBomb: 10, peashooter: 9 });
    mount();
    const top = need('[data-card="walnutBomb"]');
    expect(top.className).toContain('is-max');
    expect(top.dataset.max).toBeDefined();
    expect(filled('walnutBomb')).toBe(10);
    expect(top.querySelector('[data-buy]')).toBeNull();
    expect(top.querySelector('[data-price]')).toBeNull();
    // Buying the last step turns a card gold.
    tap('[data-buy="peashooter"]');
    expect(need('[data-card="peashooter"]').className).toContain('is-max');
    expect(q('[data-buy="peashooter"]')).toBeNull();
    expect(coins()).toBe(5000 - upgradeCost(10));
  });

  it('nothing needs reading: every button has a picture and a label for the screen reader', async () => {
    await player();
    mount();
    for (const b of all('button')) {
      expect(b.getAttribute('aria-label'), b.outerHTML.slice(0, 80)).toBeTruthy();
      expect(b.querySelector('svg, .ico, img, .pic'), b.outerHTML.slice(0, 80)).not.toBeNull();
    }
  });

  it('back goes Home', async () => {
    await player();
    mount();
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('home');
  });

  it('logged out, it sends the visitor to the pictures from an effect', () => {
    const spy = vi.fn();
    const stop = screen.subscribe(spy);
    mount();
    expect(screen.value.name).toBe('players');
    stop();
  });
});
