import { UnitState } from '../entities/Unit';

export class CombatManager {
  findTarget(attacker: UnitState, allUnits: UnitState[]): UnitState | null {
    const effectiveRange = attacker.range === 0 ? 1 : attacker.range;
    let bestTarget: UnitState | null = null;
    let bestDistance = Infinity;

    for (const unit of allUnits) {
      if (unit.faction === attacker.faction) continue;
      if (!unit.isAlive()) continue;
      if (Math.abs(unit.row - attacker.row) > 0.5) continue;

      const distance = unit.col - attacker.col;

      // Plants target enemies to the right (positive distance)
      // BUT also target enemies on the same tile (distance ~0) for melee/overlap
      if (attacker.faction === 'plants' && distance < -0.5) continue;
      // Zombies target enemies to the left (negative distance)
      // BUT also target enemies on the same tile
      if (attacker.faction === 'zombies' && distance > 0.5) continue;

      const absDistance = Math.abs(distance);
      if (absDistance > effectiveRange) continue;

      if (absDistance < bestDistance) {
        bestDistance = absDistance;
        bestTarget = unit;
      }
    }

    return bestTarget;
  }
}
