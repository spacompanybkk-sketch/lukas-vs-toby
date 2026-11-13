// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleOptions, HudSignals } from '../../src/app/BattleController';
import { BOARD_KEY, board } from '../../src/app/board';
import { session } from '../../src/app/session';
import { go, screen } from '../../src/app/store';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { BoardRow, Cloud } from '../../src/cloud/types';
import type { Slot } from '../../src/progress/save';
import type { CardKey, Faction, UnitKey } from '../../src/sim/types';
import { App } from '../../src/ui/App';
import { ResultOverlay } from '../../src/ui/hud/ResultOverlay';
import type { BattleSessionLike, SessionFactory } from '../../src/ui/screens/BattleScreen';
import { Home } from '../../src/ui/screens/Home';
import { MemoryStorage } from '../progress/memoryStorage';

let root: HTMLElement;
let db: FakeDatabase;
let cloud: Cloud;
let storage: MemoryStorage;
let clock: { t: number };

beforeEach(() => {
  clock = { t: 1_762_900_000_000 };
  db = new FakeDatabase({ now: () => clock.t });
  cloud = createFakeCloud(db);
  storage = new MemoryStorage();
  session.configure({ cloud, storage, now: () => clock.t, window: null, document: null });
  board.configure({ cloud, storage });
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
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const all = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 800)}`);
  return el;
};
const tap = (sel: string): void => { act(() => { need(sel).click(); }); };
async function see(sel: string): Promise<HTMLElement> {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    need(sel);
  }, { timeout: 3000, interval: 5 });
  return need(sel);
}
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** A row put straight into the fake database, as another device's player would have. */
function seed(slot: Slot, picture: CardKey, o: Partial<BoardRow>): void {
  db.poke(`v2/board/${slot}`, {
    slot, name: `N${slot}`, picture, stars: 0, wave: 0, versusWins: 0, computerWins: 0, updatedAt: 100, ...o,
  } as never);
}

async function loginAs(slot: Slot, name: string, picture: CardKey, wins = 0): Promise<void> {
  const r = await session.create(name, picture, '123', slot);
  if (typeof r !== 'object') throw new Error(String(r));
  if (wins > 0) {
    session.update((s) => ({ ...s, computerWins: wins }));
    await session.flush();
  }
}

const mount = (props: Partial<Parameters<typeof App>[0]> = {}): void => {
  act(() => render(<App {...props} />, root));
};
const order = (): string[] => all('[data-row]').map((el) => el.dataset.row ?? '');
const places = (): string[] => all('[data-row]').map((el) => el.dataset.place ?? '');

describe('leaderboard', () => {
  it('opens on the first table anyone is on, highest first, ties sharing a place by who got there first', async () => {
    await loginAs('p01', 'Lukas', 'peashooter', 3);
    seed('p03', 'hotTopic', { computerWins: 5, updatedAt: 200 });
    seed('p04', 'torchwood', { computerWins: 3, updatedAt: 50 });
    seed('p05', 'sunflower', { computerWins: 0 });
    act(() => go({ name: 'leaderboard' }));
    mount();
    await see('[data-row="p03"]');
    expect(need('[data-screen="leaderboard"]').dataset.table).toBe('computer');
    // p04 reached 3 before Lukas did: same place, p04 first. p05 has no wins: not on the table.
    expect(order()).toEqual(['p03', 'p04', 'p01']);
    expect(places()).toEqual(['1', '2', '2']);
    expect(need('[data-row="p03"] [data-rank]').className).toContain('rank--gold');
    expect(need('[data-row="p04"] [data-rank]').className).toContain('rank--iron');
    expect(need('[data-row="p01"] [data-score]').dataset.score).toBe('3');
  });

  it("highlights the logged-in player's row and scrolls it into view", async () => {
    const scrolled: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.dataset.row ?? '');
    });
    await loginAs('p02', 'Toby', 'brainEater', 1);
    for (let i = 3; i <= 12; i++) seed(`p${String(i).padStart(2, '0')}`, 'sunflower', { computerWins: 20 - i });
    act(() => go({ name: 'leaderboard' }));
    mount();
    await see('[data-row="p02"]');
    await settle();
    expect(all('[data-me]').map((el) => el.dataset.row)).toEqual(['p02']);
    expect(need('[data-row="p02"]').className).toContain('is-me');
    expect(scrolled).toContain('p02');
    expect(order().at(-1)).toBe('p02');
    spy.mockRestore();
  });

  it("opens on the first table the player is on, even when another table comes first", async () => {
    await loginAs('p01', 'Lukas', 'peashooter', 2);
    seed('p03', 'hotTopic', { versusWins: 4 });
    act(() => go({ name: 'leaderboard' }));
    mount();
    await see('[data-row="p01"]');
    expect(need('[data-screen="leaderboard"]').dataset.table).toBe('computer');
  });

  it('picture tabs switch tables; an empty table is an empty podium', async () => {
    await loginAs('p01', 'Lukas', 'peashooter', 2);
    seed('p03', 'hotTopic', { versusWins: 4 });
    act(() => go({ name: 'leaderboard' }));
    mount();
    await see('[data-row]');
    expect(all('[data-tab]').map((el) => el.dataset.tab)).toEqual(['stars', 'wave', 'versus', 'computer']);
    tap('[data-tab="stars"]');
    expect(q('[data-empty]')).not.toBeNull();
    expect(q('[data-row]')).toBeNull();
    expect(need('[data-tab="stars"]').getAttribute('aria-selected')).toBe('true');
    tap('[data-tab="versus"]');
    expect(order()).toEqual(['p03']);
    tap('[data-tab="computer"]');
    expect(order()).toEqual(['p01']);
  });

  it('offline: the board last fetched on this device, with the no-connection picture', async () => {
    await loginAs('p01', 'Lukas', 'peashooter', 2);
    seed('p03', 'hotTopic', { computerWins: 7 });
    act(() => go({ name: 'leaderboard' }));
    mount();
    await see('[data-row="p03"]');
    expect(q('[data-offline]')).toBeNull();
    expect(storage.getItem(BOARD_KEY)).not.toBeNull();
    act(() => render(null, root));

    db.offline = true;
    act(() => go({ name: 'leaderboard' }));
    mount();
    await see('[data-offline]');
    expect(order()).toEqual(['p03', 'p01']);
  });

  it('offline with nothing kept: the podium and the no-connection picture', async () => {
    db.offline = true;
    act(() => go({ name: 'leaderboard' }));
    mount();
    await see('[data-offline]');
    expect(q('[data-empty]')).not.toBeNull();
  });

  it('back goes Home for a player, to the title without one', async () => {
    act(() => go({ name: 'leaderboard' }));
    mount();
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('title');
    await loginAs('p01', 'Lukas', 'peashooter');
    act(() => go({ name: 'leaderboard' }));
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('home');
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
  const battle = (): void => void act(() => go({ name: 'battle', options: { playerFaction: 'plants', skill: 'medium', seed: 1 } }));

  it('a win that catches up with another player shows the up arrow with the new place', async () => {
    // Lukas 2nd with 2 wins; the win makes 3, level with p03: a shared first place.
    await loginAs('p01', 'Lukas', 'peashooter', 2);
    seed('p03', 'hotTopic', { computerWins: 3, updatedAt: 1 });
    const { factory, hud } = fakeFactory();
    mount({ createSession: factory });
    battle();
    act(() => { hud().result.value = { winner: 'plants', playerWon: true }; });
    const up = await see('[data-rank-up]');
    expect(up.dataset.rankUp).toBe('1');
    expect(up.dataset.table).toBe('computer');
    expect(need('[data-rank-up] [data-rank]').className).toContain('rank--gold');
  });

  it('no move (already first, or a loss), no arrow', async () => {
    await loginAs('p01', 'Lukas', 'peashooter', 5);
    seed('p03', 'hotTopic', { computerWins: 2 });
    const { factory, hud } = fakeFactory();
    mount({ createSession: factory });
    battle();
    act(() => { hud().result.value = { winner: 'plants', playerWon: true }; });
    await see('[data-coins-earned]');
    await settle();
    expect(q('[data-rank-up]')).toBeNull();
  });

  it('alone on the board: no arrow', async () => {
    await loginAs('p01', 'Lukas', 'peashooter');
    const { factory, hud } = fakeFactory();
    mount({ createSession: factory });
    battle();
    act(() => { hud().result.value = { winner: 'plants', playerWon: true }; });
    await see('[data-coins-earned]');
    await settle();
    expect(q('[data-rank-up]')).toBeNull();
  });

  it('the result panel shows the badge by the coins, or alone', () => {
    act(() => render(
      <ResultOverlay result={{ winner: 'plants', playerWon: true }} playerFaction="plants" seconds={60}
        onPlayAgain={() => {}} onMenu={() => {}} coins={40} rankUp={{ table: 'versus', rank: 3 }} />, root,
    ));
    expect(need('.coin-rain [data-rank-up]').dataset.table).toBe('versus');
    expect(need('[data-rank-up] [data-rank]').className).toContain('rank--bronze');
    act(() => render(
      <ResultOverlay result={{ winner: 'plants', playerWon: true }} playerFaction="plants" seconds={60}
        onPlayAgain={() => {}} onMenu={() => {}} coins={null} rankUp={{ table: 'stars', rank: 5 }} />, root,
    ));
    expect(need('[data-rank-up] [data-rank]').className).toContain('rank--wood');
  });
});

describe('Home', () => {
  it('logged out, it sends the visitor to the pictures from an effect, not during render', async () => {
    act(() => go({ name: 'home' }));
    act(() => render(<Home />, root));
    await settle();
    expect(screen.value.name).toBe('players');
    expect(root.innerHTML).toBe('');
  });
});
