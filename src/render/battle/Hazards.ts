import { Color, Group, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import { InstanceBatch } from '../fx/InstanceBatch';
import { glowMaterial } from '../fx/glow';
import { MATTE_PLASTIC } from '../look';
import { BoxBatch, hash2 } from '../world/boxes';

// Brain Rot's poison puddles (plan Task 5): a flat stepped toxic green-yellow decal with a pale rim, on the lawn, with
// glowing bubbles rising slowly out of it, fading out over its last half second. Drawn from
// `hazardSpawned` and `hazardEnded`. Puddles are built up front and reused; each has its own
// copy of the decal material, so one can fade while the others stay solid.

/** Seconds a puddle takes to fade out at the end of its life. */
export const HAZARD_FADE = 0.5;
/** Emissive intensity of the bubbles: past the bloom threshold. */
export const BUBBLE_GLOW = 1.8;

const BUBBLES = 4;
/** How high the decal sits: just above the lawn and below the tile highlight. */
const LIFT = 0.006;

// Toxic green-yellow, brighter and yellower than grass, with a pale rim: never to be taken
// for the Vines' dark leafy mat or a scorch mark, both of which are dark.
const C = {
  rim: '#E6FF8C',
  body: '#B4EA28',
  ooze: '#D2FA3C',
  shine: '#F4FFB0',
  bubble: '#C8F22E',
} as const;

interface Puddle {
  root: Group;
  decal: Mesh;
  material: MeshStandardMaterial;
  bubbles: Mesh[];
  id: number;
  age: number;
  life: number;
  /** Order of adding, so a full pool gives up its oldest. */
  born: number;
  active: boolean;
}

/**
 * A puddle of radius 1, stepped: cells of a ninth of a tile inside a ragged circle, a dark
 * rim, a body, and lighter blotches and a shine on top, each layer a little higher.
 */
function puddleGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const cell = 1 / 9;
  const n = 10;
  const rim = new Color(C.rim);
  const body = new Color(C.body);
  const ooze = new Color(C.ooze);
  const shine = new Color(C.shine);
  for (let i = -n; i < n; i++) {
    for (let k = -n; k < n; k++) {
      const x = (i + 0.5) * cell;
      const z = (k + 0.5) * cell;
      const d = Math.hypot(x, z) + (hash2(i, k, 77) - 0.5) * 0.18;
      if (d > 1) continue;
      if (d > 0.82) {
        b.box(i * cell, 0, k * cell, cell, 0.01, cell, rim);
        continue;
      }
      const blot = hash2(i, k, 5);
      const top = blot < 0.12 ? shine : blot < 0.4 ? ooze : body;
      b.box(i * cell, 0, k * cell, cell, blot < 0.12 ? 0.016 : 0.012, cell, body, top);
    }
  }
  return b.build();
}

function bubbleGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const e = 0.09;
  b.box(-e / 2, -e / 2, -e / 2, e, e, e, C.bubble, C.shine);
  return b.build();
}

export class Hazards {
  readonly group = new Group();

  private readonly puddle = puddleGeometry();
  private readonly bubble = bubbleGeometry();
  private readonly glow = glowMaterial(BUBBLE_GLOW);
  private readonly puddles: Puddle[] = [];
  /** Every puddle's bubbles in one draw call (the bubble meshes are layer-less stand-ins it copies). */
  private readonly bubbles: InstanceBatch;
  private born = 0;
  private count = 0;

  /** Room for `capacity` puddles at once (Brain Rots rarely leave more than a handful). */
  constructor(capacity = 12) {
    this.group.name = 'hazards';
    this.bubbles = new InstanceBatch(this.bubble, this.glow, capacity * BUBBLES, 'hazard-bubbles');
    this.group.add(this.bubbles.mesh);
    for (let i = 0; i < capacity; i++) {
      const root = new Group();
      root.name = 'hazard';
      root.visible = false;
      // A faint glow of its own, so a puddle in a unit's shadow still reads bright (under the
      // bloom threshold: only the bubbles bloom).
      const material = new MeshStandardMaterial({
        ...MATTE_PLASTIC,
        roughness: 0.4,
        transparent: true,
        emissive: new Color('#9CCB1C'),
        emissiveIntensity: 0.18,
      });
      const decal = new Mesh(this.puddle, material);
      decal.name = 'hazard-decal';
      decal.receiveShadow = true;
      decal.renderOrder = 1;
      root.add(decal);
      const bubbles: Mesh[] = [];
      for (let j = 0; j < BUBBLES; j++) {
        const mesh = new Mesh(this.bubble, this.glow);
        mesh.name = 'hazard-bubble';
        mesh.layers.disableAll(); // posed here, drawn by the bubble batch
        root.add(mesh);
        bubbles.push(mesh);
      }
      this.group.add(root);
      this.puddles.push({ root, decal, material, bubbles, id: -1, age: 0, life: 1, born: 0, active: false });
    }
  }

