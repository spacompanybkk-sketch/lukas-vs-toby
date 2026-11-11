// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { Renderer } from '../../src/render/Renderer';

it('throws webgl2-unavailable when the browser gives no WebGL2 context', () => {
  const canvas = document.createElement('canvas');
  canvas.getContext = (() => null) as typeof canvas.getContext;
  expect(() => new Renderer(canvas, 'high')).toThrowError(/^webgl2-unavailable$/);
});

it('throws webgl2-unavailable, not something else, when asking for the context fails outright', () => {
  const canvas = document.createElement('canvas');
  canvas.getContext = (() => ({})) as unknown as typeof canvas.getContext; // a context Three.js cannot use
  expect(() => new Renderer(canvas, 'low')).toThrowError(/^webgl2-unavailable$/);
});
