import { BufferAttribute, Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import type { Director, StageLike } from '../app/Stage';
import { LAWN_COLS } from '../render/coords';
import { MATTE_PLASTIC } from '../render/look';
import { PALETTE } from '../render/palette';
import { BoxBatch, seededRandom, shade } from '../render/world/boxes';
import { buildIslet } from '../render/world/island';
import type { Faction } from '../sim/types';
import { HOP_MS } from '../ui/screens/mapModel';
import type { StoneState } from '../ui/screens/mapModel';

/** A client point (CSS pixels, origin at the viewport's top-left). */
export interface Pt { x: number; y: number }

/** What the map shows: whose path, the stones' states in path order, and the marker's colour. */
export interface MapView {
  side: Faction;
  stones: { id: string; state: StoneState }[];
  /** The player's frame colour, for the flag on the next stone. */
  frame: string;
}

/**
 * Where the HTML over the map goes: each stone's top middle at rest, the middle of the flag's
 * cloth (if any), and how many pixels the next stone rises at the top of its hop (the HTML hops by
 * a CSS animation of that height). One object, reused: its points change in place, and `version`
 * goes up whenever any of them moved, so a caller with nothing new to write can skip at once.
 */
export interface MapLayout {
  readonly stones: Record<string, Pt>;
  readonly flag: Pt | null;
  readonly hop: number;
  readonly version: number;
}



/**
 * Where the eight stones lie on the Backyard for the plants, as (x, z) on the lawn: a stepping-stone
 * path winding from Lukas's end to Toby's. The zombies walk the mirror image, from Toby's end.
 */
export const PLANT_PATH: readonly (readonly [number, number])[] = [
  [0.9, 3.9], [2.0, 2.2], [3.2, 0.9], [4.6, 1.9], [5.3, 3.7], [6.8, 4.2], [8.0, 2.7], [9.1, 1.1],
];

export function pathFor(side: Faction): [number, number][] {
  return PLANT_PATH.map(([x, z]) => [side === 'plants' ? x : LAWN_COLS - x, z]);
}

/** The four later worlds, greyed, adrift in the sky behind the island: x, y, z, scale. */
const WORLDS: readonly [number, number, number, number][] = [
  [-1.9, 0.6, -2.9, 1.2], [1.6, 1.4, -4.6, 1.05], [8.4, 1.4, -4.6, 1.05], [11.9, 0.6, -2.9, 1.2],
];

/** Stone sizes: 0.1-tile voxels, a disc 11 voxels across, two high. */
const VOX = 0.1;
const STONE_R = 5.6;
const STONE_H = 2;
const STONE_TOP = STONE_H * VOX;
/** How high the next stone hops (tiles) and how many hops a second. */
const HOP = 0.32;
const HOPS_PER_SECOND = 1000 / HOP_MS;
/** The flag's pole height above the stone top, where it stands (the stone's edge, away from the badge) and its cloth. */
const POLE = 1.1;
const POLE_X = -0.62;
const CLOTH_W = 0.64;
const CLOTH_H = 0.5;

const TOP: Record<StoneState, string> = {
  closed: '#6B7480', open: '#E9EEF3', next: '#FFFFFF', done: '#FFD54A',
};
const SIDE: Record<StoneState, string> = {
  closed: '#4F5762', open: '#9AA4B1', next: '#AEB7C2', done: '#F59F0B',
};

/** A pixel disc: a voxel circle of stone, its rim one shade darker on top. */
function stoneGeometry(state: StoneState): BufferGeometry {
  const batch = new BoxBatch();
  const r = Math.ceil(STONE_R);
  const top = new Color(TOP[state]);
  const rim = shade(TOP[state], -0.08);
  const side = new Color(SIDE[state]);
  batch.voxels(
    VOX, [-r, 0, -r], [r - 1, STONE_H - 1, r - 1],
    (i, _j, k) => (i + 0.5) ** 2 + (k + 0.5) ** 2 <= STONE_R ** 2,
    (i, j, k) => (j < STONE_H - 1 ? side : (i + 0.5) ** 2 + (k + 0.5) ** 2 > (STONE_R - 1.2) ** 2 ? rim : top),
  );
  return batch.build();
}

/** Small pebbles stepping from one stone to the next. */
function pebblesGeometry(path: [number, number][]): BufferGeometry {
  const batch = new BoxBatch();
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i]!;
    const [bx, bz] = path[i + 1]!;
    for (const t of [0.35, 0.5, 0.65]) {
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      batch.boxOn(x, 0, z, 0.2, 0.06, 0.2, PALETTE.boneShadow, PALETTE.bone);
    }
  }
  return batch.build();
}

