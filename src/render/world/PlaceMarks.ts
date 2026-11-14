import { Color, DataTexture, Mesh, NearestFilter, PlaneGeometry, RGBAFormat, ShaderMaterial, UnsignedByteType } from 'three';
import { LAWN_COLS, LAWN_LANES } from '../coords';
import { PALETTE } from '../palette';
import type { Faction } from '../types';

// Where the picked card may go (UX fix A): every such tile at once, as blocky pixel corner
// brackets (white, inked on the outside) round a light fill in the player's colour. One quad over
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
  uniform vec3 uFill;
  uniform vec3 uLine;
  uniform vec3 uInk;
  uniform float uFillOpacity;
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
    bool inside = p.x >= 2.0 && p.x <= 7.0 && p.y >= 2.0 && p.y <= 7.0;
    if (corner && ring) gl_FragColor = vec4(uLine, 0.95);
    else if (corner && edge) gl_FragColor = vec4(uInk, 0.55);
    else if (inside) gl_FragColor = vec4(uFill, uFillOpacity);
    else discard;
  }
`;

/** The fill under the brackets: light enough that the grass and the units read through it. */
const FILL_OPACITY = 0.22;

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
        uFill: { value: new Color(PALETTE.sun) },
        uLine: { value: new Color('#FFFFFF').multiplyScalar(1.3) },
        uInk: { value: new Color('#2A1B0E') },
        uFillOpacity: { value: FILL_OPACITY },
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
   * Shows the tiles marked 1 in `mask` (`lane * LAWN_COLS + col`) in `side`'s colour; null or an
   * all-zero mask hides the overlay. Call it when the tiles change, not every frame.
   */
  show(mask: Uint8Array | null, side: Faction): void {
    let any = false;
    for (let i = 0; i < LAWN_COLS * LAWN_LANES; i++) {
      const on = mask !== null && mask[i] === 1;
      this.data[i * 4] = on ? 255 : 0;
      if (on) any = true;
    }
    this.texture.needsUpdate = true;
    (this.material.uniforms.uFill as { value: Color }).value.set(side === 'plants' ? PALETTE.sun : PALETTE.lanePurple);
    this.mesh.visible = any;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
