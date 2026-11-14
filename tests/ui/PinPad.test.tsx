// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinPad } from '../../src/ui/screens/PinPad';
import type { PadAnswer } from '../../src/ui/screens/PinPad';
import { setUiSound } from '../../src/ui/uiSound';

let root: HTMLElement;
let sounds: string[];

beforeEach(() => {
  vi.useFakeTimers();
  sounds = [];
  setUiSound((n) => sounds.push(n));
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  setUiSound(null);
  vi.useRealTimers();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const need = (sel: string): HTMLElement => {
  const el = q(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 400)}`);
  return el;
};
const press = (k: string): void => { act(() => { need(`[data-key="${k}"]`).click(); }); };
const filled = (): number => root.querySelectorAll('[data-pin-box].is-filled').length;
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const key = (k: string): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); }); };

describe('PinPad', () => {
  it('has keys 0–9 and a delete key, and three empty boxes', () => {
    act(() => render(<PinPad onCode={() => 'ok'} onBack={() => {}} />, root));
    for (let d = 0; d <= 9; d++) expect(q(`[data-key="${d}"]`), String(d)).not.toBeNull();
    expect(q('[data-key="del"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-pin-box]')).toHaveLength(3);
    expect(filled()).toBe(0);
  });

  it('fills a box per digit with a sound per key; delete takes one back; the third digit submits', async () => {
    const onCode = vi.fn((_c: string): PadAnswer => 'ok');
    act(() => render(<PinPad onCode={onCode} onBack={() => {}} />, root));
    press('4');
    press('2');
    expect(filled()).toBe(2);
    press('del');
    expect(filled()).toBe(1);
    press('7');
    press('9');
    await flush();
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith('479');
    expect(sounds.filter((s) => s === 'click')).toHaveLength(5);
  });

  it('a wrong number shakes, clears and plays the deny sound; a new try works', async () => {
    const answers: PadAnswer[] = ['wrong', 'ok'];
    const onCode = vi.fn(async () => answers.shift() as PadAnswer);
    act(() => render(<PinPad onCode={onCode} onBack={() => {}} />, root));
    for (const k of ['1', '2', '3']) press(k);
    await flush();
    expect(need('[data-pin-boxes]').classList.contains('is-wrong')).toBe(true);
    expect(filled()).toBe(0);
    expect(sounds).toContain('deny');
    act(() => { vi.advanceTimersByTime(500); });
    expect(need('[data-pin-boxes]').classList.contains('is-wrong')).toBe(false);
    for (const k of ['1', '2', '4']) press(k);
    await flush();
    expect(onCode).toHaveBeenLastCalledWith('124');
  });

  it('double taps while the number is checked are ignored (never a fourth digit, never two checks)', async () => {
    let answer: (a: PadAnswer) => void = () => {};
    const onCode = vi.fn(() => new Promise<PadAnswer>((resolve) => { answer = resolve; }));
    act(() => render(<PinPad onCode={onCode} onBack={() => {}} />, root));
    for (const k of ['1', '2', '3', '3', '3']) press(k);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(filled()).toBe(3);
    answer('wrong');
    await flush();
    expect(filled()).toBe(0);
  });

  it('the back arrow always works, even halfway and while checking', async () => {
    const onBack = vi.fn();
    act(() => render(<PinPad onCode={() => new Promise<PadAnswer>(() => {})} onBack={onBack} />, root));
    press('1');
    act(() => need('[data-action="back"]').click());
    for (const k of ['2', '3']) press(k);
    act(() => need('[data-action="back"]').click());
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('locked: no keys, a boxy hourglass counting down, and the keys come back when it ends', async () => {
    let t = 1000;
    let until = 0;
    const onCode = vi.fn((): PadAnswer => {
      until = t + 30_000;
      return 'locked';
    });
    act(() => render(<PinPad onCode={onCode} onBack={() => {}} lockedUntil={() => until} now={() => t} />, root));
    for (const k of ['1', '2', '3']) press(k);
    await flush();
    expect(need('[data-lock]').textContent).toContain('30');
    expect(q('[data-keys]')?.getAttribute('aria-disabled')).toBe('true');
    expect(sounds).toContain('deny');
    press('5');
    expect(filled()).toBe(0);
    t += 12_400;
    act(() => { vi.advanceTimersByTime(250); });
    expect(need('[data-lock]').textContent).toContain('18');
    t += 17_600;
    act(() => { vi.advanceTimersByTime(250); });
    expect(q('[data-lock]')).toBeNull();
    press('5');
    expect(filled()).toBe(1);
  });

  it('opens already locked when the player is locked (after a reload)', () => {
    act(() => render(<PinPad onCode={() => 'ok'} onBack={() => {}} lockedUntil={() => 21_000} now={() => 1000} />, root));
    expect(need('[data-lock]').textContent).toContain('20');
  });

  it('the device keyboard types digits, Backspace deletes and Escape goes back', async () => {
    const onCode = vi.fn((): PadAnswer => 'ok');
    const onBack = vi.fn();
    act(() => render(<PinPad onCode={onCode} onBack={onBack} />, root));
    key('5');
    key('x');
    key('6');
    key('Backspace');
    expect(filled()).toBe(1);
    key('6');
    key('7');
    await flush();
    expect(onCode).toHaveBeenCalledWith('567');
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a six-digit pad for the grown-up code', async () => {
    const onCode = vi.fn((): PadAnswer => 'ok');
    act(() => render(<PinPad length={6} onCode={onCode} onBack={() => {}} />, root));
    expect(root.querySelectorAll('[data-pin-box]')).toHaveLength(6);
    for (const k of ['1', '2', '3', '4', '5']) press(k);
    expect(onCode).not.toHaveBeenCalled();
    press('6');
    await flush();
    expect(onCode).toHaveBeenCalledWith('123456');
  });

  it('offline: the boxes clear and a crossed-out cloud shows for a moment', async () => {
    act(() => render(<PinPad onCode={() => 'offline'} onBack={() => {}} />, root));
    for (const k of ['1', '2', '3']) press(k);
    await flush();
    expect(q('[data-pin-offline]')).not.toBeNull();
    expect(filled()).toBe(0);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(q('[data-pin-offline]')).toBeNull();
  });

  it('shows which of the two steps it is when choosing a number: step 2 has the first row done, ticked, an arrow and a tint', () => {
    act(() => render(<PinPad step={1} onCode={() => 'ok'} onBack={() => {}} />, root));
    expect(need('[data-pin-step]').getAttribute('data-pin-step')).toBe('1');
    expect(q('[data-pin-done]')).toBeNull();
    act(() => render(<PinPad step={2} onCode={() => 'ok'} onBack={() => {}} />, root));
    expect(need('[data-pin-step]').getAttribute('data-pin-step')).toBe('2');
    expect(root.querySelectorAll('[data-pin-done] .pin-box--done')).toHaveLength(3);
    expect(need('.pinpad').classList.contains('pinpad--repeat')).toBe(true);
  });

  it('failed (refused for another reason): the boxes clear and a big cross shows for a moment', async () => {
    act(() => render(<PinPad onCode={() => 'failed'} onBack={() => {}} />, root));
    for (const k of ['1', '2', '3']) press(k);
    await flush();
    expect(q('[data-pin-failed]')).not.toBeNull();
    expect(filled()).toBe(0);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(q('[data-pin-failed]')).toBeNull();
  });
});
