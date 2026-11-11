import { Box3, Color, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Lawn } from '../../src/render/world/Lawn';

const lawn = new Lawn();

function mesh(name: string, from: Lawn = lawn): Mesh {
  const found = from.group.getObjectByName(name);
  if (!(found instanceof Mesh)) throw new Error(`no mesh named ${name}`);
  return found;
}

/** Every vertex of a mesh in world space; instanced meshes give every instance's copy. */
function worldVertices(target: Mesh): Vector3[] {
  target.updateMatrixWorld(true);
  const position = target.geometry.getAttribute('position');
  const matrices: Matrix4[] = [];
  if (target instanceof InstancedMesh) {
    for (let i = 0; i < target.count; i++) {
      const m = new Matrix4();
      target.getMatrixAt(i, m);
      matrices.push(m.premultiply(target.matrixWorld));
    }
  } else {
    matrices.push(target.matrixWorld);
  }
  const out: Vector3[] = [];
  for (const matrix of matrices) {
    for (let i = 0; i < position.count; i++) out.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix));
  }
  return out;
}

/** Colour of the island's top face at a point (the nearest top-face vertex). */
function groundColorAt(x: number, z: number): Color {
  const island = mesh('island');
  const position = island.geometry.getAttribute('position');
  const normal = island.geometry.getAttribute('normal');
  const color = island.geometry.getAttribute('color');
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < position.count; i++) {
    if (normal.getY(i) < 0.5 || position.getY(i) !== 0) continue;
    const d = Math.hypot(position.getX(i) - x, position.getZ(i) - z);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  expect(bestDistance).toBeLessThan(0.2);
  return new Color().fromBufferAttribute(color, best);
}

