import { Color, Group, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import { glowMaterial } from '../fx/glow';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import { BoxBatch, hash2 } from '../world/boxes';

// Brain Rot's poison puddles (plan Task 5): a stepped green-black decal on the lawn with
// bright bubbles rising slowly out of it, fading out over its last half second. Drawn from
// `hazardSpawned` and `hazardEnded`. Puddles are built up front and reused; each has its own
// copy of the decal material, so one can fade while the others stay solid.

/** Seconds a puddle takes to fade out at the end of its life. */
export const HAZARD_FADE = 0.5;
/** Emissive intensity of the bubbles: past the bloom threshold. */
export const BUBBLE_GLOW = 1.8;

const BUBBLES = 4;
/** How high the decal sits: just above the lawn and below the tile highlight. */
const LIFT = 0.006;

const C = {
  rim: '#1E2A10',
  body: '#33471A',
  ooze: '#5E8F1E',
  shine: PALETTE.poison,
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
        b.box(i * cell, 0, k * cell, cell, 0.012, cell, rim);
        continue;
      }
      const blot = hash2(i, k, 5);
      const top = blot < 0.16 ? shine : blot < 0.42 ? ooze : body;
      b.box(i * cell, 0, k * cell, cell, blot < 0.16 ? 0.026 : 0.02, cell, body, top);
    }
  }
  return b.build();
}

function bubbleGeometry(): BufferGeometry {
  const b = new BoxBatch();
  const e = 0.07;
  b.box(-e / 2, -e / 2, -e / 2, e, e, e, C.shine, '#D4FF8A');
  return b.build();
}

export class Hazards {
  readonly group = new Group();

  private readonly puddle = puddleGeometry();
  private readonly bubble = bubbleGeometry();
  private readonly glow = glowMaterial(BUBBLE_GLOW);
  private readonly puddles: Puddle[] = [];
  private born = 0;
  private count = 0;

  /** Room for `capacity` puddles at once (Brain Rots rarely leave more than a handful). */
  constructor(capacity = 12) {
    this.group.name = 'hazards';
    for (let i = 0; i < capacity; i++) {
      const root = new Group();
      root.name = 'hazard';
      root.visible = false;
      const material = new MeshStandardMaterial({ ...MATTE_PLASTIC, roughness: 0.4, transparent: true });
      const decal = new Mesh(this.puddle, material);
      decal.name = 'hazard-decal';
      decal.receiveShadow = true;
      decal.renderOrder = 1;
      root.add(decal);
      const bubbles: Mesh[] = [];
      for (let j = 0; j < BUBBLES; j++) {
        const mesh = new Mesh(this.bubble, this.glow);
        mesh.name = 'hazard-bubble';
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
      p = this.puddles.find((q) => !q.active) ?? null;
      if (!p) {
        p = this.puddles.reduce((a, q) => (q.born < a.born ? q : a));
        this.count--;
      }
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
    for (const p of this.puddles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        this.drop(p);
        continue;
      }
      this.pose(p);
    }
  }

  clear(): void {
    for (const p of this.puddles) if (p.active) this.drop(p);
  }

  /** Frees the shapes and materials. Take `group` out of the scene first. */
  dispose(): void {
    this.puddle.dispose();
    this.bubble.dispose();
    this.glow.dispose();
    for (const p of this.puddles) p.material.dispose();
  }

  private find(id: number): Puddle | null {
    for (const p of this.puddles) if (p.active && p.id === id) return p;
    return null;
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
    p.bubbles.forEach((bubble, j) => {
      // Each bubble swells as it rises slowly from somewhere in the puddle, then pops.
      const u = (p.age * 0.55 + j / BUBBLES + p.id * 0.13) % 1;
      const a = j * 2.1 + p.id;
      const r = 0.25 + 0.35 * ((j * 0.37) % 1);
      // The puddle is stretched by its radius; the bubbles keep their own size.
      bubble.position.set(Math.cos(a) * r, 0.03 + 0.22 * u, Math.sin(a) * r);
      bubble.scale.set((0.5 + 0.9 * u) / sx, (0.5 + 0.9 * u) * (u > 0.92 ? 0.3 : 1), (0.5 + 0.9 * u) / sx);
      bubble.scale.multiplyScalar(fade);
      bubble.visible = fade > 0.02;
    });
  }
}
