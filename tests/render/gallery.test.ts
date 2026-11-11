// @vitest-environment happy-dom
import { Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from '../../src/render/Renderer';
import type { ModelInstance } from '../../src/render/voxel/rig';

// A WebGL renderer and an effect composer that do nothing, so the gallery can be mounted,
// run for a few frames and torn down without a GPU.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = '';
    toneMapping = 0;
    toneMappingExposure = 1;
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('postprocessing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('postprocessing')>();
  class FakeEffectComposer {
    passes: unknown[] = [];
    multisampling = 0;
    addPass(pass: unknown): void {
      this.passes.push(pass);
    }
    removeAllPasses(): void {
      this.passes = [];
    }
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, EffectComposer: FakeEffectComposer };
});

const { PAGE_SIZE, galleryLayout, galleryPage, mount } = await import('../../src/render/gallery');
const { registerModel } = await import('../../src/render/models/registry');
const { VOXEL } = await import('../../src/render/voxel/build');

interface GalleryDebug {
  instances: ModelInstance[];
  pose(clip: string | null, seconds: number | null): void;
  stats: { key: string; level: number; meshes: number; triangles: number }[];
}

/** Animation frames are run by hand: each call draws one frame, 1/60 s after the last. */
let pending: FrameRequestCallback[] = [];
let clock = 0;
function frames(count: number): void {
  for (let i = 0; i < count; i++) {
    const callbacks = pending;
    pending = [];
    clock += 1000 / 60;
    for (const callback of callbacks) callback(clock);
  }
}

let teardown: (() => void) | null = null;
function open(query: string): { gallery: GalleryDebug; renderer: Renderer; ui: HTMLElement } {
  const canvas = document.createElement('canvas');
  canvas.getContext = (() => ({})) as unknown as typeof canvas.getContext;
  teardown = mount(canvas, new URLSearchParams(query));
  frames(2);
  return {
    gallery: window.__lvt.gallery as GalleryDebug,
    renderer: window.__lvt.renderer as Renderer,
    ui: document.getElementById('ui') as HTMLElement,
  };
}

function part(instance: ModelInstance, name: string): Object3D {
  return instance.root.getObjectByName(name) as Object3D;
}

beforeEach(() => {
  Reflect.deleteProperty(window, '__lvt');
  document.body.innerHTML = '<div id="ui"></div>';
  pending = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => pending.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = [];
  });
});

afterEach(() => {
  teardown?.();
  teardown = null;
  vi.unstubAllGlobals();
});

