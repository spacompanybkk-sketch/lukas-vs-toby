// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pixelPaths } from '../../../src/ui/hud/PixelIcon';
import { SWORDS } from '../../../src/ui/screens/boardPictures';
import { CROSS } from '../../../src/ui/screens/pictures';
import { setUiSound } from '../../../src/ui/uiSound';
import { InviteCard } from '../../../src/ui/versus/InviteCard';
import { SWAP } from '../../../src/ui/versus/pictures';
import type { InviteCardState, InviteDraftVM } from '../../../src/ui/versus/types';

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

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 800)}`);
  return el;
};
const drawn = (el: Element): string[] => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
const paths = (art: Parameters<typeof pixelPaths>[0]): string[] => pixelPaths(art).map((p) => p.d);
const px = (el: HTMLElement, prop: 'width' | 'height' | 'minWidth' | 'minHeight'): number => parseFloat(el.style[prop]);

/** Toby (zombies) invites Lukas; the head start is Toby's, three steps. */
const DRAFT: InviteDraftVM = {
  me: { slot: 'p02', name: 'Toby', picture: 'brainEater' },
  them: { slot: 'p01', name: 'Lukas', picture: 'peashooter' },
  mySide: 'zombies',
  head: { slot: 'p02', step: 3 },
};

function mount(draft: InviteDraftVM = DRAFT, state: InviteCardState = 'draft') {
  const cb = { onSwap: vi.fn(), onHead: vi.fn(), onSend: vi.fn(), onClose: vi.fn() };
  act(() => render(<InviteCard draft={draft} state={state} portraits={{}} {...cb} />, root));
  return cb;
}

const atLeast64 = (sel: string): void => {
  const b = need(sel);
  expect(px(b, 'minWidth'), `${sel} width`).toBeGreaterThanOrEqual(64);
  expect(px(b, 'minHeight'), `${sel} height`).toBeGreaterThanOrEqual(64);
};

describe('the invite card', () => {
  it('both faces, each with his side\'s icon (sun for plants, brain for zombies)', () => {
    mount();
    expect(need('[data-me] [data-face-of="p02"]')).toBeDefined();
    expect(need('[data-them] [data-face-of="p01"]')).toBeDefined();
    expect(need('[data-me] [data-side-icon]').dataset.sideIcon).toBe('zombies');
    expect(need('[data-me] [data-side-icon]').classList.contains('ico--brain')).toBe(true);
    expect(need('[data-them] [data-side-icon]').dataset.sideIcon).toBe('plants');
    expect(need('[data-them] [data-side-icon]').classList.contains('ico--sun')).toBe(true);
  });

  it('the swap button (two arrows, ≥ 64 px) calls onSwap', () => {
    const cb = mount();
    atLeast64('[data-action="swap"]');
    expect(drawn(need('[data-action="swap"]'))).toEqual(paths(SWAP));
    act(() => need('[data-action="swap"]').click());
    expect(cb.onSwap).toHaveBeenCalledTimes(1);
    expect(sounds).toContain('click');
  });

  it('the head start shows `step` pictures of the head boy\'s side, with minus and plus (≥ 64 px)', () => {
    const cb = mount();
    const pics = [...root.querySelectorAll<HTMLElement>('[data-head] [data-head-pic]')];
    expect(pics).toHaveLength(3);
    for (const p of pics) expect(p.classList.contains('ico--brain')).toBe(true);
    expect(need('[data-head]').dataset.headSlot).toBe('p02');
    atLeast64('[data-action="head-minus"]');
    atLeast64('[data-action="head-plus"]');
    act(() => need('[data-action="head-plus"]').click());
    expect(cb.onHead).toHaveBeenLastCalledWith(4);
    act(() => need('[data-action="head-minus"]').click());
    expect(cb.onHead).toHaveBeenLastCalledWith(2);
  });

  it('the head start of a plant boy is suns', () => {
    mount({ ...DRAFT, head: { slot: 'p01', step: 2 } });
    const pics = [...root.querySelectorAll<HTMLElement>('[data-head] [data-head-pic]')];
    expect(pics).toHaveLength(2);
    for (const p of pics) expect(p.classList.contains('ico--sun')).toBe(true);
  });

  it('the head start is clamped to 0..5', () => {
    let cb = mount({ ...DRAFT, head: { slot: 'p02', step: 5 } });
    act(() => need('[data-action="head-plus"]').click());
    expect(cb.onHead).not.toHaveBeenCalled();
    act(() => render(null, root));
    cb = mount({ ...DRAFT, head: { slot: 'p02', step: 0 } });
    expect(root.querySelectorAll('[data-head-pic]')).toHaveLength(0);
    act(() => need('[data-action="head-minus"]').click());
    expect(cb.onHead).not.toHaveBeenCalled();
    act(() => need('[data-action="head-plus"]').click());
    expect(cb.onHead).toHaveBeenCalledWith(1);
  });

  it('at a limit the button is greyed and a tap buzzes (no click, no change); inside the limits it clicks', () => {
    let cb = mount({ ...DRAFT, head: { slot: 'p02', step: 5 } });
    expect(need('[data-action="head-plus"]').getAttribute('aria-disabled')).toBe('true');
    expect(need('[data-action="head-minus"]').getAttribute('aria-disabled')).toBeNull();
    act(() => need('[data-action="head-plus"]').click());
    expect(sounds).toEqual(['deny']);
    expect(cb.onHead).not.toHaveBeenCalled();
    act(() => render(null, root));
    sounds.length = 0;
    cb = mount({ ...DRAFT, head: { slot: 'p02', step: 0 } });
    expect(need('[data-action="head-minus"]').getAttribute('aria-disabled')).toBe('true');
    expect(need('[data-action="head-plus"]').getAttribute('aria-disabled')).toBeNull();
    act(() => need('[data-action="head-minus"]').click());
    expect(sounds).toEqual(['deny']);
    act(() => need('[data-action="head-plus"]').click());
    expect(sounds).toEqual(['deny', 'click']);
    expect(cb.onHead).toHaveBeenCalledOnce();
  });

  it('no head start: no head row', () => {
    mount({ ...DRAFT, head: null });
    expect(q('[data-head]')).toBeNull();
  });

  it('the big swords button (≥ 64 px) sends; the red cross closes', () => {
    const cb = mount();
    atLeast64('[data-action="send"]');
    expect(drawn(need('[data-action="send"]'))).toEqual(paths(SWORDS));
    act(() => need('[data-action="send"]').click());
    expect(cb.onSend).toHaveBeenCalledTimes(1);
    atLeast64('[data-action="close"]');
    expect(drawn(need('[data-action="close"]'))).toEqual(paths(CROSS));
    act(() => need('[data-action="close"]').click());
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('waiting: the other face pulses with three dots; only the cross is left to press', () => {
    const cb = mount(DRAFT, 'waiting');
    expect(need('[data-invite-card]').dataset.state).toBe('waiting');
    expect(need('[data-them]').dataset.anim).toBe('pulse');
    expect(root.querySelectorAll('[data-them] [data-dots] [data-dot]')).toHaveLength(3);
    expect(q('[data-me]')!.dataset.anim).toBeUndefined();
    expect(q('[data-action="send"]')).toBeNull();
    expect(q('[data-action="swap"]')).toBeNull();
    act(() => need('[data-action="close"]').click());
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('refused: a red cross stamps over his face, which shakes, with the "uh-uh"', () => {
    mount(DRAFT, 'refused');
    expect(drawn(need('[data-them] [data-stamp]'))).toEqual(paths(CROSS));
    expect(need('[data-them]').dataset.anim).toBe('shake');
    expect(q('[data-them] [data-dots]')).toBeNull();
    expect(sounds).toContain('deny');
  });

  it('expired: the card shakes once', () => {
    mount(DRAFT, 'expired');
    expect(need('[data-invite-card]').dataset.anim).toBe('shake');
    expect(q('[data-them] [data-stamp]')).toBeNull();
    // A draft card does not shake.
    act(() => render(null, root));
    mount();
    expect(need('[data-invite-card]').dataset.anim).toBeUndefined();
  });
});
