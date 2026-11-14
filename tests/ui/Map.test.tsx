// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { session } from '../../src/app/session';
import { go, screen } from '../../src/app/store';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { newSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { frameColor } from '../../src/ui/frameColor';
import { App } from '../../src/ui/App';
import type { MapHost, MapHostView } from '../../src/ui/screens/Map';
import { resetSeenStars } from '../../src/ui/screens/Map';
import { mapStones } from '../../src/ui/screens/mapModel';
import { LEVELS } from '../../src/adventure/levels';
import { previewWorlds } from '../../src/app/previewWorlds';
import { mapLevels } from '../../src/ui/screens/Map';
import { setUiSound } from '../../src/ui/uiSound';
import { MemoryStorage } from '../progress/memoryStorage';

let root: HTMLElement;
let sounds: string[];
let calls: string[];
const NOW = 1_762_900_000_000;

type Layout = NonNullable<ReturnType<MapHost['layout']>>;

/**
 * A 3D map stand-in: records what it is told and lays the stones out on a line. Like MapStage, its
 * layout is one object whose version goes up only when something moved (a view or a measure).
 */
function fakeHost(): MapHost & { views: MapHostView[]; layouts: number; out: { stones: Record<string, { x: number; y: number }>; flag: { x: number; y: number } | null; hop: number; version: number } } {
  const views: MapHostView[] = [];
  let open = false;
  const host = {
    views,
    layouts: 0,
    out: { stones: {} as Record<string, { x: number; y: number }>, flag: null as { x: number; y: number } | null, hop: 9, version: 0 },
    relayout(v: MapHostView) {
      host.out.stones = Object.fromEntries(v.stones.map((s, i) => [s.id, { x: 100 + i * 100, y: 400 - i * 10 }]));
      host.out.flag = v.stones.some((s) => s.state === 'next') ? { x: 55, y: 66 } : null;
      host.out.version++;
    },
    open: (v: MapHostView) => { open = true; views.push(v); calls.push(`open ${v.side}`); host.relayout(v); },
    update: (v: MapHostView) => { views.push(v); calls.push(`update ${v.side}`); host.relayout(v); },
    measure: () => { calls.push('measure'); host.out.version++; },
    close: () => { open = false; calls.push('close'); },
    layout: (): Layout | null => { host.layouts++; return open ? host.out : null; },
  };
  return host;
}

const at = (sel: string): string => need(sel).style.transform;
const frames = (n: number): Promise<void> => act(async () => {
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
});

beforeEach(() => {
  session.configure({ cloud: createFakeCloud(new FakeDatabase({ now: () => NOW })), storage: new MemoryStorage(), now: () => NOW, window: null, document: null });
  sounds = [];
  calls = [];
  resetSeenStars();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  setUiSound(null);
  mapLevels.value = LEVELS;
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
const mount = (host?: MapHost): void => void act(() => render(
  <App boys={{ lukas: '/l.png', toby: '/t.png' }} onSound={(n) => sounds.push(n)} map={host} />, root,
));

async function player(stars: Save['plants']['stars'] = {}, picture: Save['picture'] = 'peashooter'): Promise<void> {
  const made = await session.create('Mia', picture, '123');
  if (typeof made === 'string') throw new Error(made);
  session.update((s) => ({ ...s, plants: { ...s.plants, stars } }));
}
const state = (id: string): string | undefined => need(`[data-stone="${id}"]`).dataset.state;

describe('map states', () => {
  const fresh = newSave('p01', 'Lukas', 'peashooter', NOW);
  it('a new player: the first stone is next, the other seven closed', () => {
    expect(mapStones(fresh, 'plants').map((s) => s.state)).toEqual(['next', 'closed', 'closed', 'closed', 'closed', 'closed', 'closed', 'closed']);
  });
  it('midway: won stones are done with their stars, the first without a star is next, the rest closed', () => {
    const s: Save = { ...fresh, plants: { stars: { 'p1-1': 3, 'p1-2': 1, 'p1-3': 2 }, unlocked: ['potatoMine'] } };
    const stones = mapStones(s, 'plants');
    expect(stones.map((x) => x.state)).toEqual(['done', 'done', 'done', 'next', 'closed', 'closed', 'closed', 'closed']);
    expect(stones.map((x) => x.stars)).toEqual([3, 1, 2, 0, 0, 0, 0, 0]);
    // The unlock silhouettes: p1-3's Potato Mine is won (gone); p1-6's Kernel-pult is still to win.
    expect(stones.map((x) => x.unlock)).toEqual([null, null, null, null, null, 'kernelPult', null, null]);
    // The other side's progress is its own.
    expect(mapStones(s, 'zombies')[0]!.state).toBe('next');
  });
  it('an open level that is not the next: won later levels with an earlier one skipped stay open', () => {
    const s: Save = { ...fresh, plants: { stars: { 'p1-1': 1, 'p1-3': 2 }, unlocked: [] } };
    expect(mapStones(s, 'plants').slice(0, 5).map((x) => x.state)).toEqual(['done', 'next', 'done', 'open', 'closed']);
  });
  it('all won: no next stone', () => {
    const stars = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p1-${i + 1}`, 3 as const]));
    expect(mapStones({ ...fresh, plants: { stars, unlocked: [] } }, 'plants').every((x) => x.state === 'done')).toBe(true);
  });
});

describe('Map screen', () => {
  it('eight stones with kind, number, stars; padlocks on closed ones; the player on the next stone in their frame colour', async () => {
    await player({ 'p1-1': 3, 'p1-2': 2 });
    mount();
    act(() => go({ name: 'map', side: 'plants' }));
    expect(all('[data-stone]').map((s) => s.dataset.stone)).toEqual(['p1-1', 'p1-2', 'p1-3', 'p1-4', 'p1-5', 'p1-6', 'p1-7', 'p1-8']);
    expect(state('p1-1')).toBe('done');
    expect(all('[data-stone="p1-1"] [data-on]')).toHaveLength(3);
    expect(all('[data-stone="p1-2"] [data-on]')).toHaveLength(2);
    expect(state('p1-3')).toBe('next');
    expect(all('[data-stone="p1-3"] .stone__star')).toHaveLength(3);
    expect(all('[data-stone="p1-3"] [data-on]')).toHaveLength(0);
    expect(state('p1-4')).toBe('closed');
    expect(q('[data-stone="p1-4"] .stone__lock')).not.toBeNull();
    expect(q('[data-stone="p1-3"] .stone__lock')).toBeNull();
    expect(need('[data-stone="p1-5"] [data-kind="conveyor"]')).toBeDefined();
    expect(need('[data-stone="p1-8"] [data-kind="boss"]')).toBeDefined();
    expect(need('[data-stone="p1-3"] [data-unlock="potatoMine"]')).toBeDefined();
    const marker = need('[data-marker]');
    expect(marker.dataset.marker).toBe('p1-3');
    expect(marker.querySelector('[data-frame]')?.getAttribute('data-frame')).toBe(frameColor(session.player.value!.slot));
    for (const s of all('[data-stone]')) expect(s.textContent?.trim()).toBe(''); // pictures only
  });

  it('a closed stone buzzes and shows a padlock with an arrow to the next level; the arrow opens that card', async () => {
    await player({ 'p1-1': 1 });
    mount();
    act(() => go({ name: 'map', side: 'plants' }));
    tap('[data-stone="p1-5"]');
    expect(sounds.at(-1)).toBe('deny');
    expect(need('[data-screen="level-card"]').hasAttribute('data-locked')).toBe(true);
    expect(q('[data-action="start-level"]')).toBeNull();
    expect(need('[data-action="go-next"]').dataset.next).toBe('p1-2');
    tap('[data-action="go-next"]');
    expect(screen.value).toEqual({ name: 'map', side: 'plants', card: 'p1-2' });
    expect(need('[data-screen="level-card"]').dataset.level).toBe('p1-2');
    expect(q('[data-action="start-level"]')).not.toBeNull();
  });

  it('an open stone opens its card; close goes back to the map', async () => {
    await player();
    mount();
    act(() => go({ name: 'map', side: 'plants' }));
    tap('[data-stone="p1-1"]');
    expect(sounds.at(-1)).toBe('click');
    expect(need('[data-screen="level-card"]').dataset.level).toBe('p1-1');
    tap('[data-action="close-card"]');
    expect(screen.value).toEqual({ name: 'map', side: 'plants', world: 1 });
    expect(q('[data-screen="level-card"]')).toBeNull();
  });

  it('two portrait tabs switch sides; each side has its own path', async () => {
    await player({ 'p1-1': 2 });
    mount();
    act(() => go({ name: 'map', side: 'plants' }));
    expect(need('[data-tab="plants"]').getAttribute('aria-selected')).toBe('true');
    expect(need('[data-tab="plants"] img').getAttribute('src')).toBe('/l.png');
    expect(need('[data-tab="zombies"] img').getAttribute('src')).toBe('/t.png');
    tap('[data-tab="zombies"]');
    expect(screen.value).toEqual({ name: 'map', side: 'zombies' });
    expect(all('[data-stone]').map((s) => s.dataset.stone)[0]).toBe('z1-1');
    expect(state('z1-1')).toBe('next');
    expect(state('z1-2')).toBe('closed');
  });

  it('the 3D host: opened with the stones, updated on a side change, closed when leaving; HTML placed from its layout', async () => {
    await player({ 'p1-1': 1 });
    const host = fakeHost();
    mount(host);
    act(() => go({ name: 'map', side: 'plants' }));
    expect(calls).toEqual(['open plants']);
    expect(host.views[0]).toEqual({
      side: 'plants', arena: 'backyard', locked: false, frame: frameColor(session.player.value!.slot),
      islands: [
        { arena: 'backyard', locked: false }, { arena: 'meadow', locked: true }, { arena: 'desert', locked: true },
        { arena: 'tundra', locked: true }, { arena: 'citadel', locked: true },
      ],
      stones: [{ id: 'p1-1', state: 'done' }, { id: 'p1-2', state: 'next' }, ...['3', '4', '5', '6', '7', '8'].map((n) => ({ id: `p1-${n}`, state: 'closed' }))],
    });
    expect(at('[data-stone="p1-1"]')).toBe('translate3d(100px, 400px, 0)');
    expect(at('[data-stone="p1-3"]')).toBe('translate3d(300px, 380px, 0)');
    expect(at('[data-marker]')).toBe('translate3d(55px, 66px, 0)');
    expect(need('[data-screen="map"]').style.getPropertyValue('--hop')).toBe('9px');
    // Opening a card does not rebuild the board.
    tap('[data-stone="p1-2"]');
    expect(calls).toEqual(['open plants']);
    tap('[data-action="close-card"]');
    tap('[data-tab="zombies"]');
    expect(calls).toEqual(['open plants', 'update zombies']);
    // A resize measures again and places the HTML at once.
    host.out.stones['z1-1'] = { x: 7, y: 8 };
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(calls).toContain('measure');
    expect(at('[data-stone="z1-1"]')).toBe('translate3d(7px, 8px, 0)');
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('play');
    expect(calls.at(-1)).toBe('close');
  });

  it('every frame asks the layout, but writes nothing while its version stands', async () => {
    await player({ 'p1-1': 1 });
    const host = fakeHost();
    mount(host);
    act(() => go({ name: 'map', side: 'plants' }));
    const stone = need('[data-stone="p1-2"]');
    expect(stone.style.transform).toBe('translate3d(200px, 390px, 0)');
    // A mark no placement would write: it stays while the layout's version stands.
    stone.style.transform = 'mark';
    need('[data-marker]').style.transform = 'mark';
    const before = host.layouts;
    await frames(5);
    expect(host.layouts).toBeGreaterThan(before);
    expect(stone.style.transform).toBe('mark');
    expect(at('[data-marker]')).toBe('mark');
    // The camera moved (the version went up): written again, as a transform.
    host.out.stones['p1-2'] = { x: 210, y: 391 };
    host.out.version++;
    await frames(2);
    expect(stone.style.transform).toBe('translate3d(210px, 391px, 0)');
    expect(stone.style.left).toBe('');
  });

  it('an unlock bubble leans away from the next stone on the path', async () => {
    await player({ 'p1-1': 1, 'p1-2': 1 });
    const host = fakeHost();
    mount(host);
    act(() => go({ name: 'map', side: 'plants' }));
    // The fake lays the path left to right: the next stone is always to the right.
    expect(need('[data-stone="p1-3"]').dataset.lean).toBe('left');
    expect(need('[data-stone="p1-3"] [data-unlock] .stone__q')).toBeDefined();
    expect(need('[data-stone="p1-6"] [data-unlock="kernelPult"]')).toBeDefined();
  });

  it('opening and closing the map ten times leaves the host closed each time', async () => {
    await player();
    const host = fakeHost();
    mount(host);
    for (let i = 0; i < 10; i++) {
      act(() => go({ name: 'map', side: i % 2 === 0 ? 'plants' : 'zombies' }));
      act(() => go({ name: 'play' }));
    }
    expect(calls.filter((c) => c.startsWith('open'))).toHaveLength(10);
    expect(calls.filter((c) => c === 'close')).toHaveLength(10);
    expect(calls.at(-1)).toBe('close');
  });

  it('a star won since the last look pops in with the merge sound, once', async () => {
    await player({ 'p1-1': 1 });
    mount();
    act(() => go({ name: 'map', side: 'plants' }));
    expect(sounds).not.toContain('merge');
    act(() => go({ name: 'play' }));
    act(() => session.update((s) => ({ ...s, plants: { ...s.plants, stars: { 'p1-1': 3 } } })));
    act(() => go({ name: 'map', side: 'plants' }));
    expect(sounds.filter((n) => n === 'merge')).toHaveLength(1);
    expect(need('[data-stone="p1-1"]').classList.contains('is-fresh')).toBe(true);
    tap('[data-stone="p1-1"]');
    expect(sounds.filter((n) => n === 'merge')).toHaveLength(1);
  });

  it('nobody logged in: back to the Play menu', () => {
    mount();
    act(() => go({ name: 'map', side: 'plants' }));
    expect(screen.value.name).toBe('play');
  });
});

describe('Map screen: one island per world', () => {
  const won = (prefix: string): Record<string, 3> => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${prefix}-${i + 1}`, 3]));

  it('shipped levels: world 1 has no arrow back; the arrow on goes to a locked island (grey, padlock, no stones) that refuses a tap', async () => {
    await player({ 'p1-1': 1 });
    const host = fakeHost();
    mount(host);
    act(() => go({ name: 'map', side: 'plants' }));
    const map = need('[data-screen="map"]');
    expect(map.dataset.world).toBe('1');
    expect(map.dataset.arena).toBe('backyard');
    expect(q('[data-action="world-prev"]')).toBeNull();
    const on = need('[data-action="world-next"]');
    expect(on.dataset.to).toBe('2');
    expect(on.dataset.arena).toBe('meadow');
    expect(on.hasAttribute('data-locked')).toBe(true);
    expect(on.textContent?.trim()).toBe(''); // a picture only
    tap('[data-action="world-next"]');
    expect(sounds.at(-1)).toBe('click');
    expect(screen.value).toEqual({ name: 'map', side: 'plants', world: 2 });
    expect(need('[data-screen="map"]').dataset.arena).toBe('meadow');
    expect(need('[data-screen="map"]').hasAttribute('data-locked')).toBe(true);
    expect(all('[data-stone]')).toHaveLength(0);
    expect(q('[data-marker]')).toBeNull();
    expect(host.views.at(-1)).toMatchObject({ arena: 'meadow', locked: true, stones: [] });
    // The padlock refuses: the deny sound and a shake, and nothing opens.
    tap('[data-action="island-locked"]');
    expect(sounds.at(-1)).toBe('deny');
    expect(need('[data-action="island-locked"]').className).toContain('is-deny-a');
    tap('[data-action="island-locked"]');
    expect(need('[data-action="island-locked"]').className).toContain('is-deny-b');
    expect(screen.value).toEqual({ name: 'map', side: 'plants', world: 2 });
    expect(q('[data-screen="level-card"]')).toBeNull();
    // Arrows step on to the last island and back to the first.
    tap('[data-action="world-next"]');
    tap('[data-action="world-next"]');
    tap('[data-action="world-next"]');
    expect(need('[data-screen="map"]').dataset.arena).toBe('citadel');
    expect(q('[data-action="world-next"]')).toBeNull();
    for (let i = 0; i < 4; i++) tap('[data-action="world-prev"]');
    expect(need('[data-screen="map"]').dataset.arena).toBe('backyard');
    expect(all('[data-stone]')).toHaveLength(8);
  });

  it('the zombies\' first island is the Citadel; their arrows walk citadel → tundra → desert → meadow → backyard', async () => {
    await player();
    mount();
    act(() => go({ name: 'map', side: 'zombies' }));
    expect(need('[data-screen="map"]').dataset.arena).toBe('citadel');
    expect(all('[data-stone]').map((s) => s.dataset.stone)[0]).toBe('z1-1');
    const seen: string[] = ['citadel'];
    for (let i = 0; i < 4; i++) {
      tap('[data-action="world-next"]');
      seen.push(need('[data-screen="map"]').dataset.arena ?? '');
    }
    expect(seen).toEqual(['citadel', 'tundra', 'desert', 'meadow', 'backyard']);
  });

  it('with a world 2 to play (stand-in levels): the map opens on it, its stones are there, the arrow back is open', async () => {
    mapLevels.value = previewWorlds(LEVELS);
    await player(won('p1'));
    const host = fakeHost();
    mount(host);
    act(() => go({ name: 'map', side: 'plants' }));
    expect(need('[data-screen="map"]').dataset.world).toBe('2');
    expect(need('[data-screen="map"]').hasAttribute('data-locked')).toBe(false);
    expect(all('[data-stone]').map((s) => s.dataset.stone)).toEqual(Array.from({ length: 8 }, (_, i) => `p2-${i + 1}`));
    expect(state('p2-1')).toBe('next');
    expect(host.views.at(-1)).toMatchObject({ arena: 'meadow', locked: false });
    expect(host.views.at(-1)!.islands.map((i) => i.locked)).toEqual([false, false, true, true, true]);
    const back = need('[data-action="world-prev"]');
    expect(back.hasAttribute('data-locked')).toBe(false);
    tap('[data-action="world-prev"]');
    expect(all('[data-stone]').map((s) => s.dataset.stone)[0]).toBe('p1-1');
    expect(state('p1-8')).toBe('done');
    // A card keeps its island: open p1-2 and close it, still on world 1.
    tap('[data-stone="p1-2"]');
    expect(screen.value).toEqual({ name: 'map', side: 'plants', world: 1, card: 'p1-2' });
    tap('[data-action="close-card"]');
    expect(screen.value).toEqual({ name: 'map', side: 'plants', world: 1 });
    expect(need('[data-screen="map"]').dataset.world).toBe('1');
  });

  it('a card asked for by id opens on its own island; a closed stone\'s arrow leads to the level to play now', async () => {
    mapLevels.value = previewWorlds(LEVELS);
    await player(won('p1'));
    mount();
    act(() => go({ name: 'map', side: 'plants', card: 'p2-1' }));
    expect(need('[data-screen="map"]').dataset.world).toBe('2');
    expect(need('[data-screen="level-card"]').dataset.level).toBe('p2-1');
    act(() => go({ name: 'map', side: 'plants', world: 1 }));
    act(() => go({ name: 'map', side: 'plants', world: 2, card: 'p2-5' }));
    expect(need('[data-screen="level-card"]').hasAttribute('data-locked')).toBe(true);
    expect(need('[data-action="go-next"]').dataset.next).toBe('p2-1');
  });
});

describe('Map screen: music', () => {
  it('asks for the shown island\'s tune on opening and on each side or island change, once per change', async () => {
    await player();
    const tunes: string[] = [];
    const onMusic = (t: string): void => { tunes.push(t); };
    act(() => render(<App boys={{ lukas: '/l.png', toby: '/t.png' }} onSound={(n) => sounds.push(n)} onMusic={onMusic} />, root));
    act(() => go({ name: 'map', side: 'zombies' }));
    expect(tunes).toEqual(['citadel']);
    tap('[data-stone="z1-1"]'); // a card on the same island: the same tune, not asked again
    tap('[data-action="close-card"]');
    expect(tunes).toEqual(['citadel']);
    tap('[data-tab="plants"]');
    expect(tunes).toEqual(['citadel', 'backyard']);
    tap('[data-action="world-next"]'); // a locked island
    expect(tunes).toEqual(['citadel', 'backyard', 'menu']);
    tap('[data-action="world-prev"]');
    expect(tunes).toEqual(['citadel', 'backyard', 'menu', 'backyard']);
    act(() => go({ name: 'play' }));
    expect(tunes).toHaveLength(4);
  });
});
