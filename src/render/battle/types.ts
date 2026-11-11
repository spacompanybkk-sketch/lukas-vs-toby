import type { UnitKey } from '../../sim/types';

/** Screen feedback a battle event asks for; every field is optional and in the view's own units. */
export interface Feel { shake?: number; hitStop?: number; slowMo?: number; punch?: number }

/** What the placement ghost should show for the tile under the pointer. */
export interface PlacementPreview {
  unit: UnitKey; lane: number; col: number; ok: boolean; mergeTargetId: number | null;
}
