import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { StatusMarks } from '../../src/render/battle/StatusMarks';
import type { StatusKind } from '../../src/render/types';

const ALL: StatusKind[] = ['stun', 'blind', 'tied', 'poison', 'burn', 'haste'];

/** A stand-in unit: a box one tile tall standing on its origin. */
function unit(x = 3, z = 2.5, height = 1): Object3D {
  const root = new Object3D();
  const body = new Mesh(new BoxGeometry(0.6, height, 0.5), new MeshBasicMaterial());
  body.position.y = height / 2;
  root.add(body);
  root.position.set(x, 0, z);
  root.updateMatrixWorld(true);
  return root;
}

function visibleMarks(marks: StatusMarks): Object3D[] {
  return marks.group.children.filter((o) => o.visible);
}

function maxGlow(root: Object3D): number {
  let glow = 0;
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as Material & { emissiveIntensity?: number; emissive?: { getHex(): number } };
    if (m.emissive && m.emissive.getHex() !== 0) glow = Math.max(glow, m.emissiveIntensity ?? 0);
  });
  return glow;
}

describe('StatusMarks', () => {
  it('shows a mark when a status starts and hides it when it ends', () => {
    const marks = new StatusMarks();
    const a = unit();
    for (const status of ALL) {
      marks.set(1, a, status, true);
      marks.update(1 / 60);
      expect(marks.has(1, status), status).toBe(true);
      expect(visibleMarks(marks), status).toHaveLength(1);
      marks.set(1, a, status, false);
      marks.update(1 / 60);
      expect(marks.has(1, status), status).toBe(false);
      expect(visibleMarks(marks), status).toHaveLength(0);
    }
    expect(marks.active).toBe(0);
  });

  it('keeps one mark per unit and status, however often the status is applied', () => {
    const marks = new StatusMarks();
    const a = unit();
    marks.set(1, a, 'poison', true);
    marks.set(1, a, 'poison', true);
    marks.set(1, a, 'burn', true);
    marks.set(2, unit(5), 'poison', true);
    expect(marks.active).toBe(3);
    // Turning off a status that is not on is harmless.
    marks.set(3, a, 'stun', false);
    expect(marks.active).toBe(3);
  });

  it('is pooled: the group never grows, and every mark goes back to the pool', () => {
    const marks = new StatusMarks(8);
    const size = marks.group.children.length;
    const a = unit();
    for (let round = 0; round < 5; round++) {
      for (let id = 0; id < 20; id++) for (const status of ALL) marks.set(id, a, status, true);
      marks.update(1 / 60);
      expect(marks.group.children.length).toBe(size);
      for (let id = 0; id < 20; id++) for (const status of ALL) marks.set(id, a, status, false);
    }
    expect(marks.active).toBe(0);
    expect(marks.free).toBe(8 * ALL.length);
  });

  it('forgets every mark of a unit at once (a unit that died)', () => {
    const marks = new StatusMarks();
    const a = unit();
    for (const status of ALL) marks.set(7, a, status, true);
    marks.set(8, unit(6), 'stun', true);
    marks.forget(7);
    expect(marks.active).toBe(1);
    expect(marks.has(8, 'stun')).toBe(true);
  });

  it('follows its unit as it walks', () => {
    const marks = new StatusMarks();
    const a = unit(3);
    marks.set(1, a, 'tied', true);
    marks.update(1 / 60);
    const mark = visibleMarks(marks)[0]!;
    const before = mark.position.x;
    a.position.x = 4.5;
    a.updateMatrixWorld(true);
    marks.update(1 / 60);
    expect(mark.position.x - before).toBeCloseTo(1.5, 5);
  });

  it('circles the stun stars round the head', () => {
    const marks = new StatusMarks();
    marks.set(1, unit(), 'stun', true);
    marks.update(1 / 60);
    const star = visibleMarks(marks)[0]!.children[0]!;
    star.updateMatrixWorld(true);
    const p0 = star.getWorldPosition(new Vector3());
    marks.update(0.25);
    star.updateMatrixWorld(true);
    const p1 = star.getWorldPosition(new Vector3());
    expect(p0.distanceTo(p1)).toBeGreaterThan(0.05);
  });

  it('makes the glowing marks bright enough to bloom (emissive at least 1.5)', () => {
    const marks = new StatusMarks();
    const a = unit();
    for (const status of ['stun', 'poison', 'burn', 'haste'] as const) {
      marks.set(1, a, status, true);
      marks.update(1 / 60);
      expect(maxGlow(visibleMarks(marks)[0]!), status).toBeGreaterThanOrEqual(1.5);
      marks.set(1, a, status, false);
    }
  });

  it('keeps every mark under the health bar, which sits 0.14 above the top of the unit', () => {
    const marks = new StatusMarks();
    for (const height of [0.8, 1, 1.34]) {
      const a = unit(3, 2.5, height);
      for (const status of ALL) {
        marks.set(1, a, status, true);
        for (let i = 0; i < 30; i++) marks.update(1 / 30);
        const mark = visibleMarks(marks)[0]!;
        mark.updateMatrixWorld(true);
        const box = new Box3().setFromObject(mark);
        expect(box.max.y, `${status} at height ${height}`).toBeLessThanOrEqual(height + 0.1);
        marks.set(1, a, status, false);
      }
    }
  });

  it('puts the haste streaks behind a zombie (towards +X), since zombies walk to −X', () => {
    const marks = new StatusMarks();
    const a = unit(5);
    marks.set(1, a, 'haste', true);
    marks.update(1 / 60);
    const mark = visibleMarks(marks)[0]!;
    mark.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mark);
    expect((box.min.x + box.max.x) / 2).toBeGreaterThan(5.2);
  });

  it('clears everything at once', () => {
    const marks = new StatusMarks();
    for (const status of ALL) marks.set(1, unit(), status, true);
    marks.clear();
    expect(marks.active).toBe(0);
    expect(visibleMarks(marks)).toHaveLength(0);
  });
});
