import { Color, Group, Matrix4, Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D } from 'three';
import { glowMaterial } from '../fx/glow';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import type { Faction, ProjectileKind } from '../types';
import { BoxBatch, hash2, paint } from '../world/boxes';

// Small things that fly or float over the lawn: the ten projectiles and the two energy
// tokens, and the props the spells and hero powers bring on (the Mega Mower, the rock, the
// meteor, bones, lightning, vines, fog). Each is built of voxels; every copy of one shares
// its geometry and material, which belong to this module (remove the object when done; do
// not dispose them).

export { GRAVESTONE_HEIGHT, makeGravestone } from '../world/props';

/** What the simulation fires (declared in `../types` until the simulation exports it). */
export type { ProjectileKind };
export type TokenKind = 'sun' | 'brain';

/** Longest edge of a projectile, in tiles (art bible section 6: at least 0.2). */
export const PROJECTILE_SIZE: Record<ProjectileKind, number> = {
  pea: 0.22,
  brain: 0.26,
  kernel: 0.2,
  butter: 0.3,
  mango: 0.32,
  sand: 0.32,
  arrow: 0.44,
  bullet: 0.24,
  trident: 0.5,
  rot: 0.3,
};
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

/**
 * The pea in flight is deeper and darker than the palette's pea (#7ED957), which is almost the
 * grass's own colour (#7FD14B): a child has to be able to follow it down the lawn. A bright
 * glint on top, a near-black-green underside and edge so it stands off the grass.
 */
export const PEA_COLORS = { body: '#2E9E2E', glint: '#B5EF8A', rim: '#17561B' } as const;