  /** Puddles on the lawn now. */
  get active(): number {
    return this.count;
  }

  has(id: number): boolean {
    return this.find(id) !== null;
  }

  /** How opaque puddle `id` is now: 1 until its last HAZARD_FADE seconds; 0 when there is none. */
  opacity(id: number): number {
    const p = this.find(id);
    return p ? p.material.opacity : 0;
  }

  /**
   * Lays puddle `id` on `lane` centred at `x`, `radius` tiles across its middle, for `seconds`
   * (it fades over the last HAZARD_FADE of them, then goes). Adding an id already down moves
   * and restarts it. When every puddle is in use, the oldest makes way.
   */
  add(id: number, lane: number, x: number, radius: number, seconds: number): void {
    let p = this.find(id);
    if (!p) {
      p = this.freeOrOldest();
      if (p.active) this.count--;
      this.count++;
    }
    p.id = id;
    p.age = 0;
    p.life = Math.max(0.01, seconds);
    p.born = this.born++;
    p.active = true;
    p.root.visible = true;
    p.root.position.set(x, LIFT, lane + 0.5);
    // Turned by its id, so two puddles side by side are not the same shape.
    p.root.rotation.y = (id % 4) * (Math.PI / 2);
    p.root.scale.set(radius, 1, radius);
    this.pose(p);
  }

  /** Takes puddle `id` away at once. */
  remove(id: number): void {
    const p = this.find(id);
    if (p) this.drop(p);
  }

  /** Moves the bubbles and the fades on by `dtSeconds` of game time. */
  update(dtSeconds: number): void {
    const dt = Math.max(0, dtSeconds);
    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i] as Puddle;
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        this.drop(p);
        continue;
      }
      this.pose(p);
    }
    this.draw();
  }

  clear(): void {
    for (let i = 0; i < this.puddles.length; i++) if ((this.puddles[i] as Puddle).active) this.drop(this.puddles[i] as Puddle);
    this.draw();
  }

  /** How many draw calls the bubbles take now (all puddles share one). */
  get bubbleDrawCalls(): number {
    return this.bubbles.count > 0 ? 1 : 0;
  }

  /** Copies every live puddle's shown bubbles into the batch. */
  private draw(): void {
    const batch = this.bubbles;
    batch.begin();
    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i] as Puddle;
      if (!p.active) continue;
      p.root.updateMatrixWorld(true);
      for (let j = 0; j < p.bubbles.length; j++) {
        const bubble = p.bubbles[j] as Mesh;
        if (bubble.visible) batch.add(bubble);
      }
    }
    batch.end();
  }

  /** Takes every puddle away, takes `group` out of the scene, and frees the shapes and materials. */
  dispose(): void {
    this.clear();
    this.bubbles.dispose();
    this.group.removeFromParent();
    this.group.clear();
    this.puddle.dispose();
    this.bubble.dispose();
    this.glow.dispose();
    for (const p of this.puddles) p.material.dispose();
  }

  private find(id: number): Puddle | null {
    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i] as Puddle;
      if (p.active && p.id === id) return p;
    }
    return null;
  }

  /** A puddle not in use, or else the oldest one. */
  private freeOrOldest(): Puddle {
    let oldest = this.puddles[0] as Puddle;
    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i] as Puddle;
      if (!p.active) return p;
      if (p.born < oldest.born) oldest = p;
    }
    return oldest;
  }

  private drop(p: Puddle): void {
    p.active = false;
    p.root.visible = false;
    p.id = -1;
    this.count--;
  }

  private pose(p: Puddle): void {
    const fade = Math.max(0, Math.min(1, (p.life - p.age) / HAZARD_FADE));
    p.material.opacity = fade;
    // Solid until it fades, so it sorts and shades like the lawn.
    p.material.depthWrite = fade >= 1;
    const sx = p.root.scale.x || 1;
    for (let j = 0; j < p.bubbles.length; j++) {
      const bubble = p.bubbles[j] as Mesh;
      // Each bubble swells as it rises slowly from somewhere in the puddle, then pops.
      const u = (p.age * 0.55 + j / BUBBLES + p.id * 0.13) % 1;
      const a = j * 2.1 + p.id;
      const r = 0.25 + 0.35 * ((j * 0.37) % 1);
      // The puddle is stretched by its radius; the bubbles keep their own size.
      bubble.position.set(Math.cos(a) * r, 0.03 + 0.22 * u, Math.sin(a) * r);
      bubble.scale.set((0.5 + 0.9 * u) / sx, (0.5 + 0.9 * u) * (u > 0.92 ? 0.3 : 1), (0.5 + 0.9 * u) / sx);
      bubble.scale.multiplyScalar(fade);
      bubble.visible = fade > 0.02;
    }
  }
}
