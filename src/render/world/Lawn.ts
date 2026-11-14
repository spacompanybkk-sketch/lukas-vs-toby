import { Color, Group, Mesh, MeshStandardMaterial, type InstancedMesh, type Material } from 'three';
import type { WorldKey } from '../../data/worlds';
import { LAWN_COLS, LAWN_LANES } from '../coords';
import { MATTE_PLASTIC } from '../look';
import type { Faction } from '../types';
import { seededRandom } from './boxes';
import { buildGrass } from './grass';
import { buildIsland, buildIslet } from './island';
import { LOOKS, type Look } from './looks';
import { PlaceMarks } from './PlaceMarks';
import { TileMark, type MarkState } from './TileMark';
import { Weather } from './Weather';
import { TwistTiles, coveredTile, sameLawn } from './TwistTiles';
import { NO_TWIST } from '../../sim/lawn';
import type { LawnConfig } from '../../sim/types';

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

/**
 * The battlefield: a floating island with the 10 × 5 lawn on top, dressed as one world (the
 * Backyard unless told otherwise) with its lawn twists drawn on it.
 */
export class Lawn {
  readonly group = new Group();

  private readonly wind = { value: 0 };
  private readonly tileMark = new TileMark('tile-mark', 1, 1);
  private readonly laneMark = new TileMark('lane-mark', LAWN_COLS, 1);
  private readonly placeMarks = new PlaceMarks();
  private readonly islets: Islet[] = [];
  /** What the current world built: island, props, grass, islets, twist tiles. */
  private readonly dressing = new Group();
  private grass!: InstancedMesh;
  private materials: Material[] = [];
  private twistTiles: TwistTiles | null = null;
  private weather: Weather | null = null;
  private worldKey: WorldKey;
  private twist: LawnConfig;
  private time = 0;

  constructor(world: WorldKey = 'backyard', twist: LawnConfig = NO_TWIST) {
    this.group.name = 'lawn';
    this.dressing.name = 'world';
    this.worldKey = world;
    this.twist = twist;
    this.group.add(this.dressing);
    this.build(LOOKS[world], twist);
    this.placeMarks.setLook(LOOKS[world].marks);
    this.group.add(this.tileMark.mesh, this.laneMark.mesh, this.placeMarks.mesh);
    this.update(0);
  }

  /** The world the lawn is dressed as. */
  get world(): WorldKey {
    return this.worldKey;
  }

  /** The lawn twists drawn on it. */
  get lawnConfig(): LawnConfig {
    return this.twist;
  }

  /**
   * Dresses the island as `world` with `twist`'s tiles, freeing everything the old dressing
   * made. Returns false (and does nothing) when that is what it already shows.
   */
  setWorld(world: WorldKey, twist: LawnConfig = NO_TWIST): boolean {
    if (world === this.worldKey && sameLawn(twist, this.twist)) return false;
    this.clear();
    this.worldKey = world;
    this.twist = twist;
    this.build(LOOKS[world], twist);
    this.placeMarks.setLook(LOOKS[world].marks);
    this.update(this.time);
    return true;
  }

  private build(look: Look, twist: LawnConfig): void {
    const plastic = new MeshStandardMaterial(MATTE_PLASTIC);
    const glowing = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0,
      emissive: new Color(look.glow.color),
      emissiveIntensity: look.glow.intensity,
    });
    this.materials = [plastic, glowing];

    const island = new Mesh(buildIsland(look.ground), plastic);
    island.name = 'island';
    island.castShadow = true;
    island.receiveShadow = true;
    this.dressing.add(island);

    const props = look.props();
    const solid = new Mesh(props.solid, plastic);
    solid.name = 'props';
    solid.castShadow = true;
    solid.receiveShadow = true;
    this.dressing.add(solid);

    const glow = new Mesh(props.glow, glowing);
    glow.name = 'crystals';
    glow.castShadow = true;
    this.dressing.add(glow);

    this.grass = buildGrass(this.wind, look.tufts, coveredTile(twist));
    this.dressing.add(this.grass);

    const random = seededRandom(4242);
    for (const [x, y, z, grave, scale] of ISLETS) {
      const mesh = new Mesh(buildIslet(grave, random, look), plastic);
      mesh.name = 'islet';
      mesh.position.set(x, y, z);
      mesh.rotation.y = (random() - 0.5) * 0.8;
      mesh.scale.setScalar(scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.dressing.add(mesh);
      this.islets.push({ mesh, y, phase: random() * 6.28 });
    }

    if (look.weather !== 'none') {
      this.weather = new Weather(look.weather);
      if (this.weather.mesh) this.dressing.add(this.weather.mesh);
    }

    if (twist !== NO_TWIST && !sameLawn(twist, NO_TWIST)) {
      this.twistTiles = new TwistTiles(twist);
      this.dressing.add(this.twistTiles.group);
    }
  }

  /** Frees the current dressing (the highlight marks stay). */
  private clear(): void {
    this.dressing.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.materials = [];
    (this.grass.material as Material).dispose();
    this.grass.dispose();
    this.twistTiles?.dispose();
    this.twistTiles = null;
    this.weather?.dispose();
    this.weather = null;
    this.islets.length = 0;
    this.dressing.clear();
  }

  /** Moves the grass, the drifting rocks and the highlight pulse to `timeSeconds`. */
  update(timeSeconds: number): void {
    this.time = timeSeconds;
    this.wind.value = timeSeconds;
    this.twistTiles?.update(timeSeconds);
    this.weather?.update(timeSeconds);
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
   * Marks every tile the picked card may go on (`mask`: 1 at `lane * LAWN_COLS + col`); null
   * clears them. Call it when the tiles change, not every frame.
   */
  showPlaceable(mask: Uint8Array | null): void {
    this.placeMarks.show(mask);
  }

  /** How strongly the place marks show (`MARKS_QUIET` while a card stays picked, `MARKS_LOUD` while dragging). */
  setPlaceStrength(strength: number): void {
    this.placeMarks.setStrength(strength);
  }

  /** Frees every geometry and material the lawn made. Take `group` out of the scene first. */
  dispose(): void {
    this.clear();
    this.tileMark.dispose();
    this.laneMark.dispose();
    this.placeMarks.dispose();
  }
}
