import { Group, Mesh, type Material } from 'three';
import type { WorldKey } from '../../data/worlds';
import { COLS, PLANT_COLS } from '../../sim/types';

// The lawn twists as the player sees them: boulders on rock tiles, mist over a foggy lawn,
// icy lanes and glowing lava tiles. Built once when a battle starts (the twists never change
// during a match); `update` only moves uniforms.

// TODO(merge): import LawnConfig and NO_TWIST from the sim once the twist task is merged; this
// is the same shape, declared here so the render layer builds before it.
/** What a level does to the lawn (the sim's `MatchConfig.lawn`). */
export interface LawnConfig {
  /** Tiles a plant may not be put on, as lane * PLANT_COLS + col. */
  rocks: number[];
  /** Tiles a shot reaches before it fades, or null for no fog. */
  fog: number | null;
  ice: { lanes: number[]; speed: number } | null;
  /** Burning tiles, as lane * COLS + col. */
  lava: { tiles: number[]; dps: number; burnTicks: number } | null;
}

/** A lawn with no twist. */
export const NO_TWIST: LawnConfig = { rocks: [], fog: null, ice: null, lava: null };

/**
 * Each world's twist as a level might use it, for the tools and the debug hooks until the
 * levels of worlds 2–5 exist (numbers as `Balance.twists` will give them).
 */
export const SAMPLE_LAWNS: Record<WorldKey, LawnConfig> = {
  backyard: NO_TWIST,
  meadow: { ...NO_TWIST, fog: 5 },
  desert: { ...NO_TWIST, rocks: [0 * PLANT_COLS + 3, 1 * PLANT_COLS + 5, 2 * PLANT_COLS + 2, 3 * PLANT_COLS + 6, 4 * PLANT_COLS + 4] },
  tundra: { ...NO_TWIST, ice: { lanes: [1, 3], speed: 1.6 } },
  citadel: { ...NO_TWIST, lava: { tiles: [0 * COLS + 4, 1 * COLS + 6, 2 * COLS + 3, 2 * COLS + 8, 3 * COLS + 5, 4 * COLS + 2], dps: 15, burnTicks: 60 } },
};

/** True when the two configs draw the same lawn. */
export function sameLawn(a: LawnConfig, b: LawnConfig): boolean {
  const same = (x: readonly number[] | undefined, y: readonly number[] | undefined): boolean =>
    (x ?? []).length === (y ?? []).length && (x ?? []).every((v, i) => v === (y ?? [])[i]);
  return (
    same(a.rocks, b.rocks) &&
    a.fog === b.fog &&
    (a.ice === null) === (b.ice === null) &&
    same(a.ice?.lanes, b.ice?.lanes) &&
    (a.lava === null) === (b.lava === null) &&
    same(a.lava?.tiles, b.lava?.tiles)
  );
}

/** The lawn tiles (col, lane) the config covers with ice or lava, where no grass grows. */
export function coveredTile(config: LawnConfig): (col: number, lane: number) => boolean {
  const ice = new Set(config.ice?.lanes ?? []);
  const lava = new Set(config.lava?.tiles ?? []);
  return (col, lane) => ice.has(lane) || lava.has(lane * COLS + col);
}

/** A rock tile's (lane, col). */
export function rockTile(index: number): { lane: number; col: number } {
  return { lane: Math.floor(index / PLANT_COLS), col: index % PLANT_COLS };
}

/** A lava tile's (lane, col). */
export function lavaTile(index: number): { lane: number; col: number } {
  return { lane: Math.floor(index / COLS), col: index % COLS };
}

/** The twist visuals of one lawn config, as one group. */
export class TwistTiles {
  readonly group = new Group();
  private readonly materials: Material[] = [];

  constructor(readonly config: LawnConfig) {
    this.group.name = 'twist-tiles';
  }

  /** Moves the mist and the lava's glow on to `timeSeconds`. Allocates nothing. */
  update(timeSeconds: number): void {
    void timeSeconds;
  }

  /** Frees every geometry and material it made. Take `group` out of the scene first. */
  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
  }
}
