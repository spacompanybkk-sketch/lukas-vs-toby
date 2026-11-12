import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import { PALETTE } from '../palette';
import type { Faction } from '../types';

// Placement highlight (art bible section 6): a rounded white outline with a 30% fill in
// the player's colour, or red warning stripes where the spot is not allowed. One quad.

const MARK_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MARK_FRAGMENT = /* glsl */ `
  uniform vec2 uSize;
  uniform vec3 uFill;
  uniform vec3 uLine;
  uniform float uPulse;
  uniform float uFillOpacity;
  uniform float uStripes;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float radius = 0.13;
    vec2 q = abs(p) - (uSize * 0.5 - 0.035 - radius);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float aa = max(fwidth(d), 1e-4);
    float inside = 1.0 - smoothstep(-aa, aa, d);
    float line = inside * smoothstep(-0.055 - aa, -0.055 + aa, d);
    // Warning stripes: red laid thinly over green grass comes out orange, so the forbidden
    // mark is solid diagonal bands with nothing at all between them.
    float band = abs(fract((p.x + p.y) * 3.5) - 0.5) * 2.0;
    float bandAa = max(fwidth((p.x + p.y) * 3.5) * 2.0, 1e-4);
    float stripe = uStripes * smoothstep(0.62 - bandAa, 0.62 + bandAa, band);
    // The fill breathes a little either side of its set opacity.
    float wash = uFillOpacity * (1.0 + 0.15 * (2.0 * uPulse - 1.0));
    float fill = inside * max(wash, stripe);
    gl_FragColor = vec4(mix(uFill, uLine, line), max(line * 0.96, fill));
  }
`;

export type MarkState = 'ok' | 'bad';

/** Art bible section 6: a 30% fill. */
const FILL_OPACITY = 0.3;
/** A zombie spell's area: brain pink, filled more strongly, so it reads on grass and graveyard alike. */
const VIVID_ZOMBIE_FILL = '#D6197F';
const VIVID_ZOMBIE_LINE = '#FF8AC8';
const VIVID_FILL_OPACITY = 0.92;

/** A highlight lying on the lawn: one tile, or a strip of them. */
export class TileMark {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  /** True for a spell's area: the zombies' mark is drawn in vivid brain pink. */
  private readonly vivid: boolean;

  /** `width` along X and `depth` along Z, in tiles. */
  constructor(name: string, width: number, depth: number, options: { vivid?: boolean } = {}) {
    this.vivid = options.vivid ?? false;
    this.material = new ShaderMaterial({
      vertexShader: MARK_VERTEX,
      fragmentShader: MARK_FRAGMENT,
      uniforms: {
        uSize: { value: new Vector2(width, depth) },
        uFill: { value: new Color() },
        uLine: { value: new Color() },
        uPulse: { value: 0.5 },
        uFillOpacity: { value: FILL_OPACITY },
        uStripes: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    const geometry = new PlaneGeometry(width, depth);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = name;
    this.mesh.position.y = 0.012;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /**
   * Shows the mark centred on (x, z). `ok` is a white outline round a 30% fill in the
   * colour of `side` (Sun yellow for plants, purple for zombies); `bad` is a red outline
   * round red stripes, whoever is asking.
   */
  show(x: number, z: number, state: MarkState, side: Faction): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    const bad = state === 'bad';
    // A vivid mark (a spell's area) on the zombies' side is brain pink with a pink rim, filled as
    // strongly as the plants' yellow: the lane purple washes out to grey on the grass.
    const vivid = this.vivid && side === 'zombies' && !bad;
    const fill = bad ? PALETTE.denyRed : side === 'plants' ? PALETTE.sun : vivid ? VIVID_ZOMBIE_FILL : PALETTE.lanePurple;
    this.uniform<Color>('uFill').value.set(fill);
    // The outline is a little brighter than any lit surface, so it keeps a faint glow.
    this.uniform<Color>('uLine')
      .value.set(bad ? PALETTE.denyRed : vivid ? VIVID_ZOMBIE_LINE : '#FFFFFF')
      .multiplyScalar(1.3);
    this.uniform<number>('uFillOpacity').value = bad ? 0 : vivid ? VIVID_FILL_OPACITY : FILL_OPACITY;
    this.uniform<number>('uStripes').value = bad ? 1 : 0;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /** `amount` 0..1 moves the fill between a little under and a little over its opacity. */
  pulse(amount: number): void {
    this.uniform<number>('uPulse').value = amount;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private uniform<T>(name: string): { value: T } {
    return this.material.uniforms[name] as { value: T };
  }
}
