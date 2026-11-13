// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleOptions, HudSignals } from '../../src/app/BattleController';
import { session } from '../../src/app/session';
import { go, screen } from '../../src/app/store';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { loadLocal } from '../../src/progress/localStore';
import type { Faction, UnitKey } from '../../src/sim/types';
import { App } from '../../src/ui/App';
import type { BattleSessionLike, SessionFactory } from '../../src/ui/screens/BattleScreen';
import { MemoryStorage } from '../progress/memoryStorage';

let root: HTMLElement;
let db: FakeDatabase;
let storage: MemoryStorage;
let clock: { t: number };
let sounds: string[];

function configure(store: Storage = storage): void {
  session.configure({ cloud: createFakeCloud(db), storage: store, now: () => clock.t, window: null, document: null });
}

beforeEach(() => {
  clock = { t: 1_762_900_000_000 };
  db = new FakeDatabase({ now: () => clock.t });
  storage = new MemoryStorage();
  sounds = [];
  configure();
  go({ name: 'title' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 704 });
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  session.dispose();
  vi.useRealTimers();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 600)}`);
  return el;
};
const tap = (sel: string): void => { act(() => { need(sel).click(); }); };
/** Waits (cloud calls and hashing are asynchronous) until `sel` is on screen. */
async function see(sel: string): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    el = need(sel);
  }, { timeout: 3000, interval: 5 });
  return el as unknown as HTMLElement;
}
async function typePin(pin: string): Promise<void> {
  for (const d of pin) tap(`[data-key="${d}"]`);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function mount(props: Partial<Parameters<typeof App>[0]> = {}): void {
  act(() => render(<App onSound={(n) => sounds.push(n)} {...props} />, root));
}

/** Title → Players → Lukas → choose 123 twice → Home. */
async function makeLukas(): Promise<void> {
  mount();
  tap('[data-action="play"]');
  tap(await see('[data-player="p01"]') && '[data-player="p01"]');
  await see('[data-screen="create"] [data-pin-step="1"]');
  await typePin('123');
  await see('[data-pin-step="2"]');
  await typePin('123');
  await see('[data-screen="home"]');
}

describe('Players', () => {
  it('shows Lukas and Toby from the first start, a "+" tile, a small lock, and no letters for missing pictures', async () => {
    mount();
    tap('[data-action="play"]');
    await see('[data-player="p02"]');
    const tiles = [...root.querySelectorAll('[data-player]')].map((el) => el.getAttribute('data-player'));
    expect(tiles).toEqual(['p01', 'p02']);
    expect(q('[data-action="new-player"]')).not.toBeNull();
    expect(q('[data-action="grownup"]')).not.toBeNull();
    // No portraits drawn yet: the boxy silhouette, never an initial.
    expect(need('[data-player="p01"] .pic svg')).not.toBeNull();
    expect(need('[data-player="p01"] .pic').textContent).toBe('');
    expect(need('[data-player="p01"]').textContent).toContain('Lukas');
  });

  it('every tile has its own frame colour by place, the same on the number pad', async () => {
    await session.create('Mia', 'brainEater', '111');
    session.logout();
    mount();
    tap('[data-action="play"]');
    await see('[data-player="p03"]');
    const toby = need('[data-player="p02"] [data-frame]').getAttribute('data-frame');
    const mia = need('[data-player="p03"] [data-frame]').getAttribute('data-frame');
    expect(toby).not.toBe(mia); // the same picture, told apart by the frame
    tap('[data-player="p03"]');
    await see('[data-screen="pinpad"]');
    expect(need('.pad-head [data-frame]').getAttribute('data-frame')).toBe(mia);
  });

  it('back while the number is being checked stays on the pictures (never lands on Home)', async () => {
    await makeLukas();
    tap('[data-action="logout"]');
    tap(await see('[data-player="p01"]') && '[data-player="p01"]');
    await see('[data-screen="pinpad"]');
    for (const d of '123') tap(`[data-key="${d}"]`);
    tap('[data-action="back"]');
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await see('[data-screen="players"]');
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.value.name).toBe('players');
    expect(session.player.value).toBeNull();
  });

  it('a refusal that is not a wrong number shows the retry cross, never the wrong-number shake', async () => {
    await session.create('Mia', 'sunflower', '111');
    session.logout();
    const real = createFakeCloud(db);
    const refusing = new Proxy(real, {
      get: (t, k) => (k === 'loadRecord' || k === 'loadSave' ? async () => 'refused' : (t as unknown as Record<PropertyKey, unknown>)[k]),
    });
    session.configure({ cloud: refusing, storage: new MemoryStorage(), now: () => clock.t, window: null, document: null });
    mount();
    act(() => go({ name: 'players', login: 'p03' }));
    await see('[data-screen="pinpad"]');
    await typePin('111');
    await see('[data-pin-failed]');
    expect(q('[data-pin-boxes].is-wrong')).toBeNull();
  });

  it('uses the unit portraits once they are drawn', async () => {
    mount({ portraits: { peashooter: 'data:image/png;base64,AAAA' } });
    tap('[data-action="play"]');
    await see('[data-player="p01"] img');
    expect(need('[data-player="p01"] img').getAttribute('src')).toContain('data:image/png');
  });

  it("Lukas's first tap chooses his number twice and makes him; he lands on Home", async () => {
    await makeLukas();
    expect(session.player.value).toMatchObject({ slot: 'p01', name: 'Lukas', picture: 'peashooter' });
    expect(need('[data-coins]').getAttribute('data-coins')).toBe('0');
    expect(sounds.filter((s) => s === 'click').length).toBeGreaterThanOrEqual(6);
  });

  it('a different repeat shakes and goes back to choosing', async () => {
    mount();
    tap('[data-action="play"]');
    await see('[data-player="p02"]');
    tap('[data-player="p02"]');
    await see('[data-pin-step="1"]');
    await typePin('123');
    await see('[data-pin-step="2"]');
    await typePin('124');
    expect(need('[data-pin-boxes]').classList.contains('is-wrong')).toBe(true);
    await see('[data-pin-step="1"]');
    expect(session.player.value).toBeNull();
    await typePin('555');
    await see('[data-pin-step="2"]');
    await typePin('555');
    await see('[data-screen="home"]');
    expect(session.player.value?.difficulty).toEqual({ plants: 'easy', zombies: 'easy' });
  });

  it('a new player: picture, name on the boxy keyboard, number twice; the lowest free place', async () => {
    mount();
    tap('[data-action="play"]');
    tap(await see('[data-action="new-player"]') && '[data-action="new-player"]');
    tap(await see('[data-pick="hotTopic"]') && '[data-pick="hotTopic"]');
    await see('[data-step="name"]');
    expect(need('[data-action="name-ok"]').getAttribute('aria-disabled')).toBe('true');
    for (const ch of 'MIA') tap(`[data-letter="${ch}"]`);
    expect(need('[data-name-field]').textContent).toBe('Mia');
    tap('[data-key="del"]');
    tap('[data-letter="X"]');
    expect(need('[data-name-field]').textContent).toBe('Mix');
    tap('[data-action="name-ok"]');
    await see('[data-pin-step="1"]');
    await typePin('321');
    await see('[data-pin-step="2"]');
    await typePin('321');
    await see('[data-screen="home"]');
    expect(session.player.value).toMatchObject({ slot: 'p03', name: 'Mix', picture: 'hotTopic' });
  });

  it('the device keyboard types the name too', async () => {
    mount();
    act(() => go({ name: 'create' }));
    tap(await see('[data-pick="sunflower"]') && '[data-pick="sunflower"]');
    await see('[data-step="name"]');
    for (const k of ['b', 'e', 'n', 'Enter']) act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); });
    await see('[data-pin-step="1"]');
  });

  it('log out by the door; the last player is first and pulsing; log in by picture and number', async () => {
    await makeLukas();
    tap('[data-action="logout"]');
    await see('[data-player="p01"].is-last');
    expect(session.player.value).toBeNull();
    tap('[data-player="p01"]');
    await see('[data-screen="pinpad"]');
    await typePin('123');
    await see('[data-screen="home"]');
    expect(session.player.value?.slot).toBe('p01');
  });

  it('three wrong numbers lock the picture with an hourglass; back works; the grid shows it locked', async () => {
    await makeLukas();
    tap('[data-action="logout"]');
    tap(await see('[data-player="p01"]') && '[data-player="p01"]');
    await see('[data-screen="pinpad"]');
    for (const pin of ['000', '001', '002']) {
      await typePin(pin);
      await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    }
    expect((await see('[data-lock]')).textContent).toContain('30');
    expect(sounds).toContain('deny');
    tap('[data-action="back"]');
    await see('[data-player="p01"] [data-locked]');
    clock.t += 30_000;
    tap('[data-player="p01"]');
    await see('[data-screen="pinpad"]');
    expect(q('[data-lock]')).toBeNull();
    await typePin('123');
    await see('[data-screen="home"]');
  });

  it('offline: the players this device knows, a no-connection cloud; making a player says so and retries', async () => {
    await makeLukas();
    tap('[data-action="logout"]');
    await see('[data-player="p01"]');
    db.offline = true;
    act(() => go({ name: 'title' }));
    tap('[data-action="play"]');
    await see('[data-offline]');
    tap('[data-action="new-player"]');
    await see('[data-step="offline"]');
    db.offline = false;
    tap('[data-action="retry"]');
    await see('[data-step="picture"]');
  });

  it('offline log-in with the right number plays from the device copy', async () => {
    await makeLukas();
    tap('[data-action="logout"]');
    db.offline = true;
    tap(await see('[data-player="p01"]') && '[data-player="p01"]');
    await see('[data-screen="pinpad"]');
    await typePin('123');
    await see('[data-screen="home"]');
    expect(need('[data-sync]').getAttribute('data-sync')).toBe('offline');
  });

  it('Home: Play goes to the side pick preset from the save; a changed difficulty is saved; back to Home', async () => {
    await makeLukas();
    tap('[data-home="play"]');
    await see('[data-screen="sidepick"]');
    expect(need('[data-side="plants"]').getAttribute('aria-pressed')).toBe('true');
    expect(need('[data-skill="medium"]').getAttribute('aria-pressed')).toBe('true');
    tap('[data-skill="hard"]');
    expect(session.player.value?.difficulty.plants).toBe('hard');
    expect(loadLocal('p01', storage)?.difficulty.plants).toBe('hard');
    tap('[data-action="back"]');
    await see('[data-screen="home"]');
    tap('[data-home="play"]');
    await see('[data-skill="hard"][aria-pressed="true"]');
  });

  it('Home buttons reach Marketplace, Almanac and Leaderboard, each with a way back', async () => {
    await makeLukas();
    for (const place of ['marketplace', 'almanac', 'leaderboard']) {
      tap(`[data-home="${place}"]`);
      await see(`[data-screen="${place}"]`);
      tap('[data-action="back"]');
      await see('[data-screen="home"]');
    }
  });
});

describe('grown-up gate', () => {
  async function openGate(): Promise<void> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => { need('[data-action="grownup"]').dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, pointerType: 'touch', bubbles: true })); });
    act(() => { vi.advanceTimersByTime(1999); });
    expect(screen.value.name).toBe('players');
    act(() => { vi.advanceTimersByTime(1); });
    vi.useRealTimers();
    await see('[data-screen="grownup"]');
  }

  it('a short tap on the lock does nothing; held two seconds it opens', async () => {
    mount();
    tap('[data-action="play"]');
    await see('[data-action="grownup"]');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const lock = need('[data-action="grownup"]');
    act(() => { lock.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, pointerType: 'touch', bubbles: true })); });
    act(() => { vi.advanceTimersByTime(800); });
    act(() => { lock.dispatchEvent(new PointerEvent('pointerup', { isPrimary: true, pointerType: 'touch', bubbles: true })); });
    act(() => { vi.advanceTimersByTime(3000); });
    vi.useRealTimers();
    expect(screen.value.name).toBe('players');
    await openGate();
  });

  it('first use sets the code (twice); then a player can get a new number or be deleted', async () => {
    await makeLukas();
    tap('[data-action="logout"]');
    await see('[data-player="p01"]');
    await openGate();
    expect(root.querySelectorAll('[data-pin-box]')).toHaveLength(6);
    await typePin('246802');
    await see('[data-pin-step="2"]');
    await typePin('246802');
    await see('[data-row="p01"]');
    // A new number for Lukas.
    tap('[data-row="p01"] [data-action="new-number"]');
    await see('[data-pin-step="1"]');
    await typePin('777');
    await see('[data-pin-step="2"]');
    await typePin('777');
    await see('[data-note]');
    expect(await session.login('p01', '777')).toMatchObject({ name: 'Lukas' });
    session.logout();
    // Delete him: the code again confirms.
    tap('[data-row="p01"] [data-action="delete"]');
    await see('[data-screen="grownup"] [data-pin-boxes]');
    await typePin('111111');
    await see('[data-pin-boxes].is-wrong');
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    await typePin('246802');
    await see('[data-note]');
    expect(q('[data-row="p01"]')).toBeNull();
    expect(db.peek('v2/players/p01')).toBeNull();
  });

  it('on a device that never saw the code, a mistype just shakes (never "set a new code"); five lock the gate', async () => {
    await session.setGrownUp('246802');
    storage.removeItem('lvt2_grownup_known');
    mount();
    tap('[data-action="play"]');
    await see('[data-action="grownup"]');
    await openGate();
    for (let i = 0; i < 4; i++) {
      clock.t += 1;
      await typePin('999999');
      await see('[data-pin-boxes].is-wrong');
      expect(q('[data-pin-done]')).toBeNull();
      await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    }
    clock.t += 1;
    await typePin('999999');
    await see('[data-lock]');
  });

  it('a wrong code once one is known on this device just shakes', async () => {
    await session.setGrownUp('246802');
    mount();
    tap('[data-action="play"]');
    await see('[data-action="grownup"]');
    await openGate();
    await typePin('999999');
    await see('[data-pin-boxes].is-wrong');
    expect(q('[data-pin-step]')).toBeNull();
  });
});

describe('after a battle', () => {
  function fakeFactory(): { factory: SessionFactory; hud: () => HudSignals } {
    let last: HudSignals | null = null;
    const factory: SessionFactory = (opts: BattleOptions): BattleSessionLike => {
      const hud: HudSignals = {
        energy: signal(150), cards: signal([]),
        base: signal({ plants: { hp: 900, max: 1000 }, zombies: { hp: 0, max: 1000 } }),
        seconds: signal(75), suddenDeath: signal(false), paused: signal(false),
        selected: signal<UnitKey | null>(null), shovel: signal(false),
        result: signal<null | { winner: Faction | 'draw'; playerWon: boolean }>(null), denied: signal(0),
        hero: signal({ ready: false, fraction: 0 }), heroSelected: signal(false),
        spells: signal<HudSignals['spells']['value']>([]), spellSelected: signal<HudSignals['spellSelected']['value']>(null),
      };
      last = hud;
      return {
        controller: { hud, playerFaction: opts.playerFaction, select: () => {}, toggleShovel: () => {}, setPaused: (p) => { hud.paused.value = p; } },
        begin: () => {}, dispose: () => {}, skipIntro: true,
      };
    };
    return { factory, hud: () => last as unknown as HudSignals };
  }

  it('a win pays coins through the save, they fall on the result, and Menu goes Home with them', async () => {
    const { factory, hud } = fakeFactory();
    mount({ createSession: factory });
    tap('[data-action="play"]');
    tap(await see('[data-player="p01"]') && '[data-player="p01"]');
    await see('[data-pin-step="1"]');
    await typePin('123');
    await see('[data-pin-step="2"]');
    await typePin('123');
    await see('[data-screen="home"]');
    tap('[data-home="play"]');
    tap('[data-action="start"]');
    await see('[data-screen="battle"]');
    act(() => { hud().result.value = { winner: 'plants', playerWon: true }; });
    // Medium, base at 90%: 40 × 1.5 = 60.
    expect(session.player.value?.coins).toBe(60);
    expect(session.player.value?.computerWins).toBe(1);
    expect(need('[data-coins-earned]').getAttribute('data-coins-earned')).toBe('60');
    expect(root.querySelectorAll('.coin-rain__block').length).toBe(12);
    tap('[data-action="menu"]');
    await see('[data-screen="home"]');
    expect(need('[data-coins]').getAttribute('data-coins')).toBe('60');
  });

  it('the battle is started with the logged-in player\'s upgrades (the controller keeps their own side)', async () => {
    const { factory } = fakeFactory();
    const seen: BattleOptions[] = [];
    mount({ createSession: (o) => { seen.push(o); return factory(o); } });
    tap('[data-action="play"]');
    tap(await see('[data-player="p01"]') && '[data-player="p01"]');
    await see('[data-pin-step="1"]');
    await typePin('123');
    await see('[data-pin-step="2"]');
    await typePin('123');
    await see('[data-screen="home"]');
    act(() => session.update((save) => ({ ...save, upgrades: { peashooter: 4, brainEater: 2 } })));
    tap('[data-home="play"]');
    tap('[data-action="start"]');
    await see('[data-screen="battle"]');
    expect(seen.at(-1)).toMatchObject({ playerFaction: 'plants', upgrades: { peashooter: 4, brainEater: 2 } });
    expect(seen.at(-1)?.versus).toBeUndefined();
  });

  it('without a player (a battle opened directly) nothing is paid and no coins show', () => {
    const { factory, hud } = fakeFactory();
    mount({ createSession: factory });
    act(() => go({ name: 'battle', options: { playerFaction: 'plants', skill: 'medium', seed: 1 } }));
    act(() => { hud().result.value = { winner: 'plants', playerWon: true }; });
    expect(q('[data-coins-earned]')).toBeNull();
    tap('[data-action="menu"]');
    expect(screen.value.name).toBe('title');
  });
});
