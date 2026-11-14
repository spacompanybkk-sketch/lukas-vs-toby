import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, Vector3, type Material, type Object3D } from 'three';
import type { FrameBox, FrameView } from '../CameraRig';
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

// ---- Ice: deep blue glassy tiles along each icy lane -----------------------------------------

/** Ice lies this far above the ground: over the grass creases, under the placement marks (0.012). */
const ICE_Y = 0.006;

/** Deep blues, well apart from the pale snow, so a child sees at once which lanes are ice. */
const ICE_LIGHT = '#3F92D6';
const ICE_DARK = '#3282C8';
const ICE_EDGE = '#1F5E9E';
const ICE_CRACK = '#1C4F88';
const ICE_GLINT = '#F2FAFF';

/**
 * One lane of ice: a checker of two deep blues in a dark blue frame, each tile with a pixel-thin
 * crack or two and a few hard white glints (a 3-pixel L and lone pixels), glossy so the sun
 * glints on it too.
 */
function iceLane(batch: BoxBatch, lane: number, random: () => number): void {
  const glint = shade(ICE_GLINT, 0);
  const crack = shade(ICE_CRACK, 0);
  const px = 1 / 16;
  for (let col = 0; col < COLS; col++) {
    const tint = shade((col + lane) % 2 === 0 ? ICE_LIGHT : ICE_DARK, (random() - 0.5) * 0.03);
    const x0 = col + 0.02;
    const x1 = col + 0.98;
    const z0 = lane + 0.02;
    const z1 = lane + 0.98;
    batch.quad([x0, ICE_Y, z1], [x1, ICE_Y, z1], [x1, ICE_Y, z0], [x0, ICE_Y, z0], [0, 1, 0], tint);
    // A crack: a few pixel-wide steps zig-zagging across part of the tile.
    let cx = col + 0.08 + Math.floor(random() * 3) * px;
    let cz = lane + 0.2 + Math.floor(random() * 8) * px;
    const steps = 4 + Math.floor(random() * 3);
    for (let i = 0; i < steps; i++) {
      const run = (1 + Math.floor(random() * 2)) * px;
      batch.boxOn(cx + run / 2, ICE_Y, cz + px / 2, run, 0.002, px * 0.6, crack);
      cx += run;
      cz += (random() < 0.5 ? -1 : 1) * px * 0.6;
    }
    // Glints: an L of three white pixels near a corner, and one or two lone pixels.
    const gx = col + 0.6 + Math.floor(random() * 3) * px;
    const gz = lane + 0.12 + Math.floor(random() * 3) * px;
    batch.boxOn(gx + px, ICE_Y, gz + px / 2, px * 2, 0.003, px, glint);
    batch.boxOn(gx + px / 2, ICE_Y, gz + px * 1.5, px, 0.003, px, glint);
    const lone = 1 + Math.floor(random() * 2);
    for (let i = 0; i < lone; i++) {
      const lx = col + 0.12 + Math.floor(random() * 12) * px;
      const lz = lane + 0.55 + Math.floor(random() * 5) * px;
      batch.boxOn(lx + px / 2, ICE_Y, lz + px / 2, px, 0.003, px, glint);
    }
  }
  // A dark blue frame along the lane's front and back edges, with a white frost line inside it.
  const edge = shade(ICE_EDGE, 0);
  const frost = shade('#D8EEFF', 0);
  batch.boxOn(COLS / 2, ICE_Y, lane + 0.05, COLS, 0.003, 0.06, edge);
  batch.boxOn(COLS / 2, ICE_Y, lane + 0.95, COLS, 0.003, 0.06, edge);
  batch.boxOn(COLS / 2, ICE_Y, lane + 0.1, COLS, 0.003, 0.025, frost);
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

// ---- The twist lesson's show (plan step 2, Task 3) -------------------------------------------
//
// While a level's `twist` step holds the match, the camera pans over the twist and ghosts act it
// out: in fog a ghost pea flies from a Peashooter's tile and puffs out at the level's reach; on
// ice the icy lanes pulse and a ghost zombie slides down one, past one walking a plain lane. The
// ghosts are pictures only: they are no units, the simulation never hears of them.

/** The ghost pea's puff: the pale mist blue of a real shot fading in the fog (BattleView's fade puff). */
export const GHOST_PUFF = 0xdde6ff;

/** What the show needs from the effects: a puff of mist. */
export interface PuffHost { puff(at: Vector3, color: number): void }

/** The fog show's lane, and the plant column its pea leaves from (where the lessons put the first Peashooter). */
const FOG_LANE = 2;
const FOG_FROM_COL = 1;
/** The ghost pea's height, speed (tiles a second) and the rest after each puff (seconds). */
const PEA_Y = 0.55;
const PEA_SPEED = 4;
const SHOW_REST = 0.9;
/** The ghost walker's pace on grass, tiles a second (on ice: times the ice's speed). */
const GHOST_WALK = 1.4;
/** Where a ghost zombie starts and stops along its lane. */
const GHOST_FROM_X = 10.2;
const GHOST_TO_X = 0.3;
/** The camera follows the ghosts this fast (1/seconds), and frames this many tiles along the lane. */
const FOLLOW_RATE = 3;
const FOG_WINDOW = 5.2;
const ICE_WINDOW = 6.4;
/** The glowing steps of an icy lane's pulse (blocky, never smooth). */
const PULSE_STEPS = [0.06, 0.18, 0.3, 0.18];

const GHOST_ICE = '#BFE8FF';
const GHOST_PEA = '#8BE04E';
const GHOST_BODY = '#DDF1FF';
const GHOST_DARK = '#9CC4E4';

/** A boxy ghost zombie, arms out towards the plants (−x), feet at its origin. */
function ghostZombie(): BoxBatch {
  const b = new BoxBatch();
  const body = shade(GHOST_BODY, 0);
  const dark = shade(GHOST_DARK, 0);
  b.boxOn(0, 0, -0.08, 0.12, 0.26, 0.12, dark);
  b.boxOn(0, 0, 0.08, 0.12, 0.26, 0.12, dark);
  b.boxOn(0, 0.26, 0, 0.2, 0.3, 0.32, body);
  b.boxOn(0, 0.56, 0, 0.26, 0.26, 0.26, body);
  b.boxOn(-0.14, 0.62, 0.06, 0.03, 0.05, 0.05, dark); // eyes
  b.boxOn(-0.14, 0.62, -0.06, 0.03, 0.05, 0.05, dark);
  b.boxOn(-0.2, 0.44, -0.2, 0.3, 0.08, 0.08, body); // arms out front
  b.boxOn(-0.2, 0.44, 0.2, 0.3, 0.08, 0.08, body);
  return b;
}

/** A boxy ghost Peashooter, facing the zombies (+x), on its tile. */
function ghostShooter(): BoxBatch {
  const b = new BoxBatch();
  const leaf = shade(GHOST_PEA, -0.1);
  const head = shade(GHOST_PEA, 0.05);
  b.boxOn(0, 0, 0, 0.34, 0.06, 0.34, leaf);
  b.boxOn(0, 0.06, 0, 0.08, 0.28, 0.08, leaf);
  b.boxOn(0, 0.34, 0, 0.3, 0.3, 0.3, head);
  b.boxOn(0.2, 0.42, 0, 0.14, 0.14, 0.14, head);
  return b;
}

/** A ghost on a lane, for tests: which lane, and its object. */
export interface Ghost { lane: number; object: Object3D }

/**
 * One twist lesson's show: its ghosts in `group` (add it to the scene), moved on by `update`, and
 * the box the camera should frame now (`frameBox`, `view`). Loops until disposed.
 */
export class TwistShow {
  readonly group = new Group();
  /** Fog: where the pea leaves from and where it puffs out (the level's reach on). */
  readonly startX: number = FOG_FROM_COL + 0.5;
  readonly fadeX: number = Number.NaN;
  readonly lane: number = FOG_LANE;
  /** Ice: the ghost sliding down an icy lane, and the one walking a plain lane beside it (null: none plain). */
  readonly slider: Ghost = { lane: 0, object: new Group() };
  readonly walker: Ghost | null = null;
  /** How the camera looks at `frameBox`. */
  readonly view: FrameView;
  /** Times the show has played through. */
  loops = 0;
  disposed = false;

  private readonly materials: Material[] = [];
  private readonly pulses: MeshBasicMaterial[] = [];
  private pea: Mesh | null = null;
  private strip: MeshBasicMaterial | null = null;
  private readonly slideSpeed: number = GHOST_WALK;
  private clock = 0;
  private flying = true;
  /** The middle of the camera's window along the lane. */
  private follow: number;
  private readonly puffAt = new Vector3();

  constructor(readonly kind: 'fog' | 'ice', lawn: LawnConfig, private readonly fx: PuffHost) {
    this.group.name = 'twist-show';
    if (kind === 'fog') {
      const reach = lawn.fog ?? 5;
      this.fadeX = this.startX + reach;
      this.buildFog(reach);
      this.view = { pitchDeg: 44 };
      this.follow = this.startX + 1;
    } else {
      const icy = [...(lawn.ice?.lanes ?? [FOG_LANE])];
      const near = (lanes: number[], to: number): number | null =>
        lanes.length === 0 ? null : lanes.reduce((a, b) => (Math.abs(b - to) < Math.abs(a - to) ? b : a));
      const sliderLane = near(icy, FOG_LANE) as number;
      const plain = [0, 1, 2, 3, 4].filter((l) => !icy.includes(l));
      const walkerLane = near(plain, sliderLane);
      this.lane = sliderLane;
      this.slideSpeed = GHOST_WALK * (lawn.ice?.speed ?? 1.6);
      this.buildIce(icy);
      this.slider = { lane: sliderLane, object: this.ghost(sliderLane) };
      this.walker = walkerLane === null ? null : { lane: walkerLane, object: this.ghost(walkerLane) };
      this.view = { pitchDeg: 46 };
      this.follow = GHOST_FROM_X - ICE_WINDOW / 2;
    }
    this.update(0);
  }

  /** Moves the show on by `dt` real seconds (loops for ever). Allocates nothing. */
  update(dt: number): void {
    if (this.disposed) return;
    const step = dt > 0 ? Math.min(dt, 0.25) : 0;
    this.clock += step;
    if (this.kind === 'fog') this.updateFog();
    else this.updateIce();
    const target = this.kind === 'fog'
      ? (this.flying && this.pea !== null ? this.pea.position.x : this.startX + 1)
      : this.slider.object.position.x;
    this.follow += (target - this.follow) * (1 - Math.exp(-step * FOLLOW_RATE));
  }

  /** The box the camera frames now: a window along the lane that follows the ghost. */
  frameBox(): FrameBox {
    if (this.kind === 'fog') {
      const half = FOG_WINDOW / 2;
      const c = Math.min(Math.max(this.follow, half - 0.5), 10.5 - half);
      return { x: [c - half, c + half], y: [0, 1.2], z: [this.lane - 0.6, this.lane + 1.6] };
    }
    const half = ICE_WINDOW / 2;
    const c = Math.min(Math.max(this.follow, half - 0.5), 10.5 - half);
    const lanes = this.walker === null ? [this.slider.lane] : [this.slider.lane, this.walker.lane];
    return { x: [c - half, c + half], y: [0, 1.4], z: [Math.min(...lanes) - 0.4, Math.max(...lanes) + 1.4] };
  }

  private updateFog(): void {
    const pea = this.pea!;
    const flight = (this.fadeX - this.startX) / PEA_SPEED;
    if (this.flying) {
      const u = Math.min(1, this.clock / flight);
      pea.position.x = this.startX + 0.25 + (this.fadeX - this.startX - 0.25) * u;
      pea.visible = true;
      if (u >= 1) {
        // Out of reach: it melts into the mist, where a real pea would.
        this.puffAt.set(this.fadeX, PEA_Y, this.lane + 0.5);
        this.fx.puff(this.puffAt, GHOST_PUFF);
        pea.visible = false;
        this.flying = false;
        this.clock = 0;
      }
    } else if (this.clock >= SHOW_REST) {
      this.flying = true;
      this.clock = 0;
      this.loops += 1;
      pea.position.x = this.startX + 0.25;
    }
    if (this.strip !== null) this.strip.opacity = 0.1 + 0.1 * (Math.floor(this.clock * 3) % 2);
  }

  private updateIce(): void {
    const run = (GHOST_FROM_X - GHOST_TO_X) / this.slideSpeed;
    if (this.flying) {
      const t = Math.min(this.clock, run);
      this.slider.object.position.x = GHOST_FROM_X - this.slideSpeed * t;
      if (this.walker !== null) {
        const w = this.walker.object;
        w.position.x = Math.max(GHOST_TO_X, GHOST_FROM_X - GHOST_WALK * t);
        w.position.y = Math.floor(t * 6) % 2 === 0 ? 0 : 0.04; // stepping, where the icy one glides
      }
      if (this.clock >= run) {
        this.flying = false;
        this.clock = 0;
      }
    } else if (this.clock >= SHOW_REST) {
      this.flying = true;
      this.clock = 0;
      this.loops += 1;
    }
    const level = PULSE_STEPS[Math.floor((this.clock + (this.flying ? 0 : 0.5)) * 6) % PULSE_STEPS.length] as number;
    for (const m of this.pulses) m.opacity = level;
  }

  private buildFog(reach: number): void {
    const z = this.lane + 0.5;
    const peaMaterial = new MeshBasicMaterial({ color: GHOST_PEA, transparent: true, opacity: 0.9 });
    const pea = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), peaMaterial);
    pea.name = 'ghost-pea';
    pea.position.set(this.startX, PEA_Y, z);
    pea.renderOrder = 12;
    this.pea = pea;
    const shooterMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
    const shooter = new Mesh(ghostShooter().build(), shooterMaterial);
    shooter.name = 'ghost-shooter';
    shooter.position.set(this.startX, 0, z);
    // How far a pea gets: a pale strip along the lane from the shooter to the puff.
    const stripMaterial = new MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.15, depthWrite: false });
    const stripGeometry = new PlaneGeometry(reach, 0.5);
    stripGeometry.rotateX(-Math.PI / 2);
    const strip = new Mesh(stripGeometry, stripMaterial);
    strip.name = 'fog-reach';
    strip.position.set(this.startX + reach / 2, 0.015, z);
    strip.renderOrder = 3;
    this.strip = stripMaterial;
    this.materials.push(peaMaterial, shooterMaterial, stripMaterial);
    this.group.add(strip, shooter, pea);
  }

  private buildIce(lanes: readonly number[]): void {
    for (const lane of lanes) {
      const material = new MeshBasicMaterial({ color: GHOST_ICE, transparent: true, opacity: PULSE_STEPS[0], depthWrite: false });
      const geometry = new PlaneGeometry(COLS, 0.94);
      geometry.rotateX(-Math.PI / 2);
      const glow = new Mesh(geometry, material);
      glow.name = 'ice-pulse';
      glow.position.set(COLS / 2, 0.014, lane + 0.5);
      glow.renderOrder = 3;
      this.materials.push(material);
      this.pulses.push(material);
      this.group.add(glow);
    }
  }

  private ghost(lane: number): Object3D {
    const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false });
    this.materials.push(material);
    const mesh = new Mesh(ghostZombie().build(), material);
    mesh.name = 'ghost-zombie';
    mesh.position.set(GHOST_FROM_X, 0, lane + 0.5);
    mesh.renderOrder = 12;
    this.group.add(mesh);
    return mesh;
  }

  /** Frees every geometry and material it made, and leaves the scene. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    this.pulses.length = 0;
    this.group.clear();
  }
}
