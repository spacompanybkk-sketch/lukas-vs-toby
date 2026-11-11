import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  type Object3D,
  type Vector3,
} from 'three';

// The particle pool: every particle in the game is a little cube, and every cube is one
// instance of one instanced mesh, so a screen full of debris is a single draw call. Nothing
// is allocated once the pool exists: emitting writes into fixed arrays, and updating writes
// the instance matrices in place.

export interface ParticleSpec {
  /** Where it starts, in world tiles. Copied, so the caller may reuse the vector. */
  position: Vector3;
  /** Tiles per second. Copied. */
  velocity: Vector3;
  /** 0xRRGGBB. */
  color: number;
  /** Edge of the cube, in tiles. */
  size: number;
  /** Seconds. */
  life: number;
  /** Downward pull in tiles per second squared; negative rises, as smoke does. Default 0. */
  gravity?: number;
  /**
   * Share of its speed a cube keeps when it lands on the island, 0 to 1. Without it a cube
   * falls through the ground and out of sight (sparks, motes and smoke never get there).
   */
  bounce?: number;
  /** Glows in its own colour, bright enough to bloom. */
  emissive?: boolean;
  /** How fast the cube grows, as a share of its size per second (smoke swells). Default 0. */
  grow?: number;
  /** How fast it tumbles, in turns per second at most. Default 1; 0 keeps it square to the world. */
  spin?: number;
}

/** The top of the island, where falling cubes land. Off its edge they fall on into the sky. */
const GROUND = { x0: -3.2, x1: 13.2, z0: -1.6, z1: 6.6 } as const;
/** Emissive intensity of a glowing cube. */
const GLOW = 2.6;
/** A cube shrinks away over the last part of its life: this long, or half its life if shorter. */
const FADE_SECONDS = 0.3;
/** A bounce slower than this settles instead. */
const REST_SPEED = 0.35;

