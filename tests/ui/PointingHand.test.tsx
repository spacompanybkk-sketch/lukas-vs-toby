// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GloveVM } from '../../src/app/tutorial';
import { PointingHand } from '../../src/ui/hud/PointingHand';

// The glove's cost on an iPad: a card target is found once and measured while it settles, on a
// resize and now and then, not read from the page every frame.

let root: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  root.dataset.screen = 'battle';
  root.innerHTML = '<div data-hud="tray"><button data-card="peashooter"></button></div><div id="glove"></div>';
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root.querySelector('#glove')!));
  root.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PointingHand', () => {
  it('reads a card target\'s box only while it settles, every half second after, and again on a resize', () => {
    const card = root.querySelector<HTMLElement>('[data-card="peashooter"]')!;
    let reads = 0;
    card.getBoundingClientRect = () => { reads += 1; return { left: 100, top: 500, width: 80, height: 100, right: 180, bottom: 600, x: 100, y: 500, toJSON: () => ({}) } as DOMRect; };
    const query = vi.spyOn(Element.prototype, 'querySelector');
    const glove = signal<GloveVM | null>({ aim: { kind: 'card', card: 'peashooter' }, holding: true, step: 's' });
    act(() => render(<PointingHand glove={glove} host={{}} hidden={false} />, root.querySelector('#glove')!));
    const frames = (n: number): void => { for (let i = 0; i < n; i++) vi.advanceTimersToNextFrame(); };
    frames(300); // ten seconds of a child looking at it
    expect(reads).toBeLessThanOrEqual(40 + 300 / 30 + 1);
    expect(query.mock.calls.filter(([sel]) => String(sel).includes('data-card')).length).toBe(1);
    const hand = root.querySelector<HTMLElement>('[data-glove]')!;
    expect(hand.dataset.gloveX).toBe('140');
    expect(hand.dataset.gloveY).toBe('550');
    // A belt card slides in over 600 ms (36 frames): its box is still read every frame until then.
    reads = 0;
    const fresh = signal<GloveVM | null>({ aim: { kind: 'card', card: 'peashooter' }, holding: true, step: 't' });
    act(() => render(<PointingHand glove={fresh} host={{}} hidden={false} />, root.querySelector('#glove')!));
    frames(36);
    expect(reads).toBeGreaterThanOrEqual(36);
    // The window changes: measured again at once.
    reads = 0;
    window.dispatchEvent(new Event('resize'));
    frames(1);
    expect(reads).toBe(1);
  });
});
