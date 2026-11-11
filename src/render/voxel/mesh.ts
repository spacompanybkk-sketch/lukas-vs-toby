import { Color, Matrix4, Vector3 } from 'three';
import { BoxBatch } from '../world/boxes';
import type { MaterialKey } from './materials';
import type { PartDef } from './types';

// From boxes to a shaded surface. Faces are cut into voxel-sized cells so that the creases
// where boxes meet can be shaded per vertex, which is most of what makes a pile of boxes
// read as one moulded toy. Cells hidden inside a part are left out, and where two boxes of
// a part share a surface the later one paints over the earlier, so details can be set flush
// into a face.

type Vec3 = [number, number, number];

/** A box as it is at one level: gated, recoloured and sorted into a material. In voxels. */
export interface Solid {
  min: Vec3;
  max: Vec3;
  hex: string;
  material: MaterialKey;
}

/** A part's solids at one level, with the matrices that carry points to and from the model's rest pose. */
export interface Shape {
  def: PartDef;
  solids: Solid[];
  /** Rest pose: part space (authored voxels minus the pivot) to model space, and back. */
  toModel: Matrix4;
  fromModel: Matrix4;
}

// ---- Shading baked into the vertex colours ------------------------------------------------

/**
 * HSL lightness added to faces that look up, sideways and down. Plastic needs only a hint;
 * metal is painted in three clear tones, the way a toy's gold is, so it reads as metal even
 * where there is nothing bright for it to reflect.
 */
const FACE_TONES = {
  plastic: [0.025, 0, -0.07],
  metal: [0.05, -0.05, -0.16],
} as const;
/** Brightness of a vertex with 0 to 3 of its neighbouring cells filled: the crease shading. */
const CREASE = [1, 0.86, 0.74, 0.62] as const;
/** How far from a vertex the neighbouring cells are probed, in voxels. Just under half a voxel. */
const PROBE = 0.45;

const shadeCache = new Map<string, Color>();

/** The vertex colour of `solid` on a face along `axis` looking `sign`, with `crease` neighbours filled. */
function shaded(solid: Solid, axis: number, sign: number, crease: number): Color {
  const facing = axis === 1 ? sign : 0;
  const metal = solid.material === 'iron' || solid.material === 'gold';
  const key = `${solid.hex}${metal ? 'm' : 'p'}${facing}${crease}`;
  let color = shadeCache.get(key);
  if (!color) {
    const tones = metal ? FACE_TONES.metal : FACE_TONES.plastic;
    color = new Color(solid.hex);
    color.offsetHSL(0, 0, tones[1 - facing] as number);
    color.multiplyScalar(CREASE[crease] as number);
    shadeCache.set(key, color);
  }
  return color;
}

// ---- Meshing --------------------------------------------------------------------------------

const EDGE = 1e-4;

function contains(solid: Solid, x: number, y: number, z: number): boolean {
  return (
    x > solid.min[0] + EDGE &&
    x < solid.max[0] - EDGE &&
    y > solid.min[1] + EDGE &&
    y < solid.max[1] - EDGE &&
    z > solid.min[2] + EDGE &&
    z < solid.max[2] - EDGE
  );
}

/** Whether two solids overlap or touch. */
function meets(a: Solid, b: Solid): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if ((a.min[axis] as number) > (b.max[axis] as number) + EDGE || (b.min[axis] as number) > (a.max[axis] as number) + EDGE) return false;
  }
  return true;
}

/**
 * Where a solid's faces are cut along one axis: at both ends, at every whole voxel between,
 * and wherever a box it meets begins or ends. So a cell is never half under a neighbour,
 * and the faces of one box all agree on where their shared edges are divided.
 */