/** A repeatable 0..1 value per emission, for the tumble (no `Math.random`: runs replay exactly). */
function hashUnit(n: number, salt: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Adds a per-instance glow to the standard material: the instance colour times `aGlow`. */
function addInstanceGlow(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = aGlow;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGlow;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * vGlow;');
}

const scratch = new Color();

export class Particles {
  readonly object: Object3D;
  readonly capacity: number;

  private readonly mesh: InstancedMesh;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;
  private readonly glow: Float32Array;
  private readonly glowAttribute: InstancedBufferAttribute;
  // Per slot. Position, velocity, life left and at birth, size, pull, bounce, growth, and the
  // tumble: two angles and their rates.
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly born: Float32Array;
  private readonly size: Float32Array;
  private readonly pull: Float32Array;
  private readonly bounce: Float32Array;
  private readonly grow: Float32Array;
  private readonly angleA: Float32Array;
  private readonly angleB: Float32Array;
  private readonly rateA: Float32Array;
  private readonly rateB: Float32Array;
  /** Next slot to write: the oldest emission still in the pool. */
  private cursor = 0;
  /** Slots ever written; the mesh draws this many. */
  private used = 0;
  private live = 0;
  private emitted = 0;

  constructor(capacity = 2000) {
    this.capacity = capacity;
    const floats = (n: number): Float32Array => new Float32Array(capacity * n);
    this.px = floats(1);
    this.py = floats(1);
    this.pz = floats(1);
    this.vx = floats(1);
    this.vy = floats(1);
    this.vz = floats(1);
    this.life = floats(1);
    this.born = floats(1);
    this.size = floats(1);
    this.pull = floats(1);
    this.bounce = floats(1);
    this.grow = floats(1);
    this.angleA = floats(1);
    this.angleB = floats(1);
    this.rateA = floats(1);
    this.rateB = floats(1);

    const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    material.onBeforeCompile = addInstanceGlow;
    material.name = 'particles';
    const geometry = new BoxGeometry(1, 1, 1);
    this.glow = floats(1);
    this.glowAttribute = new InstancedBufferAttribute(this.glow, 1);
    this.glowAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aGlow', this.glowAttribute);

    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = 'particles';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.matrices = mesh.instanceMatrix.array as Float32Array;
    this.matrices.fill(0);
    this.colors = floats(3);
    mesh.instanceColor = new InstancedBufferAttribute(this.colors, 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    // The cubes go everywhere, so the mesh is never culled as a whole.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    this.mesh = mesh;
    this.object = mesh;
  }

  /** How many particles are alive. */
  get alive(): number {
    return this.live;
  }

  /** Adds a particle. When the pool is full, the oldest one makes way. */
  emit(p: ParticleSpec): void {
    const i = this.cursor;
    if ((this.life[i] as number) > 0) this.live--;
    this.cursor = (i + 1) % this.capacity;
    if (i >= this.used) {
      this.used = i + 1;
      this.mesh.count = this.used;
    }
    const n = this.emitted++;
    this.px[i] = p.position.x;
    this.py[i] = p.position.y;
    this.pz[i] = p.position.z;
    this.vx[i] = p.velocity.x;
    this.vy[i] = p.velocity.y;
    this.vz[i] = p.velocity.z;
    const life = Math.max(1e-3, p.life);
    this.life[i] = life;
    this.born[i] = life;
    this.size[i] = p.size;
    this.pull[i] = p.gravity ?? 0;
    this.bounce[i] = p.bounce ?? -1;
    this.grow[i] = p.grow ?? 0;
    const spin = (p.spin ?? 1) * Math.PI * 2;
    this.angleA[i] = hashUnit(n, 1) * Math.PI * 2 * (spin > 0 ? 1 : 0);
    this.angleB[i] = hashUnit(n, 2) * Math.PI * 2 * (spin > 0 ? 1 : 0);
    this.rateA[i] = (hashUnit(n, 3) - 0.5) * 2 * spin;
    this.rateB[i] = (hashUnit(n, 4) - 0.5) * 2 * spin;
    scratch.setHex(p.color);
    this.colors[i * 3] = scratch.r;
    this.colors[i * 3 + 1] = scratch.g;
    this.colors[i * 3 + 2] = scratch.b;
    this.glow[i] = p.emissive ? GLOW : 0;
    this.live++;
    this.write(i);
    (this.mesh.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    this.glowAttribute.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Moves every particle on by `dtSeconds` of game time. */
  update(dtSeconds: number): void {
    if (this.used === 0) return;
    const dt = Math.max(0, dtSeconds);
    for (let i = 0; i < this.used; i++) {
      let life = this.life[i] as number;
      if (life <= 0) continue;
      life -= dt;
      if (life <= 0) {
        this.life[i] = 0;
        this.live--;
        this.hide(i);
        continue;
      }
      this.life[i] = life;

      let vy = (this.vy[i] as number) - (this.pull[i] as number) * dt;
      const x = (this.px[i] as number) + (this.vx[i] as number) * dt;
      let y = (this.py[i] as number) + vy * dt;
      const z = (this.pz[i] as number) + (this.vz[i] as number) * dt;
      this.size[i] = (this.size[i] as number) * (1 + (this.grow[i] as number) * dt);

      const bounce = this.bounce[i] as number;
      if (bounce >= 0 && x > GROUND.x0 && x < GROUND.x1 && z > GROUND.z0 && z < GROUND.z1) {
        const half = this.shownSize(i) / 2;
        if (y < half) {
          y = half;
          if (vy < 0) {
            vy = -vy * bounce;
            if (vy < REST_SPEED) vy = 0;
            // The ground takes some of the slide and most of the tumble.
            this.vx[i] = (this.vx[i] as number) * 0.6;
            this.vz[i] = (this.vz[i] as number) * 0.6;
            this.rateA[i] = (this.rateA[i] as number) * 0.4;
            this.rateB[i] = (this.rateB[i] as number) * 0.4;
          }
          if (vy === 0) {
            // Sliding to a stop.
            const drag = Math.max(0, 1 - 6 * dt);
            this.vx[i] = (this.vx[i] as number) * drag;
            this.vz[i] = (this.vz[i] as number) * drag;
          }
        }
      }
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.vy[i] = vy;
      this.angleA[i] = (this.angleA[i] as number) + (this.rateA[i] as number) * dt;
      this.angleB[i] = (this.angleB[i] as number) + (this.rateB[i] as number) * dt;
      this.write(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Removes every particle at once (a scene being reset). */
  clear(): void {
    for (let i = 0; i < this.used; i++) {
      this.life[i] = 0;
      this.hide(i);
    }
    this.live = 0;
    this.cursor = 0;
    this.used = 0;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * The live particles' centres as x, y, z triples, oldest slot first. For tests and
   * debugging; it allocates, so keep it out of the frame loop.
   */
  alivePositions(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.used; i++) {
      if ((this.life[i] as number) > 0) out.push(this.px[i] as number, this.py[i] as number, this.pz[i] as number);
    }
    return out;
  }

  /** Frees the mesh's geometry and material. Take `object` out of the scene first. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
  }

  /** The edge the cube is drawn at now: full size, shrinking to nothing at the end of its life. */
  private shownSize(i: number): number {
    const born = this.born[i] as number;
    const fade = Math.min(FADE_SECONDS, born * 0.5);
    return (this.size[i] as number) * Math.min(1, (this.life[i] as number) / fade);
  }

  private hide(i: number): void {
    this.matrices.fill(0, i * 16, i * 16 + 16);
  }

  /** Writes slot `i`'s matrix: its tumble, its size and its place. */
  private write(i: number): void {
    const s = this.shownSize(i);
    const a = this.angleA[i] as number;
    const b = this.angleB[i] as number;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    // Turned about Y by a, then about X by b; columns of that rotation, scaled by s.
    const m = this.matrices;
    const o = i * 16;
    m[o] = ca * s;
    m[o + 1] = 0;
    m[o + 2] = -sa * s;
    m[o + 3] = 0;
    m[o + 4] = sa * sb * s;
    m[o + 5] = cb * s;
    m[o + 6] = ca * sb * s;
    m[o + 7] = 0;
    m[o + 8] = sa * cb * s;
    m[o + 9] = -sb * s;
    m[o + 10] = ca * cb * s;
    m[o + 11] = 0;
    m[o + 12] = this.px[i] as number;
    m[o + 13] = this.py[i] as number;
    m[o + 14] = this.pz[i] as number;
    m[o + 15] = 1;
  }
}
