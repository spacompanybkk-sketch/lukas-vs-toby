// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pixelPaths } from '../../../src/ui/hud/PixelIcon';
import { SWORDS } from '../../../src/ui/screens/boardPictures';
import { CHECK, CROSS } from '../../../src/ui/screens/pictures';
import { setUiSound } from '../../../src/ui/uiSound';
import { InvitePanel } from '../../../src/ui/versus/InvitePanel';
import type { IncomingVM } from '../../../src/ui/versus/types';

let root: HTMLElement;
let sounds: string[];

beforeEach(() => {
  sounds = [];
  setUiSound((n) => sounds.push(n));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
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
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 800)}`);
  return el;
};
const drawn = (el: Element): string[] => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
const paths = (art: Parameters<typeof pixelPaths>[0]): string[] => pixelPaths(art).map((p) => p.d);

/** Lukas invites Toby, who would play zombies with a four-step head start. */
const INVITE: IncomingVM = {
  from: { slot: 'p01', name: 'Lukas', picture: 'peashooter' },
  me: { slot: 'p02', name: 'Toby', picture: 'brainEater' },
  mySide: 'zombies',
  head: { slot: 'p02', step: 4 },
};

function mount(invite: IncomingVM = INVITE) {
  const cb = { onAccept: vi.fn(), onDecline: vi.fn() };
  act(() => render(<InvitePanel invite={invite} portraits={{}} {...cb} />, root));
  return cb;
}

describe('the invite panel', () => {
  it('the inviter\'s face, the crossed swords, my own face with my side\'s icon, the head start pictures', () => {
    mount();
    need('[data-invite-panel] [data-from] [data-face-of="p01"]');
    expect(drawn(need('[data-invite-panel] [data-vs-swords]'))).toEqual(paths(SWORDS));
    need('[data-invite-panel] [data-me] [data-face-of="p02"]');
    expect(need('[data-me] [data-side-icon]').dataset.sideIcon).toBe('zombies');
    expect(need('[data-from] [data-side-icon]').dataset.sideIcon).toBe('plants');
    const pics = [...root.querySelectorAll<HTMLElement>('[data-head] [data-head-pic]')];
    expect(pics).toHaveLength(4);
    for (const p of pics) expect(p.classList.contains('ico--brain')).toBe(true);
  });

  it('no head start: no head pictures', () => {
    mount({ ...INVITE, head: null });
    expect(root.querySelector('[data-head]')).toBeNull();
  });

  it('a big tick and a big cross (≥ 96 px), at least 400 px apart on a 1024 px screen', () => {
    const cb = mount();
    const tick = need('[data-action="accept"]');
    const cross = need('[data-action="decline"]');
    expect(drawn(tick)).toEqual(paths(CHECK));
    expect(drawn(cross)).toEqual(paths(CROSS));
    for (const b of [tick, cross]) {
      expect(parseFloat(b.style.width)).toBeGreaterThanOrEqual(96);
      expect(parseFloat(b.style.height)).toBeGreaterThanOrEqual(96);
    }
    // The panel is full width; the cross sits at the left edge, the tick at the right.
    const width = window.innerWidth;
    const crossRight = parseFloat(cross.style.left) + parseFloat(cross.style.width);
    const tickLeft = width - parseFloat(tick.style.right) - parseFloat(tick.style.width);
    expect(tickLeft - crossRight).toBeGreaterThanOrEqual(400);
    act(() => tick.click());
    expect(cb.onAccept).toHaveBeenCalledTimes(1);
    act(() => cross.click());
    expect(cb.onDecline).toHaveBeenCalledTimes(1);
  });

  it('arriving plays the two-note chime, once', () => {
    mount();
    expect(sounds).toEqual(['chime']);
    act(() => render(<InvitePanel invite={{ ...INVITE, head: { slot: 'p02', step: 2 } }} portraits={{}} onAccept={() => {}} onDecline={() => {}} />, root));
    expect(sounds).toEqual(['chime']);
  });
});
