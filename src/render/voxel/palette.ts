import type { PaletteName } from '../palette';

// The colours models are painted with, and what each of the five levels adds (art bible
// sections 1 and 3). Colours live in one table for the whole renderer; this module passes
// it on so model code has a single place to look.
export { PALETTE } from '../palette';

export const MAX_LEVEL = 5;

/** Size of a model at each level, indexed by level. There is no level 0. */
export const LEVEL_SCALE: number[] = [0, 1, 1.08, 1.16, 1.24, 1.34];

export type LevelMaterial = 'none' | 'iron' | 'crystal' | 'gold';

/** The material a level turns a model's trim into: iron at 3, crystal at 4, gold at 5. */
export function levelMaterial(level: number): LevelMaterial {
  if (level >= 5) return 'gold';
  if (level === 4) return 'crystal';
  if (level === 3) return 'iron';
  return 'none';
}

export interface LevelMaterialDef {
  /** Palette names: the main tone, then its shadow tone. Boxes in these colours get this material. */
  tones: readonly [PaletteName, PaletteName];
  metalness: number;
  roughness: number;
  /** Emissive intensity, in the main tone. 1.5 or more blooms. */
  emissive: number;
  /**
   * Whether the glow is multiplied by each surface's own baked colour, so that faces and
   * creases still read through it (art bible section 3). Without it the glow is even.
   */
  shadedGlow: boolean;
}

export const LEVEL_MATERIALS: Record<Exclude<LevelMaterial, 'none'>, LevelMaterialDef> = {
  iron: { tones: ['levelIron', 'levelIronDark'], metalness: 0.6, roughness: 0.4, emissive: 0, shadedGlow: false },
  // Glows, and keeps its shading while it does. The glow is multiplied by the baked tone, so
  // the intensity is set for what a lit top face emits after that: about 1.37 in scene
  // luminance, over the bloom threshold of 1.2, with sides and creases falling below it.
  crystal: { tones: ['levelCrystal', 'levelCrystalDeep'], metalness: 0, roughness: 0.25, emissive: 2.5, shadedGlow: true },
  // A warm, even sheen, not a glow.
  gold: { tones: ['levelGold', 'levelGoldDark'], metalness: 0.8, roughness: 0.35, emissive: 0.15, shadedGlow: false },
};
