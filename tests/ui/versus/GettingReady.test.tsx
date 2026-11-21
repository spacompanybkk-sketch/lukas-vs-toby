// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GettingReady } from '../../../src/ui/versus/GettingReady';
import type { FaceVM } from '../../../src/ui/versus/types';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

const TOBY: FaceVM = { slot: 'p02', name: 'Toby', picture: 'brainEater' };
const LUKAS: FaceVM = { slot: 'p01', name: 'Lukas', picture: 'peashooter' };

function mount(blocks: { connected: boolean; bothReady: boolean; sameBuild: boolean }) {
  act(() => render(<GettingReady me={TOBY} them={LUKAS} mySide="zombies" blocks={blocks} portraits={{}} />, root));
}
const filled = (): string[] => [...root.querySelectorAll<HTMLElement>('[data-block][data-filled]')].map((b) => b.dataset['block'] ?? '');

describe('getting ready', () => {
  it('both faces, each with his side\'s icon', () => {
    mount({ connected: false, bothReady: false, sameBuild: false });
    expect(root.querySelector('[data-screen="vs-ready"]')).not.toBeNull();
    expect(root.querySelector('[data-face-of="p02"] [data-side-icon="zombies"]')).not.toBeNull();
    expect(root.querySelector('[data-face-of="p01"] [data-side-icon="plants"]')).not.toBeNull();
  });

  it('a bar of three blocks: connected, both ready, same game version', () => {
    mount({ connected: false, bothReady: false, sameBuild: false });
    expect([...root.querySelectorAll<HTMLElement>('[data-block]')].map((b) => b.dataset['block'])).toEqual(['connected', 'ready', 'build']);
    expect(filled()).toEqual([]);
  });

  it('fills the blocks in order, never one past an empty one', () => {
    mount({ connected: true, bothReady: false, sameBuild: false });
    expect(filled()).toEqual(['connected']);
    mount({ connected: true, bothReady: true, sameBuild: false });
    expect(filled()).toEqual(['connected', 'ready']);
    mount({ connected: true, bothReady: true, sameBuild: true });
    expect(filled()).toEqual(['connected', 'ready', 'build']);
    // Later steps true but an earlier one not yet: the bar stops at the gap.
    mount({ connected: false, bothReady: true, sameBuild: true });
    expect(filled()).toEqual([]);
    mount({ connected: true, bothReady: false, sameBuild: true });
    expect(filled()).toEqual(['connected']);
  });
});
