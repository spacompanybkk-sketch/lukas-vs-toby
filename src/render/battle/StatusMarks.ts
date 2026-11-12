import { Box3, Group, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Object3D } from 'three';
import { glowMaterial } from '../fx/glow';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import type { StatusKind } from '../types';
import { BoxBatch } from '../world/boxes';

// What a status looks like on a unit (plan Task 5), drawn from `statusApplied` and
// `statusEnded` alone:
//
//   stun    three yellow voxel stars circling the head
//   blind   a band of tan sand over the eyes, a few grains jiggling on top
//   tied    two brown stepped rope rings round the body and a knot
//   poison  green bubbles rising off the body, and a green ring pulsing at its feet
//   burn    orange flame voxels flickering up the body
//   haste   red speed streaks streaming out behind (towards +X: only zombies are hasted)
//
// Every mark is built once, up front, `capacity` of each kind, and handed out and taken
// back; nothing is made or dropped while a battle runs. All of them stay below the top of
// the unit plus 0.1 tile, under the health bar (which sits 0.14 above the top).

/** Emissive intensity of the glowing marks: past the bloom threshold. */
export const MARK_GLOW = 1.8;

/** Every status, in the order their pools are built. */
const STATUSES: readonly StatusKind[] = ['stun', 'blind', 'tied', 'poison', 'burn', 'haste'];

const C = {
  sand: '#E3C58A',
  sandDark: '#B98E52',
  sandLight: '#F5E2B8',
  rope: '#A8743E',
  ropeDark: '#6B4423',
  ropeLight: '#C99560',
} as const;

const STARS = 3;
const STAR_RADIUS = 0.36;
const BUBBLES = 4;
const FLAMES = 6;
const STREAKS = 3;
const GRAINS = 3;

interface Mark {
  status: StatusKind;
  root: Group;
  /** The moving pieces, in a fixed order per status. */
  pieces: Mesh[];
  unitId: number;
  anchor: Object3D | null;
  height: number;
  time: number;
  /** Where in the active list it sits, or −1 when it is in the pool. */
  slot: number;
}

const here = new Vector3();
const box = new Box3();

/** A cube `edge` across in one colour (its top `top`), centred on the origin. */
function cube(edge: number, color: string, top?: string): BufferGeometry {
  const b = new BoxBatch();
  b.box(-edge / 2, -edge / 2, -edge / 2, edge, edge, edge, color, top);
  return b.build();
}

/** A four-pointed voxel star in the XY plane, 3 × 3 cells with points, centred. */
function star(): BufferGeometry {
  const b = new BoxBatch();
  const c = 0.04;
  const color = PALETTE.stunStars;
  const core = '#FFF6B8';
  b.box(-c * 1.5, -c / 2, -c / 2, c * 3, c, c, color);
  b.box(-c / 2, -c * 1.5, -c / 2, c, c * 3, c, color);
  b.box(-c / 2, -c / 2, -c * 0.7, c, c, c * 1.4, core);
  return b.build();
}

/** A stepped ring of cells lying flat, radius `r`, cells `cell` across and `h` tall, in alternating colours. */
function steppedRing(r: number, cell: number, h: number, a: string, b2: string, top?: string): BufferGeometry {
  const b = new BoxBatch();
  const n = Math.ceil(r / cell) + 1;
  for (let i = -n; i < n; i++) {
    for (let k = -n; k < n; k++) {
      const d = Math.hypot((i + 0.5) * cell, (k + 0.5) * cell);
      if (d > r || d < r - cell * 1.5) continue;
      b.box(i * cell, -h / 2, k * cell, cell, h, cell, (i + k) % 3 === 0 ? b2 : a, top);
    }
  }
  return b.build();
}

