// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, expect, it } from 'vitest';
import { PhoneNotice } from '../../src/ui/PhoneNotice';

afterEach(() => { document.body.innerHTML = ''; });

it('shows the line and nothing else: no buttons, no game root', () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<PhoneNotice />, root);
  expect(root.textContent).toBe('THIS GAME IS FOR iPAD AND COMPUTERS');
  expect(root.querySelector('[data-screen="phone"]')).not.toBeNull();
  expect(root.querySelectorAll('svg').length).toBe(2); // the tablet and the monitor
  expect(root.querySelector('button, a, input, canvas, [data-screen="title"]')).toBeNull();
});