describe('Lawn', () => {
  it('is solid, flat ground under the lawn and both bases', () => {
    const box = new Box3().setFromObject(mesh('island'));
    expect(box.max.y).toBe(0);
    expect(box.min.x).toBeLessThanOrEqual(-1.9);
    expect(box.max.x).toBeGreaterThanOrEqual(11.9);
    expect(box.min.z).toBeLessThanOrEqual(-0.3);
    expect(box.max.z).toBeGreaterThanOrEqual(5.3);
    // No holes: there is ground at every quarter tile of the lawn and the base pads.
    for (let x = -1.8; x <= 11.8; x += 0.25) {
      for (let z = -0.2; z <= 5.2; z += 0.25) groundColorAt(x, z);
    }
  });

  it('hangs well below its surface, so it reads as a floating island', () => {
    const box = new Box3().setFromObject(mesh('island'));
    expect(box.min.y).toBeLessThan(-2);
  });

  it('paints columns 0 to 7 as a green checker and columns 8 and 9 as the graveyard strip', () => {
    for (let lane = 0; lane < 5; lane++) {
      for (let col = 0; col < 10; col++) {
        // A little off the centre, clear of the creases along tile edges.
        const c = groundColorAt(col + 0.4, lane + 0.4);
        if (col < 8) expect(c.g).toBeGreaterThan(c.b * 2);
        else expect(c.b).toBeGreaterThan(c.g);
      }
    }
    const brightness = (c: Color): number => c.r + c.g + c.b;
    for (const [lane, col] of [[0, 0], [2, 4], [4, 8]] as const) {
      const here = brightness(groundColorAt(col + 0.4, lane + 0.4));
      const right = brightness(groundColorAt(col + 1.4, lane + 0.4));
      const below = brightness(groundColorAt(col + 0.4, lane === 4 ? lane - 0.6 : lane + 1.4));
      expect(Math.abs(here - right)).toBeGreaterThan(0.02);
      expect(Math.abs(here - below)).toBeGreaterThan(0.02);
    }
  });

  it('marks lane edges with a darker crease', () => {
    const brightness = (c: Color): number => c.r + c.g + c.b;
    const inTile = brightness(groundColorAt(3.5, 1.5));
    const onEdge = brightness(groundColorAt(3.5, 2));
    expect(onEdge).toBeLessThan(inTile * 0.85);
  });

  it('keeps everything on the playable tiles under a quarter of a tile high', () => {
    let checked = 0;
    for (const name of ['props', 'crystals', 'grass']) {
      for (const v of worldVertices(mesh(name))) {
        if (v.x > 0 && v.x < 10 && v.z > 0 && v.z < 5) {
          expect(v.y).toBeLessThanOrEqual(0.25);
          checked++;
        }
      }
    }
    // The test means something only if there are things on the tiles to check.
    expect(checked).toBeGreaterThan(1000);
  });

  it('keeps the two base pads clear for the bases', () => {
    for (const name of ['props', 'crystals', 'grass']) {
      for (const v of worldVertices(mesh(name))) {
        const onPad = (v.x > -1.7 && v.x < -0.1) || (v.x > 10.1 && v.x < 11.7);
        if (onPad && v.z > 0.05 && v.z < 4.95) expect(v.y).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('puts garden things at the plant end and graveyard things at the zombie end', () => {
    const props = worldVertices(mesh('props'));
    const tallLeft = props.filter((v) => v.y > 0.3 && v.x < 8).length;
    const tallRight = props.filter((v) => v.y > 0.3 && v.x > 8).length;
    expect(tallLeft).toBeGreaterThan(0);
    expect(tallRight).toBeGreaterThan(0);
    // Crystals belong to Toby.
    for (const v of worldVertices(mesh('crystals'))) expect(v.x).toBeGreaterThan(8);
  });

  it('highlights one tile and clears it again', () => {
    const fresh = new Lawn();
    const mark = mesh('tile-mark', fresh);
    expect(mark.visible).toBe(false);

    fresh.highlightTile(2, 3, 'ok');
    expect(mark.visible).toBe(true);
    expect(mark.position.x).toBe(3.5);
    expect(mark.position.z).toBe(2.5);
    expect(mark.position.y).toBeGreaterThan(0);
    expect(mark.position.y).toBeLessThan(0.05);

    fresh.highlightTile(4, 9, 'bad');
    expect(mark.visible).toBe(true);
    expect(mark.position.x).toBe(9.5);
    expect(mark.position.z).toBe(4.5);

    fresh.highlightTile(4, 9, null);
    expect(mark.visible).toBe(false);
  });

  it('highlights a whole lane and clears it again', () => {
    const fresh = new Lawn();
    const mark = mesh('lane-mark', fresh);
    expect(mark.visible).toBe(false);

    fresh.highlightLane(1, 'ok');
    expect(mark.visible).toBe(true);
    const box = new Box3().setFromObject(mark);
    expect(box.min.x).toBeCloseTo(0, 6);
    expect(box.max.x).toBeCloseTo(10, 6);
    expect(box.min.z).toBeCloseTo(1, 6);
    expect(box.max.z).toBeCloseTo(2, 6);

    fresh.highlightLane(null, 'ok');
    expect(mark.visible).toBe(false);
  });

  it('ignores highlights that are off the lawn instead of drawing them somewhere odd', () => {
    const fresh = new Lawn();
    for (const [lane, col] of [[-1, 0], [5, 0], [0, -1], [0, 10], [Number.NaN, 2]] as const) {
      fresh.highlightTile(2, 2, 'ok');
      fresh.highlightTile(lane, col, 'ok');
      expect(mesh('tile-mark', fresh).visible).toBe(false);
    }
    fresh.highlightLane(2, 'ok');
    fresh.highlightLane(7, 'bad');
    expect(mesh('lane-mark', fresh).visible).toBe(false);
  });

  it('builds the same island every time', () => {
    const other = new Lawn();
    for (const name of ['island', 'props', 'crystals']) {
      const a = mesh(name).geometry.getAttribute('position').array;
      const b = mesh(name, other).geometry.getAttribute('position').array;
      expect(a.length).toBe(b.length);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });

  it('moves with time without moving the ground', () => {
    const fresh = new Lawn();
    const islet = fresh.group.getObjectByName('islet') as Mesh;
    fresh.update(0);
    const before = islet.position.y;
    fresh.update(2);
    expect(islet.position.y).not.toBe(before);
    expect(mesh('island', fresh).position.toArray()).toEqual([0, 0, 0]);
    // The same time always gives the same picture (frozen-time screenshots rely on it).
    fresh.update(0);
    expect(islet.position.y).toBe(before);
  });
});