/** A blindfold of sand: a band of blocks round the head, thicker over the eyes in front. */
function sandBand(): BufferGeometry {
  const b = new BoxBatch();
  const hx = 0.34;
  const hz = 0.31;
  const t = 0.07;
  const h = 0.13;
  b.box(-hx, -h / 2, -hz, 2 * hx, h, t, C.sandDark, C.sand);
  b.box(-hx, -h / 2, hz - t, 2 * hx, h, t, C.sandDark, C.sand);
  b.box(-hx, -h / 2, -hz, t, h, 2 * hz, C.sandDark, C.sand);
  b.box(hx - t, -h / 2, -hz, t, h, 2 * hz, C.sandDark, C.sand);
  // Lumps over the eyes on the camera side and the facing side, paler on top.
  b.box(-0.22, -h / 2 - 0.02, hz - 0.02, 0.44, h + 0.04, 0.06, C.sand, C.sandLight);
  b.box(hx - 0.02, -h / 2 - 0.02, -0.2, 0.06, h + 0.04, 0.4, C.sand, C.sandLight);
  b.box(-hx - 0.04, -h / 2 - 0.02, -0.2, 0.06, h + 0.04, 0.4, C.sand, C.sandLight);
  return b.build();
}

/** The knot of the rope, on the side the camera sees. */
function knot(): BufferGeometry {
  const b = new BoxBatch();
  b.box(-0.05, -0.05, 0, 0.1, 0.1, 0.07, C.ropeDark, C.rope);
  b.box(-0.09, -0.12, 0.02, 0.04, 0.09, 0.04, C.rope, C.ropeLight);
  b.box(0.04, -0.14, 0.02, 0.04, 0.1, 0.04, C.rope, C.ropeLight);
  return b.build();
}

/** A speed streak: a long thin bar along X with a bright head at its front (−X) end. */
function streak(): BufferGeometry {
  const b = new BoxBatch();
  b.box(0, -0.025, -0.025, 0.42, 0.05, 0.05, PALETTE.speedRed);
  b.box(-0.06, -0.035, -0.035, 0.08, 0.07, 0.07, '#FF9A7A');
  return b.build();
}

export class StatusMarks {
  readonly group = new Group();

  private readonly plastic = new MeshStandardMaterial(MATTE_PLASTIC);
  private readonly glow = glowMaterial(MARK_GLOW);
  private readonly geometries: BufferGeometry[] = [];
  private readonly pools = new Map<StatusKind, Mark[]>();
  private readonly live: Mark[] = [];

  /** `capacity` marks of each status: as many units as can carry one status at once. */
  constructor(capacity = 48) {
    this.group.name = 'status-marks';
    const g = {
      star: this.keep(star()),
      band: this.keep(sandBand()),
      grain: this.keep(cube(0.06, C.sand, C.sandLight)),
      rope: this.keep(steppedRing(0.38, 0.06, 0.06, C.rope, C.ropeDark, C.ropeLight)),
      knot: this.keep(knot()),
      bubble: this.keep(cube(0.075, PALETTE.poison, '#D4FF8A')),
      poisonRing: this.keep(steppedRing(0.4, 0.07, 0.03, PALETTE.poison, '#5FA81E')),
      flame: this.keep(cube(0.11, PALETTE.fire, PALETTE.fireLight)),
      flameLight: this.keep(cube(0.085, PALETTE.fireLight, '#FFF1A6')),
      streak: this.keep(streak()),
    };
    const parts: Record<StatusKind, [BufferGeometry, boolean][]> = {
      stun: Array.from({ length: STARS }, () => [g.star, true]),
      blind: [[g.band, false], ...Array.from({ length: GRAINS }, (): [BufferGeometry, boolean] => [g.grain, false])],
      tied: [[g.rope, false], [g.rope, false], [g.knot, false]],
      poison: [[g.poisonRing, true], ...Array.from({ length: BUBBLES }, (): [BufferGeometry, boolean] => [g.bubble, true])],
      burn: Array.from({ length: FLAMES }, (_, i): [BufferGeometry, boolean] => [i % 2 ? g.flameLight : g.flame, true]),
      haste: Array.from({ length: STREAKS }, (): [BufferGeometry, boolean] => [g.streak, true]),
    };
    for (const status of STATUSES) {
      const pool: Mark[] = [];
      for (let i = 0; i < capacity; i++) {
        const root = new Group();
        root.name = `status-${status}`;
        root.visible = false;
        const pieces = parts[status].map(([geometry, glows]) => {
          const mesh = new Mesh(geometry, glows ? this.glow : this.plastic);
          mesh.name = `${status}-piece`;
          root.add(mesh);
          return mesh;
        });
        this.group.add(root);
        pool.push({ status, root, pieces, unitId: -1, anchor: null, height: 1, time: 0, slot: -1 });
      }
      this.pools.set(status, pool);
    }
  }

