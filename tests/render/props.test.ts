import { Box3, BufferAttribute, Color, Mesh, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BOLT_HEIGHT,
  LOB_STEP,
  PROJECTILE_SIZE,
  PROJECTILE_TRAIL,
  PROJECTILE_TUMBLE,
  ROCK_STAGES,
  lobHeight,
  makeBolt,
  makeBone,
  makeFogBlock,
  makeGravestone,
  makeMegaMower,
  makeMeteor,
  makeProjectile,
  makeRock,
  makeVine,
  rockStage,
} from '../../src/render/models/props';
import type { ProjectileKind } from '../../src/render/types';

const KINDS: ProjectileKind[] = ['pea', 'brain', 'kernel', 'butter', 'mango', 'sand', 'arrow', 'bullet', 'trident', 'rot'];

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

function triangles(root: Object3D): number {
  let n = 0;
  for (const mesh of meshes(root)) {
    const g = mesh.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  }
  return n;
}

function maxGlow(root: Object3D): number {
  let glow = 0;
  for (const mesh of meshes(root)) {
    const m = mesh.material as Material & { emissiveIntensity?: number; emissive?: Color };
    if (m.emissive && m.emissive.getHex() !== 0) glow = Math.max(glow, m.emissiveIntensity ?? 0);
  }
  return glow;
}

/** The average vertex colour over every mesh, weighted by vertex. */
function meanColor(root: Object3D): Color {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const mesh of meshes(root)) {
    const c = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
    if (!c) continue;
    for (let i = 0; i < c.count; i++) {
      r += c.getX(i);
      g += c.getY(i);
      b += c.getZ(i);
      n++;
    }
  }
  return new Color(r / n, g / n, b / n);
}

function extent(root: Object3D): [number, number, number] {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
}

describe('projectiles', () => {
  it('has a size for all ten kinds, each at least 0.2 tile (art bible section 6)', () => {
    expect(Object.keys(PROJECTILE_SIZE).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) expect(PROJECTILE_SIZE[kind], kind).toBeGreaterThanOrEqual(0.2);
  });

  it('makes every kind at its size: its longest edge is PROJECTILE_SIZE', () => {
    for (const kind of KINDS) {
      const longest = Math.max(...extent(makeProjectile(kind)));
      expect(longest, kind).toBeGreaterThanOrEqual(0.2);
      // At its stated size at the least (float slack only), and not much over it.
      expect(longest, kind).toBeGreaterThanOrEqual(PROJECTILE_SIZE[kind] - 1e-6);
      expect(longest, kind).toBeLessThanOrEqual(PROJECTILE_SIZE[kind] + 0.06);
    }
  });

  it('gives each kind its own shape or colour, so no two read alike from the lawn camera', () => {
    const looks = KINDS.map((kind) => ({ kind, size: extent(makeProjectile(kind)), color: meanColor(makeProjectile(kind)) }));
    for (let i = 0; i < looks.length; i++) {
      for (let j = i + 1; j < looks.length; j++) {
        const a = looks[i]!;
        const b = looks[j]!;
        const shape = Math.max(...a.size.map((v, k) => Math.abs(v - (b.size[k] as number))));
        const colour = Math.hypot(a.color.r - b.color.r, a.color.g - b.color.g, a.color.b - b.color.b);
        expect(shape > 0.05 || colour > 0.12, `${a.kind} v ${b.kind}: shape ${shape.toFixed(3)}, colour ${colour.toFixed(3)}`).toBe(true);
      }
    }
  });

  it('shares one geometry between copies of a kind', () => {
    for (const kind of KINDS) {
      const a = meshes(makeProjectile(kind)).map((m) => m.geometry);
      const b = meshes(makeProjectile(kind)).map((m) => m.geometry);
      expect(a, kind).toEqual(b);
    }
  });

  it('has a trail colour and a tumble rate for every kind', () => {
    for (const kind of KINDS) {
      expect(typeof PROJECTILE_TRAIL[kind], kind).toBe('number');
      expect(PROJECTILE_TUMBLE[kind], kind).toBeGreaterThanOrEqual(0);
    }
    // The mango tumbles (plan Task 5); arrows, bullets and tridents fly point first.
    expect(PROJECTILE_TUMBLE.mango).toBeGreaterThan(0);
    expect(PROJECTILE_TUMBLE.arrow).toBe(0);
    expect(PROJECTILE_TUMBLE.trident).toBe(0);
  });

  it('makes a burning pea that glows orange (emissive at least 1.5)', () => {
    const plain = makeProjectile('pea');
    const burning = makeProjectile('pea', true);
    expect(maxGlow(plain)).toBe(0);
    expect(maxGlow(burning)).toBeGreaterThanOrEqual(1.5);
    const c = meanColor(burning);
    // Orange: red high, green middling, blue low.
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.g).toBeGreaterThan(c.b);
    expect(Math.max(...extent(burning))).toBeGreaterThanOrEqual(0.2);
  });

  it('ignores `burning` on anything but a pea', () => {
    expect(maxGlow(makeProjectile('kernel', true))).toBe(0);
  });
});

