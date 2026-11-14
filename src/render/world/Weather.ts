import {
  BoxGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
} from 'three';
import { DISPLAY_TO_SCENE_GLSL } from '../look';
import { seededRandom } from './boxes';

// Weather over a world's island: fireflies, blown dust, snowfall or rising embers. Each kind is
// one instanced mesh of little cubes (one draw call) that the vertex shader moves by time alone,
// so a frame costs one uniform write and allocates nothing. Drawn after the opaque scene with no
// depth written, so the ambient occlusion pass never sees a flake, and before the health bars
// (render order 20, no depth test), which therefore always show over it.

export type WeatherKind = 'none' | 'fireflies' | 'dust' | 'snow' | 'embers';

interface WeatherSpec {
  count: number;
  /** Edge of a cube in tiles, smallest and largest. */
  size: [number, number];
  /** Colours as they should show on screen, picked per cube. */
  colors: string[];
  /** Above 0 the colour is a glow (scene luminance multiplier, bloom from about 1.2); 0 is painted. */
  glow: number;
  /** The box the cubes live in, wrapping round: x, y, z ranges. */
  box: { x: [number, number]; y: [number, number]; z: [number, number] };
  /** Travel per second along x and y (each cube 60–140% of it). */
  drift: [number, number];
  /** How far a cube wanders either side of its path, and how fast. */
  sway: number;
  swaySpeed: number;
  /** Fireflies blink; embers shrink as they rise. */
  blink: boolean;
  shrink: boolean;
  /** Share of a cube's own opacity (dust is thin). */
  opacity: number;
}

const BOX = { x: [-3.2, 13.2] as [number, number], z: [-1.4, 6.4] as [number, number] };

const SPECS: Record<Exclude<WeatherKind, 'none'>, WeatherSpec> = {
  fireflies: {
    count: 46, size: [0.045, 0.06], colors: ['#E8FF7A', '#C8FF5A', '#FFF59A'], glow: 3.2,
    box: { x: BOX.x, y: [0.25, 1.8], z: BOX.z }, drift: [0.05, 0.02], sway: 0.45, swaySpeed: 0.55,
    blink: true, shrink: false, opacity: 1,
  },
  dust: {
    count: 240, size: [0.025, 0.05], colors: ['#E9C98C', '#D8AE6A', '#F3DDB0'], glow: 0,
    box: { x: BOX.x, y: [0.05, 1.4], z: BOX.z }, drift: [1.1, 0.04], sway: 0.18, swaySpeed: 1.3,
    blink: false, shrink: false, opacity: 0.75,
  },
  snow: {
    count: 520, size: [0.03, 0.055], colors: ['#FFFFFF', '#F2F8FF', '#E4F0FF'], glow: 0,
    box: { x: BOX.x, y: [-0.2, 4.5], z: BOX.z }, drift: [0.12, -0.55], sway: 0.16, swaySpeed: 0.9,
    blink: false, shrink: false, opacity: 1,
  },
  embers: {
    count: 150, size: [0.03, 0.055], colors: ['#FF7A1A', '#FFB23F', '#FF5A1A'], glow: 2.6,
    box: { x: BOX.x, y: [0, 3.2], z: BOX.z }, drift: [0.08, 0.42], sway: 0.22, swaySpeed: 1.1,
    blink: false, shrink: true, opacity: 1,
  },
};