  /** Marks showing now. */
  get active(): number {
    return this.live.length;
  }

  /** Marks waiting in the pools. */
  get free(): number {
    let n = 0;
    for (const pool of this.pools.values()) n += pool.length;
    return n;
  }

  /** Whether `unitId` shows `status` now. */
  has(unitId: number, status: StatusKind): boolean {
    return this.find(unitId, status) !== null;
  }

  /**
   * Turns `status` on or off for unit `unitId`, whose model's root is `anchor` (the marks
   * follow it). `height` is the unit's height in tiles; left out, it is measured from
   * `anchor` when the mark goes on. Turning on a status already shown keeps the one mark;
   * turning off one not shown does nothing. When a pool runs dry, the new mark is skipped.
   */
  set(unitId: number, anchor: Object3D, status: StatusKind, on: boolean, height?: number): void {
    const mark = this.find(unitId, status);
    if (!on) {
      if (mark) this.release(mark);
      return;
    }
    if (mark) {
      mark.anchor = anchor;
      if (height !== undefined) mark.height = height;
      return;
    }
    const pool = this.pools.get(status) as Mark[];
    const next = pool.pop();
    if (!next) return;
    next.unitId = unitId;
    next.anchor = anchor;
    next.height = height ?? measure(anchor);
    // Units start their animations at different points, so two side by side do not move as one.
    next.time = (unitId * 0.37) % 1;
    next.slot = this.live.length;
    next.root.visible = true;
    this.live.push(next);
    this.place(next);
  }

