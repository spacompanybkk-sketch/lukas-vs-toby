// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pixelPaths } from '../../../src/ui/hud/PixelIcon';
import type { PixelArt } from '../../../src/ui/hud/PixelIcon';
import { ResultOverlay } from '../../../src/ui/hud/ResultOverlay';
import { SWORDS } from '../../../src/ui/screens/boardPictures';
import { CHECK, DIGITS, DOOR } from '../../../src/ui/screens/pictures';
import { setUiSound } from '../../../src/ui/uiSound';
import { CROWN, QUESTION } from '../../../src/ui/versus/pictures';
import type { FaceVM } from '../../../src/ui/versus/types';
import { VersusResult } from '../../../src/ui/versus/VersusResult';
import type { VersusResultVM } from '../../../src/ui/versus/VersusResult';

let root: HTMLElement;
let sounds: string[];
beforeEach(() => {
  sounds = [];
  setUiSound((n) => sounds.push(n));
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  setUiSound(null);
});

const need = (sel: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 1200)}`);
  return el;
};
const drawn = (el: Element): string[] => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
const paths = (art: PixelArt): string[] => pixelPaths(art).map((p) => p.d);
const has = (el: Element, art: PixelArt): boolean => {
  const want = paths(art).join('|');
  return [...el.querySelectorAll('svg')].some((s) => drawn(s).join('|') === want);
};
const size = (el: HTMLElement): number => parseFloat(el.style.width);

/** On Toby's screen: Toby won, 3 to 2; Lukas is "them". */
const TOBY: FaceVM = { slot: 'p02', name: 'Toby', picture: 'brainEater' };
const LUKAS: FaceVM = { slot: 'p01', name: 'Lukas', picture: 'peashooter' };
const VM: VersusResultVM = {
  winner: TOBY, loser: LUKAS, them: 'p01',
  score: { left: LUKAS, leftWins: 2, right: TOBY, rightWins: 3 },
  rematch: 'offer', rankUp: null,
};

function mount(vm: Partial<VersusResultVM> = {}) {
  const cb = { onRematch: vi.fn(), onHome: vi.fn() };
  act(() => render(<VersusResult vm={{ ...VM, ...vm }} portraits={{}} {...cb} />, root));
  return cb;
}

describe('the Versus result', () => {
  it('the winner large with a crown, the loser small', () => {
    mount();
    const win = need('[data-winner]');
    const lose = need('[data-loser]');
    expect(win.querySelector('[data-face-of="p02"]')).not.toBeNull();
    expect(lose.querySelector('[data-face-of="p01"]')).not.toBeNull();
    expect(drawn(need('[data-winner] [data-crown]'))).toEqual(paths(CROWN));
    expect(lose.querySelector('[data-crown]')).toBeNull();
    const big = size(need('[data-winner] [data-face-pic]'));
    const small = size(need('[data-loser] [data-face-pic]'));
    expect(big).toBeGreaterThan(small * 1.5);
  });

  it('no winner: neither face is crowned', () => {
    mount({ winner: null, loser: null });
    expect(root.querySelector('[data-winner]')).toBeNull();
    expect(root.querySelector('[data-loser]')).toBeNull();
    expect(root.querySelector('[data-crown]')).toBeNull();
  });

  it('the scoreboard strip: left face, his wins, swords, the right\'s wins, right face', () => {
    mount({ score: { left: LUKAS, leftWins: 2, right: TOBY, rightWins: 13 } });
    const strip = need('[data-score]');
    const parts = [...strip.children].map((c) => (c as HTMLElement).dataset['part']);
    expect(parts).toEqual(['left', 'left-wins', 'vs', 'right-wins', 'right']);
    expect(strip.querySelector('[data-part="left"] [data-face-of="p01"]')).not.toBeNull();
    expect(strip.querySelector('[data-part="right"] [data-face-of="p02"]')).not.toBeNull();
    const left = need('[data-part="left-wins"]');
    const right = need('[data-part="right-wins"]');
    expect(left.dataset['wins']).toBe('2');
    expect(right.dataset['wins']).toBe('13');
    expect([...left.querySelectorAll('svg')].map((s) => drawn(s).join('|'))).toEqual([paths(DIGITS['2']!).join('|')]);
    expect([...right.querySelectorAll('svg')].map((s) => drawn(s).join('|'))).toEqual(
      [paths(DIGITS['1']!).join('|'), paths(DIGITS['3']!).join('|')],
    );
    expect(drawn(need('[data-part="vs"]'))).toEqual(paths(SWORDS));
  });

  it('rematch (two curved arrows over a small sun and brain) and home; both ≥ 64 px and pressable', () => {
    const cb = mount();
    const re = need('[data-action="rematch"]');
    expect(re.querySelector('.ico--restart')).not.toBeNull();
    expect(re.querySelector('[data-rematch-swap] .ico--sun')).not.toBeNull();
    expect(re.querySelector('[data-rematch-swap] .ico--brain')).not.toBeNull();
    const home = need('[data-action="home"]');
    expect(home.querySelector('.ico--home')).not.toBeNull();
    for (const b of [re, home]) {
      expect(parseFloat(b.style.minWidth)).toBeGreaterThanOrEqual(64);
      expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(64);
    }
    act(() => re.click());
    expect(cb.onRematch).toHaveBeenCalledTimes(1);
    act(() => home.click());
    expect(cb.onHome).toHaveBeenCalledTimes(1);
    expect(sounds.filter((s) => s === 'click').length).toBe(2);
    expect(root.querySelector('[data-rematch-tick]')).toBeNull();
    expect(root.querySelector('[data-answer]')).toBeNull();
  });

  it('mine: a green tick on rematch, a "?" on his face, and a second press does nothing', () => {
    const cb = mount({ rematch: 'mine' });
    const re = need('[data-action="rematch"]');
    expect(drawn(need('[data-action="rematch"] [data-rematch-tick]'))).toEqual(paths(CHECK));
    const answers = [...root.querySelectorAll<HTMLElement>('[data-answer]')];
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) {
      expect(a.closest('[data-result-face]')?.getAttribute('data-result-face')).toBe('p01');
      expect(a.dataset['answer']).toBe('question');
      expect(has(a, QUESTION)).toBe(true);
    }
    expect(root.querySelector('[data-result-face="p02"] [data-answer]')).toBeNull();
    act(() => re.click());
    expect(cb.onRematch).not.toHaveBeenCalled();
  });

  it('theirs: a tick on his face and a chime; my rematch still waits for me', () => {
    const cb = mount({ rematch: 'theirs' });
    expect(need('[data-result-face="p01"] [data-answer]').dataset['answer']).toBe('yes');
    expect(has(need('[data-result-face="p01"] [data-answer]'), CHECK)).toBe(true);
    expect(root.querySelector('[data-rematch-tick]')).toBeNull();
    expect(sounds).toContain('chime');
    act(() => need('[data-action="rematch"]').click());
    expect(cb.onRematch).toHaveBeenCalledTimes(1);
  });

  it('both: ticks on rematch and on his face', () => {
    mount({ rematch: 'both' });
    expect(root.querySelector('[data-rematch-tick]')).not.toBeNull();
    expect(need('[data-result-face="p01"] [data-answer]').dataset['answer']).toBe('yes');
  });

  it('gone: rematch greys out and does nothing; the door on his face; home still works', () => {
    const cb = mount({ rematch: 'gone' });
    const re = need('[data-action="rematch"]');
    expect(re.getAttribute('aria-disabled')).toBe('true');
    expect(re.classList.contains('is-off')).toBe(true);
    act(() => re.click());
    expect(cb.onRematch).not.toHaveBeenCalled();
    expect(sounds).toContain('deny');
    const door = need('[data-result-face="p01"] [data-answer]');
    expect(door.dataset['answer']).toBe('door');
    expect(has(door, DOOR)).toBe(true);
    act(() => need('[data-action="home"]').click());
    expect(cb.onHome).toHaveBeenCalledTimes(1);
  });

  it('none: no rematch, only home', () => {
    mount({ rematch: 'none' });
    expect(root.querySelector('[data-action="rematch"]')).toBeNull();
    expect(root.querySelectorAll('button').length).toBe(1);
    need('[data-action="home"]');
  });

  it('a rank-up shows its badge', () => {
    mount({ rankUp: { table: 'versus', rank: 2 } });
    expect(need('[data-rank-up]').dataset['table']).toBe('versus');
  });
});

describe('ResultOverlay, Versus variant', () => {
  const base = {
    result: { winner: 'zombies' as const, playerWon: true },
    playerFaction: 'zombies' as const, seconds: 95,
    onPlayAgain: vi.fn(), onMenu: vi.fn(),
  };

  it('shows the Versus result in place of the chips and the Play again / Menu buttons', () => {
    const onRematch = vi.fn();
    act(() => render(<ResultOverlay {...base} versus={{ vm: VM, onRematch }} />, root));
    need('[data-screen="result"]');
    need('[data-versus-result]');
    expect(root.querySelector('[data-action="play-again"]')).toBeNull();
    expect(root.querySelector('[data-action="menu"]')).toBeNull();
    act(() => need('[data-action="rematch"]').click());
    expect(onRematch).toHaveBeenCalledTimes(1);
    act(() => need('[data-action="home"]').click());
    expect(base.onMenu).toHaveBeenCalledTimes(1);
  });

  it('without `versus`, the overlay is as before', () => {
    act(() => render(<ResultOverlay {...base} />, root));
    expect(root.querySelector('[data-versus-result]')).toBeNull();
    need('[data-action="play-again"]');
    need('[data-action="menu"]');
  });
});