describe('lobHeight', () => {
  it('starts and ends on the ground', () => {
    for (const d of [1, 3, 6, 10]) {
      expect(lobHeight(d, 0)).toBe(0);
      expect(lobHeight(d, 1)).toBe(0);
    }
  });

  it('rises to a peak at the middle that grows with the distance', () => {
    expect(lobHeight(6, 0.5)).toBeGreaterThan(lobHeight(2, 0.5));
    expect(lobHeight(10, 0.5)).toBeGreaterThanOrEqual(lobHeight(6, 0.5));
    expect(lobHeight(1, 0.5)).toBeGreaterThan(0);
  });

  it('is stepped: every height is a whole number of steps, rising then falling', () => {
    let last = 0;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const h = lobHeight(5, t);
      expect(Math.abs(h / LOB_STEP - Math.round(h / LOB_STEP))).toBeLessThan(1e-9);
      if (t <= 0.5) expect(h).toBeGreaterThanOrEqual(last);
      else expect(h).toBeLessThanOrEqual(last);
      last = h;
    }
  });

  it('clamps t outside 0..1 to the ground', () => {
    expect(lobHeight(5, -0.2)).toBe(0);
    expect(lobHeight(5, 1.3)).toBe(0);
  });
});

describe('spell and hero props', () => {
  it('builds the Mega Mower in at most 3,000 triangles, with wheels to spin', () => {
    const mower = makeMegaMower();
    expect(triangles(mower)).toBeLessThanOrEqual(3000);
    expect(triangles(mower)).toBeGreaterThan(300);
    expect(meshes(mower).filter((m) => m.name === 'mower-wheel').length).toBeGreaterThanOrEqual(2);
    // Giant: longer than a tile, and as wide as a lane.
    const [x, , z] = extent(mower);
    expect(x).toBeGreaterThan(1);
    expect(z).toBeGreaterThan(0.6);
    expect(z).toBeLessThanOrEqual(1);
  });

  it('builds the rock in three damage looks, each at most 800 triangles', () => {
    expect(ROCK_STAGES).toBe(3);
    const counts = [0, 1, 2].map((s) => triangles(makeRock(s as 0 | 1 | 2)));
    for (const n of counts) expect(n).toBeLessThanOrEqual(800);
    const geometries = [0, 1, 2].map((s) => meshes(makeRock(s as 0 | 1 | 2))[0]!.geometry);
    expect(new Set(geometries).size).toBe(3);
  });

  it('picks the rock look from its health', () => {
    expect(rockStage(1)).toBe(0);
    expect(rockStage(0.7)).toBe(0);
    expect(rockStage(0.5)).toBe(1);
    expect(rockStage(0.3)).toBe(2);
    expect(rockStage(0)).toBe(2);
  });

  it('makes a meteor with glowing cracks and lightning that glows', () => {
    expect(maxGlow(makeMeteor())).toBeGreaterThanOrEqual(1.5);
    for (const side of ['plants', 'zombies'] as const) {
      const bolt = makeBolt(side);
      expect(maxGlow(bolt), side).toBeGreaterThanOrEqual(1.5);
      expect(extent(bolt)[1], side).toBeCloseTo(BOLT_HEIGHT, 1);
    }
    // Lukas's bolt is yellow, Toby's is violet.
    const plants = meanColor(makeBolt('plants'));
    const zombies = meanColor(makeBolt('zombies'));
    expect(plants.g).toBeGreaterThan(plants.b);
    expect(zombies.b).toBeGreaterThan(zombies.g);
  });

  it('makes a bone, a vine and a fog block big enough to read', () => {
    expect(Math.max(...extent(makeBone()))).toBeGreaterThanOrEqual(0.3);
    expect(extent(makeVine())[1]).toBeGreaterThanOrEqual(0.3);
    expect(Math.min(...extent(makeFogBlock()))).toBeGreaterThanOrEqual(0.3);
    expect(makeGravestone().name).toBe('gravestone');
  });
});
