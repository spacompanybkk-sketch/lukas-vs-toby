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
import { ISLAND_COLORS, MapStage, PLANT_PATH, hopHeight, pathFor } from '../../src/scenes/mapStage';
import { WORLD_ORDER } from '../../src/data/worlds';
import type { WorldKey } from '../../src/data/worlds';
import { BufferAttribute, Color } from 'three';
import { HOP_MS } from '../../src/ui/screens/mapModel';
import { allocationsIn } from './allocations';
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

/** The side's islands in its order, the first open and the rest locked (the shipped levels). */
const islandsOf = (side: MapView['side'], open = 1): MapView['islands'] =>
  (side === 'plants' ? WORLD_ORDER : [...WORLD_ORDER].reverse()).map((arena, i) => ({ arena, locked: i >= open }));

const view = (side: MapView['side'] = 'plants', next = 3): MapView => ({
  side, frame: '#E2553F', arena: side === 'plants' ? 'backyard' : 'citadel', locked: false, islands: islandsOf(side),
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

  it('closing frees every geometry and the material it made (on the Backyard and on an island of its own)', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    for (let i = 0; i < 3; i++) {
      map.open(view(i % 2 === 0 ? 'plants' : 'zombies')); // the Backyard on the stage lawn, the Citadel on its own island
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
    // The same stones, pebbles and flag; plus the zombies' Citadel island and its props (the plants' Backyard is the stage lawn).
    expect(map.meshCount).toBe(count + 2);
    map.close();
  });

  it('eight stones, the flag on the next one only, the four other islands greyed with padlocks', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open(view('plants', 2));
    for (let i = 1; i <= 8; i++) expect(stage.scene.getObjectByName(`map-stone-p1-${i}`)).toBeDefined();
    const flag = stage.scene.getObjectByName('map-flag');
    expect(flag?.parent?.name).toBe('map-stone-p1-3');
    for (const w of ['meadow', 'desert', 'tundra', 'citadel']) expect(meshesOf(stage.scene.getObjectByName(`map-world-${w}`)!).length).toBe(2);
    expect(stage.scene.getObjectByName('map-world-backyard')).toBeUndefined();
    // Everything won: no next stone, no flag.
    map.update({ ...view(), stones: view().stones.map((s) => ({ ...s, state: 'done' as const })) });
    expect(stage.scene.getObjectByName('map-flag')).toBeUndefined();
    expect(map.layout()?.flag).toBeNull();
    map.close();
  });

  it('the next stone hops in eight time steps on the page clock and comes back down; the others stay put', () => {
    const stage = fakeStage();
    let t = 0;
    const map = new MapStage(stage, { clock: () => t });
    map.open(view('plants', 1));
    const next = stage.scene.getObjectByName('map-stone-p1-2') as Mesh;
    const other = stage.scene.getObjectByName('map-stone-p1-1') as Mesh;
    const heights = new Set<number>();
    for (let i = 0; i < 60; i++) {
      t = i / 60;
      map.frame(0.5, 1 / 60, 1 / 60);
      heights.add(Number(next.position.y.toFixed(4)));
      expect(other.position.y).toBe(0);
    }
    expect(Math.max(...heights)).toBeGreaterThan(0.2);
    expect(heights.has(0)).toBe(true);
    expect(heights.size).toBeLessThanOrEqual(5); // eight steps, symmetric: 0, 7/16, 3/4, 15/16, 1
    // The same beat as the HTML's CSS hop: a whole hop every HOP_MS, the top half way.
    expect(hopHeight(0)).toBe(0);
    expect(hopHeight(HOP_MS / 2000)).toBe(1);
    expect(hopHeight(HOP_MS / 1000 + 0.0001)).toBe(0);
    map.close();
  });

  it('layout is projected again only when the camera or the measured size changed, with no allocation per frame', () => {
    const stage = fakeStage();
    let rects = 0;
    const measure = stage.canvas.getBoundingClientRect;
    stage.canvas.getBoundingClientRect = () => { rects++; return measure(); };
    let t = 0;
    const map = new MapStage(stage, { clock: () => t });
    map.open(view('plants', 2));
    expect(rects).toBe(1); // measured once, on open
    const first = map.layout()!;
    const v = first.version;
    const p1 = first.stones['p1-1']!;
    const p1x = p1.x;
    expect(first.hop).toBeGreaterThan(0);
    // Two hundred frames of a still camera: the hop and the drifting worlds move, the layout does not.
    const counts = allocationsIn(() => {
      for (let i = 0; i < 200; i++) {
        t = i / 60;
        map.frame(0.5, 1 / 60, 1 / 60);
        expect(map.layout()).toBe(first);
      }
    });
    expect(counts).toEqual({});
    expect(first.version).toBe(v);
    expect(rects).toBe(1);
    // A new size: measured on request, then projected again into the same objects.
    stage.canvas.getBoundingClientRect = () => { rects++; return { ...measure(), width: 800, right: 800 }; };
    map.measure();
    const again = map.layout()!;
    expect(again).toBe(first);
    expect(again.stones['p1-1']).toBe(p1);
    expect(again.version).toBe(v + 1);
    expect(p1.x).not.toBe(p1x);
    // The camera moved (a new frame of the rig): projected again.
    stage.camera.position.x += 0.5;
    expect(map.layout()!.version).toBe(v + 2);
    expect(rects).toBe(2);
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

  it('the island colour table: one entry per world, each top in its world\'s colour family', () => {
    const hsl = (hex: string): { h: number; s: number; l: number } => new Color(hex).getHSL({ h: 0, s: 0, l: 0 });
    expect(Object.keys(ISLAND_COLORS).sort()).toEqual([...WORLD_ORDER].sort());
    const top = (w: WorldKey): { h: number; s: number; l: number } => hsl(ISLAND_COLORS[w].top);
    expect(top('backyard').h * 360).toBeGreaterThan(80); expect(top('backyard').h * 360).toBeLessThan(140); // green
    expect(top('meadow').h * 360).toBeGreaterThan(160); expect(top('meadow').h * 360).toBeLessThan(220); // blue-teal
    expect(top('meadow').l).toBeLessThan(0.45); // night
    expect(top('desert').h * 360).toBeGreaterThan(20); expect(top('desert').h * 360).toBeLessThan(45); // orange sand
    expect(top('tundra').l).toBeGreaterThan(0.85); // snow
    expect(top('citadel').h * 360).toBeGreaterThan(250); expect(top('citadel').h * 360).toBeLessThan(300); // purple
    expect(top('citadel').l).toBeLessThan(0.35); // dark stone
    expect(hsl(ISLAND_COLORS.citadel.accent).h * 360).toBeLessThan(40); // the orange glow
  });

  it('an open Backyard uses the stage\'s own lawn; any other island hides it and shows its own, in its colours', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open(view('plants'));
    expect(stage.lawn.group.visible).toBe(true);
    expect(stage.scene.getObjectByName('map-island')).toBeUndefined();
    map.update(view('zombies'));
    expect(stage.lawn.group.visible).toBe(false);
    const island = stage.scene.getObjectByName('map-island') as Mesh;
    expect(island).toBeDefined();
    // Its lawn tiles are the Citadel's dark purple stone: a vertex on top in the middle of the lawn.
    const pos = island.geometry.getAttribute('position') as BufferAttribute;
    const nor = island.geometry.getAttribute('normal') as BufferAttribute;
    const col = island.geometry.getAttribute('color') as BufferAttribute;
    let found = 0;
    const want = [new Color(ISLAND_COLORS.citadel.top), new Color(ISLAND_COLORS.citadel.topAlt)];
    for (let i = 0; i < pos.count; i += 4) {
      if (nor.getY(i) < 0.5) continue;
      const cx = (pos.getX(i) + pos.getX(i + 2)) / 2;
      const cz = (pos.getZ(i) + pos.getZ(i + 2)) / 2;
      if (cx < 3 || cx > 7 || cz < 1 || cz > 4) continue;
      const c = new Color(col.getX(i), col.getY(i), col.getZ(i));
      const near = Math.min(...want.map((w) => Math.abs(w.r - c.r) + Math.abs(w.g - c.g) + Math.abs(w.b - c.b)));
      expect(near).toBeLessThan(0.1);
      found++;
    }
    expect(found).toBeGreaterThan(50);
    // The zombies' four others: tundra, desert, meadow locked; the Backyard last.
    expect(stage.scene.getObjectByName('map-world-citadel')).toBeUndefined();
    expect(meshesOf(stage.scene.getObjectByName('map-world-backyard')!).length).toBe(2);
    // Back on the plants' Backyard the stage lawn shows again and the own island is freed.
    let freed = false;
    island.geometry.addEventListener('dispose', () => { freed = true; });
    map.update(view('plants'));
    expect(freed).toBe(true);
    expect(stage.lawn.group.visible).toBe(true);
    expect(stage.scene.getObjectByName('map-island')).toBeUndefined();
    // Closing on another island shows the stage lawn again for whoever comes next.
    map.update(view('zombies'));
    map.close();
    expect(stage.lawn.group.visible).toBe(true);
  });

  it('a locked island: grey (no colour left), no stones, no flag; an open island in the sky has no padlock', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open({ ...view('plants'), arena: 'meadow', locked: true, stones: [], islands: islandsOf('plants', 2) });
    const island = stage.scene.getObjectByName('map-island') as Mesh;
    const col = island.geometry.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < col.count; i += 97) {
      const c = new Color(col.getX(i), col.getY(i), col.getZ(i));
      expect(c.getHSL({ h: 0, s: 0, l: 0 }).s).toBeLessThan(0.2);
    }
    expect(stage.scene.getObjectByName('map-flag')).toBeUndefined();
    expect(Object.keys(map.layout()!.stones)).toHaveLength(0);
    expect(stage.lawn.group.visible).toBe(false);
    // The Backyard (open, behind) hangs in the sky without a padlock; the locked ones with one.
    expect(meshesOf(stage.scene.getObjectByName('map-world-backyard')!).length).toBe(1);
    expect(meshesOf(stage.scene.getObjectByName('map-world-desert')!).length).toBe(2);
    map.close();
  });

  it('switching islands ten times frees what each built: the mesh count comes back the same', () => {
    const stage = fakeStage();
    const map = new MapStage(stage);
    map.open(view('plants'));
    const plants = map.meshCount;
    map.update(view('zombies'));
    const zombies = map.meshCount;
    for (let i = 0; i < 10; i++) {
      map.update(view(i % 2 === 0 ? 'plants' : 'zombies'));
      expect(map.meshCount).toBe(i % 2 === 0 ? plants : zombies);
    }
    map.close();
    expect(stage.lawn.group.visible).toBe(true);
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
