// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { BattleOptions, HudSignals, OnlineSignals } from '../../src/app/BattleController';
import { board } from '../../src/app/board';
import { debugEnabled, installDebug, installVersusDebug } from '../../src/app/debug';
import type { LvtDebug } from '../../src/app/debug';
import { versusParams } from '../../src/app/pageVersus';
import { PlayerSession, session } from '../../src/app/session';
import { go, screen } from '../../src/app/store';
import { VersusFlow } from '../../src/app/versus';
import { fakeConnection } from '../../src/cloud/connection';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { StallStage } from '../../src/net/timeouts';
import { VirtualClock } from '../../src/net/virtualClock';
import { newSave } from '../../src/progress/save';
import type { Slot } from '../../src/progress/save';
import type { CardKey, Faction, UnitKey } from '../../src/sim/types';
import { App } from '../../src/ui/App';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { BattleScreen } from '../../src/ui/screens/BattleScreen';
import type { BattleSessionLike, VersusBattleProps } from '../../src/ui/screens/BattleScreen';
import { Title } from '../../src/ui/screens/Title';
import type { FaceVM } from '../../src/ui/versus/types';
import type { VersusResultVM } from '../../src/ui/versus/VersusResult';
import { T0 } from '../cloud/helpers';
import { MemoryStorage } from '../progress/memoryStorage';

