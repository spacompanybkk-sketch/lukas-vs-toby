import { Color, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D } from 'three';
import type { ProjectileKind } from '../../sim/types';
import { glowMaterial } from '../fx/glow';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import { BoxBatch, hash2, paint, shade } from '../world/boxes';

// Small things that fly or float over the lawn: the two projectiles and the two energy
// tokens. Each is a little ball of voxels; every copy of one shares its geometry and
// material, which belong to this module (remove the object when done; do not dispose them).

export { GRAVESTONE_HEIGHT, makeGravestone } from '../world/props';

/** What the simulation fires: the simulation's own type. */
export type { ProjectileKind };
export type TokenKind = 'sun' | 'brain';

/** Edge of a projectile, in tiles (art bible section 6: at least 0.2). */
export const PROJECTILE_SIZE: Record<ProjectileKind, number> = { pea: 0.22, brain: 0.26 };
/** Emissive intensity of a token: past the bloom threshold, so it glows. */
export const TOKEN_GLOW = 2;

const BRAIN_FOLD = '#D9658F';
const BRAIN_LIGHT = '#FFB5CB';

/**
 * Fills cells of an n × m × l grid (cell edge `cell`, centred on the origin in x and z,
 * resting on y = 0 unless `centred`) that pass `inside`, coloured by `color`.
 */
function blob(
  cell: number,
  nx: number,
  ny: number,
  nz: number,
  inside: (x: number, y: number, z: number) => boolean,
  color: (i: number, j: number, k: number) => Color,
  centred = true,
): BufferGeometry {
  const batch = new BoxBatch();
  // Cell centres in units of half the grid, -1..1 on each axis.
  const u = (i: number, n: number): number => ((i + 0.5) / n) * 2 - 1;
  batch.voxels(cell, [0, 0, 0], [nx - 1, ny - 1, nz - 1], (i, j, k) => inside(u(i, nx), u(j, ny), u(k, nz)), color);
  const geometry = batch.build();
  geometry.translate((-nx * cell) / 2, centred ? (-ny * cell) / 2 : 0, (-nz * cell) / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const round = (x: number, y: number, z: number): boolean => x * x + y * y + z * z <= 1.25;

function peaGeometry(): BufferGeometry {
  const n = 5;
  const light = paint(PALETTE.peaLight);
  const pea = paint(PALETTE.pea);
  const dark = shade(PALETTE.pea, -0.12);
  return blob(PROJECTILE_SIZE.pea / n, n, n, n, round, (i, j, k) => {
    // A glint at the top towards the sun, a darker underside.
    if (j === n - 1 && i <= 2 && k <= 2) return light;
    if (j === 0) return dark;
    return pea;
  });
}

function brainGeometry(): BufferGeometry {
  const wide = 6;
  const tall = 5;
  const deep = 5;
  const pink = paint(PALETTE.brainPink);
  const fold = paint(BRAIN_FOLD);
  const light = paint(BRAIN_LIGHT);
  return blob(
    PROJECTILE_SIZE.brain / wide,
    wide,
    tall,
    deep,
    (x, y, z) => x * x * 0.9 + y * y * 1.1 + z * z <= 1.3 && y > -0.85,
    (i, j, k) => {
      // A groove down the middle of the top, and folds in a wandering pattern.
      if (j === tall - 1 && k === 2) return fold;
      if (hash2(i * 3 + j, k * 5 - j, 41) < 0.3) return fold;
      if (j === tall - 1) return light;
      return pink;
    },
  );
}

/** A flat voxel sun with eight rays and a happy face on both sides. */
function sunGeometry(): BufferGeometry {
  const batch = new BoxBatch();
  const c = 0.05;
  const r = 4;
  const sun = paint(PALETTE.sun);
  const deep = paint(PALETTE.petalDark);
  const centre = paint(PALETTE.petal);
  const eye = paint(PALETTE.eye);
  for (let i = -r; i < r; i++) {
    for (let j = -r; j < r; j++) {
      const d = Math.hypot(i + 0.5, j + 0.5);
      if (d > r - 0.1) continue;
      const color = d > r - 1.2 ? deep : d < 1.6 ? centre : sun;
      batch.box(i * c, j * c, -c, c, c, 2 * c, color);
    }
  }
  // Rays: four straight, four diagonal.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    batch.box((dx * (r + 0.5) - 0.5) * c, (dy * (r + 0.5) - 0.5) * c, -0.5 * c, c, c, c, sun);
    batch.box((dx * (r + 1.5) - 0.5) * c, (dy * (r + 1.5) - 0.5) * c, -0.5 * c, c, c, c, sun);
  }
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    batch.box((dx * (r - 0.5) - 0.5 + dx) * c, (dy * (r - 0.5) - 0.5 + dy) * c, -0.5 * c, c, c, c, sun);
  }
  // Eyes and a smile, standing a little proud on both faces.
  for (const z of [c, -c - 0.012]) {
    batch.box(-2 * c, 0.5 * c, z, c, 1.5 * c, 0.012, eye);
    batch.box(1 * c, 0.5 * c, z, c, 1.5 * c, 0.012, eye);
    batch.box(-1.5 * c, -1.6 * c, z, 3 * c, 0.6 * c, 0.012, eye);
    batch.box(-2.4 * c, -1.2 * c, z, 0.9 * c, 0.6 * c, 0.012, eye);
    batch.box(1.5 * c, -1.2 * c, z, 0.9 * c, 0.6 * c, 0.012, eye);
  }
  return batch.build();
}

function brainTokenGeometry(): BufferGeometry {
  const geometry = brainGeometry();
  geometry.scale(1.45, 1.45, 1.45);
  return geometry;
}

const geometries = new Map<string, BufferGeometry>();
let plastic: MeshStandardMaterial | null = null;
let glowing: MeshStandardMaterial | null = null;

function shared(key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = make();
    geometries.set(key, geometry);
  }
  return geometry;
}

/** A pea (0.22 tile) or a brain (0.26 tile), centred on its own origin. */
export function makeProjectile(kind: ProjectileKind): Object3D {
  plastic ??= new MeshStandardMaterial(MATTE_PLASTIC);
  const mesh = new Mesh(shared(kind, kind === 'pea' ? peaGeometry : brainGeometry), plastic);
  mesh.name = `projectile-${kind}`;
  mesh.castShadow = true;
  return mesh;
}

/**
 * An energy token: a glowing sun for the plants, a glowing brain for the zombies, centred
 * on its own origin. It turns and bobs when `spinToken` is called each frame.
 */
export function makeToken(kind: TokenKind): Object3D {
  glowing ??= glowMaterial(TOKEN_GLOW);
  const group = new Group();
  group.name = `token-${kind}`;
  const mesh = new Mesh(shared(`token-${kind}`, kind === 'sun' ? sunGeometry : brainTokenGeometry), glowing);
  mesh.name = 'token-body';
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

/** Turns a token about its upright axis and bobs it, for a time in seconds. */
export function spinToken(token: Object3D, timeSeconds: number): void {
  const body = token.children[0];
  if (!body) return;
  body.rotation.y = timeSeconds * 2.2;
  body.position.y = Math.sin(timeSeconds * 3.1) * 0.035;
}