  /** Takes every mark off unit `unitId` (it died or left). */
  forget(unitId: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const mark = this.live[i] as Mark;
      if (mark.unitId === unitId) this.release(mark);
    }
  }

  /** Moves every mark to its unit and on by `dtSeconds` of game time. */
  update(dtSeconds: number): void {
    const dt = Math.max(0, dtSeconds);
    for (let i = 0; i < this.live.length; i++) {
      const mark = this.live[i] as Mark;
      mark.time += dt;
      this.place(mark);
    }
  }

  /** Takes every mark off every unit. */
  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.release(this.live[i] as Mark);
  }

  /** Frees the shapes and materials. Take `group` out of the scene first. */
  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.plastic.dispose();
    this.glow.dispose();
  }

  private keep(geometry: BufferGeometry): BufferGeometry {
    this.geometries.push(geometry);
    return geometry;
  }

  private find(unitId: number, status: StatusKind): Mark | null {
    for (let i = 0; i < this.live.length; i++) {
      const mark = this.live[i] as Mark;
      if (mark.unitId === unitId && mark.status === status) return mark;
    }
    return null;
  }

  private release(mark: Mark): void {
    // Swap the last live mark into this one's place.
    const last = this.live.pop() as Mark;
    if (last !== mark) {
      this.live[mark.slot] = last;
      last.slot = mark.slot;
    }
    mark.slot = -1;
    mark.anchor = null;
    mark.unitId = -1;
    mark.root.visible = false;
    (this.pools.get(mark.status) as Mark[]).push(mark);
  }

  /** Puts a mark on its unit and poses its pieces for its time. */
  private place(mark: Mark): void {
    const { root, pieces, height: h, time: t } = mark;
    mark.anchor?.getWorldPosition(here);
    root.position.copy(here);
    switch (mark.status) {
      case 'stun': {
        // Round the top of the head, the stars bobbing out of step and each turning.
        const spin = t * 3.4;
        pieces.forEach((p, i) => {
          const a = spin + (i / STARS) * Math.PI * 2;
          p.position.set(Math.cos(a) * STAR_RADIUS, h - 0.1 + Math.sin(t * 6 + i * 2) * 0.02, Math.sin(a) * STAR_RADIUS);
          p.rotation.set(0, -a, t * 5 + i);
        });
        break;
      }
      case 'blind': {
        const [band, ...grains] = pieces;
        (band as Mesh).position.set(0, h * 0.68, 0);
        (band as Mesh).scale.setScalar(Math.max(0.8, h));
        grains.forEach((p, i) => {
          const hop = Math.abs(Math.sin(t * 7 + i * 1.9)) * 0.05;
          p.position.set((i - 1) * 0.16, h * 0.68 + 0.08 + hop, 0.26 - i * 0.05);
        });
        break;
      }
      case 'tied': {
        const [low, high, tie] = pieces as [Mesh, Mesh, Mesh];
        // The rope pulls tight now and then, as if the unit were straining against it.
        const squeeze = 1 - 0.05 * Math.max(0, Math.sin(t * 4));
        low.position.set(0, h * 0.3, 0);
        high.position.set(0, h * 0.52, 0);
        low.scale.set(squeeze * h, h, squeeze * h);
        high.scale.set(squeeze * 0.94 * h, h, squeeze * 0.94 * h);
        tie.position.set(0.02, h * 0.42, 0.36 * squeeze * h);
        break;
      }
      case 'poison': {
        const [ring, ...bubbles] = pieces as [Mesh, ...Mesh[]];
        const pulse = 1 + 0.12 * Math.sin(t * 5);
        ring.position.set(0, 0.03, 0);
        ring.scale.set(pulse, 1, pulse);
        bubbles.forEach((p, i) => {
          // Each bubble rises from the body, swells and pops at the top, then starts again.
          const u = (t * 0.75 + i / BUBBLES) % 1;
          const a = i * 2.4 + t * 0.6;
          p.position.set(Math.cos(a) * 0.24, h * (0.2 + 0.72 * u), Math.sin(a) * 0.24);
          p.scale.setScalar(0.6 + 0.8 * u * (u < 0.9 ? 1 : (1 - u) * 10));
        });
        break;
      }
      case 'burn': {
        pieces.forEach((p, i) => {
          // Flames lick up the body: each rises a little and shrinks, flickering, then relights.
          const u = (t * 2.2 + i * 0.37) % 1;
          const a = i * 1.05 + 0.4;
          p.position.set(Math.cos(a) * 0.27, h * (0.12 + 0.11 * i) + u * 0.12, Math.sin(a) * 0.27);
          p.scale.setScalar(Math.max(0.15, (1 - u) * (0.85 + 0.25 * Math.sin(t * 19 + i))));
        });
        break;
      }
      case 'haste': {
        pieces.forEach((p, i) => {
          // Streaks stream out behind the unit and thin as they go.
          const u = (t * 2.6 + i * 0.41) % 1;
          p.position.set(0.3 + u * 0.28, h * (0.28 + 0.2 * i), (i - 1) * 0.12);
          p.scale.set(1 - 0.6 * u, 1, 1);
        });
        break;
      }
    }
  }
}

/** A unit's height above its own feet, from its model's bounds; 1 tile if it has none. */
function measure(anchor: Object3D): number {
  anchor.updateMatrixWorld(true);
  box.setFromObject(anchor);
  if (!Number.isFinite(box.max.y)) return 1;
  anchor.getWorldPosition(here);
  const h = box.max.y - here.y;
  return h > 0.2 ? h : 1;
}
