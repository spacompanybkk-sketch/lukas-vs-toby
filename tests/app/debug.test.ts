// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { debugEnabled, installDebug, markReady } from '../../src/app/debug';

/**
 * 'pending' only if `promise` has not settled by the next macrotask. (An already-resolved
 * sentinel cannot tell the two apart: it always beats `promise.then`.)
 */
function state(promise: Promise<void>): Promise<'pending' | 'resolved'> {
  return Promise.race([
    promise.then(() => 'resolved' as const),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
  ]);
}

beforeEach(() => {
  Reflect.deleteProperty(window, '__lvt');
});

it('exposes window.__lvt with a ready promise that is pending until markReady()', async () => {
  const lvt = installDebug();

  expect(window.__lvt).toBe(lvt);
  expect(lvt.ready).toBeInstanceOf(Promise);
  expect(await state(lvt.ready)).toBe('pending');

  markReady();
  await window.__lvt.ready;
  expect(await state(lvt.ready)).toBe('resolved');
});

it('does not replace the existing object when installed twice', () => {
  const first = installDebug();
  first.extra = 42;
  const second = installDebug();

  expect(second).toBe(first);
  expect(window.__lvt).toBe(first);
  expect(window.__lvt.extra).toBe(42);
});

describe('the gate: window.__lvt only in a dev build or with ?debug', () => {
  it('is open in a dev build, and in a production build only when the address has ?debug', () => {
    expect(debugEnabled(true, '')).toBe(true);
    expect(debugEnabled(true, '?scene=stress')).toBe(true);
    expect(debugEnabled(false, '')).toBe(false);
    expect(debugEnabled(false, '?scene=battle&fps')).toBe(false);
    expect(debugEnabled(false, '?debug')).toBe(true);
    expect(debugEnabled(false, '?scene=stress&debug&units=60')).toBe(true);
    expect(debugEnabled(false, '?debug=1')).toBe(true);
    expect(debugEnabled(false, '?debugger')).toBe(false);
  });

  it('when shut, puts nothing on window but still hands the scenes one working object', async () => {
    const hidden = installDebug(false);
    expect('__lvt' in window).toBe(false);
    expect(installDebug(false)).toBe(hidden);
    hidden.extra = 1;
    expect(await state(hidden.ready)).toBe('pending');
    markReady();
    expect(await state(hidden.ready)).toBe('resolved');
    expect('__lvt' in window).toBe(false);
  });

  it('when open, is window.__lvt (the default in this test run, a dev build)', () => {
    const lvt = installDebug(true);
    expect(window.__lvt).toBe(lvt);
    expect(installDebug()).toBe(lvt);
  });
});