function cuts(solid: Solid, axis: number, solids: readonly Solid[]): number[] {
  const from = solid.min[axis] as number;
  const to = solid.max[axis] as number;
  const out = [from, to];
  for (let at = Math.floor(from) + 1; at < to; at++) out.push(at);
  for (const other of solids) {
    if (other === solid || !meets(solid, other)) continue;
    out.push(other.min[axis] as number, other.max[axis] as number);
  }
  out.sort((a, b) => a - b);
  return out.filter((at, i) => at >= from && at <= to && (i === 0 || at - (out[i - 1] as number) > EDGE));
}

const probe = new Vector3();
const corner: Vec3 = [0, 0, 0];

/** Whether a point in `shape`'s authored space is inside any box of the model at rest. */
function filled(shapes: readonly Shape[], shape: Shape, x: number, y: number, z: number): boolean {
  for (const solid of shape.solids) if (contains(solid, x, y, z)) return true;
  const [px, py, pz] = shape.def.pivot;
  for (const other of shapes) {
    if (other === shape || other.solids.length === 0) continue;
    probe.set(x - px, y - py, z - pz).applyMatrix4(shape.toModel).applyMatrix4(other.fromModel);
    const [ox, oy, oz] = other.def.pivot;
    for (const solid of other.solids) if (contains(solid, probe.x + ox, probe.y + oy, probe.z + oz)) return true;
  }
  return false;
}

/**
 * The surface of one part, as one batch of quads per material. Vertices are relative to the
 * part's pivot and multiplied by `scale` (the size of a voxel). `shapes` is the whole model:
 * its other parts darken the creases where they rest against this one.
 */
export function meshPart(shapes: readonly Shape[], shape: Shape, scale: number): Map<MaterialKey, BoxBatch> {
  const batches = new Map<MaterialKey, BoxBatch>();
  const { solids } = shape;
  const [px, py, pz] = shape.def.pivot;
  const at = (a: number, u: number, v: number, c: number, cu: number, cv: number): Vec3 => {
    corner[a] = c;
    corner[u] = cu;
    corner[v] = cv;
    return [(corner[0] - px) * scale, (corner[1] - py) * scale, (corner[2] - pz) * scale];
  };
  const isFilled = (a: number, u: number, v: number, c: number, cu: number, cv: number): boolean => {
    corner[a] = c;
    corner[u] = cu;
    corner[v] = cv;
    return filled(shapes, shape, corner[0], corner[1], corner[2]);
  };

  solids.forEach((solid, index) => {
    let batch = batches.get(solid.material);
    if (!batch) batches.set(solid.material, (batch = new BoxBatch()));
    const along = [cuts(solid, 0, solids), cuts(solid, 1, solids), cuts(solid, 2, solids)];
    for (let a = 0; a < 3; a++) {
      const u = (a + 1) % 3;
      const v = (a + 2) % 3;
      const us = along[u] as number[];
      const vs = along[v] as number[];
      for (const sign of [1, -1]) {
        const c = (sign > 0 ? solid.max[a] : solid.min[a]) as number;
        const normal: Vec3 = [0, 0, 0];
        normal[a] = sign;
        for (let i = 0; i + 1 < us.length; i++) {
          for (let j = 0; j + 1 < vs.length; j++) {
            const u0 = us[i] as number;
            const u1 = us[i + 1] as number;
            const v0 = vs[j] as number;
            const v1 = vs[j + 1] as number;

            // Skip a cell that another box of this part hides: one that covers it from just
            // outside, or a later box whose own face lies on it (later boxes paint over).
            const hidden = solids.some((other, otherIndex) => {
              if (other === solid) return false;
              const lo = other.min;
              const hi = other.max;
              const spans =
                (lo[u] as number) <= u0 + EDGE &&
                (hi[u] as number) >= u1 - EDGE &&
                (lo[v] as number) <= v0 + EDGE &&
                (hi[v] as number) >= v1 - EDGE;
              if (!spans) return false;
              const face = (sign > 0 ? hi[a] : lo[a]) as number;
              if (Math.abs(face - c) <= EDGE) return otherIndex > index;
              return (lo[a] as number) < c + sign * EDGE * 2 && (hi[a] as number) > c + sign * EDGE * 2;
            });
            if (hidden) continue;

            // Crease shading: for each corner, how many of the three cells that touch it
            // from outside the face are filled.
            const out = c + sign * PROBE;
            const crease = (cu: number, du: number, cv: number, dv: number): number => {
              const side1 = isFilled(a, u, v, out, cu + du * PROBE, cv - dv * PROBE);
              const side2 = isFilled(a, u, v, out, cu - du * PROBE, cv + dv * PROBE);
              if (side1 && side2) return 3;
              return Number(side1) + Number(side2) + Number(isFilled(a, u, v, out, cu + du * PROBE, cv + dv * PROBE));
            };
            // Counter-clockwise seen from outside.
            const ring: [number, number, number, number][] =
              sign > 0
                ? [[u0, -1, v0, -1], [u1, 1, v0, -1], [u1, 1, v1, 1], [u0, -1, v1, 1]]
                : [[u0, -1, v0, -1], [u0, -1, v1, 1], [u1, 1, v1, 1], [u1, 1, v0, -1]];
            const dark = ring.map(([cu, du, cv, dv]) => crease(cu, du, cv, dv));
            const points = ring.map(([cu, , cv]) => at(a, u, v, c, cu, cv));
            const tints = dark.map((d) => shaded(solid, a, sign, d));
            // Split the quad along the diagonal that joins its two brighter corners, or the
            // shading leans one way.
            const turn = (dark[0] as number) + (dark[2] as number) > (dark[1] as number) + (dark[3] as number) ? 1 : 0;
            const p = (k: number): Vec3 => points[(k + turn) % 4] as Vec3;
            const t = (k: number): Color => tints[(k + turn) % 4] as Color;
            batch.quad(p(0), p(1), p(2), p(3), normal, [t(0), t(1), t(2), t(3)]);
          }
        }
      }
    }
  });
  return batches;
}

