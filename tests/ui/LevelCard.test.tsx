// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import { ADVENTURE } from '../../src/adventure/rewards';
import { session } from '../../src/app/session';
import { go, screen, startLevel } from '../../src/app/store';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { Save } from '../../src/progress/save';
import { App } from '../../src/ui/App';
import { resetSeenStars } from '../../src/ui/screens/Map';
import { DIFF_EASY, DIFF_HARD, DIFF_NORMAL } from '../../src/ui/screens/adventurePictures';
import { pixelPaths } from '../../src/ui/hud/PixelIcon';
import type { PixelArt } from '../../src/ui/hud/PixelIcon';
import { MemoryStorage } from '../progress/memoryStorage';

let root: HTMLElement;
let sounds: string[];
const NOW = 1_762_900_000_000;

beforeEach(() => {
  session.configure({ cloud: createFakeCloud(new FakeDatabase({ now: () => NOW })), storage: new MemoryStorage(), now: () => NOW, window: null, document: null });
  sounds = [];
  resetSeenStars();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  session.dispose();
  go({ name: 'title' });
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const all = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 600)}`);
  return el;
};
const tap = (sel: string): void => { act(() => { need(sel).click(); }); };

/** A player with `progress`, on the map of `side` with the card of `id` open. */
async function openCard(id: string, progress: Partial<Pick<Save, 'plants' | 'zombies'>> = {}): Promise<void> {
  const made = await session.create('Mia', 'peashooter', '123');
  if (typeof made === 'string') throw new Error(made);
  session.update((s) => ({ ...s, ...progress }));
  act(() => render(<App onSound={(n) => sounds.push(n)} />, root));
  const side = id.startsWith('p') ? 'plants' : 'zombies';
  act(() => go({ name: 'map', side, card: id }));
}
const pictures = (sel: string): string[] => all(`${sel} [data-picture]`).map((p) => p.dataset.picture ?? '');

describe('Level card', () => {
  it('a first battle: its kind and number, the one card dealt, the enemy, three empty stars (win, base at half, nearly full)', async () => {
    await openCard('p1-1');
    const card = need('[data-screen="level-card"]');
    expect(card.dataset.kind).toBe('battle');
    expect(need('.lcard__head [data-kind="battle"]')).toBeDefined();
    expect(pictures('[data-dealt]')).toEqual(['peashooter']);
    expect(pictures('[data-enemy]')).toEqual(['brainEater']);
    expect(all('[data-star]')).toHaveLength(3);
    expect(all('[data-star][data-won]')).toHaveLength(0);
    expect(all('[data-goal]').map((g) => `${g.dataset.goal} ${g.dataset.share}`)).toEqual([
      'win 1', `base ${ADVENTURE.baseStars.two}`, `base ${ADVENTURE.baseStars.three}`,
    ]);
    expect(q('[data-reward]')).toBeNull();
    expect(card.textContent?.trim()).toBe('EasyNormalHardHelp'); // pictures, and only the four small buttons' names
  });

  it('a won level shows its stars filled', async () => {
    await openCard('p1-1', { plants: { stars: { 'p1-1': 2 }, unlocked: [] } });
    expect(all('[data-star][data-won]').map((s) => s.dataset.star)).toEqual(['1', '2']);
  });

  it('a Survive level that unlocks a unit shows its silhouette as the reward; deals only the cards the player holds', async () => {
    await openCard('p1-3', { plants: { stars: { 'p1-1': 1, 'p1-2': 1 }, unlocked: [] } });
    expect(need('.lcard__head [data-kind="survive"]')).toBeDefined();
    expect(need('[data-reward]').dataset.reward).toBe('potatoMine');
    expect(pictures('[data-dealt]')).toEqual(['peashooter', 'sunflower', 'walnutBomb']);
    expect(pictures('[data-enemy]')).toEqual(['brainEater']);
  });

  it('a Breakthrough level asks for time left: two clock stars', async () => {
    await openCard('z1-3', { zombies: { stars: { 'z1-1': 1, 'z1-2': 1 }, unlocked: [] } });
    expect(all('[data-goal]').map((g) => `${g.dataset.goal} ${g.dataset.share}`)).toEqual([
      'win 1', `clock ${ADVENTURE.clockStars.two}`, `clock ${ADVENTURE.clockStars.three}`,
    ]);
    expect(pictures('[data-enemy]')).toEqual(['peashooter', 'walnutBomb']);
  });

  it('a boss level shows the skull-crown first among the enemies', async () => {
    const stars = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`p1-${i + 1}`, 1 as const]));
    await openCard('p1-8', { plants: { stars, unlocked: ['potatoMine', 'kernelPult'] } });
    expect(need('[data-enemy] [data-boss]').dataset.boss).toBe('brainTitan');
    expect(pictures('[data-dealt]')).toHaveLength(5);
  });

  it('three faces with the saved difficulty ringed; a change is saved for that side', async () => {
    await openCard('z1-1');
    const pressed = (): string[] => all('[data-skill][aria-pressed="true"]').map((b) => b.dataset.skill ?? '');
    expect(all('[data-skill]').map((b) => b.dataset.skill)).toEqual(['easy', 'medium', 'hard']);
    const saved = session.player.value!.difficulty.zombies;
    expect(pressed()).toEqual([saved]);
    tap('[data-skill="hard"]');
    expect(session.player.value!.difficulty.zombies).toBe('hard');
    expect(pressed()).toEqual(['hard']);
    expect(sounds.at(-1)).toBe('click');
  });

  it('each small button names itself under its picture: EASY, NORMAL, HARD and the glove HELP', async () => {
    await openCard('p1-1');
    const names = (sel: string): string | undefined => need(`${sel} [data-btn-name]`).textContent ?? undefined;
    expect(names('[data-skill="easy"]')).toBe('Easy');
    expect(names('[data-skill="medium"]')).toBe('Normal');
    expect(names('[data-skill="hard"]')).toBe('Hard');
    expect(names('[data-action="replay-tutorial"]')).toBe('Help');
    for (const el of all('[data-btn-name]')) expect(el.classList.contains('inked')).toBe(true);
  });

  it('the difficulty is drawn as one, two, three skulls (not moods); the chosen one ringed, the others greyed', async () => {
    await openCard('z1-1');
    const drawn = (skill: string): string[] => [...need(`[data-skill="${skill}"] svg`).querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
    expect(drawn('easy')).toEqual(pixelPaths(DIFF_EASY).map((p) => p.d));
    expect(drawn('medium')).toEqual(pixelPaths(DIFF_NORMAL).map((p) => p.d));
    expect(drawn('hard')).toEqual(pixelPaths(DIFF_HARD).map((p) => p.d));
    tap('[data-skill="medium"]');
    expect(need('[data-skill="medium"]').classList.contains('is-on')).toBe(true);
    expect(all('.lcard__face.is-on')).toHaveLength(1);
  });

  it('each difficulty picture holds as many skulls as its step (eyes counted: two of four pixels a skull)', () => {
    const eyes = (art: PixelArt): number => art.rows.join('').split('').filter((ch) => ch === 'P' || ch === 'r').length;
    expect([DIFF_EASY, DIFF_NORMAL, DIFF_HARD].map((a) => eyes(a) / 4)).toEqual([1, 2, 3]);
  });

  it('a level with no energy (conveyor) shows no difficulty faces: they change only income', async () => {
    await openCard('p1-5', { plants: { stars: { 'p1-1': 3, 'p1-2': 3, 'p1-3': 3, 'p1-4': 3 }, unlocked: ['potatoMine'] } });
    expect(all('[data-skill]')).toHaveLength(0);
    expect(q('[data-action="start-level"]')).not.toBeNull();
    act(() => session.update((s) => ({ ...s, zombies: { stars: { 'z1-1': 3, 'z1-2': 3, 'z1-3': 3, 'z1-4': 3 }, unlocked: ['desertZombie'] } })));
    act(() => go({ name: 'map', side: 'zombies', card: 'z1-5' }));
    expect(need('[data-screen="level-card"]').dataset.level).toBe('z1-5');
    expect(all('[data-skill]')).toHaveLength(0);
    // A level with energy keeps them.
    act(() => go({ name: 'map', side: 'zombies', card: 'z1-4' }));
    expect(all('[data-skill]')).toHaveLength(3);
  });

  it('the big play button starts the level: a battle on its side with its cards (startLevel)', async () => {
    await openCard('p1-2', { plants: { stars: { 'p1-1': 1 }, unlocked: [] } });
    tap('[data-action="start-level"]');
    const s = screen.value;
    expect(s.name).toBe('battle');
    if (s.name !== 'battle') return;
    expect(s.options).toMatchObject({ playerFaction: 'plants', level: 'p1-2', cards: ['peashooter', 'sunflower'], skill: levelById('p1-2')!.opponent?.skill ?? 'easy' });
  });

  it('startLevel itself refuses a closed level (not only the map), and starts an open one', async () => {
    await openCard('p1-1');
    const save = session.player.value!;
    act(() => go({ name: 'map', side: 'plants' }));
    expect(startLevel(levelById('p1-3')!, save, 5)).toBe(false);
    expect(screen.value.name).toBe('map');
    expect(startLevel(levelById('z1-2')!, save, 5)).toBe(false);
    expect(startLevel(levelById('p1-1')!, save, 5)).toBe(true);
    expect(screen.value.name).toBe('battle');
  });

  it('the reward is a gift box with the unit\'s silhouette, set apart from the stars by a plus; the two bar goals differ', async () => {
    await openCard('p1-3', { plants: { stars: { 'p1-1': 1, 'p1-2': 1 }, unlocked: [] } });
    const row = [...need('.lcard__stars').children].map((c) => c.className.split(' ')[0]);
    expect(row).toEqual(['lcard__star', 'lcard__star', 'lcard__star', 'lcard__plus', 'lcard__reward']);
    expect(need('[data-reward] .lcard__bow')).toBeDefined();
    expect(need('[data-reward] .lcard__gift [data-picture="potatoMine"]')).toBeDefined();
    expect(all('[data-fill]').map((f) => `${f.dataset.fill} ${f.style.width}`)).toEqual(['yellow 50%', 'green 80%']);
  });

  it('a tap on the dim around the card closes it', async () => {
    await openCard('p1-1');
    act(() => { need('[data-veil]').click(); });
    expect(screen.value).toEqual({ name: 'map', side: 'plants' });
  });

  it('every target is a button (tap only), and the card of a level of the other side does not open', async () => {
    await openCard('p1-1');
    for (const b of all('[data-screen="level-card"] button')) expect(b.getAttribute('type')).toBe('button');
    act(() => go({ name: 'map', side: 'zombies', card: 'p1-1' }));
    expect(q('[data-screen="level-card"]')).toBeNull();
  });
});
