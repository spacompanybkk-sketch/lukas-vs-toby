import { BufferGeometry, Color, Float32BufferAttribute, Matrix3, Matrix4, Vector3, type ColorRepresentation } from 'three';

type Vec3 = readonly [number, number, number];

const colorCache = new Map<ColorRepresentation, Color>();

/** A shared, read-only Color for a hex value (converted to the linear working space once). */
export function paint(color: ColorRepresentation): Color {
  if (color instanceof Color) return color;
  let cached = colorCache.get(color);
  if (!cached) {
    cached = new Color(color);
    colorCache.set(color, cached);
  }
  return cached;
}

/** A new colour: `color` made lighter (positive) or darker (negative) by `amount` of HSL lightness. */
export function shade(color: ColorRepresentation, amount: number): Color {
  return paint(color).clone().offsetHSL(0, 0, amount);
}

/** Small seeded random number generator (mulberry32), so the world is the same on every load. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Repeatable 0..1 value for a grid point. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 0..1 value noise over the plane; one unit of input is one noise cell. */
export function valueNoise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash2(x0, y0, seed) + (hash2(x0 + 1, y0, seed) - hash2(x0, y0, seed)) * sx;
  const bottom = hash2(x0, y0 + 1, seed) + (hash2(x0 + 1, y0 + 1, seed) - hash2(x0, y0 + 1, seed)) * sx;
  return top + (bottom - top) * sy;
}

const point = new Vector3();
const normalMatrix = new Matrix3();

/** Collects flat-shaded, vertex-coloured quads and boxes into one geometry. */
export class BoxBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private transform: Matrix4 | null = null;

  get quadCount(): number {
    return this.indices.length / 6;
  }

  /**
   * One quad. Corners go counter-clockwise seen from the side `normal` points to.
   * Pass one colour for the whole quad or one per corner.
   */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal: Vec3, color: Color | readonly [Color, Color, Color, Color]): void {
    const base = this.positions.length / 3;
    const corners = [a, b, c, d];
    let nx = normal[0];
    let ny = normal[1];
    let nz = normal[2];
    if (this.transform) {
      point.set(nx, ny, nz).applyMatrix3(normalMatrix).normalize();
      nx = point.x;
      ny = point.y;
      nz = point.z;
    }
    for (let i = 0; i < 4; i++) {
      const corner = corners[i] as Vec3;
      if (this.transform) {
        point.set(corner[0], corner[1], corner[2]).applyMatrix4(this.transform);
        this.positions.push(point.x, point.y, point.z);
      } else {
        this.positions.push(corner[0], corner[1], corner[2]);
      }
      this.normals.push(nx, ny, nz);
      const tint = color instanceof Color ? color : (color[i] as Color);
      this.colors.push(tint.r, tint.g, tint.b);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * An axis-aligned box from its minimum corner and size. `top` recolours the upper face.
   */
  box(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: ColorRepresentation,
    top?: ColorRepresentation,
  ): void {
    const side = paint(color);
    const x1 = x + sx;
    const y1 = y + sy;
    const z1 = z + sz;
    this.quad([x, y1, z1], [x1, y1, z1], [x1, y1, z], [x, y1, z], [0, 1, 0], top === undefined ? side : paint(top));
    this.quad([x, y, z], [x1, y, z], [x1, y, z1], [x, y, z1], [0, -1, 0], side);
    this.quad([x, y, z1], [x1, y, z1], [x1, y1, z1], [x, y1, z1], [0, 0, 1], side);
    this.quad([x1, y, z], [x, y, z], [x, y1, z], [x1, y1, z], [0, 0, -1], side);
    this.quad([x1, y, z1], [x1, y, z], [x1, y1, z], [x1, y1, z1], [1, 0, 0], side);
    this.quad([x, y, z], [x, y, z1], [x, y1, z1], [x, y1, z], [-1, 0, 0], side);
  }

  /** A box given by the centre of its base instead of its minimum corner. */
  boxOn(
    cx: number,
    y: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    color: ColorRepresentation,
    top?: ColorRepresentation,
  ): void {
    this.box(cx - sx / 2, y, cz - sz / 2, sx, sy, sz, color, top);
  }

  /**
   * A block of cubes of edge `size`, drawing only the faces that border an empty cell.
   * Cell (i, j, k) has its minimum corner at (i, j, k) × size; `solid` is asked about cells
   * from `min` to `max` inclusive and everything beyond counts as empty.
   */
  voxels(
    size: number,
    min: readonly [number, number, number],
    max: readonly [number, number, number],
    solid: (i: number, j: number, k: number) => boolean,
    color: (i: number, j: number, k: number) => Color,
  ): void {
    const inside = (i: number, j: number, k: number): boolean =>
      i >= min[0] && i <= max[0] && j >= min[1] && j <= max[1] && k >= min[2] && k <= max[2] && solid(i, j, k);
    for (let j = min[1]; j <= max[1]; j++) {
      for (let k = min[2]; k <= max[2]; k++) {
        for (let i = min[0]; i <= max[0]; i++) {
          if (!inside(i, j, k)) continue;
          const tint = color(i, j, k);
          const x = i * size;
          const y = j * size;
          const z = k * size;
          const x1 = x + size;
          const y1 = y + size;
          const z1 = z + size;
          if (!inside(i, j + 1, k)) this.quad([x, y1, z1], [x1, y1, z1], [x1, y1, z], [x, y1, z], [0, 1, 0], tint);
          if (!inside(i, j - 1, k)) this.quad([x, y, z], [x1, y, z], [x1, y, z1], [x, y, z1], [0, -1, 0], tint);
          if (!inside(i, j, k + 1)) this.quad([x, y, z1], [x1, y, z1], [x1, y1, z1], [x, y1, z1], [0, 0, 1], tint);
          if (!inside(i, j, k - 1)) this.quad([x1, y, z], [x, y, z], [x, y1, z], [x1, y1, z], [0, 0, -1], tint);
          if (!inside(i + 1, j, k)) this.quad([x1, y, z1], [x1, y, z], [x1, y1, z], [x1, y1, z1], [1, 0, 0], tint);
          if (!inside(i - 1, j, k)) this.quad([x, y, z], [x, y, z1], [x, y1, z1], [x, y1, z], [-1, 0, 0], tint);
        }
      }
    }
  }

  /** Everything added inside `build` is moved by `matrix` (rotation and translation only). */
  transformed(matrix: Matrix4, build: () => void): void {
    const outer = this.transform;
    this.transform = outer ? outer.clone().multiply(matrix) : matrix;
    normalMatrix.getNormalMatrix(this.transform);
    try {
      build();
    } finally {
      this.transform = outer;
      if (outer) normalMatrix.getNormalMatrix(outer);
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}