function peaGeometry(): BufferGeometry {
  const n = 5;
  const light = paint(PEA_COLORS.glint);
  const pea = paint(PEA_COLORS.body);
  const dark = paint(PEA_COLORS.rim);
  return blob(PROJECTILE_SIZE.pea / n, n, n, n, round, (i, j, k) => {
    // A glint at the top towards the sun; the underside and the outer ring dark.
    if (j === n - 1 && i <= 2 && k <= 2) return light;
    if (j === 0) return dark;
    if (i === 0 || i === n - 1 || k === 0 || k === n - 1) return j >= n - 2 ? pea : dark;
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

// ---- The eight phase 2 shots ------------------------------------------------------------
//
// Shots fired by zombies fly towards −X, so the pointed ones (arrow, bullet, trident) are
// built point first along −X. A plant's pea and the pults' lobs are round or tumble.

/** Colours of the new shots, each inside its side's family (art bible section 3). */
export const SHOT_COLORS = {
  kernel: '#FFD83A',
  kernelDark: '#E9A80C',
  kernelTip: '#FFF4C2',
  butter: '#FFE070',
  butterTop: '#FFF1A8',
  butterDark: '#E0B83A',
  mango: '#FF9A1F',
  mangoBlush: '#F2542D',
  mangoBelly: '#FFC23D',
  sand: '#D9A55A',
  sandDark: '#A8733A',
  sandLight: '#EFC98A',
  bulletTail: '#D7DCE3',
  brass: '#D9A441',
  trident: '#A879FF',
  rot: '#3B4A22',
  rotDark: '#222B14',
  rotOoze: '#8FD13A',
  burn: '#FF7A1A',
  burnGlint: '#FFD23F',
  burnRim: '#E0400A',
} as const;

function kernelGeometry(): BufferGeometry {
  const n = 4;
  const body = paint(SHOT_COLORS.kernel);
  const dark = paint(SHOT_COLORS.kernelDark);
  const tip = paint(SHOT_COLORS.kernelTip);
  // A chunky cube with its corners knocked off and a pale tip on top: a kernel of corn.
  return blob(PROJECTILE_SIZE.kernel / n, n, n, n, (x, y, z) => Math.abs(x) + Math.abs(y) + Math.abs(z) < 2.2, (i, j, k) => {
    if (j === n - 1 && i >= 1 && i <= 2 && k >= 1 && k <= 2) return tip;
    if (j === 0) return dark;
    return hash2(i * 5 + j, k * 3, 17) < 0.2 ? dark : body;
  });
}

function butterGeometry(): BufferGeometry {
  const batch = new BoxBatch();
  const w = PROJECTILE_SIZE.butter;
  const d = 0.22;
  const h = 0.12;
  // A pat of butter: a slab with a paler top and a little curl of butter on it.
  batch.box(-w / 2, -h / 2, -d / 2, w, h, d, SHOT_COLORS.butterDark, SHOT_COLORS.butter);
  batch.box(-w / 2 + 0.02, h / 2 - 0.001, -d / 2 + 0.02, w - 0.04, 0.025, d - 0.04, SHOT_COLORS.butter, SHOT_COLORS.butterTop);
  batch.box(-0.05, h / 2 + 0.024, -0.03, 0.1, 0.04, 0.06, SHOT_COLORS.butter, SHOT_COLORS.butterTop);
  return batch.build();
}

function mangoGeometry(): BufferGeometry {
  const nx = 6;
  const ny = 5;
  const nz = 5;
  const cell = PROJECTILE_SIZE.mango / nx;
  const body = paint(SHOT_COLORS.mango);
  const blush = paint(SHOT_COLORS.mangoBlush);
  const belly = paint(SHOT_COLORS.mangoBelly);
  const u = (i: number, n: number): number => ((i + 0.5) / n) * 2 - 1;
  const batch = new BoxBatch();
  // A fat mango, blushing red on one cheek and yellow underneath, centred on the origin.
  batch.transformed(new Matrix4().makeTranslation((-nx * cell) / 2, (-ny * cell) / 2, (-nz * cell) / 2), () =>
    batch.voxels(
      cell,
      [0, 0, 0],
      [nx - 1, ny - 1, nz - 1],
      (i, j, k) => u(i, nx) ** 2 * 0.8 + u(j, ny) ** 2 + u(k, nz) ** 2 <= 1.25,
      (i, j, k) => (j <= 1 ? belly : i >= 3 && j >= 3 && hash2(i, k + j, 3) < 0.7 ? blush : body),
    ),
  );
  // A stem and a leaf on top, so a tumbling mango shows which way up it is.
  const y = (ny * cell) / 2;
  batch.box(-cell * 0.5, y - cell * 0.3, -cell * 0.5, cell, cell, cell, PALETTE.walnutDark);
  batch.box(cell * 0.5, y, -cell * 0.6, cell * 2, cell * 0.6, cell * 1.2, PALETTE.leafDark, PALETTE.leaf);
  return batch.build();
}

function sandGeometry(): BufferGeometry {
  const n = 5;
  const sand = paint(SHOT_COLORS.sand);
  const dark = paint(SHOT_COLORS.sandDark);
  const light = paint(SHOT_COLORS.sandLight);
  // A loose puff of sand: a ragged clump with gaps in it, never a clean ball.
  return blob(
    PROJECTILE_SIZE.sand / n,
    n,
    n - 1,
    n,
    (x, y, z) => x * x + y * y + z * z <= 1.3 && hash2(Math.round(x * 4), Math.round(y * 4) * 7 + Math.round(z * 4), 9) > 0.18,
    (i, j, k) => (j >= 3 ? light : hash2(i, j * 3 + k, 5) < 0.35 ? dark : sand),
  );
}

function arrowGeometry(): BufferGeometry {
  const batch = new BoxBatch();
  const L = PROJECTILE_SIZE.arrow;
  const t = 0.06;
  const x0 = -L / 2;
  // A thick bone shaft, a stepped iron head at the front (−X) and purple fletching at the back,
  // chunky enough to follow from the lawn camera.
  batch.box(x0 + 0.1, -t / 2, -t / 2, L - 0.14, t, t, PALETTE.boneShadow, PALETTE.bone);
  batch.box(x0 + 0.05, -0.055, -0.055, 0.06, 0.11, 0.11, PALETTE.levelIronDark, PALETTE.levelIron);
  batch.box(x0, -0.03, -0.03, 0.06, 0.06, 0.06, PALETTE.levelIronDark, PALETTE.levelIron);
  for (const dz of [-1, 1]) batch.box(L / 2 - 0.12, -0.02, dz > 0 ? t / 2 : -t / 2 - 0.07, 0.12, 0.04, 0.07, PALETTE.clothDark, PALETTE.clothPurple);
  batch.box(L / 2 - 0.12, t / 2, -0.02, 0.12, 0.07, 0.04, PALETTE.clothDark, PALETTE.clothPurple);
  return batch.build();
}

function bulletGeometry(): BufferGeometry {
  const batch = new BoxBatch();
  const L = PROJECTILE_SIZE.bullet;
  // A short iron slug with a brass back, and a pale streak behind it: a pistol shot.
  batch.box(-L / 2, -0.05, -0.05, 0.1, 0.1, 0.1, PALETTE.levelIronDark, PALETTE.levelIron);
  batch.box(-L / 2 + 0.1, -0.055, -0.055, 0.04, 0.11, 0.11, SHOT_COLORS.brass);
  batch.box(-L / 2 + 0.14, -0.035, -0.035, L - 0.14, 0.07, 0.07, SHOT_COLORS.bulletTail, '#FFFFFF');
  return batch.build();
}

function tridentGeometry(): BufferGeometry {
  const batch = new BoxBatch();
  const L = PROJECTILE_SIZE.trident;
  const x0 = -L / 2;
  const t = 0.045;
  // A long dark shaft; at the front (−X) a crossbar and three purple prongs spread across
  // the lane, so they show from above, the middle one longest.
  batch.box(x0 + 0.16, -t / 2, -t / 2, L - 0.16, t, t, PALETTE.clothDark, PALETTE.clothPurple);
  batch.box(x0 + 0.13, -0.03, -0.12, 0.05, 0.06, 0.24, PALETTE.clothDark, SHOT_COLORS.trident);
  for (const z of [-0.1, 0.1]) batch.box(x0 + 0.03, -0.025, z - 0.025, 0.11, 0.05, 0.05, PALETTE.clothDark, SHOT_COLORS.trident);
  batch.box(x0, -0.03, -0.03, 0.14, 0.06, 0.06, PALETTE.clothDark, SHOT_COLORS.trident);
  // Barbs on the outer prongs.
  for (const z of [-0.13, 0.13]) batch.box(x0 + 0.03, -0.02, z - 0.015, 0.03, 0.04, 0.03, SHOT_COLORS.trident);
  return batch.build();
}

function rotGeometry(): BufferGeometry {
  const n = 5;
  const rot = paint(SHOT_COLORS.rot);
  const dark = paint(SHOT_COLORS.rotDark);
  const ooze = paint(SHOT_COLORS.rotOoze);
  // A green-black lump with bright green ooze bubbling out of it.
  return blob(
    PROJECTILE_SIZE.rot / n,
    n,
    n,
    n,
    (x, y, z) => x * x + y * y * 1.2 + z * z <= 1.3,
    (i, j, k) => (hash2(i * 7 + j, k * 11 - j, 23) < 0.28 ? ooze : j <= 1 ? dark : hash2(i, k, j) < 0.4 ? dark : rot),
  );
}

/** The pea once it has passed through a Torchwood: the same pea, burning. */
function burningPeaGeometry(): BufferGeometry {
  const n = 5;
  const light = paint(SHOT_COLORS.burnGlint);
  const fire = paint(SHOT_COLORS.burn);
  const rim = paint(SHOT_COLORS.burnRim);
  return blob(PROJECTILE_SIZE.pea / n, n, n, n, round, (i, j, k) => {
    if (j >= n - 2 && i <= 3 && k <= 3) return light;
    if (j === 0) return rim;
    if (i === 0 || i === n - 1 || k === 0 || k === n - 1) return j >= n - 2 ? fire : rim;
    return fire;
  });
}

const SHOT_GEOMETRY: Record<ProjectileKind, () => BufferGeometry> = {
  pea: peaGeometry,
  brain: brainGeometry,
  kernel: kernelGeometry,
  butter: butterGeometry,
  mango: mangoGeometry,
  sand: sandGeometry,
  arrow: arrowGeometry,
  bullet: bulletGeometry,
  trident: tridentGeometry,
  rot: rotGeometry,
};

const hexNumber = (color: string): number => parseInt(color.slice(1), 16);

/** The colour of the short trail of cubes each kind leaves (art bible section 6). */
export const PROJECTILE_TRAIL: Record<ProjectileKind, number> = {
  pea: hexNumber(PEA_COLORS.body),
  brain: hexNumber(PALETTE.brainPink),
  kernel: hexNumber(SHOT_COLORS.kernel),
  butter: hexNumber(SHOT_COLORS.butter),
  mango: hexNumber(SHOT_COLORS.mango),
  sand: hexNumber(SHOT_COLORS.sand),
  arrow: hexNumber(PALETTE.bone),
  bullet: hexNumber(SHOT_COLORS.bulletTail),
  trident: hexNumber(SHOT_COLORS.trident),
  rot: hexNumber(PALETTE.poison),
};
/** A burning pea's trail: fire. */
export const BURNING_TRAIL = hexNumber(PALETTE.fire);

/**
 * How fast each kind tumbles in flight, in turns per second about its own axes. Pointed
 * shots fly point first (0); the mango, the brain and the rot roll over and over.
 */
export const PROJECTILE_TUMBLE: Record<ProjectileKind, number> = {
  pea: 0,
  brain: 0.8,
  kernel: 1.2,
  butter: 0.6,
  mango: 0.9,
  sand: 0.5,
  arrow: 0,
  bullet: 0,
  trident: 0,
  rot: 0.7,
};

/** Emissive intensity of a burning pea and of the glowing props: past the bloom threshold. */
export const PROP_GLOW = 2.2;

const geometries = new Map<string, BufferGeometry>();
let plastic: MeshStandardMaterial | null = null;
let glowing: MeshStandardMaterial | null = null;
let propGlow: MeshStandardMaterial | null = null;

function shared(key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = make();
    geometries.set(key, geometry);
  }
  return geometry;
}

function plasticMaterial(): MeshStandardMaterial {
  plastic ??= new MeshStandardMaterial(MATTE_PLASTIC);
  return plastic;
}

function glowingProp(): MeshStandardMaterial {
  propGlow ??= glowMaterial(PROP_GLOW);
  return propGlow;
}

/**
 * A projectile of `kind`, centred on its own origin, PROJECTILE_SIZE across at its longest.
 * Pointed kinds point along −X. `burning` turns a pea into a glowing orange fireball (a pea
 * that has passed a Torchwood); it is ignored for every other kind.
 */
export function makeProjectile(kind: ProjectileKind, burning = false): Object3D {
  const fire = burning && kind === 'pea';
  const mesh = fire
    ? new Mesh(shared('pea-burning', burningPeaGeometry), glowingProp())
    : new Mesh(shared(kind, SHOT_GEOMETRY[kind]), plasticMaterial());
  mesh.name = fire ? 'projectile-pea-burning' : `projectile-${kind}`;
  mesh.castShadow = true;
  return mesh;
}

/** Height of one step of a lobbed shot's arc, in tiles: one character voxel. */
export const LOB_STEP = 1 / 16;

/**
 * How high a lobbed shot is above its straight line, `t` of the way (0..1) along a flight of
 * `distance` tiles: a parabola that peaks higher the further it goes, cut into whole steps
 * of LOB_STEP so the arc is stepped like everything else.
 */
export function lobHeight(distance: number, t: number): number {
  if (!(t > 0 && t < 1)) return 0;
  const peak = Math.min(1.5, 0.35 + 0.13 * Math.max(0, distance));
  return Math.round((4 * t * (1 - t) * peak) / LOB_STEP) * LOB_STEP;
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

// ---- Spell and hero-power props ----------------------------------------------------------

/** Colours of the spell and hero props, each a relative of a palette colour. */
export const PROP_COLORS = {
  // The Mega Mower: Sun yellow with leaf-green trim, so it is Lukas's at a glance.
  mowerBody: PALETTE.petal,
  mowerSkirt: PALETTE.petalDark,
  mowerTrim: PALETTE.leafDark,
  tyre: '#2B2A30',
  tyreTread: '#3E3D45',
  // The rock: a warm grey with moss on top, the crack nearly black.
  rock: '#A39E96',
  rockDark: '#7F7A73',
  rockLight: '#BDB8AF',
  moss: PALETTE.leafDark,
  crack: '#2E2A27',
  // The meteor: scorched rock round molten cracks.
  meteor: '#4A3C3A',
  meteorLight: '#66544F',
  // Lightning: a white-hot core, yellow for Lukas, violet for Toby.
  boltCore: '#FFFBE6',
  boltPlants: PALETTE.stunStars,
  boltCoreZombies: '#F1E8FF',
  boltZombies: '#A55CFF',
  // Fog: pale grey blocks, lighter on top.
  fog: '#D3D6DE',
  fogTop: '#F0F2F6',
  fogUnder: '#AEB2BD',
} as const;

/** Length of the Mega Mower along the lane, in tiles. */
export const MEGA_MOWER_LENGTH = 1.5;

function mowerBody(): BufferGeometry {
  const b = new BoxBatch();
  const { mowerBody: body, mowerSkirt: skirt, mowerTrim: trim } = PROP_COLORS;
  const L = MEGA_MOWER_LENGTH;
  const x0 = -L / 2;
  // The deck: a wide low box with a darker skirt, stepped at the front like a bumper.
  b.box(x0 + 0.1, 0.12, -0.4, L - 0.25, 0.08, 0.8, skirt);
  b.box(x0 + 0.12, 0.2, -0.38, L - 0.3, 0.16, 0.76, skirt, body);
  b.box(x0 + 0.2, 0.36, -0.34, L - 0.48, 0.06, 0.68, body);
  b.box(L / 2 - 0.2, 0.16, -0.36, 0.08, 0.14, 0.72, trim, PALETTE.leaf);
  // A green stripe down each side, and a big leaf badge on the side the camera sees.
  b.box(x0 + 0.14, 0.27, 0.379, L - 0.34, 0.05, 0.01, trim);
  b.box(x0 + 0.14, 0.27, -0.389, L - 0.34, 0.05, 0.01, trim);
  b.box(-0.1, 0.22, 0.38, 0.12, 0.1, 0.012, PALETTE.leaf);
  b.box(0.02, 0.26, 0.38, 0.08, 0.06, 0.012, PALETTE.leafLight);
  // The engine: a green block with an iron cap and a pull cord.
  b.box(-0.28, 0.42, -0.2, 0.46, 0.2, 0.4, trim, PALETTE.leaf);
  b.box(-0.22, 0.62, -0.15, 0.34, 0.08, 0.3, PALETTE.levelIronDark, PALETTE.levelIron);
  b.box(-0.12, 0.7, -0.06, 0.14, 0.05, 0.12, PALETTE.levelIronDark, PALETTE.levelIron);
  b.box(-0.36, 0.5, -0.03, 0.08, 0.05, 0.06, '#D93A2B');
  // An exhaust stack.
  b.box(0.1, 0.62, 0.12, 0.06, 0.16, 0.06, PALETTE.levelIronDark, '#2B2A30');
  // Eyes on the front, looking up the lane: big black blocks with a white glint, and a grin.
  const fx = L / 2 - 0.12;
  for (const z of [-0.2, 0.08]) {
    b.box(fx, 0.25, z, 0.04, 0.1, 0.12, '#FFFFFF');
    b.box(fx + 0.02, 0.26, z + 0.03, 0.04, 0.07, 0.07, PALETTE.eye);
    b.box(fx + 0.05, 0.3, z + 0.07, 0.01, 0.025, 0.025, PALETTE.eyeGlint);
  }
  // The grass chute on the camera side, where the clippings fly out.
  b.box(-0.1, 0.24, 0.38, 0.3, 0.14, 0.08, skirt, body);
  b.box(-0.05, 0.26, 0.46, 0.2, 0.1, 0.02, '#2B2A30');
  // The handle: two iron bars sloping up and back, and a green grip across the top.
  for (const z of [-0.3, 0.26]) {
    for (let i = 0; i < 5; i++) b.box(x0 + 0.12 - i * 0.07, 0.36 + i * 0.12, z, 0.07, 0.13, 0.04, PALETTE.levelIronDark, PALETTE.levelIron);
  }
  b.box(x0 + 0.12 - 4 * 0.07 - 0.02, 0.36 + 4 * 0.12 + 0.06, -0.34, 0.1, 0.08, 0.68, trim, PALETTE.leaf);
  return b.build();
}

function wheelGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const { tyre, tyreTread } = PROP_COLORS;
  const r = 0.15;
  const c = 0.05;
  // A stepped disc in the XY plane, a tread ring and an iron hub.
  for (let i = -3; i < 3; i++) {
    for (let j = -3; j < 3; j++) {
      const d = Math.hypot(i + 0.5, j + 0.5) * c;
      if (d > r) continue;
      b.box(i * c, j * c, -0.05, c, c, 0.1, d > r - c ? tyreTread : tyre);
    }
  }
  b.box(-0.04, -0.04, -0.06, 0.08, 0.08, 0.12, PALETTE.levelIronDark, PALETTE.levelIron);
  return b.build();
}

/**
 * The Mega Mower (hero power of the plants): a giant yellow push mower MEGA_MOWER_LENGTH long
 * and nearly a lane wide, facing +X, standing on its origin. Its four wheels are meshes named
 * `mower-wheel` that turn about Z.
 */
export function makeMegaMower(): Object3D {
  const group = new Group();
  group.name = 'mega-mower';
  const body = new Mesh(shared('mower-body', mowerBody), plasticMaterial());
  body.name = 'mower-body';
  body.castShadow = true;
  group.add(body);
  const wheel = shared('mower-wheel', wheelGeometry);
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.4, 0.4]) {
      const mesh = new Mesh(wheel, plasticMaterial());
      mesh.name = 'mower-wheel';
      mesh.position.set(x, 0.15, z);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

/** The rock's three looks: whole, cracked, and crumbling. */
export const ROCK_STAGES = 3;
export type RockStage = 0 | 1 | 2;

/** Which look a rock with `fraction` of its health left shows. */
export function rockStage(fraction: number): RockStage {
  if (fraction > 0.6) return 0;
  if (fraction > 0.33) return 1;
  return 2;
}

function rockGeometry(stage: RockStage): () => BufferGeometry {
  return () => {
    const nx = 7;
    const ny = 5;
    const nz = 6;
    const cell = 0.115;
    const u = (i: number, n: number): number => ((i + 0.5) / n) * 2 - 1;
    const { rock, rockDark, rockLight, moss, crack } = PROP_COLORS;
    const c = { rock: paint(rock), dark: paint(rockDark), light: paint(rockLight), moss: paint(moss), crack: paint(crack) };
    // A boulder: flat-bottomed, lumpy, with moss on its crown. Damage knocks chunks off its
    // corners and opens a crack down the face the camera sees.
    const solid = (i: number, j: number, k: number): boolean => {
      const x = u(i, nx);
      const y = (j + 0.5) / ny;
      const z = u(k, nz);
      if (x * x + z * z + (y * 1.1) ** 2 * 0.9 > 1.35 + 0.25 * hash2(i, k, 4)) return false;
      if (stage >= 1 && i === nx - 1 && j >= ny - 2) return false;
      if (stage >= 2 && ((i === 0 && j >= 2) || (k === nz - 1 && i >= 4 && j >= 2) || (j === ny - 1 && i <= 2))) return false;
      return true;
    };
    // Cracks zig-zag down from the top on the faces the camera sees (+Z, and +X at stage 2),
    // stopping short of the ground so they never read as a doorway.
    const cracks: [number, number][][] = [
      [],
      [[3, 4], [3, 3], [4, 2]],
      [[3, 4], [3, 3], [4, 2], [4, 1], [2, 3], [1, 2]],
    ];
    const sideCrack: [number, number][] = [[2, 4], [3, 3], [3, 2]];
    const isCrack = (i: number, j: number, k: number): boolean => {
      const front = !solid(i, j, k + 1);
      if (front && (cracks[stage] as [number, number][]).some(([ci, cj]) => ci === i && cj === j)) return true;
      const side = !solid(i + 1, j, k);
      return stage >= 2 && side && sideCrack.some(([ck, cj]) => ck === k && cj === j);
    };
    const color = (i: number, j: number, k: number): Color => {
      if (isCrack(i, j, k)) return c.crack;
      // Moss only on the crown, so the rock reads as stone with a green cap, not a green block.
      if (!solid(i, j + 1, k)) return j >= ny - 1 && hash2(i, k, 11) < 0.75 && stage < 2 ? c.moss : c.light;
      if (j === 0) return c.dark;
      return hash2(i * 3 + j, k, 6) < 0.3 ? c.dark : c.rock;
    };
    const b = new BoxBatch();
    b.transformed(new Matrix4().makeTranslation((-nx * cell) / 2, 0, (-nz * cell) / 2), () =>
      b.voxels(cell, [0, 0, 0], [nx - 1, ny - 1, nz - 1], solid, color),
    );
    return b.build();
  };
}

/** The Rock Wall's rock in one of its three looks, about 0.8 × 0.6 × 0.7, standing on its origin. */
export function makeRock(stage: RockStage): Object3D {
  const mesh = new Mesh(shared(`rock-${stage}`, rockGeometry(stage)), plasticMaterial());
  mesh.name = `rock-${stage}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function meteorPart(molten: boolean): () => BufferGeometry {
  return () => {
    const n = 6;
    const cell = 0.12;
    const u = (i: number): number => ((i + 0.5) / n) * 2 - 1;
    const inBall = (i: number, j: number, k: number): boolean => u(i) ** 2 + u(j) ** 2 + u(k) ** 2 <= 1.3;
    // Molten cells run in seams through the rock; each part fills only its own cells.
    const seam = (i: number, j: number, k: number): boolean => hash2(i * 5 + k, j * 3 - k, 31) < 0.3;
    const rock = paint(PROP_COLORS.meteor);
    const rockLight = paint(PROP_COLORS.meteorLight);
    const hot = paint(PALETTE.fire);
    const hotLight = paint(PALETTE.fireLight);
    const b = new BoxBatch();
    b.transformed(new Matrix4().makeTranslation((-n * cell) / 2, (-n * cell) / 2, (-n * cell) / 2), () =>
      b.voxels(
        cell,
        [0, 0, 0],
        [n - 1, n - 1, n - 1],
        (i, j, k) => inBall(i, j, k) && seam(i, j, k) === molten,
        (i, j, k) => (molten ? (hash2(i, j, k) < 0.5 ? hotLight : hot) : j >= 4 ? rockLight : rock),
      ),
    );
    return b.build();
  };
}

/** A voxel meteor about 0.7 tile across, centred on its origin: dark rock with glowing seams. */
export function makeMeteor(): Object3D {
  const group = new Group();
  group.name = 'meteor';
  const rock = new Mesh(shared('meteor-rock', meteorPart(false)), plasticMaterial());
  rock.name = 'meteor-rock';
  rock.castShadow = true;
  const seams = new Mesh(shared('meteor-seams', meteorPart(true)), glowingProp());
  seams.name = 'meteor-seams';
  group.add(rock, seams);
  return group;
}

function boneGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const { bone, boneShadow } = PALETTE;
  // A big cartoon bone along X, centred: a shaft and two knuckles at each end.
  b.box(-0.15, -0.035, -0.035, 0.3, 0.07, 0.07, boneShadow, bone);
  for (const x of [-0.2, 0.12]) {
    for (const z of [-0.075, 0.005]) b.box(x, -0.045, z, 0.08, 0.09, 0.07, boneShadow, bone);
  }
  return b.build();
}

/** A bone for the Bone Storm, 0.4 tile long along X, centred on its origin. */
export function makeBone(): Object3D {
  const mesh = new Mesh(shared('bone', boneGeometry), plasticMaterial());
  mesh.name = 'storm-bone';
  mesh.castShadow = true;
  return mesh;
}

/** Height of a lightning bolt from `makeBolt`, in tiles: from the sky to the lawn. */
export const BOLT_HEIGHT = 3;

function boltGeometry(side: Faction): () => BufferGeometry {
  return () => {
    const b = new BoxBatch();
    const core = side === 'plants' ? PROP_COLORS.boltCore : PROP_COLORS.boltCoreZombies;
    const edge = side === 'plants' ? PROP_COLORS.boltPlants : PROP_COLORS.boltZombies;
    // A stepped zig-zag from the top down to the origin: straight runs joined by sideways
    // jogs, each run a bright core inside a coloured sleeve.
    const runs: [number, number][] = [
      [0, 0.5],
      [0.18, 0.45],
      [-0.06, 0.55],
      [0.16, 0.5],
      [-0.1, 0.5],
      [0.04, 0.5],
    ];
    let y = BOLT_HEIGHT;
    let x = 0;
    for (const [jog, length] of runs) {
      const nx = x + jog;
      const lo = Math.min(x, nx);
      if (jog !== 0) b.box(lo - 0.06, y - 0.12, -0.06, Math.abs(jog) + 0.12, 0.12, 0.12, edge, core);
      x = nx;
      const h = Math.min(length, y);
      b.box(x - 0.07, y - h, -0.07, 0.14, h, 0.14, edge);
      b.box(x - 0.035, y - h, 0.07, 0.07, h, 0.005, core);
      y -= h;
    }
    // Pull the foot back onto the origin.
    b.box(x - 0.1, 0, -0.1, 0.2, 0.05, 0.2, edge, core);
    const g = b.build();
    g.translate(-x, 0, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };
}

/**
 * A stepped lightning bolt BOLT_HEIGHT tall, its foot on the origin: yellow for the plants'
 * Thunderbolt, violet for the zombies' Bone Storm. It glows (emissive PROP_GLOW).
 */
export function makeBolt(side: Faction): Object3D {
  const mesh = new Mesh(shared(`bolt-${side}`, boltGeometry(side)), glowingProp());
  mesh.name = `bolt-${side}`;
  return mesh;
}

function vineGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const { stem, leaf, leafDark, leafLight } = PALETTE;
  const t = 0.08;
  // A thick stalk that climbs in steps and hooks over at the top towards +X, like a hand
  // reaching for whatever stands there, with leaves sticking out to either side.
  const steps: [number, number][] = [
    [0, 0],
    [0.02, 0.1],
    [0.05, 0.2],
    [0.06, 0.3],
    [0.1, 0.38],
    [0.17, 0.42],
  ];
  for (const [x, y] of steps) b.box(x - t / 2, y, -t / 2, t, 0.11, t, stem, leafDark);
  b.box(0.2, 0.36, -t / 2, t, 0.08, t, stem, leaf);
  steps.forEach(([x, y], i) => {
    if (i === 0 || i === steps.length - 1) return;
    const side = i % 2 === 0 ? 1 : -1;
    b.box(x - 0.05, y + 0.05, side > 0 ? t / 2 : -t / 2 - 0.1, 0.1, 0.035, 0.1, leafDark, i % 3 === 0 ? leafLight : leaf);
  });
  return b.build();
}

/** A vine about 0.5 tile tall, its root on the origin: the Vines spell grows these over its tiles. */
export function makeVine(): Object3D {
  const mesh = new Mesh(shared('vine', vineGeometry), plasticMaterial());
  mesh.name = 'vine';
  mesh.castShadow = true;
  return mesh;
}

/** Edge of a fog block, in tiles. */
export const FOG_BLOCK = 0.42;

function fogGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const s = FOG_BLOCK;
  b.box(-s / 2, -s / 2, -s / 2, s, s, s, PROP_COLORS.fog, PROP_COLORS.fogTop);
  // A paler lid a little inset, so even a lone block has a top and an edge.
  b.box(-s / 2 + 0.04, s / 2, -s / 2 + 0.04, s - 0.08, 0.04, s - 0.08, PROP_COLORS.fogTop, '#FFFFFF');
  return b.build();
}

/** One block of the Fog spell's cloud bank, FOG_BLOCK across, centred on its origin. */
export function makeFogBlock(): Object3D {
  const mesh = new Mesh(shared('fog', fogGeometry), plasticMaterial());
  mesh.name = 'fog-block';
  return mesh;
}