/**
 * Versus on screen (Task 15): the invite panel on the menus only, accepting into the battle, the
 * waiting faces, the other boy's pause, the white flag, the result and the title's way back.
 * Tests find elements by `data-*`, never by text.
 */

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 600)}`);
  return el;
};
const tap = (sel: string): void => { act(() => { need(sel).click(); }); };

const LUKAS: FaceVM = { slot: 'p01', name: 'Lukas', picture: 'peashooter' };
const TOBY: FaceVM = { slot: 'p02', name: 'Toby', picture: 'brainEater' };

// ---- the battle screen alone, with a fake session that has the online signals ----

interface OnlineFake {
  session: BattleSessionLike & { visibility: Mock<(h: boolean) => void> };
  hud: HudSignals;
  online: OnlineSignals;
  forfeit: Mock<() => void>;
  giveUp: Mock<() => void>;
  setPaused: Mock<(p: boolean) => void>;
}

function onlineSession(faction: Faction = 'plants', withSpeed = false): OnlineFake {
  const hud: HudSignals = {
    energy: signal(150),
    cards: signal([{ unit: 'brainEater' as UnitKey, name: 'Brain Eater', price: 100, hotkey: '1', affordable: true, rechargeFraction: 0 }]),
    base: signal({ plants: { hp: 900, max: 1000, safe: false }, zombies: { hp: 1000, max: 1000, safe: false } }),
    seconds: signal(75), suddenDeath: signal(false), paused: signal(false),
    selected: signal<UnitKey | null>(null), shovel: signal(false),
    result: signal<null | { winner: Faction | 'draw'; playerWon: boolean }>(null), denied: signal(0),
    hero: signal({ ready: false, fraction: 0 }),
    heroSelected: signal(false), spells: signal<HudSignals['spells']['value']>([]),
    spellSelected: signal<HudSignals['spellSelected']['value']>(null), boss: signal<HudSignals['boss']['value']>(null),
  };
  const online: OnlineSignals = {
    stall: signal<StallStage>('none'), pausedBy: signal<Slot | null>(null), pending: signal([]),
    outcome: signal(null), repairs: signal(0),
  };
  const setPaused = vi.fn((p: boolean) => { hud.paused.value = p; });
  const forfeit = vi.fn();
  const giveUp = vi.fn();
  const visibility = vi.fn<(h: boolean) => void>();
  const s = {
    controller: {
      hud, playerFaction: faction, online, forfeit, giveUp, setPaused,
      select: vi.fn(), toggleShovel: vi.fn(),
    },
    begin: vi.fn(), dispose: vi.fn(), visibility,
    ...(withSpeed ? { speed: { fast: signal(false), shown: signal(true), toggle: vi.fn() } } : {}),
  } as OnlineFake['session'];
  return { session: s, hud, online, forfeit, giveUp, setPaused };
}

const RESULT_VM: VersusResultVM = {
  winner: LUKAS, loser: TOBY, them: 'p02',
  score: { left: LUKAS, leftWins: 1, right: TOBY, rightWins: 0 }, rematch: 'offer', rankUp: null,
};

function mountBattle(f: OnlineFake, versus?: Partial<VersusBattleProps>, onQuit = vi.fn()): { props: VersusBattleProps; onQuit: Mock<() => void> } {
  const props: VersusBattleProps = {
    me: 'p01', other: 'p02', face: (slot) => (slot === 'p01' ? LUKAS : TOBY), result: null,
    onRematch: vi.fn(), onHome: vi.fn(), ...versus,
  };
  act(() => render(
    <BattleScreen
      session={f.session} settings={DEFAULT_SETTINGS} onSettingsChange={vi.fn()} onRestart={vi.fn()} onQuit={onQuit} versus={props}
    />,
    root,
  ));
  return { props, onQuit };
}

describe('the battle screen in a two-device Versus match', () => {
  it('a stall at the face stage dims the lawn with the other boy\'s sleeping face; the hourglass stage is only the small glass', () => {
    const f = onlineSession();
    mountBattle(f);
    expect(q('[data-stall]')).toBeNull();
    act(() => { f.online.stall.value = 'hourglass'; });
    expect(need('[data-stall="hourglass"]').getAttribute('data-side')).toBe('zombies');
    expect(q('[data-stall-veil]')).toBeNull();
    act(() => { f.online.stall.value = 'face'; });
    expect(need('[data-stall-veil]').getAttribute('data-stall')).toBe('face');
    expect(need('[data-stall-veil] [data-face-of]').getAttribute('data-face-of')).toBe('p02');
    expect(q('[data-zzz]')).not.toBeNull();
    expect(q('[data-action="flag"]')).toBeNull();
    act(() => { f.online.stall.value = 'none'; });
    expect(q('[data-stall]')).toBeNull();
  });

  it('the waiting flag gives up (nobody wins) and leaves the screen alone', () => {
    const f = onlineSession();
    const { onQuit, props } = mountBattle(f);
    act(() => { f.online.stall.value = 'flag'; });
    tap('[data-action="flag"]');
    expect(f.giveUp).toHaveBeenCalledTimes(1);
    expect(f.forfeit).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
    expect(props.onHome).not.toHaveBeenCalled();
    expect(q('[data-screen="battle"]')).not.toBeNull();
  });

  it('the other boy\'s pause shows his face and Play (for either of us) instead of the pause menu', () => {
    const f = onlineSession();
    mountBattle(f);
    act(() => { f.online.pausedBy.value = 'p02'; f.hud.paused.value = true; });
    expect(q('[data-screen="pause"]')).toBeNull();
    expect(need('[data-screen="vs-paused"] [data-face-of]').getAttribute('data-face-of')).toBe('p02');
    tap('[data-screen="vs-paused"] [data-action="resume"]');
    expect(f.setPaused).toHaveBeenCalledWith(false);
  });

  it('my own pause is the pause menu, with the white flag where the door is; two taps forfeit and nothing navigates', () => {
    const f = onlineSession();
    const { onQuit, props } = mountBattle(f);
    act(() => { f.online.pausedBy.value = 'p01'; f.hud.paused.value = true; });
    expect(q('[data-screen="vs-paused"]')).toBeNull();
    expect(need('[data-screen="pause"]')).not.toBeNull();
    expect(q('[data-quit-kind="flag"]')).not.toBeNull();
    expect(q('[data-quit-to]')).toBeNull();
    expect(q('[data-action="restart"]')).toBeNull();
    tap('[data-action="quit"]');
    expect(f.forfeit).not.toHaveBeenCalled(); // the first tap only arms it
    tap('[data-action="quit"]');
    expect(f.forfeit).toHaveBeenCalledTimes(1);
    expect(onQuit).not.toHaveBeenCalled();
    expect(props.onHome).not.toHaveBeenCalled();
  });

  it('there is no 2X button', () => {
    const f = onlineSession('plants', true);
    mountBattle(f);
    expect(q('[data-hud="speed"], [data-action="speed"]')).toBeNull();
    expect(q('[data-hud="pause"]')).not.toBeNull();
  });

  it('the result is the flow\'s: nothing without it, then the Versus result with rematch and home going to the flow', () => {
    const f = onlineSession();
    const { props } = mountBattle(f);
    act(() => { f.hud.result.value = { winner: 'plants', playerWon: true }; });
    expect(q('[data-screen="result"]')).toBeNull(); // credit and the numbers are the flow's, not hud.result's
    act(() => render(
      <BattleScreen
        session={f.session} settings={DEFAULT_SETTINGS} onSettingsChange={vi.fn()} onRestart={vi.fn()} onQuit={vi.fn()}
        versus={{ ...props, result: RESULT_VM }}
      />,
      root,
    ));
    expect(need('[data-screen="result"]').hasAttribute('data-versus')).toBe(true);
    expect(q('[data-versus-result]')).not.toBeNull();
    tap('[data-versus-result] [data-action="rematch"]');
    expect(props.onRematch).toHaveBeenCalledTimes(1);
    tap('[data-versus-result] [data-action="home"]');
    expect(props.onHome).toHaveBeenCalledTimes(1);
  });

  it('a hidden tab goes to the session\'s visibility (the shared pause), never to setPaused', () => {
    const f = onlineSession();
    mountBattle(f);
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(f.session.visibility).toHaveBeenLastCalledWith(true);
    hidden = false;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(f.session.visibility).toHaveBeenLastCalledWith(false);
    expect(f.setPaused).not.toHaveBeenCalled();
    Reflect.deleteProperty(document, 'hidden');
  });

  it('outside Versus the pause menu keeps its door and has no white flag', () => {
    const hud = onlineSession().hud;
    const s: BattleSessionLike = {
      controller: { hud, playerFaction: 'plants', select: vi.fn(), toggleShovel: vi.fn(), setPaused: vi.fn((p: boolean) => { hud.paused.value = p; }) },
      begin: vi.fn(), dispose: vi.fn(),
    };
    act(() => render(<BattleScreen session={s} settings={DEFAULT_SETTINGS} onSettingsChange={vi.fn()} onRestart={vi.fn()} onQuit={vi.fn()} />, root));
    act(() => { hud.paused.value = true; });
    expect(q('[data-quit-to="home"]')).not.toBeNull();
    expect(q('[data-quit-kind="flag"]')).toBeNull();
  });
});

// ---- the title's way back ----

describe('the title', () => {
  it('shows "back to the battle" (96 px, crossed swords) only while a match can be rejoined', () => {
    const can = signal(false);
    const onRejoin = vi.fn();
    act(() => render(<Title onSettings={vi.fn()} canRejoin={can} onRejoin={onRejoin} />, root));
    expect(q('[data-action="rejoin"]')).toBeNull();
    act(() => { can.value = true; });
    const btn = need('[data-action="rejoin"]');
    expect(parseFloat(btn.style.minWidth)).toBeGreaterThanOrEqual(96);
    expect(parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(96);
    expect(btn.querySelector('svg')).not.toBeNull();
    act(() => { btn.click(); });
    expect(onRejoin).toHaveBeenCalledTimes(1);
  });

  it('is unchanged without a flow', () => {
    act(() => render(<Title onSettings={vi.fn()} />, root));
    expect(q('[data-action="rejoin"]')).toBeNull();
    expect(q('[data-action="play"]')).not.toBeNull();
  });
});

// ---- the debug hooks ----

describe('debug hooks', () => {
  afterEach(() => { Reflect.deleteProperty(window, '__lvt'); });

  it('__lvt.versus is absent without the gate, and present with it', () => {
    const flow = { phase: signal({ name: 'closed' } as const) } as unknown as VersusFlow;
    const stop = installVersusDebug(flow, () => undefined, false);
    expect('__lvt' in window).toBe(false);
    stop();
    installVersusDebug(flow, () => undefined, true);
    const v = (window as unknown as { __lvt: LvtDebug }).__lvt.versus;
    expect(v?.flow).toBe(flow);
    expect(v?.seat()).toBeNull();
    expect(v?.matchId()).toBeNull();
    expect(v?.hash()).toBe(-1);
    expect(v?.tick()).toBe(-1);
  });

  it('with the gate shut a page asking for ?debug-less hooks gets none', () => {
    expect(debugEnabled(false, '?vsquick&vstest=5')).toBe(false);
    installDebug(false);
    expect('__lvt' in window).toBe(false);
  });

  it('vsquick (÷30) and vstest=1..500 count only on the fake cloud with the gate open', () => {
    const slow = versusParams('', 'fake', true).timeouts;
    expect(versusParams('?vsquick', 'fake', true).timeouts.inviteMs).toBeCloseTo(slow.inviteMs / 30);
    expect(versusParams('?vsquick', 'fake', true).timeouts.stall.faceMs).toBeCloseTo(slow.stall.faceMs / 30);
    expect(versusParams('?vstest=7', 'fake', true).testBaseHp).toBe(7);
    expect(versusParams('?vstest=500', 'fake', true).testBaseHp).toBe(500);
    expect(versusParams('?vstest=0', 'fake', true).testBaseHp).toBeNull();
    expect(versusParams('?vstest=501', 'fake', true).testBaseHp).toBeNull();
    expect(versusParams('?vstest=abc', 'fake', true).testBaseHp).toBeNull();
    for (const [mode, debug] of [['live', true], ['test', true], ['fake', false]] as const) {
      const p = versusParams('?vsquick&vstest=7', mode, debug);
      expect(p.testBaseHp, `${mode}/${debug}`).toBeNull();
      expect(p.timeouts.inviteMs).toBe(slow.inviteMs);
    }
  });
});

// ---- the app with two real flows on one fake database ----

const PINS: Record<string, string> = { p01: '123', p02: '456' };
const PEOPLE: Record<string, { name: string; picture: CardKey }> = {
  p01: { name: 'Lukas', picture: 'peashooter' },
  p02: { name: 'Toby', picture: 'brainEater' },
};

describe('the app with Versus', () => {
  let clock: VirtualClock;
  let db: FakeDatabase;
  const flows: VersusFlow[] = [];
  const peers: PlayerSession[] = [];
  const built: BattleOptions[] = [];

  const settle = async (): Promise<void> => { for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0)); };
  async function until(done: () => boolean, maxMs = 60_000): Promise<void> {
    for (let left = maxMs; left > 0 && !done(); left -= 50) {
      await settle();
      if (done()) break;
      clock.advance(50);
    }
    await settle();
    expect(done()).toBe(true);
  }

  function fakeFactory() {
    return vi.fn((options: BattleOptions): BattleSessionLike => {
      built.push(options);
      const f = onlineSession(options.playerFaction);
      return f.session;
    });
  }

  /** Lukas's device is the app's own session; Toby's is a peer with a flow of its own. */
  async function devices(): Promise<{ lukas: VersusFlow; toby: VersusFlow }> {
    const now = (): number => T0 + clock.now();
    session.configure({ cloud: createFakeCloud(db, 'v2'), storage: new MemoryStorage(), now, window: null, document: null, mode: 'fake' });
    expect(typeof await session.login('p01', PINS.p01!)).toBe('object');
    const lukas = new VersusFlow({ conn: () => Promise.resolve(fakeConnection(db, 'v2')), session, now, timers: clock, build: '2289558', reload: vi.fn(), flag: new MemoryStorage() });
    const other = new PlayerSession();
    other.configure({ cloud: createFakeCloud(db, 'v2'), storage: new MemoryStorage(), now, window: null, document: null, mode: 'fake' });
    expect(typeof await other.login('p02', PINS.p02!)).toBe('object');
    const toby = new VersusFlow({ conn: () => Promise.resolve(fakeConnection(db, 'v2')), session: other, now, timers: clock, build: '2289558', reload: vi.fn(), flag: new MemoryStorage() });
    toby.onMenu(true);
    peers.push(other);
    flows.push(lukas, toby);
    return { lukas, toby };
  }

  beforeEach(async () => {
    clock = new VirtualClock();
    db = new FakeDatabase({ now: () => T0 + clock.now() });
    built.length = 0;
    for (const r of ['v2', 'v2test'] as const) {
      const cloud = createFakeCloud(db, r);
      for (const slot of ['p01', 'p02'] as const) {
        const p = PEOPLE[slot]!;
        expect(await cloud.createPlayer(newSave(slot, p.name, p.picture, T0), await pinHash(slot, PINS[slot]!))).toBe('ok');
      }
    }
    board.configure({ cloud: createFakeCloud(db, 'v2'), storage: new MemoryStorage() });
    clock.advance(1000);
  });

  afterEach(() => {
    act(() => render(null, root));
    for (const f of flows.splice(0)) f.dispose();
    for (const p of peers.splice(0)) p.dispose();
    session.dispose();
    go({ name: 'title' });
  });

  it('the panel shows on Home and on the map, never on the side pick, the players\' pictures or the battle; accepting puts both devices in the battle', async () => {
    const { lukas, toby } = await devices();
    const factory = fakeFactory();
    act(() => { go({ name: 'home' }); });
    act(() => render(<App createSession={factory} versus={lukas} boys={{ lukas: '/l.png', toby: '/t.png' }} />, root));
    await until(() => lukas.here.value.some((h) => h.slot === 'p02') && toby.here.value.some((h) => h.slot === 'p01' && !h.busy));
    toby.open();
    toby.pick('p01');
    toby.send();
    await until(() => lukas.incoming.value !== null);
    await until(() => q('[data-invite-panel]') !== null);
    expect(screen.value.name).toBe('home');

    act(() => { go({ name: 'map', side: 'plants' }); });
    await settle();
    expect(q('[data-invite-panel]')).not.toBeNull();
    for (const name of ['sidepick', 'players'] as const) {
      act(() => { go({ name }); });
      await settle();
      expect(q('[data-invite-panel]'), name).toBeNull();
    }
    act(() => { go({ name: 'home' }); });
    await until(() => q('[data-invite-panel]') !== null);

    tap('[data-invite-panel] [data-action="accept"]');
    await until(() => screen.value.name === 'battle' && toby.phase.value.name === 'battle');
    const here = screen.value;
    expect(here.name === 'battle' && here.options.online !== undefined).toBe(true);
    expect(built.at(-1)?.online).toBeDefined();
    expect(q('[data-invite-panel]')).toBeNull();
    await settle();
    expect(q('[data-screen="battle"]')).not.toBeNull();
    expect(q('[data-hud="speed"], [data-action="speed"]')).toBeNull();
  });

  it('the Play menu\'s Versus tile opens "who is here"; its back button returns to the Play menu', async () => {
    const { lukas } = await devices();
    act(() => { go({ name: 'play' }); });
    act(() => render(<App createSession={fakeFactory()} versus={lukas} />, root));
    await until(() => lukas.allowed.value);
    tap('[data-play="versus"]');
    await until(() => screen.value.name === 'versus');
    expect(q('[data-screen="whoishere"]')).not.toBeNull();
    tap('[data-screen="whoishere"] [data-action="back"]');
    await until(() => screen.value.name === 'play');
  });

  it('a notice shows over the screen it came on and its home goes to the list', async () => {
    const { lukas } = await devices();
    act(() => { go({ name: 'home' }); });
    act(() => render(<App createSession={fakeFactory()} versus={lukas} />, root));
    await until(() => lukas.allowed.value);
    // another game version arriving on Home: nobody plays, the notice says so
    const odd = new VersusFlow({ conn: () => Promise.resolve(fakeConnection(db, 'v2')), session: peers[0]!, now: () => T0 + clock.now(), timers: clock, build: 'abcdef0', reload: vi.fn(), flag: new MemoryStorage() });
    flows.push(odd);
    odd.onMenu(true);
    await until(() => odd.here.value.some((h) => h.slot === 'p01' && !h.busy));
    odd.open();
    odd.pick('p01');
    odd.send();
    await until(() => q('[data-invite-panel]') !== null);
    tap('[data-invite-panel] [data-action="accept"]');
    await until(() => q('[data-screen="vs-notice"]') !== null);
    expect(need('[data-screen="vs-notice"]').getAttribute('data-notice')).toBe('update');
    expect(screen.value.name).toBe('home');
    tap('[data-screen="vs-notice"] [data-action="home"]');
    await until(() => screen.value.name === 'versus');
  });

  it('without a flow there is no panel, no Versus and nothing on the title', () => {
    act(() => { go({ name: 'play' }); });
    act(() => render(<App createSession={fakeFactory()} />, root));
    expect(need('[data-play="versus"]').hasAttribute('data-locked')).toBe(true);
  });
});
