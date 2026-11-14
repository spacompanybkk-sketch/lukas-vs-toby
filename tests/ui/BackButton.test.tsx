// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackButton } from '../../src/ui/BackButton';

let root: HTMLElement | null = null;
afterEach(() => { if (root !== null) { act(() => render(null, root!)); root.remove(); root = null; } });

describe('BackButton', () => {
  it('keeps the arrow, the aria-label and the test id, and gains the word BACK in the pixel font', () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    const onClick = vi.fn();
    act(() => render(<BackButton data-action="back" class="screen-back" onClick={onClick} />, root!));
    const b = root.querySelector<HTMLButtonElement>('[data-action="back"]')!;
    expect(b.getAttribute('aria-label')).toBe('Back');
    expect(b.type).toBe('button');
    expect(b.querySelector('.ico--back')).not.toBeNull();
    expect(b.querySelector('.back__word.inked')?.textContent).toBe('BACK');
    expect(b.classList.contains('screen-back')).toBe(true);
    act(() => b.click());
    expect(onClick).toHaveBeenCalledOnce();
  });
});