/** A boxy flag on a wooden pole, its cloth in the player's frame colour. */
function flagGeometry(frame: string): BufferGeometry {
  const batch = new BoxBatch();
  batch.boxOn(POLE_X, 0, 0, 0.08, STONE_TOP + POLE, 0.08, PALETTE.walnutDark, PALETTE.walnut);
  // The cloth flies out from the pole, away from the stone.
  batch.box(POLE_X - CLOTH_W, STONE_TOP + POLE - CLOTH_H, -0.03, CLOTH_W, CLOTH_H, 0.06, shade(frame, -0.08), frame);
  batch.boxOn(POLE_X, STONE_TOP + POLE, 0, 0.12, 0.08, 0.12, PALETTE.petal);
  return batch.build();
}

/** A voxel padlock: a golden body and an iron shackle. */
function padlockGeometry(): BufferGeometry {
  const batch = new BoxBatch();
  batch.boxOn(0, 0, 0, 0.7, 0.55, 0.3, PALETTE.petalDark, PALETTE.petal);
  batch.boxOn(0, 0.2, 0.16, 0.12, 0.2, 0.04, PALETTE.outline);
  batch.boxOn(-0.24, 0.55, 0, 0.1, 0.32, 0.12, PALETTE.iron);
  batch.boxOn(0.24, 0.55, 0, 0.1, 0.32, 0.12, PALETTE.iron);
  batch.boxOn(0, 0.85, 0, 0.58, 0.1, 0.12, PALETTE.iron);
  return batch.build();
}

/** An islet greyed out: every vertex colour turned to a cool grey of its brightness. */
function greyIslet(random: () => number, grave: boolean): BufferGeometry {
  const geometry = buildIslet(grave, random);
  const colors = geometry.getAttribute('color') as BufferAttribute;
  for (let i = 0; i < colors.count; i++) {
    const l = 0.2126 * colors.getX(i) + 0.7152 * colors.getY(i) + 0.0722 * colors.getZ(i);
    const g = 0.12 + l * 0.6;
    colors.setXYZ(i, g, g * 1.02, g * 1.1);
  }
  colors.needsUpdate = true;
  return geometry;
}

const at = new Vector3();
const hopPt: Pt = { x: 0, y: 0 };

/**
 * The hop's height (0..1) at `seconds` on the page clock: a parabola in eight time steps
 * (Minecraft moves in steps). The HTML's CSS hop uses the same eight steps.
 */
export function hopHeight(seconds: number): number {
  const u = Math.floor(((seconds * HOPS_PER_SECOND) % 1) * 8) / 8;
  return 4 * u * (1 - u);
}

/**
 * The world map, a director on the app's one stage (no renderer, canvas or light of its own). The
 * camera rises so the island reads as a board; eight voxel stones wind across the Backyard, the
 * next one hops with the player's flag on it, and the four later worlds hang greyed in the sky
 * with padlocks. The HTML over it (numbers, stars, pictures, the tap targets) is placed from
 * `layout()`. `open` puts it on stage; `close` (or any other director taking the stage) takes
 * everything back out and frees what it made.
 */
