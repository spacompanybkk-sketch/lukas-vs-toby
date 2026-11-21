// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseBar } from '../../src/ui/hud/BaseBars';
import { pixelPaths } from '../../src/ui/hud/PixelIcon';
import { LOCK } from '../../src/ui/screens/pictures';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

const need = (sel: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) throw new Error(`nothing at ${sel}`);
  return el;
};

describe('BaseBar: a base the level makes safe (#1)', () => {
  it('reads as locked: the padlock picture on a stone bar, no health fill, no health colour', () => {
    act(() => render(<BaseBar faction="zombies" vm={{ hp: 1000, max: 1000, safe: true }} you={false} portrait={undefined} />, root));
    const base = need('[data-hud="base-zombies"]');
    expect(base.hasAttribute('data-safe')).toBe(true);
    const bar = need('[data-hud="base-zombies"] .hud-base__bar');
    expect(bar.classList.contains('hud-base__bar--safe')).toBe(true);
    for (const level of ['low', 'mid', 'good']) expect(bar.classList.contains(`hud-base__bar--${level}`)).toBe(false);
    expect(root.querySelector('.hud-base__fill')).toBeNull();
    expect(root.querySelector('.hud-base__ticks')).toBeNull();
    const drawn = [...bar.querySelectorAll('svg path')].map((p) => p.getAttribute('d') ?? '');
    expect(drawn).toEqual(pixelPaths(LOCK).map((p) => p.d));
  });

  it('is no meter: a picture labelled as the base being safe in this level', () => {
    act(() => render(<BaseBar faction="zombies" vm={{ hp: 1000, max: 1000, safe: true }} you={false} portrait={undefined} />, root));
    expect(root.querySelector('[role="meter"]')).toBeNull();
    const bar = need('.hud-base__bar');
    expect(bar.getAttribute('role')).toBe('img');
    expect(bar.getAttribute('aria-label')).toBe('TOBY base is safe in this level');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('a normal bar is exactly what it was: no data-safe, the fill and its health colour', () => {
    act(() => render(<BaseBar faction="zombies" vm={{ hp: 400, max: 1000, safe: false }} you={false} portrait={undefined} />, root));
    expect(root.innerHTML).toBe(
      '<div data-hud="base-zombies" class="hud-base hud-base--zombies side-zombies"><span class="hud-base__chip chip px pal-side"><span aria-hidden="true">T</span></span>'
      + '<span class="hud-base__name inked">TOBY</span><span class="hud-base__bar px hud-base__bar--mid" role="meter" aria-label="TOBY base" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="400">'
      + '<span class="hud-base__fill" style="width: 40%;"></span><span class="hud-base__ticks" aria-hidden="true"></span></span></div>',
    );
    act(() => render(<BaseBar faction="plants" vm={{ hp: 1000, max: 1000, safe: false }} you portrait={undefined} />, root));
    expect(root.innerHTML).toBe(
      '<div data-hud="base-plants" class="hud-base hud-base--plants side-plants is-player"><span class="hud-base__chip chip px pal-side"><span aria-hidden="true">L</span></span>'
      + '<span class="hud-base__name inked">LUKAS</span><span class="hud-base__bar px hud-base__bar--good" role="meter" aria-label="LUKAS base" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="1000">'
      + '<span class="hud-base__fill" style="width: 100%;"></span><span class="hud-base__ticks" aria-hidden="true"></span></span></div>',
    );
  });
});
