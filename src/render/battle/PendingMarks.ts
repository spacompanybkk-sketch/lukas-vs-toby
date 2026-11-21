import { Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D, type Scene } from 'three';
import type { PendingMark } from '../../app/BattleController';
import type { UnitKey } from '../../sim/types';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import { BoxBatch, seededRandom } from '../world/boxes';

/** A refused tap's puff (or crack) folds into the ground over this long, then goes (spec 6.4). */
export const COLLAPSE_SECONDS = 0.6;
/** How fast a waiting puff breathes (radians a second) and by how much (share of its height). */
const SPROUT_SPEED = 9;
const SPROUT_SWELL = 0.18;
/** The collapse sinks the mark this far into the lawn as it shrinks. */
const COLLAPSE_SINK = 0.15;

/** One mark on the lawn: its group (puff or crack, and the card's ghost), its age, its collapse. */
interface Shown {
  id: number;
  group: Group;
  /** The leaf puff or the crack of earth: the part that breathes. */
  ground: Mesh;
  age: number;
  /** Seconds of the collapse left, or null while the tap still waits. */
  collapse: number | null;
}

/** A sprouting puff of leaves: small green cubes in a loose ring, a few taller in the middle. */
function leafPuff(): BufferGeometry {
  const b = new BoxBatch();
  const random = seededRandom(0x1eaf);
  const greens = [PALETTE.leaf, PALETTE.leafLight, PALETTE.leafDark];
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 + random() * 0.4;
    const r = 0.16 + random() * 0.12;
    const s = 0.07 + random() * 0.05;
    b.boxOn(Math.cos(angle) * r, random() * 0.05, Math.sin(angle) * r, s, s * (1.2 + random()), s, greens[i % 3]!);
  }
  for (let i = 0; i < 3; i++) {
    const s = 0.06 + random() * 0.03;
    b.boxOn((random() - 0.5) * 0.12, 0, (random() - 0.5) * 0.12, s, 0.14 + random() * 0.1, s, PALETTE.leafLight, PALETTE.leaf);
  }
  return b.build();
}

/** A crack of earth: a jagged dark line across the tile, broken clods of soil thrown up beside it. */
function earthCrack(): BufferGeometry {
  const b = new BoxBatch();
  const random = seededRandom(0xc7ac);
  let z = -0.06;
  for (let i = 0; i < 7; i++) {
    const x = -0.36 + i * 0.12;
    z += (random() - 0.5) * 0.1;
    b.boxOn(x, 0.005, z, 0.13, 0.02, 0.07, PALETTE.soilDark);
  }
  for (let i = 0; i < 6; i++) {
    const x = -0.3 + random() * 0.6;
    const side = i % 2 === 0 ? 1 : -1;
    const s = 0.06 + random() * 0.05;
    b.boxOn(x, 0, side * (0.08 + random() * 0.1), s, s * 0.8, s, i % 3 === 0 ? PALETTE.soilDark : PALETTE.soil);
  }
  return b.build();
}

/**
 * The own taps waiting to run in two-device Versus (spec 6.4): a sprouting puff of leaves (plants)
 * or a crack of earth (zombies) with the card's ghost, on the mark's tile, until the sim's unit
 * replaces it. A refused tap's mark collapses over `COLLAPSE_SECONDS` of frames, then goes, even if
 * the list still holds it. A spell or hero mark shows nothing here. The two shapes are built once
 * in code from voxels; the ghosts come from `ghostOf` (the view's, which owns them).
 */
export class PendingMarks {
  readonly group = new Group();
  private readonly ghostOf: (unit: UnitKey) => Object3D;
  private readonly puffGeometry = leafPuff();
  private readonly crackGeometry = earthCrack();
  private readonly material = new MeshStandardMaterial(MATTE_PLASTIC);
  private readonly shownById = new Map<number, Shown>();
  /** Marks that have collapsed but are still listed: not drawn again. */
  private readonly done = new Set<number>();
  private disposed = false;

  constructor(scene: Scene, ghostOf: (unit: UnitKey) => Object3D) {
    this.ghostOf = ghostOf;
    this.group.name = 'pending-marks';
    scene.add(this.group);
  }

  /** Marks on the lawn now, for tests. */
  get shown(): number {
    return this.shownById.size;
  }

  /** The marks to show (the controller's `online.pending`): new ones appear, gone ones go, refused ones collapse. */
  set(marks: readonly PendingMark[]): void {
    if (this.disposed) return;
    const listed = new Set<number>();
    for (const mark of marks) {
      if (mark.unit === null) continue;
      listed.add(mark.id);
      if (this.done.has(mark.id)) continue;
      let shown = this.shownById.get(mark.id);
      if (shown === undefined) shown = this.add(mark, mark.unit);
      if (mark.refused && shown.collapse === null) shown.collapse = COLLAPSE_SECONDS;
    }
    for (const shown of [...this.shownById.values()]) {
      // a collapse under way plays out; a mark still waiting goes with its tap (the unit stands there now)
      if (!listed.has(shown.id) && shown.collapse === null) this.remove(shown);
    }
    for (const id of [...this.done]) if (!listed.has(id)) this.done.delete(id);
  }

  /** Once a frame, with real seconds: the puffs breathe and the collapses run on. */
  frame(dt: number): void {
    const step = dt > 0 ? dt : 0;
    // A Map may lose the entry being visited: no copy needed, and a frame allocates nothing.
    for (const shown of this.shownById.values()) {
      shown.age += step;
      const breathe = 1 + SPROUT_SWELL * Math.sin(shown.age * SPROUT_SPEED);
      shown.ground.scale.set(1, breathe, 1);
      if (shown.collapse === null) continue;
      shown.collapse -= step;
      if (shown.collapse <= 0) {
        this.remove(shown);
        this.done.add(shown.id);
        continue;
      }
      const left = shown.collapse / COLLAPSE_SECONDS;
      shown.group.scale.setScalar(left);
      shown.group.position.y = -COLLAPSE_SINK * (1 - left);
    }
  }

  /** Takes every mark off the lawn and frees the shapes and the material. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const shown of [...this.shownById.values()]) this.remove(shown);
    this.done.clear();
    this.group.removeFromParent();
    this.puffGeometry.dispose();
    this.crackGeometry.dispose();
    this.material.dispose();
  }

  private add(mark: PendingMark, unit: UnitKey): Shown {
    const group = new Group();
    group.name = `pending-${mark.id}`;
    group.position.set(mark.col + 0.5, 0, mark.lane + 0.5);
    const plants = mark.faction === 'plants';
    const ground = new Mesh(plants ? this.puffGeometry : this.crackGeometry, this.material);
    ground.name = plants ? 'pending-puff' : 'pending-crack';
    ground.castShadow = false;
    ground.receiveShadow = false;
    group.add(ground, this.ghostOf(unit));
    this.group.add(group);
    const shown: Shown = { id: mark.id, group, ground, age: 0, collapse: null };
    this.shownById.set(mark.id, shown);
    return shown;
  }

  private remove(shown: Shown): void {
    shown.group.removeFromParent();
    const children = shown.group.children; // the ghost leaves the scene with it (no `clear`: it spreads)
    while (children.length > 0) shown.group.remove(children[children.length - 1]!);
    this.shownById.delete(shown.id);
  }
}
