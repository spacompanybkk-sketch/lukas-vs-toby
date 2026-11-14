// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PauseMenu, QUIT_CONFIRM_MS } from '../../src/ui/hud/PauseMenu';

let root: HTMLElement;
const props = { onResume: vi.fn(), onRestart: vi.fn(), onSettings: vi.fn(), onQuit: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of Object.values(props)) f.mockReset();
  root = document.createElement('div');
  document.body.appendChild(root);
  act(() => render(<PauseMenu {...props} />, root));
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  vi.useRealTimers();
});

const quit = (): HTMLButtonElement => {
  const el = root.querySelector<HTMLButtonElement>('[data-action="quit"]');
  if (el === null) throw new Error('no quit');
  return el;
};

describe('PauseMenu', () => {
  it('has no Restart when none is given (a Free Play run: Quit banks it, nothing throws it away)', () => {
    expect(root.querySelector('[data-action="restart"]')).not.toBeNull();
    const { onRestart: _, ...rest } = props;
    act(() => render(<PauseMenu {...rest} />, root));
    expect(root.querySelector('[data-action="restart"]')).toBeNull();
    expect(root.querySelector('[data-action="settings"]')).not.toBeNull();
    expect(root.querySelector('[data-action="quit"]')).not.toBeNull();
  });

  it('Quit takes two taps: the first arms it (a tick shows), the second quits', () => {
    act(() => quit().click());
    expect(props.onQuit).not.toHaveBeenCalled();
    expect(quit().classList.contains('is-armed')).toBe(true);
    expect(quit().querySelector('.pixel-icon')).not.toBeNull();
    act(() => quit().click());
    expect(props.onQuit).toHaveBeenCalledTimes(1);
  });

  it('an armed Quit goes back to normal by itself after a few seconds', () => {
    act(() => quit().click());
    act(() => { vi.advanceTimersByTime(QUIT_CONFIRM_MS + 10); });
    expect(quit().classList.contains('is-armed')).toBe(false);
    act(() => quit().click());
    expect(props.onQuit).not.toHaveBeenCalled();
  });

  it('the other buttons work with one tap and disarm Quit', () => {
    act(() => quit().click());
    act(() => root.querySelector<HTMLElement>('[data-action="restart"]')?.click());
    expect(props.onRestart).toHaveBeenCalledTimes(1);
    expect(quit().classList.contains('is-armed')).toBe(false);
    act(() => root.querySelector<HTMLElement>('[data-action="resume"]')?.click());
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });
});
