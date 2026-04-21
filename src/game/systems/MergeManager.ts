import { UnitState, MAX_UNIT_LEVEL } from '../entities/Unit';
import { MERGE_OVERLAP_DURATION } from '../constants';

export interface MergeResult {
  survivor: UnitState;
  consumed: UnitState;
  newTextureKey: string;
}

export class MergeManager {
  // Overlap timers keyed by sorted unit ID pair: "id1|id2" -> elapsed ms
  private overlapTimers: Map<string, number> = new Map();

  /** Check if two units can merge */
  canMerge(unitA: UnitState, unitB: UnitState): boolean {
    if (unitA.key !== unitB.key) return false;
    if (unitA.faction !== unitB.faction) return false;
    if (unitA.level >= MAX_UNIT_LEVEL) return false;
    if (unitB.level >= MAX_UNIT_LEVEL) return false;
    return true;
  }

  /** Merge two units. The higher-level (or older) unit survives and levels up. */
  merge(unitA: UnitState, unitB: UnitState): MergeResult {
    // Higher level survives. If equal, unitA (older/existing) survives.
    const survivor = unitA.level >= unitB.level ? unitA : unitB;
    const consumed = survivor === unitA ? unitB : unitA;

    survivor.levelUp();

    return {
      survivor,
      consumed,
      newTextureKey: survivor.getTextureKey(),
    };
  }

  /**
   * Track overlap between two same-type moving units.
   * Returns MergeResult after MERGE_OVERLAP_DURATION ms of continuous overlap,
   * or null if timer hasn't elapsed yet.
   */
  trackOverlap(unitA: UnitState, unitB: UnitState, delta: number): MergeResult | null {
    if (!this.canMerge(unitA, unitB)) return null;

    const key = this.pairKey(unitA.id, unitB.id);
    const elapsed = (this.overlapTimers.get(key) ?? 0) + delta;
    this.overlapTimers.set(key, elapsed);

    if (elapsed >= MERGE_OVERLAP_DURATION) {
      this.overlapTimers.delete(key);
      return this.merge(unitA, unitB);
    }

    return null;
  }

  /** Reset overlap timer for a pair (called when units separate) */
  resetOverlap(unitA: UnitState, unitB: UnitState): void {
    this.overlapTimers.delete(this.pairKey(unitA.id, unitB.id));
  }

  /** Clear all timers involving a specific unit (called on death) */
  clearTimers(unitId: string): void {
    for (const key of this.overlapTimers.keys()) {
      if (key.includes(unitId)) {
        this.overlapTimers.delete(key);
      }
    }
  }

  private pairKey(idA: string, idB: string): string {
    return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
  }
}
