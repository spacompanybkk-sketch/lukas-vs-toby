// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Renderer, fixHalfResTarget } from '../../src/render/Renderer';

describe('Renderer without a usable WebGL2 context', () => {
  it('throws webgl2-unavailable when the browser gives no WebGL2 context', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = (() => null) as typeof canvas.getContext;
    expect(() => new Renderer(canvas, 'high')).toThrowError(/^webgl2-unavailable$/);
  });

  it('lets any other failure through as it is, so a bug is not reported as an old browser', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = (() => ({})) as unknown as typeof canvas.getContext; // a context Three.js cannot use
    let thrown: unknown;
    try {
      new Renderer(canvas, 'low');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toBe('webgl2-unavailable');
  });
});

/** The shape n8ao 2.0.1 gives its half-resolution target: `texture` hands back the whole list. */
function brokenTarget(): { textures: object[]; texture: unknown } {
  return {
    textures: [{ name: 'depth' }, { name: 'normal' }],
    get texture() {
      return this.textures;
    },
  };
}

describe('fixHalfResTarget', () => {
  it('makes `texture` the first texture again and leaves the list alone', () => {
    const target = brokenTarget();
    const [depth, normal] = target.textures;
    expect(Array.isArray(target.texture)).toBe(true);

    fixHalfResTarget({ depthDownsampleTarget: target });

    expect(target.texture).toBe(depth);
    expect(target.textures).toEqual([depth, normal]);
    expect(target.textures[1]).toBe(normal);
  });

  it('keeps following the list if its first texture is replaced', () => {
    const target = brokenTarget();
    fixHalfResTarget({ depthDownsampleTarget: target });
    const replacement = { name: 'new depth' };
    target.textures[0] = replacement;
    expect(target.texture).toBe(replacement);
  });

  it('can be applied again and again', () => {
    const target = brokenTarget();
    const pass = { depthDownsampleTarget: target };
    fixHalfResTarget(pass);
    fixHalfResTarget(pass);
    expect(target.texture).toBe(target.textures[0]);
  });

  it('fixes a target that the pass has rebuilt', () => {
    const pass = { depthDownsampleTarget: brokenTarget() };
    fixHalfResTarget(pass);
    pass.depthDownsampleTarget = brokenTarget();
    expect(Array.isArray(pass.depthDownsampleTarget.texture)).toBe(true);
    fixHalfResTarget(pass);
    expect(pass.depthDownsampleTarget.texture).toBe(pass.depthDownsampleTarget.textures[0]);
  });

  it('leaves a healthy target exactly as it is', () => {
    const texture = { name: 'depth' };
    const target = { textures: [texture], texture };
    const before = Object.getOwnPropertyDescriptor(target, 'texture');
    fixHalfResTarget({ depthDownsampleTarget: target });
    expect(Object.getOwnPropertyDescriptor(target, 'texture')).toEqual(before);
  });

  it('does nothing when the pass has no half-resolution target', () => {
    expect(() => fixHalfResTarget({})).not.toThrow();
    expect(() => fixHalfResTarget({ depthDownsampleTarget: null })).not.toThrow();
  });
});