export class MapStage implements Director {
  private readonly stage: StageLike;
  /** Seconds on the page clock: the 3D hop and the HTML's CSS hop share it, so they keep in step. */
  private readonly clock: () => number;
  private readonly out: { stones: Record<string, Pt>; flag: Pt | null; hop: number; version: number } = {
    stones: {}, flag: null, hop: 0, version: 0,
  };
  private readonly flagPt: Pt = { x: 0, y: 0 };
  /** The canvas's place on the page, measured on open and on `measure()` (a resize), never per frame. */
  private readonly rect = { left: 0, top: 0, width: 0, height: 0 };
  /** The camera the points were last projected with (world matrix, then projection). */
  private readonly seen = new Float64Array(32);
  private dirty = true;
  private readonly root = new Group();
  /** One matte material for everything the map builds; made on open, freed on close. */
  private material: MeshStandardMaterial | null = null;
  private stones: { id: string; mesh: Mesh; x: number; z: number }[] = [];
  private nextStone: Mesh | null = null;
  private flag: Mesh | null = null;
  private worlds: { mesh: Group; y: number; phase: number }[] = [];

  constructor(stage: StageLike, { clock = () => performance.now() / 1000 }: { clock?: () => number } = {}) {
    this.stage = stage;
    this.clock = clock;
    this.root.name = 'map';
  }

  get isOpen(): boolean {
    return this.stage.director === this;
  }

  /** Meshes the map has in the scene now (for tests). */
  get meshCount(): number {
    let n = 0;
    this.root.traverse((o) => { if (o instanceof Mesh) n++; });
    return n;
  }

  open(view: MapView): void {
    if (!this.isOpen) {
      this.stage.show(this);
      this.material = new MeshStandardMaterial(MATTE_PLASTIC);
      this.stage.scene.add(this.root);
      this.buildWorlds();
      this.measure();
    }
    this.update(view);
  }

  close(): void {
    this.stage.release(this);
  }

