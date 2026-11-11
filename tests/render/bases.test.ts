import { Box3, Mesh, type Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLANT_BASE_X, ZOMBIE_BASE_X } from '../../src/render/coords';
import { BaseView } from '../../src/render/models/bases';
import { makeGravestone, makeProjectile, makeToken } from '../../src/render/models/props';
import type { Faction } from '../../src/render/types';

const SIDES: [Faction, readonly [number, number]][] = [
  ['plants', PLANT_BASE_X],
  ['zombies', ZOMBIE_BASE_X],
];

function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** The box round every mesh that is on screen. */
function visibleBox(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !shown(object)) return;
    object.geometry.computeBoundingBox();
    box.union((object.geometry.boundingBox as Box3).clone().applyMatrix4(object.matrixWorld));
  });
  return box;
}

/** Boxes on screen: each base mesh records how many boxes it was built from. */
function visibleBoxes(root: Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof Mesh && shown(object)) count += (object.userData.boxes as number | undefined) ?? 0;
  });
  return count;
}

function triangles(root: Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof Mesh && shown(object)) count += (object.geometry.index?.count ?? 0) / 3;
  });
  return count;
}

describe.each(SIDES)('the %s base', (side, [x0, x1]) => {
  it('stands on its own strip beside the lawn, across all five lanes, at most 2.4 tall', () => {
    const base = new BaseView(side);
    for (const health of [1, 0.6, 0.3, 0.1]) {
      base.setHealth(health);
      const box = visibleBox(base.group);
      expect(box.min.x, `health ${health}`).toBeGreaterThanOrEqual(x0 - 1e-6);
      expect(box.max.x, `health ${health}`).toBeLessThanOrEqual(x1 + 1e-6);
      expect(box.min.z, `health ${health}`).toBeGreaterThanOrEqual(-1e-6);
      expect(box.max.z, `health ${health}`).toBeLessThanOrEqual(5 + 1e-6);
      expect(box.max.y, `health ${health}`).toBeLessThanOrEqual(2.4 + 1e-6);
      // It spans the lanes rather than standing in one corner.
      expect(box.max.z - box.min.z).toBeGreaterThan(4.5);
    }
  });

  it('shows four damage states, each with fewer boxes than the one before', () => {
    const base = new BaseView(side);
    const counts = [1, 0.6, 0.3, 0.1].map((health) => {
      base.setHealth(health);
      return visibleBoxes(base.group);
    });
    expect(new Set(counts).size).toBe(4);
    for (let i = 1; i < counts.length; i++) expect(counts[i] as number).toBeLessThan(counts[i - 1] as number);
  });

  it('stays under about 6,000 triangles in every state', () => {
    const base = new BaseView(side);
    for (const health of [1, 0.6, 0.3, 0.1]) {
      base.setHealth(health);
      expect(triangles(base.group), `health ${health}`).toBeLessThan(6000);
    }
  });

  it('smokes only once it is hurt, from points on the base', () => {
    const base = new BaseView(side);
    base.setHealth(1);
    expect(base.smokeAnchors()).toEqual([]);
    base.setHealth(0.3);
    const anchors = base.smokeAnchors();
    expect(anchors.length).toBeGreaterThan(0);
    for (const p of anchors) {
      expect(p.x).toBeGreaterThanOrEqual(x0 - 0.3);
      expect(p.x).toBeLessThanOrEqual(x1 + 0.3);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThanOrEqual(5);
    }
    base.setHealth(0.1);
    expect(base.smokeAnchors().length).toBeGreaterThanOrEqual(anchors.length);
  });

  it('shudders when hit and settles back where it stood', () => {
    const base = new BaseView(side);
    base.group.updateMatrixWorld(true);
    const before = visibleBox(base.group);
    base.hit(2);
    let moved = false;
    for (let i = 0; i < 6; i++) {
      base.update(1 / 60, i / 60);
      if (!visibleBox(base.group).equals(before)) moved = true;
    }
    expect(moved).toBe(true);
    for (let i = 0; i < 60; i++) base.update(1 / 60, 0.1 + i / 60);
    const after = visibleBox(base.group);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
  });

  it('collapses over 1.6 seconds of updates and then resolves', async () => {
    const base = new BaseView(side);
    base.setHealth(0.1);
    let done = false;
    const collapsing = base.collapse().then(() => (done = true));
    for (let i = 0; i < 60; i++) base.update(1 / 60, i / 60);
    await Promise.resolve();
    expect(done).toBe(false);
    for (let i = 0; i < 60; i++) base.update(1 / 60, 1 + i / 60);
    await collapsing;
    expect(done).toBe(true);
  });
});

describe.each(SIDES)('the %s base, when nothing updates it', (side) => {
  afterEach(() => vi.useRealTimers());

  it('still falls by the clock: ruins shown, base gone, promise kept', async () => {
    vi.useFakeTimers();
    const base = new BaseView(side);
    let done = false;
    const collapsing = base.collapse().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    await collapsing;
    expect(done).toBe(true);
    expect((base.group.getObjectByName('ruins') as Object3D).visible).toBe(true);
    expect((base.group.getObjectByName('state-0') as Object3D).parent?.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when it falls on time or is thrown away', async () => {
    vi.useFakeTimers();
    const falling = new BaseView(side);
    const fell = falling.collapse();
    for (let i = 0; i < 120; i++) falling.update(1 / 60, i / 60);
    await fell;
    expect(vi.getTimerCount()).toBe(0);
    const dropped = new BaseView(side);
    void dropped.collapse();
    dropped.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shrinks its debris away after it settles, so only the ruins stay', () => {
    const base = new BaseView(side);
    void base.collapse();
    for (let i = 0; i < 60 * 5; i++) base.update(1 / 60, i / 60);
    expect((base.group.getObjectByName('base-debris') as Object3D).visible).toBe(false);
    expect((base.group.getObjectByName('ruins') as Object3D).visible).toBe(true);
  });
});

describe('the plant base', () => {
  it('swats towards a lane for a quarter of a second, reaching out over the lawn', () => {
    const base = new BaseView('plants');
    const rest = visibleBox(base.group).max.x;
    base.strike(3);
    let reach = -Infinity;
    for (let i = 0; i < 15; i++) {
      base.update(1 / 60, i / 60);
      reach = Math.max(reach, visibleBox(base.group).max.x);
    }
    expect(reach).toBeGreaterThan(0.2);
    for (let i = 0; i < 30; i++) base.update(1 / 60, 0.25 + i / 60);
    expect(visibleBox(base.group).max.x).toBeCloseTo(rest, 6);
  });
});

describe('props', () => {
  it('makes peas and brains of the sizes the art bible asks for', () => {
    const size = (kind: 'pea' | 'brain'): number => {
      const box = new Box3().setFromObject(makeProjectile(kind));
      return Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    };
    expect(size('pea')).toBeCloseTo(0.22, 2);
    expect(size('brain')).toBeCloseTo(0.26, 2);
  });

  it('makes glowing tokens and the gravestone', () => {
    for (const kind of ['sun', 'brain'] as const) {
      const token = makeToken(kind);
      let glow = 0;
      token.traverse((o) => {
        if (o instanceof Mesh) glow = Math.max(glow, (o.material as { emissiveIntensity?: number }).emissiveIntensity ?? 0);
      });
      expect(glow, kind).toBeGreaterThanOrEqual(1.5);
    }
    expect(makeGravestone().name).toBe('gravestone');
  });
});
