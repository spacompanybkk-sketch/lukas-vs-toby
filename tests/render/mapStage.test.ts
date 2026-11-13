// @vitest-environment happy-dom
import { Mesh, PerspectiveCamera, Scene } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Any WebGL renderer made while the map opens and closes is counted: there must be none.
const made = vi.hoisted(() => ({ renderers: 0, contexts: 0 }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class CountingRenderer {
    constructor() { made.renderers++; }
  }
  return { ...actual, WebGLRenderer: CountingRenderer };
});

import type { Director, StageLike } from '../../src/app/Stage';
import { TitleDemo } from '../../src/app/TitleDemo';
import { CameraRig } from '../../src/render/CameraRig';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { MapStage, PLANT_PATH, pathFor } from '../../src/scenes/mapStage';
import type { MapView } from '../../src/scenes/mapStage';

function fakeStage(): StageLike {
  const camera = new PerspectiveCamera(30, 1.4, 2, 200);
  const rig = new CameraRig(camera);
  const particles = new Particles();
  const canvas = document.createElement('canvas');
  const origGetContext = canvas.getContext.bind(canvas);
  canvas.getContext = ((...a: Parameters<HTMLCanvasElement['getContext']>) => { made.contexts++; return origGetContext(...a); }) as HTMLCanvasElement['getContext'];
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 704, right: 1024, bottom: 704, x: 0, y: 0, toJSON: () => ({}) });
  const stage = {
    scene: new Scene(), camera, rig, lawn: new Lawn(), particles, fx: new Effects(particles, seededRandom(1)),
    canvas, paused: false, timeScale: 1, director: null as Director | null,
    show(d: Director | null) {
      if (d === stage.director) return;
      const old = stage.director;
      stage.director = null;
      if (old) (old.detach(), rig.reset());
      stage.director = d;
    },
    release(d: Director) {
      if (stage.director !== d) return;
      stage.director = null;
      d.detach();
      rig.reset();
    },
  };
  stage.scene.add(stage.lawn.group, particles.object, stage.fx.group);
  return stage;
}

const view = (side: MapView['side'] = 'plants', next = 3): MapView => ({
  side, frame: '#E2553F',
  stones: Array.from({ length: 8 }, (_, i) => ({
    id: `${side === 'plants' ? 'p' : 'z'}1-${i + 1}`,
    state: i < next ? 'done' : i === next ? 'next' : 'closed',
  })),
});

const meshesOf = (o: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  o.traverse((c) => { if (c instanceof Mesh) out.push(c); });
  return out;
};

afterEach(() => {
  made.renderers = 0;
  made.contexts = 0;
});

