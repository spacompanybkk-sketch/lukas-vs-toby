import { Color, DataTexture, Mesh, NearestFilter, PlaneGeometry, RGBAFormat, ShaderMaterial, UnsignedByteType } from 'three';
import { LAWN_COLS, LAWN_LANES } from '../coords';

// Where the picked card may go (UX fix A): every such tile at once, as thin blocky pixel corner
// brackets (white, inked on the outside) and nothing between them, so the lawn still reads as
// lawn. Quiet (`MARKS_QUIET`) while a card merely stays picked; loud (`MARKS_LOUD`) while one is
// being dragged or just after one is tapped (`setStrength`, driven by the session). One quad over
// the whole lawn; which tiles show is a 10 × 5 texture (one texel a tile, nearest sampling), so a
// change of tiles is 200 bytes uploaded and never a new mesh. Each tile is drawn as 10 × 10
// hard-edged "pixels", in the HUD's Minecraft look rather than the round hover mark's.
//
// A marked tile that is lava (the sim lets a plant go there, and it burns; `setWarn`) gets its
// brackets from a second quad instead: warning orange with a burnt-black rim, opaque at any
// strength (the molten glow is far over white, so anything see-through vanishes in it), lifted
// over the lava's crust. "You can, but it burns." The warn flag is the texel's green byte; the
// plain quad skips those tiles, so every other tile draws exactly as before.

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = (warn: boolean): string => /* glsl */ `
  uniform sampler2D uMask;
  uniform vec3 uLine;
  uniform vec3 uInk;
  uniform float uStrength;
  uniform float uGamma;
  varying vec2 vUv;
  const vec2 GRID = vec2(${LAWN_COLS}.0, ${LAWN_LANES}.0);
  const float PX = 10.0;
  void main() {
    // x along the columns, y down the lanes (lane 0 at the back, where the quad's v is 1).
    vec2 g = vec2(vUv.x * GRID.x, (1.0 - vUv.y) * GRID.y);
    vec2 cell = clamp(floor(g), vec2(0.0), GRID - 1.0);
    vec4 texel = texture2D(uMask, (cell + 0.5) / GRID);
    if (texel.r < 0.5 || texel.g ${warn ? '<' : '>'} 0.5) discard;
    vec2 p = floor(fract(g) * PX);
    bool corner = (p.x <= 3.0 || p.x >= 6.0) && (p.y <= 3.0 || p.y >= 6.0);
    bool ring = ((p.x == 1.0 || p.x == 8.0) && p.y >= 1.0 && p.y <= 8.0) || ((p.y == 1.0 || p.y == 8.0) && p.x >= 1.0 && p.x <= 8.0);
    bool edge = p.x == 0.0 || p.x == 9.0 || p.y == 0.0 || p.y == 9.0;
${warn ? `
    // The lava warning: a bracket four pixels thick, ink · orange · orange · ink, opaque.
    float d = min(min(p.x, 9.0 - p.x), min(p.y, 9.0 - p.y));
    if (corner && (d == 1.0 || d == 2.0)) gl_FragColor = vec4(uLine, 1.0);
    else if (corner && (d == 0.0 || d == 3.0)) gl_FragColor = vec4(uInk, 1.0);
    else discard;` : `
    // The blend happens in linear light, which brightens a thin white a lot once shown on screen:
    // a strength of 0.35 needs about 5% cover to look like 35% (measured on the iPad-size shots).
    // (A dark line on pale ground blends without that brightening: its look sets uGamma lower.)
    float a = pow(uStrength, uGamma);
    if (corner && ring) gl_FragColor = vec4(uLine, 0.95 * a);
    else if (corner && edge) gl_FragColor = vec4(uInk, 0.55 * a);
    else discard;`}
  }
`;

/** The brackets while a card just stays picked: there, but the lawn reads as lawn. */
export const MARKS_QUIET = 0.35;
/** The brackets while a card is dragged, or just after one is tapped. */
export const MARKS_LOUD = 1;

/**
 * The brackets' colours on a world's ground: `line` (times `lineGain`) inked with `ink` on the
 * outside, and the strength curve `gamma` (see the shader). White inked in brown on every ground but
 * pale snow, where the line turns dark and the ink white.
 */