const VERTEX = /* glsl */ `
  attribute vec4 aSeed;   // x, y, z start in 0..1 of the box; w the cube's own speed and phase
  attribute vec3 aColor;
  uniform float uTime;
  uniform vec3 uMin;
  uniform vec3 uSize;
  uniform vec2 uDrift;
  uniform vec2 uCube;     // smallest and largest edge
  uniform float uSway;
  uniform float uSwaySpeed;
  uniform float uBlink;
  uniform float uShrink;
  varying vec3 vColor;
  varying float vShade;
  varying float vAlpha;
  void main() {
    float speed = 0.6 + aSeed.w * 0.8;
    float phase = aSeed.w * 43.7 + aSeed.x * 17.1;
    vec3 p = aSeed.xyz * uSize;
    p.x += uDrift.x * speed * uTime;
    p.y += uDrift.y * speed * uTime;
    p.x += sin(uTime * uSwaySpeed * speed + phase) * uSway;
    p.z += cos(uTime * uSwaySpeed * 0.8 * speed + phase * 1.3) * uSway;
    p.y += sin(uTime * uSwaySpeed * 1.3 + phase * 0.7) * uSway * 0.4;
    p = mod(p, uSize) + uMin;
    float rise = clamp((p.y - uMin.y) / uSize.y, 0.0, 1.0);
    float edge = mix(uCube.x, uCube.y, fract(aSeed.w * 7.31));
    // Embers burn out as they rise; fireflies glow on and off.
    edge *= mix(1.0, 1.0 - rise * rise, uShrink);
    float blink = 0.5 + 0.5 * sin(uTime * 2.1 * speed + phase);
    vAlpha = mix(1.0, smoothstep(0.15, 0.6, blink), uBlink);
    // Thin out at the top and bottom of the box, so a cube never pops into view.
    vAlpha *= smoothstep(0.0, 0.08, rise) * (1.0 - smoothstep(0.86, 1.0, rise));
    vColor = aColor;
    // Voxel shading: tops light, sides a little darker.
    vShade = normal.y > 0.5 ? 1.0 : normal.y < -0.5 ? 0.62 : 0.8;
    vec4 world = vec4(p + position * edge, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uGlow;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vShade;
  varying float vAlpha;
  ${DISPLAY_TO_SCENE_GLSL}
  void main() {
    vec3 c = uGlow > 0.0 ? vColor * uGlow * mix(0.85, 1.0, vShade) : displayToScene(vColor * vShade);
    float a = vAlpha * uOpacity;
    if (a < 0.02) discard;
    gl_FragColor = vec4(c, a);
  }
`;

/** One kind of weather over the island, or none. */
export class Weather {
  readonly mesh: Mesh | null;
  private readonly time: { value: number } = { value: 0 };

  constructor(readonly kind: WeatherKind) {
    if (kind === 'none') {
      this.mesh = null;
      return;
    }
    const spec = SPECS[kind];
    const random = seededRandom(9100 + spec.count);
    const geometry = new InstancedBufferGeometry();
    const cube = new BoxGeometry(1, 1, 1);
    geometry.index = cube.index;
    geometry.setAttribute('position', cube.getAttribute('position'));
    geometry.setAttribute('normal', cube.getAttribute('normal'));
    cube.dispose();
    const seeds = new Float32Array(spec.count * 4);
    const colors = new Float32Array(spec.count * 3);
    const color = new Color();
    for (let i = 0; i < spec.count; i++) {
      seeds.set([random(), random(), random(), random()], i * 4);
      // Linear: the painted path turns it into the scene colour that shows as it; a glow is one.
      color.set(spec.colors[Math.floor(random() * spec.colors.length)] as string);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    geometry.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
    geometry.instanceCount = spec.count;

    const { box } = spec;
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: this.time,
        uMin: { value: [box.x[0], box.y[0], box.z[0]] },
        uSize: { value: [box.x[1] - box.x[0], box.y[1] - box.y[0], box.z[1] - box.z[0]] },
        uDrift: { value: spec.drift },
        uCube: { value: spec.size },
        uSway: { value: spec.sway },
        uSwaySpeed: { value: spec.swaySpeed },
        uBlink: { value: spec.blink ? 1 : 0 },
        uShrink: { value: spec.shrink ? 1 : 0 },
        uGlow: { value: spec.glow },
        uOpacity: { value: spec.opacity },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = `weather-${kind}`;
    mesh.frustumCulled = false; // the shader moves every cube; there are no bounds to cull by
    mesh.renderOrder = 5;
    this.mesh = mesh;
  }

  /** Moves the weather on to `timeSeconds`. */
  update(timeSeconds: number): void {
    // Wrapped, so float precision holds however long the page stays open.
    this.time.value = timeSeconds % 3600;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