  /** Shows `view` (another side, new stars); rebuilds only the stones, pebbles and flag. */
  update(view: MapView): void {
    const material = this.material;
    if (!this.isOpen || material === null) return;
    this.clearPath();
    const path = pathFor(view.side);
    const pebbles = new Mesh(pebblesGeometry(path), material);
    pebbles.name = 'map-pebbles';
    pebbles.receiveShadow = true;
    this.root.add(pebbles);
    const points: Record<string, Pt> = {};
    view.stones.forEach((s, i) => {
      points[s.id] = { x: 0, y: 0 };
      const [x, z] = path[i] ?? path[path.length - 1]!;
      const mesh = new Mesh(stoneGeometry(s.state), material);
      mesh.name = `map-stone-${s.id}`;
      mesh.position.set(x, 0, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.stones.push({ id: s.id, mesh, x, z });
      if (s.state === 'next') {
        this.nextStone = mesh;
        const flag = new Mesh(flagGeometry(view.frame), material);
        flag.name = 'map-flag';
        flag.castShadow = true;
        // The cloth flies towards the path's start (the badge over the stone leaves that side free).
        if (view.side === 'zombies') flag.scale.x = -1;
        mesh.add(flag);
        this.flag = flag;
      }
    });
    this.out.stones = points;
    this.out.flag = this.flag ? this.flagPt : null;
    this.dirty = true;
    // The camera rises over the island; the worlds in the sky stay in the picture.
    this.stage.rig.frameSubject(
      { x: [-1.4, 11.4], y: [0, 1.2], z: [-4.4, 6.2] },
      { pitchDeg: 58, side: 0.02, top: 0.12, bottom: 0.02 },
    );
  }

  /** Measures where the canvas is on the page: on open, and when the window or its zoom changes. */
  measure(): void {
    const r = this.stage.canvas.getBoundingClientRect();
    this.rect.left = r.left;
    this.rect.top = r.top;
    this.rect.width = r.width || window.innerWidth;
    this.rect.height = r.height || window.innerHeight;
    this.dirty = true;
  }

  /**
   * Where the HTML goes (see `MapLayout`); null while the map is not on stage. Cheap to call every
   * frame: the points are projected again only when the camera or the measured size changed, into
   * the same objects, with nothing allocated.
   */
  layout(): MapLayout | null {
    if (!this.isOpen) return null;
    const camera = this.stage.camera;
    camera.updateMatrixWorld();
    const world = camera.matrixWorld.elements;
    const proj = camera.projectionMatrix.elements;
    let same = !this.dirty;
    for (let i = 0; i < 16 && same; i++) same = this.seen[i] === world[i] && this.seen[16 + i] === proj[i];
    if (same) return this.out;
    for (let i = 0; i < 16; i++) {
      this.seen[i] = world[i]!;
      this.seen[16 + i] = proj[i]!;
    }
    this.dirty = false;
    for (let i = 0; i < this.stones.length; i++) {
      const s = this.stones[i]!;
      this.project(s.x, STONE_TOP, s.z, this.out.stones[s.id]!);
    }
    this.out.hop = 0;
    if (this.flag && this.nextStone) {
      // The middle of the cloth: the player's picture goes there.
      const sx = this.flag.scale.x;
      const p = this.nextStone.position;
      this.project(p.x + sx * (POLE_X - CLOTH_W / 2), STONE_TOP + POLE - CLOTH_H / 2, p.z, this.flagPt);
      const restY = this.flagPt.y;
      this.project(p.x, STONE_TOP + POLE - CLOTH_H / 2 + HOP, p.z, hopPt);
      this.out.hop = Math.max(0, Math.round(restY - hopPt.y));
    }
    this.out.version++;
    return this.out;
  }

  /** A world point to client pixels, written into `into`. */
  private project(x: number, y: number, z: number, into: Pt): void {
    at.set(x, y, z).project(this.stage.camera);
    const r = this.rect;
    into.x = r.left + (at.x * 0.5 + 0.5) * r.width;
    into.y = r.top + (0.5 - at.y * 0.5) * r.height;
  }

  step(): void {}

  frame(_alpha: number, _realDt: number, _gameDt = 0): void {
    const t = this.clock();
    if (this.nextStone) this.nextStone.position.y = hopHeight(t) * HOP;
    for (let i = 0; i < this.worlds.length; i++) {
      const w = this.worlds[i]!;
      w.mesh.position.y = w.y + Math.sin(t * 0.6 + w.phase) * 0.08;
    }
  }

  detach(): void {
    this.clearPath();
    for (const w of this.worlds) {
      w.mesh.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose(); });
      this.root.remove(w.mesh);
    }
    this.worlds = [];
    this.stage.scene.remove(this.root);
    this.material?.dispose();
    this.material = null;
    this.stage.rig.frameSubject(null);
  }

  private buildWorlds(): void {
    const material = this.material as MeshStandardMaterial;
    const random = seededRandom(77);
    WORLDS.forEach(([x, y, z, scale], i) => {
      const group = new Group();
      group.name = `map-world-${i + 2}`;
      const islet = new Mesh(greyIslet(random, i >= 2), material);
      islet.scale.setScalar(scale);
      islet.rotation.y = (random() - 0.5) * 0.6;
      islet.castShadow = true;
      const lock = new Mesh(padlockGeometry(), material);
      lock.position.set(0.1, 0.05, 0.2);
      lock.castShadow = true;
      group.add(islet, lock);
      group.position.set(x, y, z);
      this.root.add(group);
      this.worlds.push({ mesh: group, y, phase: i * 1.7 });
    });
  }

  private clearPath(): void {
    for (const o of [...this.root.children]) {
      if (o.name.startsWith('map-world-')) continue;
      o.traverse((c) => { if (c instanceof Mesh) c.geometry.dispose(); });
      this.root.remove(o);
    }
    this.stones = [];
    this.nextStone = null;
    this.flag = null;
  }
}