describe('galleryLayout', () => {
  it('stands the five levels of a model in a row, left to right, centred on the lawn', () => {
    const { cells, box } = galleryLayout(['peashooter'], [1, 2, 3, 4, 5]);
    expect(cells.map((cell) => cell.level)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(cells.map((cell) => cell.z)).size).toBe(1);
    for (let i = 1; i < cells.length; i++) {
      expect((cells[i]?.x ?? 0) - (cells[i - 1]?.x ?? 0)).toBeGreaterThanOrEqual(1.2);
    }
    expect(((cells[0]?.x ?? 0) + (cells[4]?.x ?? 0)) / 2).toBeCloseTo(5, 9);
    expect(cells[0]?.z).toBeCloseTo(2.5, 9);
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThan(box.x[0]);
      expect(cell.x).toBeLessThan(box.x[1]);
      expect(cell.z).toBeGreaterThan(box.z[0]);
      expect(cell.z).toBeLessThan(box.z[1]);
    }
    expect(box.y[0]).toBe(0);
    expect(box.y[1]).toBeGreaterThan(1.5);
  });

  it('turns the overview into pages of ten, so every row stays inside the sun shadow', () => {
    const keys = Array.from({ length: 23 }, (_, i) => `m${i}`);
    expect(PAGE_SIZE).toBe(10);
    expect(galleryPage(keys, 1)).toEqual({ keys: keys.slice(0, 10), page: 1, pages: 3 });
    expect(galleryPage(keys, 3)).toEqual({ keys: keys.slice(20), page: 3, pages: 3 });
    // A page that does not exist is the nearest one that does.
    expect(galleryPage(keys, 9).page).toBe(3);
    expect(galleryPage(keys, 0).page).toBe(1);
    expect(galleryPage(keys, NaN).page).toBe(1);
    expect(galleryPage([], 1)).toEqual({ keys: [], page: 1, pages: 1 });
    // A full page, pads included, lies inside the renderer's shadow box (x −3.4..13.4, z −2.2..7).
    for (const cell of galleryLayout(galleryPage(keys, 1).keys, [1, 2, 3, 4, 5]).cells) {
      expect(cell.x - 0.55).toBeGreaterThan(-3.4);
      expect(cell.x + 0.55).toBeLessThan(13.4);
      expect(cell.z - 0.55).toBeGreaterThan(-2.2);
      expect(cell.z + 0.55).toBeLessThan(7);
    }
  });

  it('gives each model its own row of levels, two models side by side, inside the sun shadow', () => {
    const { cells } = galleryLayout(['a', 'b', 'c'], [1, 2, 3, 4, 5]);
    expect(cells).toHaveLength(15);
    const row = (key: string): { x: number[]; z: number } => {
      const own = cells.filter((cell) => cell.key === key);
      return { x: own.map((cell) => cell.x), z: own[0]?.z ?? NaN };
    };
    expect(row('a').z).toBe(row('b').z);
    expect(row('c').z).toBeGreaterThan(row('a').z);
    expect(Math.max(...row('a').x)).toBeLessThan(Math.min(...row('b').x));
    // The renderer's shadow box reaches from x = −3.4 to 13.4 and z = −2.2 to 7.
    for (const cell of galleryLayout(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], [1, 2, 3, 4, 5]).cells) {
      expect(cell.x).toBeGreaterThan(-2.8);
      expect(cell.x).toBeLessThan(12.8);
      expect(cell.z).toBeGreaterThan(-1.6);
      expect(cell.z).toBeLessThan(6.4);
    }
  });
});

