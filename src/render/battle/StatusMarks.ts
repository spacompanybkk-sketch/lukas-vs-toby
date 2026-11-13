import { Box3, Group, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Object3D } from 'three';
import { glowMaterial } from '../fx/glow';
import { InstanceBatch } from '../fx/InstanceBatch';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import type { StatusKind } from '../types';
import { BoxBatch } from '../world/boxes';

// What a status looks like on a unit (plan Task 5), drawn from `statusApplied` and
// `statusEnded` alone:
//
//   stun    three big yellow voxel stars with a dark outline circling the head
//   blind   outlined blocks of sand whirling round the eyes, grains trickling out
//   tied    two brown stepped rope rings round the body and a knot
//   poison  toxic green-yellow bubbles rising off the body, a ring of them pulsing at its feet
//   burn    orange flame voxels flickering up the body
//   haste   short red streaks trailing from its back (towards +X: only zombies are hasted)
//
// Every mark is built once, up front, `capacity` of each kind, and handed out and taken
// back; nothing is made or dropped while a battle runs. A mark's pieces are posed as meshes in
// the scene graph but kept hidden: each piece shape is drawn for every mark at once by one
// InstanceBatch (ten draw calls in all, however many units carry a status), and no mark casts
// a shadow. All of them stay below the top of
// the unit plus 0.1 tile, under the health bar (which sits 0.14 above the top).

/** Emissive intensity of the glowing marks: past the bloom threshold. */
export const MARK_GLOW = 1.8;

/** Every status, in the order their pools are built. */
const STATUSES: readonly StatusKind[] = ['stun', 'blind', 'tied', 'poison', 'burn', 'haste'];

const C = {
  // Tan, not cream: under the sun a pale sand reads as white boxes.
  sand: '#C98F45',
  sandDark: '#A06A2C',
  sandLight: '#DFAE62',
  rope: '#A8743E',
  ropeDark: '#6B4423',
  ropeLight: '#C99560',
} as const;

/** Toxic green-yellow: brighter and yellower than any grass or leaf, so poison never reads as a plant. */
export const POISON = { bright: '#C8F22E', lime: '#A6E01E', pale: '#EEFF8A' } as const;

const STARS = 3;
/** Edge of one cell of a stun star, in tiles: the star is five cells across with its outline. */
const STAR_CELL = 0.085;
const STAR_RADIUS = 0.42;
/** Edge of a blind sand block, in tiles. */
const SAND_BLOCK = 0.24;
const BUBBLES = 4;
const FLAMES = 6;
const STREAKS = 5;
const GRAINS = 3;
const CLUMPS = 4;

interface Mark {
  status: StatusKind;
  root: Group;
  /** The moving pieces, in a fixed order per status (hidden: the batches draw them). */
  pieces: Mesh[];
  /** The batch that draws each piece. */
  batches: InstanceBatch[];
  unitId: number;
  anchor: Object3D | null;
  height: number;
  time: number;
  /** Where in the active list it sits, or −1 when it is in the pool. */
  slot: number;
  /** How big its stars and flames are drawn (1: as built; zombies get them bigger). */
  size: number;
}

const here = new Vector3();
const box = new Box3();

/** A cube `edge` across in one colour (its top `top`), centred on the origin. */
function cube(edge: number, color: string, top?: string): BufferGeometry {
  const b = new BoxBatch();
  b.box(-edge / 2, -edge / 2, -edge / 2, edge, edge, edge, color, top);
  return b.build();
}

/** The dark outline round the stars and the sand, so they show on yellow and gold units too. */
const OUTLINE = PALETTE.outline;

/**
 * A five-cell voxel star in the XY plane (a plus with a bright core) set into a dark plate
 * one cell wider all round: the glow washes yellow towards white, and the outline keeps the
 * shape on any unit, a yellow Kernel-pult or a gold level 5 included.
 */
function star(): BufferGeometry {
  const b = new BoxBatch();
  const c = STAR_CELL;
  const lit = (i: number, j: number): boolean => (i === 0 && Math.abs(j) <= 1) || (j === 0 && Math.abs(i) <= 1);
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (lit(i, j)) {
        // Standing proud of the plate on both faces.
        b.box(i * c - c / 2, j * c - c / 2, -c, c, c, 2 * c, i === 0 && j === 0 ? '#FFF6B8' : PALETTE.stunStars);
        continue;
      }
      let edge = false;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if ((di !== 0 || dj !== 0) && lit(i + di, j + dj)) edge = true;
      if (edge) b.box(i * c - c / 2, j * c - c / 2, -c / 2, c, c, c, OUTLINE);
    }
  }
  return b.build();
}

