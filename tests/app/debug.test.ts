// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { installDebug, markReady } from '../../src/app/debug';

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
