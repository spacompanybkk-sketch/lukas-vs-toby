import { UnitState } from '../entities/Unit';

export class CombatManager {
  findTarget(attacker: UnitState, allUnits: UnitState[]): UnitState | null {
    const effectiveRange = attacker.range === 0 ? 1 : attacker.range;
    let bestTarget: UnitState | null = null;
    let bestDistance = Infinity;

    for (const unit of allUnits) {
      if (unit.faction === attacker.faction) continue;
      if (!unit.isAlive()) continue;
      if (unit.row !== attacker.row) continue;

      const distance = unit.col - attacker.col;
      if (attacker.faction === 'plants' && distance <= 0) continue;
      if (attacker.faction === 'zombies' && distance >= 0) continue;

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
