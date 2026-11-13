// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import { ADVENTURE } from '../../src/adventure/rewards';
import { BattleController } from '../../src/app/BattleController';
import type { BeltCardVM } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import type { LevelOutcome } from '../../src/app/levelSession';
import { newSave } from '../../src/progress/save';
import { Belt } from '../../src/ui/hud/Belt';
import { CLOCK_STEPS, ClockGoal, clockLeft } from '../../src/ui/hud/ClockGoal';
import { PauseMenu } from '../../src/ui/hud/PauseMenu';
import { ResultOverlay, STAR_FIRST_MS, STAR_PITCH, STAR_STAGGER_MS } from '../../src/ui/hud/ResultOverlay';
import { WaveBar, waveProgress } from '../../src/ui/hud/WaveBar';
import { BattleScreen } from '../../src/ui/screens/BattleScreen';
import type { BattleSessionLike } from '../../src/ui/screens/BattleScreen';
import { setUiSound } from '../../src/ui/uiSound';

let root: HTMLElement;
let sounds: string[];

beforeEach(() => {
  vi.useFakeTimers();
  sounds = [];
  setUiSound((n, o) => sounds.push(o?.pitch === undefined ? n : `${n}@${o.pitch}`));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 650 });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  setUiSound(null);
  vi.useRealTimers();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const all = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 800)}`);
  return el;
};
const show = (el: preact.ComponentChild): void => { act(() => render(el, root)); };
/** Lets `ms` pass in small steps, so each step's effects can start the next timers. */
const wait = (ms: number): void => { for (let t = 0; t < ms; t += 100) act(() => { vi.advanceTimersByTime(100); }); };

describe('ClockGoal', () => {
  it('drains in steps from full to empty, rounding up', () => {
    expect(clockLeft(0, 90)).toBe(1);
    expect(clockLeft(90, 90)).toBe(0);
    expect(clockLeft(1, 90)).toBe(1); // 89/90 rounds up to the full step
    expect(clockLeft(45, 90)).toBe(0.5);
    expect(clockLeft(45, 90) * CLOCK_STEPS % 1).toBe(0);
  });

  it('Survive: the clock picture and the bar, no star marks; red in the last quarter', () => {
    show(<ClockGoal seconds={30} goal={90} stars={false} />);
    expect(need('[data-hud="clock-goal"]').dataset.left).toBe('60');
    expect(need('.lvl-clock__fill').style.width).toBe(`${clockLeft(30, 90) * 100}%`);
    expect(all('[data-mark]')).toHaveLength(0);
    expect(need('[data-hud="clock-goal"]').classList.contains('is-low')).toBe(false);
    show(<ClockGoal seconds={80} goal={90} stars={false} />);
    expect(need('[data-hud="clock-goal"]').classList.contains('is-low')).toBe(true);
  });

  it('Breakthrough: the two star marks, each kept until the clock drains past it', () => {
    show(<ClockGoal seconds={30} goal={120} stars />);
    expect(all('[data-mark]').map((m) => `${m.dataset.mark} ${m.style.left} ${m.dataset.kept !== undefined}`))
      .toEqual([`2 ${ADVENTURE.clockStars.two * 100}% true`, `3 ${ADVENTURE.clockStars.three * 100}% true`]);
    show(<ClockGoal seconds={70} goal={120} stars />);
    expect(all('[data-mark]').map((m) => m.dataset.kept !== undefined)).toEqual([true, false]);
    show(<ClockGoal seconds={100} goal={120} stars />);
    expect(all('[data-mark]').map((m) => m.dataset.kept !== undefined)).toEqual([false, false]);
  });
});

describe('WaveBar', () => {
  it('the head marches along the script; a flag for each big wave drops once it has come', () => {
    show(<WaveBar seconds={0} last={112} flags={[60, 110]} enemy="zombies" />);
    expect(need('[data-head]').dataset.head).toBe('zombies');
    expect(need('[data-head]').style.left).toBe('0%');
    expect(all('[data-flag]').map((f) => f.dataset.passed !== undefined)).toEqual([false, false]);
    show(<WaveBar seconds={70} last={112} flags={[60, 110]} enemy="zombies" />);
    expect(need('[data-head]').style.left).toBe(`${waveProgress(70, 112) * 100}%`);
    expect(all('[data-flag]').map((f) => f.dataset.passed !== undefined)).toEqual([true, false]);
    show(<WaveBar seconds={200} last={112} flags={[60, 110]} enemy="plants" />);
    expect(need('[data-head]').style.left).toBe('100%');
    expect(need('[data-head]').dataset.head).toBe('plants');
  });
});

describe('Belt', () => {
  const cards: BeltCardVM[] = [{ card: 'peashooter', id: 4 }, { card: 'walnutBomb', id: 5 }];
  it('shows the waiting cards in order, picture only (no price), each with its slot; the belt fits its slots', () => {
    show(<Belt cards={cards} slots={5} selected={null} portraits={{}} side="plants" denied={0} onSelect={() => {}} />);
    expect(all('[data-belt]').map((c) => `${c.dataset.card} ${c.dataset.slot} ${c.dataset.belt}`)).toEqual(['peashooter 0 4', 'walnutBomb 1 5']);
    expect(q('.card__price')).toBeNull();
    expect(need('[data-hud="belt"]').style.getPropertyValue('--slots')).toBe('5');
  });

  it('pointer down picks a card (a drag can start from it); a tap on the picked card puts it down', () => {
    const picks: (number | null)[] = [];
    const view = (selected: number | null) => <Belt cards={cards} slots={5} selected={selected} portraits={{}} side="plants" denied={0} onSelect={(s) => picks.push(s)} />;
    show(view(null));
    const second = need('[data-slot="1"]');
    act(() => { second.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, bubbles: true })); });
    act(() => { second.click(); });
    expect(picks).toEqual([1]);
    show(view(1));
    act(() => { need('[data-slot="1"]').click(); });
    expect(picks).toEqual([1, null]);
    expect(need('[data-slot="1"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('the plants\' belt has the shovel', () => {
    const shovel = vi.fn();
    show(<Belt cards={[]} slots={5} selected={null} portraits={{}} side="plants" denied={0} onSelect={() => {}} onShovel={shovel} />);
    act(() => { need('[data-shovel]').click(); });
    expect(shovel).toHaveBeenCalled();
  });
});

function levelSession(id: string): { s: BattleSessionLike; c: BattleController } {
  const def = levelById(id)!;
  const save = newSave(def.side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
  const c = new BattleController(levelOptions(prepareLevel(def, save, 3)));
  return { c, s: { controller: c, begin() {}, dispose() {}, skipIntro: true } };
}

function screen(s: BattleSessionLike, extra: Partial<Parameters<typeof BattleScreen>[0]> = {}): void {
  show(
    <BattleScreen
      session={s} settings={{ music: 1, sfx: 1, muted: false, quality: 'high' } as never} onSettingsChange={() => {}}
      onRestart={() => {}} onQuit={() => {}} {...extra}
    />,
  );
}

describe('the battle screen in a level', () => {
  it('Survive: the clock goal and the wave bar under the clock; the tray as usual', () => {
    const { s } = levelSession('p1-6');
    screen(s);
    expect(need('[data-hud="level"]').dataset.mode).toBe('survive');
    expect(need('[data-hud="clock-goal"]').dataset.left).toBe('150');
    expect(all('[data-flag]').map((f) => f.dataset.flag)).toEqual(['120']);
    expect(q('[data-hud="tray"]')).not.toBeNull();
    expect(q('[data-hud="belt"]')).toBeNull();
    expect(q('[data-hud="energy"]')).not.toBeNull();
  });

  it('Breakthrough: the clock with its two star marks; no wave bar without a script', () => {
    const { s } = levelSession('z1-3');
    screen(s);
    expect(all('[data-mark]')).toHaveLength(2);
    expect(q('[data-hud="wave-bar"]')).toBeNull();
  });

  it('Conveyor: the belt replaces the tray; a card that arrives slides in, a tap picks it', () => {
    const { s, c } = levelSession('p1-5');
    screen(s);
    expect(q('[data-hud="tray"]')).toBeNull();
    expect(need('[data-hud="belt"]')).toBeDefined();
    expect(q('[data-hud="energy"]')).toBeNull(); // no energy in a conveyor level
    expect(all('[data-belt]')).toHaveLength(0);
    act(() => { c.step(); });
    expect(all('[data-belt]')).toHaveLength(1);
    act(() => { need('[data-slot="0"]').click(); });
    expect(c.levelHud.beltSlot.peek()).toBe(0);
  });

  it('a battle level has neither (and a Quick Battle shows nothing new)', () => {
    // p1-2: a battle with nothing scripted (p1-1's scripted Brain Eaters get the wave bar).
    const { s } = levelSession('p1-2');
    screen(s);
    expect(q('[data-hud="level"]')).toBeNull();
    const quick = new BattleController({ playerFaction: 'plants', skill: 'easy', seed: 1 });
    screen({ controller: quick, begin() {}, dispose() {}, skipIntro: true });
    expect(q('[data-hud="level"]')).toBeNull();
    expect(q('[data-hud="tray"]')).not.toBeNull();
  });

  it('a big wave cues each of its lanes at the lane\'s end, then the cue goes', () => {
    const { s, c } = levelSession('p1-6');
    const at = vi.fn((lane: number, col: number) => ({ x: col * 10, y: lane * 100 }));
    screen({ ...s, tileToClient: at });
    act(() => { c.levelHud.incoming.value = { lane: 3, side: 'zombies', n: 1 }; });
    const cue = need('[data-incoming="1"]');
    expect(cue.style.top).toBe('300px');
    expect(at).toHaveBeenCalledWith(3, 9);
    act(() => { vi.advanceTimersByTime(1600); });
    expect(q('[data-incoming]')).toBeNull();
  });

  it('the bosses task\'s bar goes in the one slot', () => {
    const { s } = levelSession('p1-8');
    screen(s, { bossBar: <i data-test-boss /> });
    expect(need('[data-hud-slot="boss"] [data-test-boss]')).toBeDefined();
  });

  it('pause in a level offers the map, which takes two taps', () => {
    const onMap = vi.fn();
    show(<PauseMenu onResume={() => {}} onRestart={() => {}} onSettings={() => {}} onQuit={() => {}} onMap={onMap} />);
    act(() => { need('[data-action="map"]').click(); });
    expect(onMap).not.toHaveBeenCalled();
    expect(need('[data-action="map"]').classList.contains('is-armed')).toBe(true);
    act(() => { need('[data-action="map"]').click(); });
    expect(onMap).toHaveBeenCalledTimes(1);
    show(<PauseMenu onResume={() => {}} onRestart={() => {}} onSettings={() => {}} onQuit={() => {}} />);
    expect(q('[data-action="map"]')).toBeNull();
  });
});

describe('the level result', () => {
  const win: LevelOutcome = { levelId: 'p1-3', won: true, stars: 3, coins: 90, newStars: 3, unlocked: 'potatoMine', next: levelById('p1-4') };
  const base = { result: { winner: 'plants' as const, playerWon: true }, playerFaction: 'plants' as const, seconds: 90, onPlayAgain: () => {}, onMenu: () => {} };

  it('the stars pop in one by one with the merge sound rising; then the coins; then the unlock on the turntable with a burst', () => {
    const turntable = { open: vi.fn(), close: vi.fn() };
    show(<ResultOverlay {...base} level={win} turntable={turntable} onNext={() => {}} onMap={() => {}} />);
    expect(need('[data-level-result]').dataset.step).toBe('stars');
    expect(need('.lresult__stars').dataset.lit).toBe('0');
    expect(q('[data-coins-earned]')).toBeNull();
    act(() => { vi.advanceTimersByTime(STAR_FIRST_MS); });
    expect(need('.lresult__stars').dataset.lit).toBe('1');
    act(() => { vi.advanceTimersByTime(STAR_STAGGER_MS * 2); });
    expect(need('.lresult__stars').dataset.lit).toBe('3');
    expect(sounds.filter((n) => n.startsWith('merge'))).toEqual(STAR_PITCH.map((p) => `merge@${p}`));
    act(() => { vi.advanceTimersByTime(STAR_STAGGER_MS); });
    expect(need('[data-coins-earned]').dataset.coinsEarned).toBe('90');
    expect(turntable.open).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1300); });
    expect(need('[data-unlock]').dataset.unlock).toBe('potatoMine');
    expect(need('.lresult__burst')).toBeDefined();
    expect(turntable.open).toHaveBeenCalledWith('potatoMine', 1);
    expect(need('[data-screen="result"]').classList.contains('has-turntable')).toBe(true);
    act(() => render(null, root));
    expect(turntable.close).toHaveBeenCalled();
  });

  it('without a turntable the unlocked unit shows as its card picture', () => {
    show(<ResultOverlay {...base} level={win} cards={{ potatoMine: 'data:mine' }} />);
    wait(5000);
    expect(need('[data-unlock] img').getAttribute('src')).toBe('data:mine');
  });

  it('picture buttons: next level (to the open one), replay, map', () => {
    const onNext = vi.fn();
    const onPlayAgain = vi.fn();
    const onMap = vi.fn();
    show(<ResultOverlay {...base} onPlayAgain={onPlayAgain} level={win} onNext={onNext} onMap={onMap} />);
    expect(need('[data-action="next-level"]').dataset.next).toBe('p1-4');
    act(() => { need('[data-action="next-level"]').click(); });
    act(() => { need('[data-action="replay"]').click(); });
    act(() => { need('[data-action="map"]').click(); });
    expect([onNext.mock.calls.length, onPlayAgain.mock.calls.length, onMap.mock.calls.length]).toEqual([1, 1, 1]);
    expect(q('[data-action="play-again"]')).toBeNull();
  });

  it('a loss: grey stars, the consolation coins at once, replay and map only', () => {
    const lost: LevelOutcome = { levelId: 'p1-1', won: false, stars: 0, coins: ADVENTURE.loss, newStars: 0, unlocked: null, next: null };
    show(<ResultOverlay {...base} result={{ winner: 'zombies', playerWon: false }} level={lost} onNext={() => {}} onMap={() => {}} />);
    expect(need('[data-coins-earned]').dataset.coinsEarned).toBe(String(ADVENTURE.loss));
    expect(all('[data-star][data-on]')).toHaveLength(0);
    expect(q('[data-action="next-level"]')).toBeNull();
    expect(q('[data-action="replay"]')).not.toBeNull();
    expect(q('[data-action="map"]')).not.toBeNull();
    wait(5000);
    expect(sounds.filter((n) => n.startsWith('merge'))).toEqual([]);
  });

  it('a replayed win already paid shows no coins', () => {
    show(<ResultOverlay {...base} level={{ ...win, coins: 0, newStars: 0, unlocked: null }} />);
    wait(5000);
    expect(q('[data-coins-earned]')).toBeNull();
  });
});
