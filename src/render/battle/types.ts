import type { UnitKey } from '../../sim/types';

/** Screen feedback a battle event asks for; every field is optional and in the view's own units. */
export interface Feel {
  shake?: number; hitStop?: number; slowMo?: number; punch?: number;
  /** How long the punch lasts (default 0.25 s). */
  punchSeconds?: number;
  /** While it punches, the camera also leans towards this lane line (world z): a hero power's push-in. */
  focusZ?: number;
}

/** What the placement ghost should show for the tile under the pointer. */
export interface PlacementPreview {
  unit: UnitKey; lane: number; col: number; ok: boolean; mergeTargetId: number | null;
}

/** While an aimed spell is picked: the tiles a tap would cover (from the simulation), and whether it would be allowed. */
export interface AreaPreview { spell: string; tiles: readonly { lane: number; col: number }[]; ok: boolean }

/** While the hero power is picked: the lane a tap would send it down. */
export interface LanePreview { hero: true; lane: number; ok: boolean }

/** Whatever the pointer is aiming: a card's spot, a spell's area, or the hero's lane. */
export type AimPreview = PlacementPreview | AreaPreview | LanePreview;
