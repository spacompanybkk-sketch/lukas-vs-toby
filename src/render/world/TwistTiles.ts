import { Color, Group, Mesh, PlaneGeometry, ShaderMaterial, type Material } from 'three';
import { DISPLAY_TO_SCENE_GLSL } from '../look';
import type { WorldKey } from '../../data/worlds';
import { COLS, PLANT_COLS } from '../../sim/types';

// The lawn twists as the player sees them: boulders on rock tiles, mist over a foggy lawn,
// icy lanes and glowing lava tiles. Built once when a battle starts (the twists never change
// during a match); `update` only moves uniforms.

// TODO(merge): import LawnConfig and NO_TWIST from the sim once the twist task is merged; this
// is the same shape, declared here so the render layer builds before it.
/** What a level does to the lawn (the sim's `MatchConfig.lawn`). */
export interface LawnConfig {
  /** Tiles a plant may not be put on, as lane * PLANT_COLS + col. */
  rocks: number[];
  /** Tiles a shot reaches before it fades, or null for no fog. */
  fog: number | null;
  ice: { lanes: number[]; speed: number } | null;
  /** Burning tiles, as lane * COLS + col. */
  lava: { tiles: number[]; dps: number; burnTicks: number } | null;
}

/** A lawn with no twist. */
export const NO_TWIST: LawnConfig = { rocks: [], fog: null, ice: null, lava: null };

/**
 * Each world's twist as a level might use it, for the tools and the debug hooks until the
 * levels of worlds 2–5 exist (numbers as `Balance.twists` will give them).
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

// ---- Fog: low sheets of blocky mist ----------------------------------------------------------

const MIST_VERTEX = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Value noise sampled on an eighth-tile grid, so the mist is made of hard-edged pixels that
// drift a cell at a time. Thin over the lawn's ends, where the bases stand.
const MIST_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vXZ;
  ${DISPLAY_TO_SCENE_GLSL}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 p = floor((vXZ + vec2(uTime * 0.18, uTime * 0.05)) * 8.0) / 8.0;
    float n = noise(p * 0.7) * 0.65 + noise(p * 1.9 + 7.3) * 0.35;
    float a = smoothstep(0.42, 0.78, n);
    // Fades out past the lawn's edges.
    float edge = smoothstep(-1.2, 0.4, vXZ.x) * (1.0 - smoothstep(9.6, 11.2, vXZ.x))
               * smoothstep(-1.0, 0.2, vXZ.y) * (1.0 - smoothstep(4.8, 6.0, vXZ.y));
    a *= edge * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(displayToScene(uColor), a);
  }
`;

/** The mist sheets: height above the lawn and opacity, the low ones thicker. */
const MIST_SHEETS: readonly [number, number][] = [
  [0.08, 0.17],
  [0.22, 0.12],
  [0.4, 0.08],
];
const MIST_COLOR = '#BCCBF0';

/** The twist visuals of one lawn config, as one group. */
export class TwistTiles {
  readonly group = new Group();
  private readonly materials: Material[] = [];
  private readonly time = { value: 0 };

  constructor(readonly config: LawnConfig) {
    this.group.name = 'twist-tiles';
    if (config.fog !== null) this.buildMist();
  }

  /** Moves the mist and the lava's glow on to `timeSeconds`. Allocates nothing. */
  update(timeSeconds: number): void {
    this.time.value = timeSeconds % 3600;
  }

  private buildMist(): void {
    const geometry = new PlaneGeometry(14, 8);
    geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < MIST_SHEETS.length; i++) {
      const [y, opacity] = MIST_SHEETS[i] as [number, number];
      const material = new ShaderMaterial({
        vertexShader: MIST_VERTEX,
        fragmentShader: MIST_FRAGMENT,
        uniforms: { uTime: this.time, uSeed: { value: i * 3.7 }, uOpacity: { value: opacity }, uColor: { value: new Color(MIST_COLOR) } },
        transparent: true,
        depthWrite: false,
      });
      this.materials.push(material);
      const sheet = new Mesh(i === 0 ? geometry : geometry.clone(), material);
      sheet.name = 'mist';
      sheet.position.set(5, y, 2.5);
      // Under the placement marks (2) and the health bars (20).
      sheet.renderOrder = 1;
      this.group.add(sheet);
    }
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
