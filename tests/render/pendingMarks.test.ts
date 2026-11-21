import { BoxGeometry, BufferGeometry, Material, Mesh, MeshBasicMaterial, Object3D, Scene, Texture, Vector3 } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PendingMark } from '../../src/app/BattleController';
import { COLLAPSE_SECONDS, PendingMarks } from '../../src/render/battle/PendingMarks';
import { allocationsIn } from './allocations';
import type { UnitKey } from '../../src/sim/types';

// Live geometries, materials and textures, counted as worldLeak.test.ts does: Three.js gives each
// a uuid in its constructor, and a setter on the prototype sees every one made.
type Kind = 'geometries' | 'materials' | 'textures';
const KINDS: [Kind, { prototype: object }][] = [['geometries', BufferGeometry], ['materials', Material], ['textures', Texture]];
const created: Record<Kind, Set<object>> = { geometries: new Set(), materials: new Set(), textures: new Set() };
const disposed: Record<Kind, Set<object>> = { geometries: new Set(), materials: new Set(), textures: new Set() };
const undo: (() => void)[] = [];

beforeAll(() => {
  for (const [kind, type] of KINDS) {
    const proto = type.prototype as { dispose: () => void };
    const dispose = proto.dispose;
    proto.dispose = function (this: object) {
      disposed[kind].add(this);
      dispose.call(this);
    };
    Object.defineProperty(proto, 'uuid', {
      configurable: true,
      set(this: object, value: string) {
        created[kind].add(this);
        Object.defineProperty(this, 'uuid', { value, writable: true, configurable: true, enumerable: true });
      },
    });
    undo.push(() => {
      proto.dispose = dispose;
      delete (proto as { uuid?: string }).uuid;
    });
  }
});

afterAll(() => {
  for (const u of undo) u();
});

const live = (): Record<Kind, number> => ({
  geometries: [...created.geometries].filter((g) => !disposed.geometries.has(g)).length,
  materials: [...created.materials].filter((m) => !disposed.materials.has(m)).length,
  textures: [...created.textures].filter((t) => !disposed.textures.has(t)).length,
});

const mark = (over: Partial<PendingMark> = {}): PendingMark => ({
  id: 1, faction: 'plants', lane: 2, col: 3, unit: 'peashooter', spell: null, refused: false, ...over,
});

/** The card ghosts the view would hand out: one shared box, one per call, recorded. */
const ghostGeometry = new BoxGeometry(0.5, 0.5, 0.5);
const ghostMaterial = new MeshBasicMaterial();
function setup() {
  const scene = new Scene();
  const ghosts: { unit: UnitKey; object: Object3D }[] = [];
  const marks = new PendingMarks(scene, (unit) => {
    const object = new Mesh(ghostGeometry, ghostMaterial);
    object.name = `ghost-${unit}`;
    ghosts.push({ unit, object });
    return object;
  });
  return { scene, marks, ghosts };
}

function named(scene: Scene, name: string): Object3D[] {
  const out: Object3D[] = [];
  scene.traverse((o) => { if (o.name === name) out.push(o); });
  return out;
}

const worldOf = (o: Object3D): Vector3 => {
  o.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(o.matrixWorld);
};

