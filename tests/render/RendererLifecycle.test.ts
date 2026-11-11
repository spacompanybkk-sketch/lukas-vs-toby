// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A WebGL renderer and an effect composer that only record what is done to them. With
// these in place the real Renderer can be built, resized and torn down without a GPU.
const fakes = vi.hoisted(() => ({
  failAt: 'nothing' as 'nothing' | 'composer' | 'resize',
  renderers: [] as { disposed: number; pixelRatios: number[] }[],
  composers: [] as { disposed: number; sizes: [number, number][]; multisampling: number; passes: unknown[] }[],
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    disposed = 0;
    pixelRatios: number[] = [];
    outputColorSpace = '';
    toneMapping = 0;
    toneMappingExposure = 1;
    shadowMap = { enabled: false, type: 0 };
    constructor() {
      fakes.renderers.push(this);
    }
    setPixelRatio(ratio: number): void {
      this.pixelRatios.push(ratio);
    }
    dispose(): void {
      this.disposed++;
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('postprocessing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('postprocessing')>();
  class FakeEffectComposer {
    disposed = 0;
    passes: unknown[] = [];
    sizes: [number, number][] = [];
    multisampling = 0;
    constructor() {
      if (fakes.failAt === 'composer') throw new Error('composer-broke');
      fakes.composers.push(this);
    }
    addPass(pass: unknown): void {
      this.passes.push(pass);
    }
    removeAllPasses(): void {
      this.passes = [];
    }
    setSize(width: number, height: number): void {
      if (fakes.failAt === 'resize') throw new Error('resize-broke');
      this.sizes.push([width, height]);
    }
    render(): void {}
    dispose(): void {
      this.disposed++;
    }
  }
  return { ...actual, EffectComposer: FakeEffectComposer };
});

const { Renderer } = await import('../../src/render/Renderer');

/** A canvas that hands out a context and keeps track of the listeners left on it. */
function countingCanvas(): { canvas: HTMLCanvasElement; listening: () => string[] } {
  const canvas = document.createElement('canvas');
  canvas.getContext = (() => ({})) as unknown as typeof canvas.getContext;
  const live = new Set<string>();
  const add = canvas.addEventListener.bind(canvas);
  const remove = canvas.removeEventListener.bind(canvas);
  canvas.addEventListener = ((type: string, listener: EventListener) => {
    live.add(type);
    add(type, listener);
  }) as typeof canvas.addEventListener;
  canvas.removeEventListener = ((type: string, listener: EventListener) => {
    live.delete(type);
    remove(type, listener);
  }) as typeof canvas.removeEventListener;
  return { canvas, listening: () => [...live].sort() };
}

/** Stands in for `window.matchMedia`: remembers every query and who listens to it. */
interface FakeQuery {
  media: string;
  listeners: Set<() => void>;
}
const queries: FakeQuery[] = [];
const realMatchMedia = window.matchMedia;
const realRatio = window.devicePixelRatio;

function setDensity(ratio: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true });
}

beforeEach(() => {
  fakes.failAt = 'nothing';
  fakes.renderers.length = 0;
  fakes.composers.length = 0;
  queries.length = 0;
  setDensity(1);
  window.matchMedia = ((media: string) => {
    const query: FakeQuery = { media, listeners: new Set() };
    queries.push(query);
    return {
      media,
      matches: true,
      addEventListener: (_type: string, listener: () => void) => query.listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => query.listeners.delete(listener),
    };
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
  setDensity(realRatio);
});

describe('Renderer that fails after the WebGL renderer exists', () => {
  it('disposes the WebGL renderer and passes the error on when the composer cannot be made', () => {
    fakes.failAt = 'composer';
    const { canvas, listening } = countingCanvas();

    expect(() => new Renderer(canvas, 'high')).toThrowError(/^composer-broke$/);

    expect(fakes.renderers).toHaveLength(1);
    expect(fakes.renderers[0]?.disposed).toBe(1);
    expect(listening()).toEqual([]);
  });

  it('also releases the post chain and its listeners when the failure comes later', () => {
    fakes.failAt = 'resize';
    const { canvas, listening } = countingCanvas();

    expect(() => new Renderer(canvas, 'high')).toThrowError(/^resize-broke$/);

    expect(fakes.renderers[0]?.disposed).toBe(1);
    expect(fakes.composers).toHaveLength(1);
    expect(fakes.composers[0]?.disposed).toBe(1);
    expect(listening()).toEqual([]);
    expect(queries.every((query) => query.listeners.size === 0)).toBe(true);
  });
});

describe('Renderer and the display it draws on', () => {
  it('listens for lost and restored contexts, and stops when disposed', () => {
    const { canvas, listening } = countingCanvas();
    const renderer = new Renderer(canvas, 'high');
    expect(listening()).toEqual(['webglcontextlost', 'webglcontextrestored']);

    renderer.dispose();
    expect(listening()).toEqual([]);
    expect(fakes.composers[0]?.disposed).toBe(1);
    expect(fakes.renderers[0]?.disposed).toBe(1);
  });

  it('follows a change of pixel density at the same size on the page', () => {
    const { canvas } = countingCanvas();
    const renderer = new Renderer(canvas, 'high');
    const composer = fakes.composers[0];
    const gl = fakes.renderers[0];
    if (!composer || !gl) throw new Error('fakes were not used');

    expect(queries.map((query) => query.media)).toEqual(['(resolution: 1dppx)']);
    expect(queries[0]?.listeners.size).toBe(1);
    expect(gl.pixelRatios.at(-1)).toBe(1);
    expect(composer.multisampling).toBe(4);
    const sizesBefore = composer.sizes.length;
    const passesBefore = composer.passes.length;

    // The window is dragged to a Retina display.
    setDensity(2);
    for (const listener of [...(queries[0]?.listeners ?? [])]) listener();

    expect(gl.pixelRatios.at(-1)).toBe(2);
    expect(composer.sizes.length).toBe(sizesBefore + 1);
    // Retina swaps multisampling for a smoothing pass at the end of the chain.
    expect(composer.multisampling).toBe(0);
    expect(composer.passes.length).toBe(passesBefore + 1);
    // The old query is let go and a new one armed for the new density.
    expect(queries.map((query) => query.media)).toEqual(['(resolution: 1dppx)', '(resolution: 2dppx)']);
    expect(queries[0]?.listeners.size).toBe(0);
    expect(queries[1]?.listeners.size).toBe(1);

    // And back again: the listener was re-armed, not used up.
    setDensity(1);
    for (const listener of [...(queries[1]?.listeners ?? [])]) listener();
    expect(gl.pixelRatios.at(-1)).toBe(1);
    expect(composer.multisampling).toBe(4);
    expect(composer.passes.length).toBe(passesBefore);
    expect(queries[1]?.listeners.size).toBe(0);
    expect(queries[2]?.listeners.size).toBe(1);

    renderer.dispose();
    expect(queries.every((query) => query.listeners.size === 0)).toBe(true);
  });

  it('notices a new pixel density on the next frame even if the browser sends no event', () => {
    // Device emulation in browser developer tools changes the density without the event.
    const { canvas } = countingCanvas();
    const renderer = new Renderer(canvas, 'high');
    const gl = fakes.renderers[0];
    if (!gl) throw new Error('fakes were not used');
    renderer.render(0);
    expect(gl.pixelRatios.at(-1)).toBe(1);
    const applied = gl.pixelRatios.length;

    setDensity(2);
    renderer.render(0);
    expect(gl.pixelRatios.at(-1)).toBe(2);
    // And it is re-armed for the new density, as after an event.
    expect(queries.at(-1)?.media).toBe('(resolution: 2dppx)');
    expect(queries.at(-1)?.listeners.size).toBe(1);

    // Nothing more happens while the density stays put.
    const settled = gl.pixelRatios.length;
    expect(settled).toBeGreaterThan(applied);
    renderer.render(0);
    renderer.render(0);
    expect(gl.pixelRatios.length).toBe(settled);
    renderer.dispose();
  });

  it('caps the pixel ratio at 2', () => {
    setDensity(3);
    const { canvas } = countingCanvas();
    const renderer = new Renderer(canvas, 'medium');
    expect(fakes.renderers[0]?.pixelRatios.at(-1)).toBe(2);
    renderer.dispose();
  });

  it('builds the chain each quality level calls for', () => {
    const { canvas } = countingCanvas();
    const renderer = new Renderer(canvas, 'low');
    const composer = fakes.composers[0];
    if (!composer) throw new Error('fakes were not used');
    const names = (): string[] => composer.passes.map((pass) => (pass as object).constructor.name);

    // Low: the scene, then one pass of effects. No ambient occlusion.
    expect(names()).toHaveLength(2);
    expect(composer.multisampling).toBe(2);

    renderer.setQuality('high');
    expect(names()).toHaveLength(3);
    expect(composer.multisampling).toBe(4);

    renderer.setQuality('medium');
    expect(names()).toHaveLength(2);
    expect(composer.multisampling).toBe(4);
    renderer.dispose();
  });
});
