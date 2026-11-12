// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrayLayout } from '../../src/ui/hud/trayLayout';

/** A stand-in for Safari's visualViewport: an event target whose listeners the test can count. */
class FakeVisualViewport extends EventTarget {
  added = vi.fn();
  removed = vi.fn();
  override addEventListener(...a: Parameters<EventTarget['addEventListener']>): void {
    this.added(a[0]);
    super.addEventListener(...a);
  }
  override removeEventListener(...a: Parameters<EventTarget['removeEventListener']>): void {
    this.removed(a[0]);
    super.removeEventListener(...a);
  }
}

const setSize = (width: number, height: number): void =>
  (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height });

let root: HTMLElement;
let vv: FakeVisualViewport;
const seen: number[] = [];

function Probe() {
  const l = useTrayLayout(10);
  seen.push(l.rows);
  return <span data-rows={l.rows} data-card={l.card} />;
}

beforeEach(() => {
  vv = new FakeVisualViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  setSize(1024, 768);
  window.dispatchEvent(new Event('resize'));
  root = document.createElement('div');
  document.body.appendChild(root);
  seen.length = 0;
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: null });
});

const rows = (): string | null => root.querySelector('span')?.getAttribute('data-rows') ?? null;

describe('useTrayLayout and the window', () => {
  it("re-measures when Safari's bars move (visualViewport resize) with no window resize", () => {
    act(() => render(<Probe />, root));
    expect(rows()).toBe('2');
    act(() => {
      setSize(1180, 746); // the address bar shows: shorter, and no window 'resize' fires here
      vv.dispatchEvent(new Event('resize'));
    });
    expect(rows()).toBe('1');
  });

  it('re-measures on orientationchange', () => {
    act(() => render(<Probe />, root));
    act(() => {
      setSize(1440, 900);
      window.dispatchEvent(new Event('orientationchange'));
    });
    expect(rows()).toBe('1');
  });

  it('adds one visualViewport listener for any number of users and removes it when the last goes', () => {
    act(() => render(<><Probe /><Probe /></>, root));
    expect(vv.added.mock.calls.filter(([t]) => t === 'resize')).toHaveLength(1);
    act(() => render(<><Probe /></>, root)); // one of the two goes
    expect(vv.removed).not.toHaveBeenCalled();
    act(() => render(null, root));
    expect(vv.removed.mock.calls.filter(([t]) => t === 'resize')).toHaveLength(1);
  });
});
