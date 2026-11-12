// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchContextLoss } from '../../src/app/game';
import { go, screen } from '../../src/app/store';
import { App } from '../../src/ui/App';
import type { SessionFactory } from '../../src/ui/screens/BattleScreen';

afterEach(() => {
  go({ name: 'title' });
  document.body.replaceChildren();
});

describe('losing the graphics', () => {
  it('a lost WebGL context shows "Graphics stopped" with a Reload button', () => {
    const renderer: { onContextLost?: () => void } = {};
    watchContextLoss(renderer);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const factory: SessionFactory = vi.fn(() => {
      throw new Error('not reached');
    });
    // A battle is not needed: the context can be lost on any screen.
    act(() => render(<App createSession={factory} />, root));
    expect(root.querySelector('[data-screen="title"]')).not.toBeNull();
    act(() => renderer.onContextLost?.());
    expect(screen.value).toEqual({ name: 'unsupported', reason: 'context-lost' });
    expect(root.textContent).toContain('Graphics stopped');
    expect(root.querySelector('[data-action="reload"]')).not.toBeNull();
    expect(root.querySelector('[data-screen="title"]')).toBeNull();
    act(() => render(null, root));
  });
});
