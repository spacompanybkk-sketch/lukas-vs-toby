import { BackSide, Color, Group, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { DISPLAY_TO_SCENE_GLSL, SUN_TRAVEL } from '../Renderer';
import { BoxBatch, seededRandom } from './boxes';

// Art bible, World colours.
const SKY_TOP = '#5EC8FF';
const SKY_HORIZON = '#CFF3FF';
const CLOUD = '#FFFFFF';

const DOME_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w; // always behind everything else
  }
`;

// The camera looks down at the island, so what it sees is sky below the horizon. The
// gradient therefore runs both ways from the horizon, and the lower half carries the
// picture: pale where the view nears the horizon, the full sky blue straight down.
const DOME_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uDeep;
  varying vec3 vWorld;
  ${DISPLAY_TO_SCENE_GLSL}
  void main() {
    float h = normalize(vWorld - cameraPosition).y;
    vec3 above = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
    float down = clamp(-h, 0.0, 1.0);
    vec3 below = mix(uHorizon, uHaze, smoothstep(0.0, 0.3, down));
    below = mix(below, uTop, smoothstep(0.3, 0.86, down));
    below = mix(below, uDeep, smoothstep(0.84, 1.0, down));
    gl_FragColor = vec4(displayToScene(h >= 0.0 ? above : below), 1.0);
  }
`;

const CLOUD_VERTEX = /* glsl */ `
  attribute vec3 color;
  varying vec3 vNormal;
  varying float vHaze;
  varying float vHeight;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vHaze = color.r;
    vHeight = color.g;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Clouds are shaded by hand, in the colours they should have on screen, rather than by
// the scene lights: the lawn's green bounce light would turn their sides green. Most of
// the shading is a soft gradient up the cloud; the cube faces add only a little, or the
// stepped surface turns into a checkerboard.
const CLOUD_FRAGMENT = /* glsl */ `
  uniform vec3 uToSun;
  uniform vec3 uLit;
  uniform vec3 uSide;
  uniform vec3 uUnder;
  uniform vec3 uFar;
  varying vec3 vNormal;
  varying float vHaze;
  varying float vHeight;
  ${DISPLAY_TO_SCENE_GLSL}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 tone = mix(uUnder, uLit, smoothstep(0.0, 0.85, vHeight));
    float away = 1.0 - smoothstep(0.2, 0.9, dot(n, uToSun) * 0.5 + 0.5);
    tone = mix(tone, uSide, away * 0.5);
    tone = mix(tone, uUnder, clamp(-n.y, 0.0, 1.0));
    gl_FragColor = vec4(displayToScene(mix(tone, uFar, vHaze)), 1.0);
  }