describe('MapStage', () => {
  it('opening and closing it ten times makes no renderer or context and leaves the scene as it was', () => {
    const stage = fakeStage();
    const demo = new TitleDemo(stage);
    demo.show();
    const before = stage.scene.children.length;
    const map = new MapStage(stage);
    for (let i = 0; i < 10; i++) {
      map.open(view(i % 2 === 0 ? 'plants' : 'zombies', i % 8));
      expect(stage.director).toBe(map);
      map.frame(0.5, 1 / 60, 1 / 60);
      expect(map.layout()).not.toBeNull();
      map.close();
      demo.show();
    }
    expect(made.renderers).toBe(0);
    expect(made.contexts).toBe(0);
    expect(stage.scene.getObjectByName('map')).toBeUndefined();
    expect(stage.scene.children.length).toBe(before);
    expect(map.layout()).toBeNull();
  });

  it('closing frees every geometry and the material it made', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    for (let i = 0; i < 3; i++) {
      map.open(view());
      const root = stage.scene.getObjectByName('map') as Object3D;
      const meshes = meshesOf(root);
      expect(meshes.length).toBe(map.meshCount);
      const geometries = new Set<BufferGeometry>(meshes.map((m) => m.geometry));
      const materials = new Set<Material>(meshes.flatMap((m) => ([] as Material[]).concat(m.material)));
      const disposed = new Set<BufferGeometry | Material>();
      for (const g of geometries) g.addEventListener('dispose', () => disposed.add(g));
      for (const m of materials) m.addEventListener('dispose', () => disposed.add(m));
      map.close();
      for (const g of geometries) expect(disposed.has(g)).toBe(true);
      for (const m of materials) expect(disposed.has(m)).toBe(true);
      expect(root.children).toHaveLength(0);
    }
  });

  it('a new view (another side, new stars) frees the old path and builds the new one', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open(view('plants', 0));
    const first = stage.scene.getObjectByName('map-stone-p1-1') as Mesh;
    let freed = false;
    first.geometry.addEventListener('dispose', () => { freed = true; });
    const count = map.meshCount;
    map.update(view('zombies', 5));
    expect(freed).toBe(true);
    expect(stage.scene.getObjectByName('map-stone-p1-1')).toBeUndefined();
    expect(stage.scene.getObjectByName('map-stone-z1-1')).toBeDefined();
    expect(map.meshCount).toBe(count);
    map.close();
  });

  it('eight stones, the flag on the next one only, four greyed worlds with padlocks', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open(view('plants', 2));
    for (let i = 1; i <= 8; i++) expect(stage.scene.getObjectByName(`map-stone-p1-${i}`)).toBeDefined();
    const flag = stage.scene.getObjectByName('map-flag');
    expect(flag?.parent?.name).toBe('map-stone-p1-3');
    for (let w = 2; w <= 5; w++) expect(meshesOf(stage.scene.getObjectByName(`map-world-${w}`)!).length).toBe(2);
    // Everything won: no next stone, no flag.
    map.update({ ...view(), stones: view().stones.map((s) => ({ ...s, state: 'done' as const })) });
    expect(stage.scene.getObjectByName('map-flag')).toBeUndefined();
    expect(map.layout()?.flag).toBeNull();
    map.close();
  });

  it('the next stone hops in steps and comes back down; the others stay put', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open(view('plants', 1));
    const next = stage.scene.getObjectByName('map-stone-p1-2') as Mesh;
    const other = stage.scene.getObjectByName('map-stone-p1-1') as Mesh;
    const heights = new Set<number>();
    for (let i = 0; i < 60; i++) {
      map.frame(0.5, 1 / 60, 1 / 60);
      heights.add(Number(next.position.y.toFixed(4)));
      expect(other.position.y).toBe(0);
    }
    expect(Math.max(...heights)).toBeGreaterThan(0.2);
    expect(heights.has(0)).toBe(true);
    expect(heights.size).toBeLessThanOrEqual(9); // eighths of the hop
    map.close();
  });

  it('layout: every stone and the flag on screen, the flag above its stone; the zombies walk the mirror path', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open(view('plants', 0));
    const l = map.layout()!;
    expect(Object.keys(l.stones)).toHaveLength(8);
    for (const p of Object.values(l.stones)) {
      expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(1024);
      expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(704);
    }
    expect(l.flag!.y).toBeLessThan(l.stones['p1-1']!.y);
    // Plants start at Lukas's (left) end; zombies at Toby's (right) end.
    expect(l.stones['p1-1']!.x).toBeLessThan(l.stones['p1-8']!.x);
    expect(pathFor('zombies')[0]![0]).toBeCloseTo(10 - PLANT_PATH[0]![0]);
    map.update(view('zombies', 0));
    const z = map.layout()!;
    expect(z.stones['z1-1']!.x).toBeGreaterThan(z.stones['z1-8']!.x);
    map.close();
  });

  it('another director taking the stage takes the map out too', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open(view());
    new TitleDemo(stage).show();
    expect(map.isOpen).toBe(false);
    expect(stage.scene.getObjectByName('map')).toBeUndefined();
  });
});
