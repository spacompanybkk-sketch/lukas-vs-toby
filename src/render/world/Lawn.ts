import { Color, Group, Mesh, MeshStandardMaterial, type InstancedMesh, type Material } from 'three';
import { LAWN_COLS, LAWN_LANES } from '../coords';
import { MATTE_PLASTIC } from '../look';
import { PALETTE } from '../palette';
import type { Faction } from '../types';
import { seededRandom } from './boxes';
import { buildGrass } from './grass';
import { buildIsland, buildIslet } from './island';
import { buildProps } from './props';
import { PlaceMarks } from './PlaceMarks';
import { TileMark, type MarkState } from './TileMark';

/** A small rock adrift beside the island. */
interface Islet {
  mesh: Mesh;
  y: number;
  phase: number;
}

/**
 * Where the islets float: x, y, z, whether it is a graveyard one, and its scale. Placed to
 * show past the island's back corners in every window shape.
 */
const ISLETS: readonly [number, number, number, boolean, number][] = [
  [-4.3, -1.6, -4.7, false, 1.0],
  [12.6, -1.5, -5.3, true, 0.9],
  [0.9, -2.5, -6.4, false, 0.55],
];

/** The battlefield: a floating island with the 10 × 5 lawn on top. */
export class Lawn {
  readonly group = new Group();

  private readonly wind = { value: 0 };
  private readonly tileMark = new TileMark('tile-mark', 1, 1);
  private readonly laneMark = new TileMark('lane-mark', LAWN_COLS, 1);
  private readonly placeMarks = new PlaceMarks();
  private readonly islets: Islet[] = [];
  private readonly grass: InstancedMesh;
  private readonly materials: Material[];

  constructor() {
    this.group.name = 'lawn';

    const plastic = new MeshStandardMaterial(MATTE_PLASTIC);
    const glowing = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0,
      emissive: new Color(PALETTE.crystalGlow),
      emissiveIntensity: 5,
    });
    this.materials = [plastic, glowing];

    const island = new Mesh(buildIsland(), plastic);
    island.name = 'island';
    island.castShadow = true;
    island.receiveShadow = true;
    this.group.add(island);

    const props = buildProps();
    const solid = new Mesh(props.solid, plastic);
    solid.name = 'props';
    solid.castShadow = true;
    solid.receiveShadow = true;
    this.group.add(solid);

    const glow = new Mesh(props.glow, glowing);
    glow.name = 'crystals';
    glow.castShadow = true;
    this.group.add(glow);

    this.grass = buildGrass(this.wind);
    this.group.add(this.grass);

    const random = seededRandom(4242);
    for (const [x, y, z, grave, scale] of ISLETS) {
      const mesh = new Mesh(buildIslet(grave, random), plastic);
      mesh.name = 'islet';
      mesh.position.set(x, y, z);
      mesh.rotation.y = (random() - 0.5) * 0.8;
      mesh.scale.setScalar(scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.islets.push({ mesh, y, phase: random() * 6.28 });
    }

    this.group.add(this.tileMark.mesh, this.laneMark.mesh, this.placeMarks.mesh);
    this.update(0);
  }

  /** Moves the grass, the drifting rocks and the highlight pulse to `timeSeconds`. */
  update(timeSeconds: number): void {
    this.wind.value = timeSeconds;
    for (const islet of this.islets) {
      islet.mesh.position.y = islet.y + Math.sin(timeSeconds * 0.55 + islet.phase) * 0.07;
    }
    const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * 5.5);
    this.tileMark.pulse(pulse);
    this.laneMark.pulse(pulse);
  }

  /**
   * Marks one tile as a good (`ok`) or forbidden (`bad`) place; `null` clears it. `side`
   * picks the fill colour of a good tile and is the plants unless said otherwise, since
   * tiles are where plants go.
   */
  highlightTile(lane: number, col: number, state: MarkState | null, side: Faction = 'plants'): void {
    if (state === null || !(lane >= 0 && lane < LAWN_LANES && col >= 0 && col < LAWN_COLS)) {
      this.tileMark.hide();
      return;
    }
    this.tileMark.show(Math.floor(col) + 0.5, Math.floor(lane) + 0.5, state, side);
  }

  /**
   * Marks a whole lane as a good or forbidden place; a `null` lane clears it. `side` picks
   * the fill colour of a good lane and is the zombies unless said otherwise, since lanes
   * are what zombies are sent into.
   */
  highlightLane(lane: number | null, state: MarkState, side: Faction = 'zombies'): void {
    if (lane === null || !(lane >= 0 && lane < LAWN_LANES)) {
      this.laneMark.hide();
      return;
    }
    this.laneMark.show(LAWN_COLS / 2, Math.floor(lane) + 0.5, state, side);
  }

  /**
   * Marks every tile the picked card may go on (`mask`: 1 at `lane * LAWN_COLS + col`), in `side`'s
   * colour; null clears them. Call it when the tiles change, not every frame.
   */
  showPlaceable(mask: Uint8Array | null, side: Faction): void {
    this.placeMarks.show(mask, side);
  }

  /** Frees every geometry and material the lawn made. Take `group` out of the scene first. */
  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    (this.grass.material as Material).dispose();
    this.grass.dispose();
    this.tileMark.dispose();
    this.laneMark.dispose();
    this.placeMarks.dispose();
  }
}