describe('PendingMarks', () => {
  it('a plant mark sprouts a leaf puff and the card\'s ghost at the middle of its tile', () => {
    const { scene, marks, ghosts } = setup();
    marks.set([mark()]);
    const puffs = named(scene, 'pending-puff');
    expect(puffs).toHaveLength(1);
    expect(named(scene, 'pending-crack')).toHaveLength(0);
    expect(ghosts.map((g) => g.unit)).toEqual(['peashooter']);
    const ghost = ghosts[0]!.object;
    expect(ghost.parent).not.toBeNull();
    for (const o of [puffs[0]!, ghost]) {
      const at = worldOf(o);
      expect(at.x).toBeCloseTo(3.5);
      expect(at.z).toBeCloseTo(2.5);
      expect(at.y).toBeCloseTo(0);
    }
    // drawn on: the same mark again makes nothing new, and the puff moves (it sprouts)
    marks.set([mark()]);
    expect(ghosts).toHaveLength(1);
    const before = puffs[0]!.scale.y;
    marks.frame(0.1);
    expect(puffs[0]!.scale.y).not.toBe(before);
  });

  it('a zombie mark cracks the earth, with the card\'s ghost, at its tile', () => {
    const { scene, marks, ghosts } = setup();
    marks.set([mark({ id: 4, faction: 'zombies', lane: 1, col: 9, unit: 'brainEater' })]);
    const cracks = named(scene, 'pending-crack');
    expect(cracks).toHaveLength(1);
    expect(named(scene, 'pending-puff')).toHaveLength(0);
    expect(ghosts.map((g) => g.unit)).toEqual(['brainEater']);
    const at = worldOf(cracks[0]!);
    expect(at.x).toBeCloseTo(9.5);
    expect(at.z).toBeCloseTo(1.5);
  });

  it('a spell or hero mark shows nothing here (their aim shows with the sim)', () => {
    const { scene, marks, ghosts } = setup();
    marks.set([mark({ unit: null, spell: 'meteor' }), mark({ id: 2, unit: null })]);
    expect(named(scene, 'pending-puff')).toHaveLength(0);
    expect(ghosts).toHaveLength(0);
    expect(marks.shown).toBe(0);
  });

  it('a mark leaving the list takes its puff and ghost with it; the others stay', () => {
    const { scene, marks, ghosts } = setup();
    marks.set([mark(), mark({ id: 2, col: 5 })]);
    expect(named(scene, 'pending-puff')).toHaveLength(2);
    marks.set([mark({ id: 2, col: 5 })]);
    expect(named(scene, 'pending-puff')).toHaveLength(1);
    expect(ghosts[0]!.object.parent?.parent ?? null).toBeNull();
    expect(worldOf(named(scene, 'pending-puff')[0]!).x).toBeCloseTo(5.5);
    marks.set([]);
    expect(named(scene, 'pending-puff')).toHaveLength(0);
    expect(marks.shown).toBe(0);
  });

  it('a refused mark collapses over 600 ms of frames, then goes, and is not drawn again while still listed', () => {
    const { scene, marks, ghosts } = setup();
    expect(COLLAPSE_SECONDS).toBe(0.6);
    marks.set([mark()]);
    marks.frame(0.2);
    const refused = mark({ refused: true });
    marks.set([refused]);
    const puff = named(scene, 'pending-puff')[0]!;
    const group = puff.parent!;
    const full = group.scale.x;
    marks.frame(0.3);
    expect(named(scene, 'pending-puff')).toHaveLength(1);
    expect(group.scale.x).toBeLessThan(full);
    expect(group.scale.x).toBeGreaterThan(0);
    marks.frame(0.29);
    expect(named(scene, 'pending-puff')).toHaveLength(1);
    marks.frame(0.02);
    expect(named(scene, 'pending-puff')).toHaveLength(0);
    expect(ghosts[0]!.object.parent?.parent ?? null).toBeNull();
    // the controller still lists it for a few more steps: nothing comes back
    marks.set([refused]);
    marks.frame(0.1);
    expect(named(scene, 'pending-puff')).toHaveLength(0);
    expect(ghosts).toHaveLength(1);
  });

  it('a refused mark keeps collapsing after the list drops it, and one first seen refused collapses too', () => {
    const { scene, marks } = setup();
    marks.set([mark()]);
    marks.set([mark({ refused: true })]);
    marks.set([]); // the steps ran out before the frames did
    expect(named(scene, 'pending-puff')).toHaveLength(1);
    marks.frame(COLLAPSE_SECONDS + 0.01);
    expect(named(scene, 'pending-puff')).toHaveLength(0);
    marks.set([mark({ id: 9, refused: true })]);
    expect(named(scene, 'pending-puff')).toHaveLength(1);
    marks.frame(COLLAPSE_SECONDS + 0.01);
    expect(named(scene, 'pending-puff')).toHaveLength(0);
  });

  it('a frame allocates nothing, with marks breathing and one collapsing away', () => {
    const { marks } = setup();
    marks.set([mark(), mark({ id: 2, col: 4 }), mark({ id: 3, faction: 'zombies', lane: 0, col: 9, unit: 'brainEater' })]);
    marks.set([mark(), mark({ id: 2, col: 4, refused: true }), mark({ id: 3, faction: 'zombies', lane: 0, col: 9, unit: 'brainEater' })]);
    expect(allocationsIn(() => { for (let i = 0; i < 60; i++) marks.frame(1 / 60); })).toEqual({});
    expect(marks.shown).toBe(2);
  });

  it('dispose leaves the scene and the live geometry and material counts where they started', () => {
    const start = live();
    const { scene, marks } = setup();
    marks.set([mark(), mark({ id: 2, col: 4 }), mark({ id: 3, faction: 'zombies', lane: 0, col: 9, unit: 'brainEater' })]);
    marks.frame(0.1);
    marks.set([mark({ id: 2, col: 4, refused: true }), mark({ id: 3, faction: 'zombies', lane: 0, col: 9, unit: 'brainEater' })]);
    marks.frame(0.1);
    expect(live().geometries).toBeGreaterThan(start.geometries);
    marks.dispose();
    expect(live()).toEqual(start);
    expect(named(scene, 'pending-puff')).toHaveLength(0);
    expect(named(scene, 'pending-crack')).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    marks.dispose(); // twice is fine
    marks.set([mark()]); // and a late set draws nothing
    expect(scene.children).toHaveLength(0);
  });
});
