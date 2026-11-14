import { Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, type Material } from 'three';
import { DISPLAY_TO_SCENE_GLSL, MATTE_PLASTIC } from '../look';
import { BoxBatch, seededRandom, shade } from './boxes';
import type { WorldKey } from '../../data/worlds';
import { COLS, PLANT_COLS } from '../../sim/types';
import type { LawnConfig } from '../../sim/types';
import { NO_TWIST } from '../../sim/lawn';

// The lawn twists as the player sees them: boulders on rock tiles, mist over a foggy lawn,
// icy lanes and glowing lava tiles. Built once when a battle starts (the twists never change
// during a match); `update` only moves uniforms.

/**
 * Each world's twist as a level might use it: tool and debug data only (the screenshot and perf
 * scenes, `__lvt.setWorld`). Real battles draw their level's own `MatchConfig.lawn`.
 */
export const SAMPLE_LAWNS: Record<WorldKey, LawnConfig> = {
  backyard: NO_TWIST,
  meadow: { ...NO_TWIST, fog: 5 },
  desert: { ...NO_TWIST, rocks: [0 * PLANT_COLS + 3, 1 * PLANT_COLS + 5, 2 * PLANT_COLS + 2, 3 * PLANT_COLS + 6, 4 * PLANT_COLS + 4] },
  tundra: { ...NO_TWIST, ice: { lanes: [1, 3], speed: 1.6 } },
  citadel: { ...NO_TWIST, lava: { tiles: [0 * COLS + 4, 1 * COLS + 6, 2 * COLS + 3, 2 * COLS + 8, 3 * COLS + 5, 4 * COLS + 2], dps: 15, burnTicks: 60 } },
};

/** True when the two configs draw the same lawn. */
export function sameLawn(a: LawnConfig, b: LawnConfig): boolean {
  const same = (x: readonly number[] | undefined, y: readonly number[] | undefined): boolean =>
    (x ?? []).length === (y ?? []).length && (x ?? []).every((v, i) => v === (y ?? [])[i]);
  return (
    same(a.rocks, b.rocks) &&
    a.fog === b.fog &&
    (a.ice === null) === (b.ice === null) &&
    same(a.ice?.lanes, b.ice?.lanes) &&
    (a.lava === null) === (b.lava === null) &&
    same(a.lava?.tiles, b.lava?.tiles)
  );
}

/** The lawn tiles (col, lane) the config covers with ice or lava, where no grass grows. */
export function coveredTile(config: LawnConfig): (col: number, lane: number) => boolean {
  const ice = new Set(config.ice?.lanes ?? []);
  const lava = new Set(config.lava?.tiles ?? []);
  return (col, lane) => ice.has(lane) || lava.has(lane * COLS + col);
}

/** A rock tile's (lane, col). */
export function rockTile(index: number): { lane: number; col: number } {
  return { lane: Math.floor(index / PLANT_COLS), col: index % PLANT_COLS };
}

/** A lava tile's (lane, col). */
export function lavaTile(index: number): { lane: number; col: number } {
  return { lane: Math.floor(index / COLS), col: index % COLS };
}

// ---- Fog: one low sheet of blocky mist -------------------------------------------------------

const MIST_VERTEX = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// One sheet in eighth-tile pixels: two drifting layers of value noise, each pixel either clear or
// one of two hard steps of thin mist (no smooth gradient anywhere). Its edge round the lawn is an
// ordered (Bayer) dither on the same pixel grid, so it breaks up in blocks rather than fading.
const MIST_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vXZ;
  ${DISPLAY_TO_SCENE_GLSL}
  float hash(vec2 p, float seed) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed) * 43758.5453); }
  float noise(vec2 p, float seed) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i, seed), hash(i + vec2(1.0, 0.0), seed), f.x),
               mix(hash(i + vec2(0.0, 1.0), seed), hash(i + vec2(1.0, 1.0), seed), f.x), f.y);
  }
  float layer(vec2 xz, vec2 drift, float seed) {
    vec2 p = floor((xz + drift) * 8.0) / 8.0;
    return noise(p * 0.7, seed) * 0.65 + noise(p * 1.9 + 7.3, seed) * 0.35;
  }
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  void main() {
    vec2 cell = floor(vXZ * 8.0);
    vec2 c = (cell + 0.5) / 8.0;
    // 1 well inside the lawn, 0 a tile and a bit past its edges; dithered to whole pixels.
    float inside = min(min(c.x + 0.9, 10.9 - c.x), min(c.y + 0.7, 5.7 - c.y)) / 1.4;
    if (clamp(inside, 0.0, 1.0) <= bayer4(cell)) discard;
    float low = layer(vXZ, vec2(uTime * 0.18, uTime * 0.05), 0.0);
    float high = layer(vXZ, vec2(-uTime * 0.11, uTime * 0.07), 3.7);
    float steps = step(0.56, low) + step(0.66, high);
    if (steps < 0.5) discard;
    // Thinner still over the zombies' dark strip (columns 8-9), where pale mist shows the most.
    float strip = c.x > 8.0 ? 0.6 : 1.0;
    gl_FragColor = vec4(displayToScene(uColor), uOpacity * strip * (0.6 + 0.4 * (steps - 1.0)));
  }