`;

interface CloudSpec {
  /** Centre of the cloud's flat base at time 0. */
  at: [number, number, number];
  /** How many puffs it is made of, side by side. */
  puffs: number;
  /** Edge of one cloud voxel in tiles. */
  voxel: number;
  /** World units per second along +X. */
  drift: number;
  /** 0 near and crisp, 1 far and washed into the sky. */
  haze: number;
  seed: number;
}

/**
 * The six clouds, all below the island so it floats above them. They are placed for the
 * framed camera: a bank behind the back-left corner, one off the right end, a far small
 * one at the top, two low at the front corners and a big hazy one far beneath the keel.
 */
const CLOUDS: CloudSpec[] = [
  { at: [-4.8, -5.2, -7.6], puffs: 5, voxel: 0.34, drift: 0.09, haze: 0.06, seed: 11 },
  { at: [15.4, -4.0, -3.2], puffs: 4, voxel: 0.3, drift: 0.07, haze: 0.04, seed: 23 },
  { at: [11.6, -8.0, -12.4], puffs: 3, voxel: 0.34, drift: 0.05, haze: 0.4, seed: 37 },
  { at: [-4.8, -6.0, 4.6], puffs: 3, voxel: 0.3, drift: 0.1, haze: 0.0, seed: 41 },
  { at: [13.6, -7.0, 4.9], puffs: 4, voxel: 0.3, drift: 0.08, haze: 0.1, seed: 59 },
  { at: [6.0, -12.0, 2.8], puffs: 4, voxel: 0.42, drift: 0.04, haze: 0.55, seed: 67 },
];

/** Clouds wrap round inside this x range. */
const DRIFT_MIN_X = -30;
const DRIFT_MAX_X = 40;

interface Puff {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/** A cumulus made of overlapping rounded puffs cut into cubes, flat underneath. */
function buildCloud(spec: CloudSpec): BoxBatch {
  const random = seededRandom(spec.seed);
  const puffs: Puff[] = [];
  let x = 0;
  for (let i = 0; i < spec.puffs; i++) {
    const middle = Math.sin(((i + 0.5) / spec.puffs) * Math.PI); // biggest in the middle
    const r = 1.6 + middle * 1.5 + random() * 0.7;
    puffs.push({ x, y: r * (0.1 + random() * 0.25), z: (random() - 0.5) * 2.4, rx: r * 1.25, ry: r * 0.95, rz: r * (0.9 + random() * 0.35) });
    x += r * (1.25 + random() * 0.35);
  }
  const shift = x / 2;
  for (const puff of puffs) puff.x -= shift;

  let reach = 0;
  let top = 0;
  let depth = 0;
  for (const puff of puffs) {
    reach = Math.max(reach, Math.abs(puff.x) + puff.rx);
    top = Math.max(top, puff.y + puff.ry);
    depth = Math.max(depth, Math.abs(puff.z) + puff.rz);
  }
  const solid = (i: number, j: number, k: number): boolean => {
    for (const puff of puffs) {
      const dx = (i + 0.5 - puff.x) / puff.rx;
      const dy = (j + 0.5 - puff.y) / puff.ry;
      const dz = (k + 0.5 - puff.z) / puff.rz;
      if (dx * dx + dy * dy + dz * dz < 1) return true;
    }
    return false;
  };
  // The vertex colour is not a colour here: red carries the haze amount and green how far
  // up the cloud the cube is. The shader does the rest.
  const layers = Math.ceil(top);
  const tints = Array.from({ length: layers + 1 }, (_, j) => new Color(spec.haze, (j + 0.5) / layers, 0));
  const batch = new BoxBatch();
  batch.voxels(
    spec.voxel,
    [-Math.ceil(reach), 0, -Math.ceil(depth)],
    [Math.ceil(reach), layers, Math.ceil(depth)],
    solid,
    (_i, j) => tints[j] as Color,
  );
  return batch;
}

/** Gradient sky dome and six drifting voxel clouds. */
export class Sky {
  readonly group = new Group();
  private readonly clouds: { mesh: Mesh; spec: CloudSpec }[] = [];

  constructor() {
    this.group.name = 'sky';

    const dome = new Mesh(
      new SphereGeometry(400, 32, 16),
      new ShaderMaterial({
        vertexShader: DOME_VERTEX,
        fragmentShader: DOME_FRAGMENT,
        uniforms: {
          uTop: { value: new Color(SKY_TOP) },
          uHorizon: { value: new Color(SKY_HORIZON) },
          // Between the two, for the part of the lower sky the camera sees most.
          uHaze: { value: new Color('#9AD8FA') },
          uDeep: { value: new Color('#4DB9F6') },
        },
        side: BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    dome.name = 'sky-dome';
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    dome.position.set(5, 0, 2.5);
    this.group.add(dome);

    const cloudMaterial = new ShaderMaterial({
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms: {
        uToSun: { value: SUN_TRAVEL.clone().negate() },
        uLit: { value: new Color(CLOUD) },
        uSide: { value: new Color('#BBDCF5') },
        uUnder: { value: new Color('#A6D2F4') },
        uFar: { value: new Color('#8FD6FF') },
      },
    });
    for (const spec of CLOUDS) {
      const mesh = new Mesh(buildCloud(spec).build(), cloudMaterial);
      mesh.name = 'cloud';
      this.group.add(mesh);
      this.clouds.push({ mesh, spec });
    }
    this.update(0);
  }

  update(timeSeconds: number): void {
    const span = DRIFT_MAX_X - DRIFT_MIN_X;
    for (const { mesh, spec } of this.clouds) {
      const travelled = spec.at[0] - DRIFT_MIN_X + spec.drift * timeSeconds;
      const x = DRIFT_MIN_X + (((travelled % span) + span) % span);
      const bob = Math.sin(timeSeconds * 0.25 + spec.seed) * 0.12;
      mesh.position.set(x, spec.at[1] + bob, spec.at[2]);
    }
  }
}
