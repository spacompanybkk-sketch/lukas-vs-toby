import { Color, DataTexture, Mesh, NearestFilter, PlaneGeometry, RGBAFormat, ShaderMaterial, UnsignedByteType } from 'three';
import { LAWN_COLS, LAWN_LANES } from '../coords';

// Where the picked card may go (UX fix A): every such tile at once, as thin blocky pixel corner
// brackets (white, inked on the outside) and nothing between them, so the lawn still reads as
// lawn. Quiet (`MARKS_QUIET`) while a card merely stays picked; loud (`MARKS_LOUD`) while one is
// being dragged or just after one is tapped (`setStrength`, driven by the session). One quad over
// the whole lawn; which tiles show is a 10 × 5 texture (one texel a tile, nearest sampling), so a
// change of tiles is 200 bytes uploaded and never a new mesh. Each tile is drawn as 10 × 10
// hard-edged "pixels", in the HUD's Minecraft look rather than the round hover mark's.

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec3 uLine;
  uniform vec3 uInk;
  uniform float uStrength;
  varying vec2 vUv;
  const vec2 GRID = vec2(${LAWN_COLS}.0, ${LAWN_LANES}.0);
  const float PX = 10.0;
  void main() {
    // x along the columns, y down the lanes (lane 0 at the back, where the quad's v is 1).
    vec2 g = vec2(vUv.x * GRID.x, (1.0 - vUv.y) * GRID.y);
    vec2 cell = clamp(floor(g), vec2(0.0), GRID - 1.0);
    if (texture2D(uMask, (cell + 0.5) / GRID).r < 0.5) discard;
    vec2 p = floor(fract(g) * PX);
    bool corner = (p.x <= 3.0 || p.x >= 6.0) && (p.y <= 3.0 || p.y >= 6.0);
    bool ring = ((p.x == 1.0 || p.x == 8.0) && p.y >= 1.0 && p.y <= 8.0) || ((p.y == 1.0 || p.y == 8.0) && p.x >= 1.0 && p.x <= 8.0);
    bool edge = p.x == 0.0 || p.x == 9.0 || p.y == 0.0 || p.y == 9.0;
    // The blend happens in linear light, which brightens a thin white a lot once shown on screen:
    // a strength of 0.35 needs about 5% cover to look like 35% (measured on the iPad-size shots).
    float a = pow(uStrength, 2.8);
    if (corner && ring) gl_FragColor = vec4(uLine, 0.95 * a);
    else if (corner && edge) gl_FragColor = vec4(uInk, 0.55 * a);
    else discard;
  }
`;

/** The brackets while a card just stays picked: there, but the lawn reads as lawn. */
export const MARKS_QUIET = 0.35;
/** The brackets while a card is dragged, or just after one is tapped. */
export const MARKS_LOUD = 1;

/** The tiles a picked card may go on, all at once (see the note at the top). */
export class PlaceMarks {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly texture: DataTexture;
  private readonly data = new Uint8Array(LAWN_COLS * LAWN_LANES * 4);

  constructor() {
    this.texture = new DataTexture(this.data, LAWN_COLS, LAWN_LANES, RGBAFormat, UnsignedByteType);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMask: { value: this.texture },
        uLine: { value: new Color('#FFFFFF').multiplyScalar(1.3) },
        uInk: { value: new Color('#2A1B0E') },
        uStrength: { value: MARKS_QUIET },
      },
      transparent: true,
      depthWrite: false,
    });
    const geometry = new PlaneGeometry(LAWN_COLS, LAWN_LANES);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'place-marks';
    this.mesh.position.set(LAWN_COLS / 2, 0.011, LAWN_LANES / 2);
    // Under the hover mark (renderOrder 2), over the grass.
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /**
   * Shows the tiles marked 1 in `mask` (`lane * LAWN_COLS + col`); null or an all-zero mask hides
   * the overlay. Call it when the tiles change, not every frame.
   */
  show(mask: Uint8Array | null): void {
    let any = false;
    for (let i = 0; i < LAWN_COLS * LAWN_LANES; i++) {
      const on = mask !== null && mask[i] === 1;
      this.data[i * 4] = on ? 255 : 0;
      if (on) any = true;
    }
    this.texture.needsUpdate = true;
    this.mesh.visible = any;
  }

  /** How strongly the brackets show, 0..1 (`MARKS_QUIET`, `MARKS_LOUD`). */
  setStrength(strength: number): void {
    (this.material.uniforms.uStrength as { value: number }).value = strength;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