`;

/** The mist sheet's height above the lawn and its strongest opacity: light, so the checker and the zombies show through. */
const MIST_Y = 0.12;
const MIST_OPACITY = 0.16;
const MIST_COLOR = '#C8D4F2';

// ---- Rocks: a boulder on each rock tile ---------------------------------------------

const BOULDER = ['#8C7868', '#7C6858', '#9E8A78'];

/** A boulder of a few stacked grey-brown blocks filling most of tile (lane, col), 0.34 tall: darker than the sand, so it reads. */
function boulder(batch: BoxBatch, lane: number, col: number, random: () => number): void {
  const cx = col + 0.5 + (random() - 0.5) * 0.08;
  const cz = lane + 0.5 + (random() - 0.5) * 0.08;
  const tone = (): string => BOULDER[Math.floor(random() * BOULDER.length)] as string;
  const block = (dx: number, y: number, dz: number, w: number, h: number, d: number): void => {
    const c = tone();
    batch.boxOn(cx + dx, y, cz + dz, w, h, d, shade(c, -0.06), shade(c, 0.05));
  };
  block(0, 0, 0, 0.72, 0.14, 0.66);
  block(-0.04 + (random() - 0.5) * 0.06, 0.14, 0.02, 0.58, 0.12, 0.52);
  block(0.05, 0.26, -0.02 + (random() - 0.5) * 0.06, 0.36, 0.08, 0.32);
  // A smaller stone at its foot, and a darker band of strata round the base.
  block(0.34, 0, 0.26, 0.16, 0.09, 0.14);
  batch.boxOn(cx, 0.06, cz, 0.732, 0.025, 0.672, shade('#5E4E44', 0));
}

// ---- Ice: glassy pale-blue tiles along each icy lane -----------------------------------------

/** Ice lies this far above the ground: over the grass creases, under the placement marks (0.012). */
const ICE_Y = 0.006;

/** One lane of ice: a checker of two blues with white scratches, glossy so the sun glints on it. */
function iceLane(batch: BoxBatch, lane: number, random: () => number): void {
  const light = '#A6DAF4';
  const dark = '#8CC8EC';
  const scratch = shade('#F4FBFF', 0);
  for (let col = 0; col < COLS; col++) {
    const tint = shade((col + lane) % 2 === 0 ? light : dark, (random() - 0.5) * 0.02);
    const x0 = col + 0.02;
    const x1 = col + 0.98;
    const z0 = lane + 0.02;
    const z1 = lane + 0.98;
    batch.quad([x0, ICE_Y, z1], [x1, ICE_Y, z1], [x1, ICE_Y, z0], [x0, ICE_Y, z0], [0, 1, 0], tint);
    // Two or three skate scratches along the lane, a pixel-thin slab each.
    const n = 2 + Math.floor(random() * 2);
    for (let i = 0; i < n; i++) {
      const sx = col + 0.08 + random() * 0.5;
      const sz = lane + 0.12 + random() * 0.76;
      batch.box(sx, ICE_Y, sz, 0.2 + random() * 0.25, 0.002, 0.025, scratch);
    }
  }
  // A frosted rim on the lane's front and back edges.
  const frost = shade('#E4F4FC', 0);
  batch.box(0, ICE_Y, lane + 0.02, COLS, 0.003, 0.05, frost);
  batch.box(0, ICE_Y, lane + 0.93, COLS, 0.003, 0.05, frost);
}

// ---- Lava: glowing tiles of blocky molten rock in a crust of basalt ---------------------------

const LAVA_VERTEX = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Molten rock in sixteenth-tile pixels that churn a step at a time, bright enough to bloom.
const LAVA_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uHot;
  uniform vec3 uWhite;
  varying vec2 vXZ;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 p = floor(vXZ * 16.0) / 16.0;
    float t = floor(uTime * 6.0) / 6.0;
    float n = noise(p * 2.2 + vec2(t * 0.35, -t * 0.2)) * 0.6 + noise(p * 5.0 - vec2(t * 0.5, t * 0.3)) * 0.4;
    vec3 c = mix(uDeep, uHot, smoothstep(0.3, 0.62, n));
    c = mix(c, uWhite, smoothstep(0.76, 0.9, n));
    float pulse = 0.9 + 0.1 * sin(uTime * 2.4);
    gl_FragColor = vec4(c * pulse, 1.0);
  }
`;

/** Lava lies just above the ground, like ice. */
const LAVA_Y = 0.006;

