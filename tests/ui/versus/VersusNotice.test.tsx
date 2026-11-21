// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pixelPaths } from '../../../src/ui/hud/PixelIcon';
import type { PixelArt } from '../../../src/ui/hud/PixelIcon';
import { DOOR } from '../../../src/ui/screens/pictures';
import { setUiSound } from '../../../src/ui/uiSound';
import { CRACKED_BLOCK, SHRUG, UPDATE } from '../../../src/ui/versus/pictures';
import { VersusNotice } from '../../../src/ui/versus/VersusNotice';
import type { NoticeKind } from '../../../src/ui/versus/VersusNotice';

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
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 800)}`);
  return el;
};
const drawn = (el: Element): string[] => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
const paths = (art: PixelArt): string[] => pixelPaths(art).map((p) => p.d);

const PICTURES: [NoticeKind, PixelArt][] = [['update', UPDATE], ['broken', CRACKED_BLOCK], ['shrug', SHRUG], ['gone', DOOR]];

describe('the Versus notices', () => {
  it.each(PICTURES)('%s: its picture and one home button (≥ 64 px)', (kind, art) => {
    const onHome = vi.fn();
    act(() => render(<VersusNotice kind={kind} onHome={onHome} />, root));
    expect(need('[data-screen="vs-notice"]').dataset['notice']).toBe(kind);
    expect(drawn(need('[data-notice-pic]'))).toEqual(paths(art));
    const buttons = root.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    const home = need('[data-action="home"]');
    expect(home.querySelector('.ico--home')).not.toBeNull();
    expect(parseFloat(home.style.minWidth)).toBeGreaterThanOrEqual(64);
    expect(parseFloat(home.style.minHeight)).toBeGreaterThanOrEqual(64);
    act(() => home.click());
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(sounds).toContain('click');
  });

  it('something went wrong (broken, shrug, gone) says so with the "uh-uh"; a new version does not', () => {
    for (const kind of ['broken', 'shrug', 'gone'] as const) {
      sounds = [];
      act(() => render(null, root));
      act(() => render(<VersusNotice kind={kind} onHome={() => {}} />, root));
      expect(sounds, kind).toEqual(['deny']);
    }
    sounds = [];
    act(() => render(null, root));
    act(() => render(<VersusNotice kind="update" onHome={() => {}} />, root));
    expect(sounds).toEqual([]);
  });
});