const relative = new Matrix4();

/**
 * Two parts are two meshes, and where a face of one lies exactly on a face of the other,
 * looking the same way, the two flicker. Within one part the mesher sorts that out; between
 * parts it cannot, because parts move. Returns the first such pair of boxes, or null. Only
 * parts that are not turned relative to each other can line up like that.
 */
export function findSharedSurface(shapes: readonly Shape[]): { a: Shape; one: Solid; b: Shape; other: Solid } | null {
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i] as Shape;
      const b = shapes[j] as Shape;
      if (a.solids.length === 0 || b.solids.length === 0) continue;
      // Where b's part space lands in a's part space, at rest.
      const e = relative.multiplyMatrices(a.fromModel, b.toModel).elements;
      const turned =
        Math.abs((e[0] as number) - 1) > 1e-6 || Math.abs((e[5] as number) - 1) > 1e-6 || Math.abs((e[10] as number) - 1) > 1e-6;
      if (turned) continue;
      // Shift from b's authored voxels to a's: zero unless a part between them is turned.
      const shift = [0, 1, 2].map((k) => (e[12 + k] as number) + (a.def.pivot[k] as number) - (b.def.pivot[k] as number));
      for (const one of a.solids) {
        for (const other of b.solids) {
          const lo = (k: number): number => (other.min[k] as number) + (shift[k] as number);
          const hi = (k: number): number => (other.max[k] as number) + (shift[k] as number);
          for (let axis = 0; axis < 3; axis++) {
            const u = (axis + 1) % 3;
            const v = (axis + 2) % 3;
            const overlaps =
              Math.min(one.max[u] as number, hi(u)) - Math.max(one.min[u] as number, lo(u)) > EDGE &&
              Math.min(one.max[v] as number, hi(v)) - Math.max(one.min[v] as number, lo(v)) > EDGE;
            if (!overlaps) continue;
            const sameFace =
              Math.abs((one.max[axis] as number) - hi(axis)) <= EDGE || Math.abs((one.min[axis] as number) - lo(axis)) <= EDGE;
            if (sameFace) return { a, one, b, other };
          }
        }
      }
    }
  }
  return null;
}