/** The twist visuals of one lawn config, as one group. */
export class TwistTiles {
  readonly group = new Group();
  private readonly materials: Material[] = [];
  private readonly time = { value: 0 };

  constructor(readonly config: LawnConfig) {
    this.group.name = 'twist-tiles';
    if (config.fog !== null) this.buildMist();
    if (config.rocks.length > 0) this.buildBoulders();
    if (config.ice !== null && config.ice.lanes.length > 0) this.buildIce(config.ice.lanes);
    if (config.lava !== null && config.lava.tiles.length > 0) this.buildLava(config.lava.tiles);
  }

  private buildLava(tiles: readonly number[]): void {
    const molten = new BoxBatch();
    const crust = new BoxBatch();
    const random = seededRandom(6660);
    const white = shade('#FFFFFF', 0);
    const basalt = '#2E2834';
    const basaltTop = '#433A4C';
    for (const index of tiles) {
      const { lane, col } = lavaTile(index);
      const x0 = col + 0.06;
      const x1 = col + 0.94;
      const z0 = lane + 0.06;
      const z1 = lane + 0.94;
      molten.quad([x0, LAVA_Y, z1], [x1, LAVA_Y, z1], [x1, LAVA_Y, z0], [x0, LAVA_Y, z0], [0, 1, 0], white);
      // A ragged crust round the edge: low basalt blocks, a few stepping into the pool.
      const edge = (x: number, z: number, w: number, d: number): void =>
        crust.box(x, 0, z, w, 0.03 + random() * 0.025, d, basalt, basaltTop);
      for (let i = 0; i < 5; i++) {
        const a = col + i * 0.2;
        edge(a, lane, 0.2, 0.08 + (random() < 0.3 ? 0.06 : 0));
        edge(a, lane + 0.92 - (random() < 0.3 ? 0.06 : 0), 0.2, 0.08 + 0.06);
        const b = lane + i * 0.2;
        edge(col, b, 0.08 + (random() < 0.3 ? 0.06 : 0), 0.2);
        edge(col + 0.92 - (random() < 0.3 ? 0.06 : 0), b, 0.14, 0.2);
      }
      // A floating crust island or two.
      if (random() < 0.7) crust.box(col + 0.25 + random() * 0.4, LAVA_Y, lane + 0.25 + random() * 0.4, 0.12, 0.02, 0.1, basalt, basaltTop);
    }
    const lava = new ShaderMaterial({
      vertexShader: LAVA_VERTEX,
      fragmentShader: LAVA_FRAGMENT,
      uniforms: {
        uTime: this.time,
        // Scene colours: the hot parts sit well over the bloom threshold.
        uDeep: { value: new Color('#C4280A').multiplyScalar(1.1) },
        uHot: { value: new Color('#FF7A1A').multiplyScalar(4) },
        uWhite: { value: new Color('#FFD23F').multiplyScalar(2.6) },
      },
    });
    const rock = new MeshStandardMaterial(MATTE_PLASTIC);
    this.materials.push(lava, rock);
    const pool = new Mesh(molten.build(), lava);
    pool.name = 'lava';
    const rim = new Mesh(crust.build(), rock);
    rim.name = 'lava-crust';
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.group.add(pool, rim);
  }

  private buildIce(lanes: readonly number[]): void {
    const batch = new BoxBatch();
    const random = seededRandom(7310);
    for (const lane of lanes) iceLane(batch, lane, random);
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0 });
    this.materials.push(material);
    const mesh = new Mesh(batch.build(), material);
    mesh.name = 'ice';
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildBoulders(): void {
    const batch = new BoxBatch();
    const random = seededRandom(5150);
    for (const index of this.config.rocks) {
      const { lane, col } = rockTile(index);
      boulder(batch, lane, col, random);
    }
    const material = new MeshStandardMaterial(MATTE_PLASTIC);
    this.materials.push(material);
    const mesh = new Mesh(batch.build(), material);
    mesh.name = 'boulders';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Moves the mist and the lava's glow on to `timeSeconds`. Allocates nothing. */
  update(timeSeconds: number): void {
    this.time.value = timeSeconds % 3600;
  }

  private buildMist(): void {
    const geometry = new PlaneGeometry(14, 8);
    geometry.rotateX(-Math.PI / 2);
    const material = new ShaderMaterial({
      vertexShader: MIST_VERTEX,
      fragmentShader: MIST_FRAGMENT,
      uniforms: { uTime: this.time, uOpacity: { value: MIST_OPACITY }, uColor: { value: new Color(MIST_COLOR) } },
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(material);
    const sheet = new Mesh(geometry, material);
    sheet.name = 'mist';
    sheet.position.set(5, MIST_Y, 2.5);
    // One draw call, under the placement marks (2) and the health bars (20).
    sheet.renderOrder = 1;
    this.group.add(sheet);
  }

  /** Frees every geometry and material it made. Take `group` out of the scene first. */
  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
  }
}