/**
 * A box of edge `s` centred on (x, y, z) drawn with a dark outline: a dark core, and the
 * coloured faces set into it a little proud, leaving a rim of `e` round every face.
 */
function outlinedBox(b: BoxBatch, x: number, y: number, z: number, s: number, e: number, side: string, top: string): void {
  const h = s / 2;
  b.box(x - h, y - h, z - h, s, s, s, OUTLINE);
  const i = s - 2 * e;
  const o = s + 0.004;
  b.box(x - i / 2, y - i / 2, z - o / 2, i, i, o, side, top);
  b.box(x - o / 2, y - i / 2, z - i / 2, o, i, i, side, top);
  b.box(x - i / 2, y - o / 2, z - i / 2, i, o, i, side, top);
}

/**
 * A flame: a stepped column, wide and deep orange at the foot, narrowing to yellow and a
 * pale tip, standing on its origin. Painted deep so the glow stays orange.
 */
function flame(scale: number): BufferGeometry {
  const b = new BoxBatch();
  const u = 0.045 * scale;
  b.box(-1.5 * u, 0, -1.5 * u, 3 * u, 1.5 * u, 3 * u, '#D8380A', '#F2560F');
  b.box(-1 * u, 1.5 * u, -1 * u, 2 * u, 1.5 * u, 2 * u, '#F2560F', PALETTE.fire);
  b.box(-0.5 * u, 3 * u, -0.5 * u, 1 * u, 1.2 * u, 1 * u, PALETTE.fireLight, '#FFF1A6');
  b.box(0.5 * u, 1 * u, 1 * u, 1 * u, 1.2 * u, 1 * u, PALETTE.fire, PALETTE.fireLight);
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

/** A block of sand with a dark outline. */
function sandClump(): BufferGeometry {
  const b = new BoxBatch();
  outlinedBox(b, 0, 0, 0, SAND_BLOCK, 0.03, C.sand, C.sandLight);
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

/**
 * A short speed streak trailing back (+X) from its origin: three steps, thick at the body
 * and thinner towards the tail. Painted deep: a glowing colour comes out paler on screen,
 * and this has to stay red.
 */
function streak(): BufferGeometry {
  const b = new BoxBatch();
  b.box(0, -0.05, -0.05, 0.09, 0.1, 0.1, '#E0301C');
  b.box(0.09, -0.037, -0.037, 0.09, 0.075, 0.075, '#C8241A');
  b.box(0.18, -0.025, -0.025, 0.1, 0.05, 0.05, '#A81A10');
  return b.build();
}

export class StatusMarks {
  readonly group = new Group();

  private readonly plastic = new MeshStandardMaterial(MATTE_PLASTIC);
  private readonly glow = glowMaterial(MARK_GLOW);
  private readonly geometries: BufferGeometry[] = [];
  private readonly pools = new Map<StatusKind, Mark[]>();
  private readonly live: Mark[] = [];
  /** One batch per piece shape, drawing that shape for every live mark. */
  private readonly batches: InstanceBatch[] = [];
  private readonly batchGroup = new Group();

  /** `capacity` marks of each status: as many units as can carry one status at once. */
  constructor(capacity = 48) {
    this.group.name = 'status-marks';
    const g = {
      star: this.keep(star()),
      clump: this.keep(sandClump()),
      grain: this.keep(cube(0.05, C.sand, C.sandLight)),
      rope: this.keep(steppedRing(0.38, 0.06, 0.06, C.rope, C.ropeDark, C.ropeLight)),
      knot: this.keep(knot()),
      bubble: this.keep(cube(0.095, POISON.bright, POISON.pale)),
      poisonRing: this.keep(steppedRing(0.4, 0.08, 0.04, POISON.bright, POISON.lime, POISON.pale)),
      flame: this.keep(flame(1)),
      flameLight: this.keep(flame(0.75)),
      streak: this.keep(streak()),
    };
    const parts: Record<StatusKind, [BufferGeometry, boolean][]> = {
      stun: Array.from({ length: STARS }, () => [g.star, true]),
      blind: [
        ...Array.from({ length: CLUMPS }, (): [BufferGeometry, boolean] => [g.clump, false]),
        ...Array.from({ length: GRAINS }, (): [BufferGeometry, boolean] => [g.grain, false]),
      ],
      tied: [[g.rope, false], [g.rope, false], [g.knot, false]],
      poison: [[g.poisonRing, true], ...Array.from({ length: BUBBLES }, (): [BufferGeometry, boolean] => [g.bubble, true])],
      burn: Array.from({ length: FLAMES }, (_, i): [BufferGeometry, boolean] => [i % 2 ? g.flameLight : g.flame, true]),
      haste: Array.from({ length: STREAKS }, (): [BufferGeometry, boolean] => [g.streak, true]),
    };
    // A batch per shape, big enough for every piece of that shape on every mark of the pools.
    const byShape = new Map<BufferGeometry, InstanceBatch>();
    const uses = new Map<BufferGeometry, { glows: boolean; n: number }>();
    for (const status of STATUSES) {
      for (const [geometry, glows] of parts[status]) {
        const use = uses.get(geometry) ?? { glows, n: 0 };
        use.n += capacity;
        uses.set(geometry, use);
      }
    }
    this.batchGroup.name = 'mark-batches';
    this.group.add(this.batchGroup);
    for (const [geometry, use] of uses) {
      const batch = new InstanceBatch(geometry, use.glows ? this.glow : this.plastic, use.n, 'mark-batch');
      byShape.set(geometry, batch);
      this.batches.push(batch);
      this.batchGroup.add(batch.mesh);
    }
    for (const status of STATUSES) {
      const pool: Mark[] = [];
      for (let i = 0; i < capacity; i++) {
        const root = new Group();
        root.name = `status-${status}`;
        root.visible = false;
        const batches: InstanceBatch[] = [];
        const pieces = parts[status].map(([geometry, glows]) => {
          const mesh = new Mesh(geometry, glows ? this.glow : this.plastic);
          mesh.name = `${status}-piece`;
          mesh.visible = false; // drawn by its batch
          root.add(mesh);
          batches.push(byShape.get(geometry) as InstanceBatch);
          return mesh;
        });
        this.group.add(root);
        pool.push({ status, root, pieces, batches, unitId: -1, anchor: null, height: 1, time: 0, slot: -1, size: 1 });
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
  set(unitId: number, anchor: Object3D, status: StatusKind, on: boolean, height?: number, size = 1): void {
    const mark = this.find(unitId, status);
    if (!on) {
      if (mark) this.release(mark);
      return;
    }
    if (mark) {
      mark.anchor = anchor;
      if (height !== undefined) mark.height = height;
      mark.size = size;
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
    next.size = size;
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

  /** Moves every mark to its unit and on by `dtSeconds` of game time, and redraws the batches. */
  update(dtSeconds: number): void {
    const dt = Math.max(0, dtSeconds);
    for (let i = 0; i < this.live.length; i++) {
      const mark = this.live[i] as Mark;
      mark.time += dt;
      this.place(mark);
    }
    this.draw();
  }

  /** How many draw calls the marks take now (one per piece shape that is showing). */
  get drawCalls(): number {
    let n = 0;
    for (let i = 0; i < this.batches.length; i++) if ((this.batches[i] as InstanceBatch).count > 0) n++;
    return n;
  }

  /** Copies every live mark's pieces into their batches. */
  private draw(): void {
    for (let i = 0; i < this.batches.length; i++) (this.batches[i] as InstanceBatch).begin();
    for (let i = 0; i < this.live.length; i++) {
      const mark = this.live[i] as Mark;
      mark.root.updateMatrixWorld(true);
      for (let j = 0; j < mark.pieces.length; j++) (mark.batches[j] as InstanceBatch).add(mark.pieces[j] as Mesh);
    }
    for (let i = 0; i < this.batches.length; i++) (this.batches[i] as InstanceBatch).end();
  }

  /** Takes every mark off every unit. */
  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.release(this.live[i] as Mark);
    this.draw();
  }

  /** Takes every mark away, takes `group` out of the scene, and frees the shapes and materials. */
  dispose(): void {
    this.clear();
    for (const batch of this.batches) batch.dispose();
    this.group.removeFromParent();
    this.group.clear();
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

  /**
   * Puts a mark on its unit and poses its pieces for its time. Called for every live mark
   * every frame, so it only writes into the pieces it has: indexed loops, no closures or
   * new arrays.
   */
  private place(mark: Mark): void {
    const pieces = mark.pieces;
    const h = mark.height;
    const t = mark.time;
    if (mark.anchor) mark.anchor.getWorldPosition(here);
    mark.root.position.copy(here);
    switch (mark.status) {
      case 'stun': {
        // Round the top of the head, each star facing out so the ring shows its faces.
        const spin = t * 3.4;
        for (let i = 0; i < STARS; i++) {
          const p = pieces[i] as Mesh;
          const a = spin + (i / STARS) * Math.PI * 2;
          p.position.set(Math.cos(a) * STAR_RADIUS, h - 0.14 + Math.sin(t * 6 + i * 2) * 0.01, Math.sin(a) * STAR_RADIUS);
          p.rotation.set(0, Math.PI / 2 - a, 0);
          // A twinkle in two steps.
          p.scale.setScalar(mark.size * (0.88 + 0.12 * Math.round(0.5 + 0.5 * Math.sin(t * 9 + i * 2))));
        }
        break;
      }
      case 'blind': {
        // A sandstorm round the head at eye height: outlined blocks of sand whirling round
        // it, and grains trickling down out of it.
        const eyes = Math.min(h * 0.72, h - 0.24);
        const reach = 0.4 * Math.min(1.25, Math.max(0.9, h));
        const whirl = t * 1.8;
        for (let i = 0; i < CLUMPS; i++) {
          const p = pieces[i] as Mesh;
          const a = whirl + (i / CLUMPS) * Math.PI * 2;
          const bob = Math.round(Math.sin(t * 5 + i * 1.7) * 2) / 32;
          p.position.set(Math.cos(a) * reach, eyes + bob, Math.sin(a) * reach);
          p.rotation.y = -a;
        }
        for (let i = 0; i < GRAINS; i++) {
          const p = pieces[CLUMPS + i] as Mesh;
          const u = (t * 1.4 + i / GRAINS) % 1;
          const a = i * 2.1 + 0.6;
          p.position.set(Math.cos(a) * reach, eyes - 0.14 - u * 0.3, Math.sin(a) * reach);
          p.scale.setScalar(1 - 0.5 * u);
        }
        break;
      }
      case 'tied': {
        const low = pieces[0] as Mesh;
        const high = pieces[1] as Mesh;
        const tie = pieces[2] as Mesh;
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
        const ring = pieces[0] as Mesh;
        // The ring pulses in steps, never smoothly.
        const pulse = 1 + 0.08 * Math.round(Math.sin(t * 5) * 2);
        ring.position.set(0, 0.03, 0);
        ring.scale.set(pulse, 1, pulse);
        for (let i = 0; i < BUBBLES; i++) {
          const p = pieces[1 + i] as Mesh;
          // Each bubble rises from the body, swells and pops at the top, then starts again.
          const u = (t * 0.75 + i / BUBBLES) % 1;
          const a = i * 2.4 + t * 0.6;
          p.position.set(Math.cos(a) * 0.26, h * (0.15 + 0.75 * u), Math.sin(a) * 0.26);
          p.scale.setScalar(0.7 + 0.7 * u * (u < 0.9 ? 1 : (1 - u) * 10));
        }
        break;
      }
      case 'burn': {
        const grow = Math.max(1, h) * mark.size;
        const r = 0.27 * grow;
        for (let i = 0; i < FLAMES; i++) {
          const p = pieces[i] as Mesh;
          // Each flame leaps up, flickering in stepped jumps, and dies back down.
          const u = (t * 1.8 + i * 0.37) % 1;
          const a = i * 2.4 + 0.4;
          const flicker = Math.round((0.75 + 0.35 * Math.sin(t * 17 + i * 2)) * 4) / 4;
          p.position.set(Math.cos(a) * r, h * (0.08 + 0.1 * i), Math.sin(a) * r);
          p.scale.set(grow, grow * Math.max(0.2, flicker * (1 - 0.6 * u)), grow);
        }
        break;
      }
      case 'haste': {
        // Short streaks trailing from the back of the body, feet to shoulders, each
        // stretching and snapping back in whole steps as the zombie races.
        for (let i = 0; i < STREAKS; i++) {
          const p = pieces[i] as Mesh;
          const step = Math.floor((t * 8 + i * 1.7) % 4);
          p.position.set(0.2, h * (0.07 + 0.14 * i), ((i % 3) - 1) * 0.12);
          p.scale.set(0.7 + 0.25 * step, 1, 1);
        }
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
