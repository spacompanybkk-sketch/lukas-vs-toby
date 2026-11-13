// @vitest-environment happy-dom
import { Mesh, PerspectiveCamera, Scene } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Any WebGL renderer made while the Almanac opens and closes is counted: there must be none.
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
import { getModelDef } from '../../src/render/models/registry';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { AlmanacStage, TURN_SPEED, actionClip, levelsOf } from '../../src/scenes/almanacStage';
import { ALMANAC_UNITS } from '../../src/ui/screens/almanacStats';

function fakeStage(): StageLike {
  const camera = new PerspectiveCamera(30, 1.4, 2, 200);
  const rig = new CameraRig(camera);
  const particles = new Particles();
  const canvas = document.createElement('canvas');
  const origGetContext = canvas.getContext.bind(canvas);
  canvas.getContext = ((...a: Parameters<HTMLCanvasElement['getContext']>) => { made.contexts++; return origGetContext(...a); }) as HTMLCanvasElement['getContext'];
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

const all = [...ALMANAC_UNITS.plants, ...ALMANAC_UNITS.zombies];

afterEach(() => {
  made.renderers = 0;
  made.contexts = 0;
});

describe('AlmanacStage', () => {
  it('opening and closing it ten times makes no renderer or context and leaves the scene as it was', () => {
    const stage = fakeStage();
    const demo = new TitleDemo(stage);
    demo.show();
    const near = stage.camera.near;
    const before = stage.scene.children.length - 0; // the demo's own units are taken out on hand-over
    const almanac = new AlmanacStage(stage);
    for (let i = 0; i < 10; i++) {
      almanac.open(all[i % all.length] as never, 1 + (i % 5));
      expect(stage.director).toBe(almanac);
      almanac.frame(0.5, 1 / 60, 1 / 60);
      expect(stage.camera.view?.enabled).toBe(true);
      almanac.close();
      demo.show();
    }
    expect(made.renderers).toBe(0);
    expect(made.contexts).toBe(0);
    expect(stage.scene.getObjectByName('almanac')).toBeUndefined();
    expect(stage.scene.getObjectByName('almanac-pedestal')).toBeUndefined();
    expect(stage.camera.view?.enabled ?? false).toBe(false);
    expect(stage.camera.near).toBe(near);
    expect(stage.scene.children.length).toBe(before);
  });

  it('closing disposes what the Almanac made (the pedestal) and leaves the models\' shared geometry alone', () => {
    const stage = fakeStage();
    const almanac = new AlmanacStage(stage);
    const meshesOf = (o: Object3D): Mesh[] => {
      const out: Mesh[] = [];
      o.traverse((c) => { if (c instanceof Mesh) out.push(c); });
      return out;
    };
    for (let i = 0; i < 4; i++) {
      almanac.open(all[i] as never, 2);
      const table = stage.scene.getObjectByName('almanac') as Object3D;
      const pedestal = stage.scene.getObjectByName('almanac-pedestal') as Mesh;
      const model = almanac.current;
      expect(model).not.toBeNull();
      const modelGeometry = new Set(meshesOf(model!.root).map((m) => m.geometry));
      const disposed = new Set<BufferGeometry | Material>();
      for (const m of meshesOf(table)) {
        m.geometry.addEventListener('dispose', () => disposed.add(m.geometry));
        for (const mat of ([] as Material[]).concat(m.material)) mat.addEventListener('dispose', () => disposed.add(mat));
      }
      almanac.close();
      expect(disposed.has(pedestal.geometry)).toBe(true);
      expect(disposed.has(pedestal.material as Material)).toBe(true);
      // Everything else that went is the model, whose geometry and materials every instance shares.
      for (const g of modelGeometry) expect(disposed.has(g)).toBe(false);
      expect(model!.root.parent).toBeNull();
      expect(table.children).toHaveLength(0);
    }
  });

  it('switching units disposes nothing shared and leaves only the new model and the pedestal on the turntable', () => {
    const stage = fakeStage();
    const almanac = new AlmanacStage(stage);
    almanac.open('peashooter', 1);
    const first = almanac.current;
    almanac.show('hotTopic', 3);
    almanac.show('hotTopic', 4);
    const table = stage.scene.getObjectByName('almanac') as Object3D;
    expect(first?.root.parent).toBeNull();
    expect(table.children.map((c) => c.name).sort()).toEqual(['almanac-pedestal', 'hotTopic@4']);
    almanac.close();
  });

  it('another director taking the stage takes the turntable out too', () => {
    const stage = fakeStage();
    const almanac = new AlmanacStage(stage);
    almanac.open('peashooter', 1);
    new TitleDemo(stage).show();
    expect(almanac.isOpen).toBe(false);
    expect(stage.scene.getObjectByName('almanac')).toBeUndefined();
    expect(almanac.current).toBeNull();
  });

  it("builds every unit's looks: five levels, one for a single-look model", () => {
    const stage = fakeStage();
    const almanac = new AlmanacStage(stage);
    almanac.open('peashooter', 1);
    for (const key of all) {
      const levels = levelsOf(getModelDef(key));
      expect(levels).toEqual(getModelDef(key).singleLevel ? [1] : [1, 2, 3, 4, 5]);
      for (const level of levels) {
        almanac.show(key, level);
        expect(almanac.current?.def.key).toBe(key);
        expect(almanac.current?.level).toBe(level);
        expect(almanac.current?.root.parent?.name).toBe('almanac');
      }
    }
    expect(levelsOf(getModelDef('boneMinion'))).toEqual([1]);
    // A level asked for a single-look model is its one look.
    almanac.show('boneMinion', 4);
    expect(almanac.current?.level).toBe(1);
    almanac.close();
  });

  it('play: the ability, else the shot, else the bite, then back to idle', () => {
    const stage = fakeStage();
    const almanac = new AlmanacStage(stage);
    for (const key of all) {
      almanac.open(key, 1);
      const def = getModelDef(key);
      const want = def.clips.ability ? 'ability' : def.clips.shoot ? 'shoot' : def.clips.melee ? 'melee' : null;
      expect(actionClip(def)).toBe(want);
      expect(almanac.play()).toBe(want);
      if (want === null) continue;
      expect(almanac.current?.clip).toBe(want);
      const seconds = (def.clips[want]?.duration ?? 0) + 1;
      for (let t = 0; t < seconds; t += 1 / 30) almanac.frame(0.5, 1 / 30, 1 / 30);
      expect(almanac.current?.clip).toBe('idle');
    }
    almanac.close();
  });

  it('turns slowly', () => {
    const stage = fakeStage();
    const almanac = new AlmanacStage(stage);
    almanac.open('cowboyZombie', 3);
    const table = stage.scene.getObjectByName('almanac');
    const a0 = table?.rotation.y ?? 0;
    for (let i = 0; i < 60; i++) almanac.frame(0.5, 1 / 60, 1 / 60);
    expect((table?.rotation.y ?? 0) - a0).toBeCloseTo(TURN_SPEED, 1);
    almanac.close();
  });
});

describe('the reveal framing (a level result\'s unlocked unit)', () => {
  it('frames the unit smaller than the Almanac does, the camera further back; the Almanac\'s own look is unchanged', () => {
    const stage = fakeStage();
    const t = new AlmanacStage(stage);
    const spy = vi.spyOn(stage.rig, 'frameSubject');
    t.open('potatoMine', 1);
    const almanac = stage.camera.position.clone();
    expect(spy.mock.calls.at(-1)?.[1]).toEqual({ pitchDeg: 14, side: 0.27, top: 0.1, bottom: 0.3 });
    t.close();
    t.open('potatoMine', 1, 'reveal');
    expect(spy.mock.calls.at(-1)?.[1]).toMatchObject({ side: 0.38 });
    expect(stage.camera.position.distanceTo({ x: 5, y: 0.36, z: 2.5 } as never))
      .toBeGreaterThan(almanac.distanceTo({ x: 5, y: 0.36, z: 2.5 } as never));
    expect(t.current?.def.key).toBe('potatoMine');
    t.close();
    t.open('potatoMine', 1);
    expect(spy.mock.calls.at(-1)?.[1]).toEqual({ pitchDeg: 14, side: 0.27, top: 0.1, bottom: 0.3 });
    t.close();
  });
});