describe('gallery scene', () => {
  it('shows every level of a model on a pad, with a label each in the UI layer', () => {
    const { gallery, renderer, ui } = open('scene=gallery&model=peashooter');
    expect(gallery.instances.map((instance) => instance.level)).toEqual([1, 2, 3, 4, 5]);
    for (const instance of gallery.instances) {
      expect(instance.root.parent).toBe(renderer.scene);
      expect(instance.root.position.y).toBe(0);
    }
    // The level under each, and the model's name once for the row.
    expect([...ui.querySelectorAll('[data-label="level"]')].map((tag) => tag.textContent)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
    expect([...ui.querySelectorAll('[data-label="name"]')].map((tag) => tag.textContent)).toEqual(['peashooter']);
    expect(renderer.scene.getObjectByName('pads')).toBeInstanceOf(Mesh);
    expect(renderer.scene.getObjectByName('lawn')).toBeUndefined();
    expect(gallery.stats.map((entry) => entry.level)).toEqual([1, 2, 3, 4, 5]);
    expect(gallery.stats[0]?.meshes).toBeGreaterThan(0);
  });

  it('uses the lights the renderer has and adds none', () => {
    const { renderer } = open('scene=gallery');
    const lights: string[] = [];
    renderer.scene.traverse((object) => {
      if ((object as { isLight?: boolean }).isLight) lights.push(object.name);
    });
    expect(lights.sort()).toEqual(['bounce', 'fill', 'sun']);
  });

  it('shows one level alone, and refuses a model that is not registered', () => {
    const { gallery } = open('scene=gallery&model=peashooter&level=3');
    expect(gallery.instances.map((instance) => instance.level)).toEqual([3]);
    teardown?.();
    teardown = null;
    const canvas = document.createElement('canvas');
    canvas.getContext = (() => ({})) as unknown as typeof canvas.getContext;
    expect(() => mount(canvas, new URLSearchParams('scene=gallery&model=nope'))).toThrow(/nope/);
  });

  it('frames one row closer than the overview', () => {
    const overview = open('scene=gallery').renderer.camera.position.clone();
    teardown?.();
    const row = open('scene=gallery&model=peashooter').renderer.camera.position.clone();
    expect(row.y).toBeLessThan(overview.y * 0.7);
  });

  it('freezes every model at one time of one clip', () => {
    const { gallery } = open('scene=gallery&model=peashooter&clip=shoot&t=0.12');
    frames(30);
    for (const instance of gallery.instances) {
      expect(instance.clip).toBe('shoot');
      // Leaning back, exactly as at 0.12 s, however many frames have passed.
      expect(part(instance, 'stem').rotation.z).toBeCloseTo((12 * Math.PI) / 180, 9);
    }
    // The screenshot tool moves the same models to another moment.
    gallery.pose('shoot', 0.2);
    frames(2);
    for (const instance of gallery.instances) expect(part(instance, 'stem').rotation.z).toBeCloseTo((-10 * Math.PI) / 180, 9);
  });

  it('plays idle when asked for nothing, and repeats a one-shot that is being watched', () => {
    const { gallery } = open('scene=gallery&model=peashooter&level=1');
    const instance = gallery.instances[0] as ModelInstance;
    expect(instance.clip).toBe('idle');
    const before = part(instance, 'stem').position.y;
    frames(20);
    expect(part(instance, 'stem').position.y).not.toBeCloseTo(before, 6);

    gallery.pose('shoot', null);
    frames(2);
    expect(instance.clip).toBe('shoot');
    frames(40); // 0.67 s: the shot is over
    expect(instance.clip).toBe('idle');
    frames(40); // and after the pause it fires again
    expect(instance.clip).toBe('shoot');
  });

  it('stands the models on the real lawn when asked', () => {
    const { gallery, renderer, ui } = open('scene=gallery&stage=lawn&t=0');
    expect(renderer.scene.getObjectByName('lawn')).toBeDefined();
    expect(renderer.scene.getObjectByName('pads')).toBeUndefined();
    // On the centres of tiles.
    for (const instance of gallery.instances) {
      expect(instance.root.position.x % 1).toBeCloseTo(0.5, 9);
      expect(instance.root.position.z % 1).toBeCloseTo(0.5, 9);
    }
    // Tiles are narrow: each model gets only its level, and the name stands once beside the row.
    const levels = [...ui.querySelectorAll('[data-label="level"]')] as HTMLElement[];
    expect(levels).toHaveLength(gallery.instances.length);
    for (const tag of levels) expect(tag.textContent?.length).toBeLessThanOrEqual(2);
    expect(ui.querySelectorAll('[data-label="name"]')).toHaveLength(1);
    // Under neighbouring tiles they sit a tile's width apart on screen.
    const left = (tag: HTMLElement): number => Number(/translate\((-?\d+)px/.exec(tag.style.transform)?.[1]);
    for (let i = 1; i < levels.length; i++) expect(left(levels[i] as HTMLElement) - left(levels[i - 1] as HTMLElement)).toBeGreaterThan(40);
  });

  it('holds the last pose of a one-shot when frozen at its end', () => {
    const { gallery } = open('scene=gallery&model=peashooter&level=1&clip=hit&t=0.2');
    frames(20);
    expect((gallery.instances[0] as ModelInstance).clip).toBe('hit');
    gallery.pose('shoot', 0.4);
    frames(20);
    expect((gallery.instances[0] as ModelInstance).clip).toBe('shoot');
  });

  it('repeats a watched one-shot on each model\'s own clip, and leaves alone a model without it', () => {
    const slow = { duration: 1.5, loop: false, parts: ['body'], sample() {} };
    const idle = { duration: 1, loop: true, parts: ['body'], sample() {} };
    const body = [{ name: 'body', pivot: [0, 0, 0] as [number, number, number], boxes: [{ at: [-1, 0, -1] as [number, number, number], size: [2, 2, 2] as [number, number, number], color: 'leaf' }] }];
    registerModel({ key: 'test-slow', trim: [], parts: body, clips: { idle, shoot: slow } });
    registerModel({ key: 'test-still', trim: [], parts: body, clips: { idle } });
    const { gallery } = open('scene=gallery&level=1&clip=shoot');
    const byKey = (key: string): ModelInstance => gallery.instances.find((instance) => instance.def.key === key) as ModelInstance;
    frames(40); // 0.67 s
    expect(byKey('peashooter').clip).toBe('idle'); // its 0.4 s shot is over
    expect(byKey('test-slow').clip).toBe('shoot'); // this one's lasts 1.5 s
    expect(byKey('test-still').clip).toBe('idle');
    frames(40); // 1.33 s: the Peashooter has fired again, the slow one is still on its first
    expect(byKey('peashooter').clip).toBe('shoot');
    expect(byKey('test-slow').clip).toBe('shoot');
  });

  it('fills the lawn with a crowd, to see what a full battle costs', () => {
    const { gallery, renderer, ui } = open('scene=gallery&crowd=150');
    expect(gallery.instances).toHaveLength(150);
    expect(renderer.scene.getObjectByName('lawn')).toBeDefined();
    expect(ui.querySelectorAll('[data-gallery] > div')).toHaveLength(0);
    const spots = new Set<string>();
    for (const instance of gallery.instances) {
      const { x, z } = instance.root.position;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(10);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThan(5);
      spots.add(`${x.toFixed(3)},${z.toFixed(3)}`);
    }
    // No two stand on exactly the same spot, and every level is among them.
    expect(spots.size).toBe(150);
    expect(new Set(gallery.instances.map((instance) => instance.level)).size).toBe(5);
    expect(gallery.stats.reduce((sum, entry) => sum + entry.meshes, 0)).toBeGreaterThan(150 * 3);
  });

  it('frames a portrait on the unit envelope, with no pads, labels or clouds', () => {
    const wide = open('scene=gallery&model=peashooter&level=1&pitch=20&yaw=32').renderer.camera.position.clone();
    teardown?.();
    const { renderer, ui, gallery } = open('scene=gallery&model=peashooter&level=1&pitch=20&yaw=32&portrait=1');
    expect(renderer.scene.getObjectByName('pads')).toBeUndefined();
    expect(ui.querySelectorAll('[data-gallery] > div')).toHaveLength(0);
    const clouds: boolean[] = [];
    renderer.scene.traverse((object) => {
      if (object.name === 'cloud') clouds.push(object.visible);
    });
    expect(clouds.length).toBeGreaterThan(0);
    expect(clouds.every((visible) => !visible)).toBe(true);
    expect(renderer.scene.getObjectByName('sky-dome')?.visible).toBe(true);
    const model = gallery.instances[0] as ModelInstance;
    const near = renderer.camera.position.distanceTo(model.root.position);
    expect(near).toBeLessThan(wide.distanceTo(model.root.position));
    // Swung round to the front (+X) and looking down only a little.
    expect(renderer.camera.position.x).toBeGreaterThan(model.root.position.x + 1);
    expect(renderer.camera.position.y).toBeLessThan(renderer.camera.position.z);

    // The frame is the envelope at the level's size, whatever the model has grown: level 5
    // is seen from 1.34 times as far, so its body is as big in its card and its crown is extra.
    teardown?.();
    const five = open('scene=gallery&model=peashooter&level=5&pitch=20&yaw=32&portrait=1');
    const far = five.renderer.camera.position.distanceTo((five.gallery.instances[0] as ModelInstance).root.position);
    expect(far / near).toBeCloseTo(1.34, 1);
  });

  it('flashes the models white when asked', () => {
    const { gallery } = open('scene=gallery&model=peashooter&level=1&flash=1');
    const mesh = part(gallery.instances[0] as ModelInstance, 'head').children.find((child) => child instanceof Mesh) as Mesh;
    expect((mesh.material as MeshStandardMaterial).emissive.r).toBeGreaterThanOrEqual(0.8);
  });

  it('takes everything it made away again', () => {
    const { gallery, renderer, ui } = open('scene=gallery&model=peashooter');
    const instances = [...gallery.instances];
    const geometry = (part(instances[0] as ModelInstance, 'head').children[0] as Mesh).geometry;
    const disposed = vi.spyOn(geometry, 'dispose');
    expect(pending).toHaveLength(1);

    teardown?.();
    teardown = null;

    expect(pending).toHaveLength(0);
    expect(ui.querySelector('[data-gallery]')).toBeNull();
    for (const instance of instances) expect(instance.root.parent).toBeNull();
    expect(renderer.scene.getObjectByName('pads')).toBeUndefined();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(window.__lvt.gallery).toBeUndefined();
    expect(window.__lvt.renderer).toBeUndefined();
    // Models can be built again afterwards.
    expect(open('scene=gallery&model=peashooter&level=1').gallery.instances).toHaveLength(1);
    expect(VOXEL).toBe(1 / 16);
  });
});