export interface MarksLook {
  line: string;
  lineGain: number;
  ink: string;
  gamma: number;
}

export const MARKS_BACKYARD: MarksLook = { line: '#FFFFFF', lineGain: 1.3, ink: '#2A1B0E', gamma: 2.8 };

/** The brackets on a lava tile, in every world: warning orange with a burnt-black rim. */
export const MARKS_LAVA = { line: '#FF7A00', ink: '#1E0A02' } as const;
/** The lava brackets' height: over the basalt crust round a pool (at most 0.055 tall). */
export const MARKS_LAVA_Y = 0.065;

/** The tiles a picked card may go on, all at once (see the note at the top). */
export class PlaceMarks {
  readonly mesh: Mesh;
  /** The lava tiles' brackets (a second quad over the same texture; see the note at the top). */
  readonly warnMesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly warnMaterial: ShaderMaterial;
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
      fragmentShader: fragment(false),
      uniforms: {
        uMask: { value: this.texture },
        uLine: { value: new Color(MARKS_BACKYARD.line).multiplyScalar(MARKS_BACKYARD.lineGain) },
        uInk: { value: new Color(MARKS_BACKYARD.ink) },
        uStrength: { value: MARKS_QUIET },
        uGamma: { value: MARKS_BACKYARD.gamma },
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

    this.warnMaterial = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: fragment(true),
      uniforms: {
        uMask: { value: this.texture },
        uLine: { value: new Color(MARKS_LAVA.line) },
        uInk: { value: new Color(MARKS_LAVA.ink) },
        uStrength: { value: 1 },
        uGamma: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.warnMesh = new Mesh(geometry, this.warnMaterial);
    this.warnMesh.name = 'place-marks-lava';
    this.warnMesh.position.set(LAWN_COLS / 2, MARKS_LAVA_Y, LAWN_LANES / 2);
    this.warnMesh.renderOrder = 1;
    this.warnMesh.visible = false;
  }

  /**
   * Shows the tiles marked 1 in `mask` (`lane * LAWN_COLS + col`); null or an all-zero mask hides
   * the overlay. Call it when the tiles change, not every frame.
   */
  show(mask: Uint8Array | null): void {
    for (let i = 0; i < LAWN_COLS * LAWN_LANES; i++) this.data[i * 4] = mask !== null && mask[i] === 1 ? 255 : 0;
    this.refresh();
  }

  /**
   * The tiles (`lane * LAWN_COLS + col`) whose brackets are the lava warning when marked: the
   * lawn's lava. Call it when the world changes; it never marks a tile by itself.
   */
  setWarn(tiles: readonly number[]): void {
    for (let i = 0; i < LAWN_COLS * LAWN_LANES; i++) this.data[i * 4 + 1] = 0;
    for (const t of tiles) if (t >= 0 && t < LAWN_COLS * LAWN_LANES) this.data[t * 4 + 1] = 255;
    this.refresh();
  }

  /** Uploads the texture; each quad shows only while it has a tile to draw. */
  private refresh(): void {
    let plain = false;
    let warned = false;
    for (let i = 0; i < LAWN_COLS * LAWN_LANES; i++) {
      if (this.data[i * 4] === 0) continue;
      if (this.data[i * 4 + 1] !== 0) warned = true;
      else plain = true;
    }
    this.texture.needsUpdate = true;
    this.mesh.visible = plain;
    this.warnMesh.visible = warned;
  }

  /** How strongly the brackets show, 0..1 (`MARKS_QUIET`, `MARKS_LOUD`); the lava warning always shows in full. */
  setStrength(strength: number): void {
    (this.material.uniforms.uStrength as { value: number }).value = strength;
  }

  /** Recolours the brackets for a world's ground (uniforms only); the lava warning keeps its colours. */
  setLook(look: MarksLook): void {
    const u = this.material.uniforms;
    (u.uLine as { value: Color }).value.set(look.line).multiplyScalar(look.lineGain);
    (u.uInk as { value: Color }).value.set(look.ink);
    (u.uGamma as { value: number }).value = look.gamma;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.warnMaterial.dispose();
    this.texture.dispose();
  }
}
