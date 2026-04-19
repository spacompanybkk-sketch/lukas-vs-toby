import { describe, it, expect } from 'vitest';
import { CombatManager } from '../src/game/systems/CombatManager';
import { UnitState } from '../src/game/entities/Unit';

describe('CombatManager', () => {
  it('finds enemies in range for a ranged plant (same row, ahead)', () => {
    const cm = new CombatManager();
    const plant = new UnitState('p1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    plant.setPosition(2, 1);
    const zombie = new UnitState('z1', 'brainEater', 'zombies', 120, 25, 2000, 4, 1);
    zombie.setPosition(2, 7);
    const target = cm.findTarget(plant, [plant, zombie]);
    expect(target).not.toBeNull();
    expect(target!.id).toBe('z1');
  });

  it('returns null when no enemies in range', () => {
    const cm = new CombatManager();
    const plant = new UnitState('p1', 'peashooter', 'plants', 100, 20, 1000, 2, 0);
    plant.setPosition(2, 0);
    const zombie = new UnitState('z1', 'brainEater', 'zombies', 120, 25, 2000, 4, 1);
    zombie.setPosition(2, 8);
    const target = cm.findTarget(plant, [plant, zombie]);
    expect(target).toBeNull();
  });

  it('does not target same-faction units', () => {
    const cm = new CombatManager();
    const p1 = new UnitState('p1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    p1.setPosition(2, 1);
    const p2 = new UnitState('p2', 'sunflower', 'plants', 75, 10, 1500, 3, 0);
    p2.setPosition(2, 3);
    const target = cm.findTarget(p1, [p1, p2]);
    expect(target).toBeNull();
  });

  it('plants target enemies to the right (higher col)', () => {
    const cm = new CombatManager();
    const plant = new UnitState('p1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    plant.setPosition(2, 5);
    const zombieBehind = new UnitState('z1', 'brainEater', 'zombies', 120, 25, 2000, 4, 1);
    zombieBehind.setPosition(2, 2);
    const target = cm.findTarget(plant, [plant, zombieBehind]);
    expect(target).toBeNull();
  });

  it('zombies target enemies to the left (lower col)', () => {
    const cm = new CombatManager();
    const zombie = new UnitState('z1', 'brainEater', 'zombies', 120, 25, 2000, 4, 1);
    zombie.setPosition(2, 5);
    const plant = new UnitState('p1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    plant.setPosition(2, 3);
    const target = cm.findTarget(zombie, [zombie, plant]);
    expect(target).not.toBeNull();
    expect(target!.id).toBe('p1');
  });

  it('melee units only target adjacent tiles', () => {
    const cm = new CombatManager();
    const zombie = new UnitState('z1', 'veryFastWalker', 'zombies', 60, 15, 800, 0, 3);
    zombie.setPosition(2, 5);
    const plant = new UnitState('p1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    plant.setPosition(2, 4);
    const target = cm.findTarget(zombie, [zombie, plant]);
    expect(target).not.toBeNull();
  });

  it('melee units cannot target non-adjacent units', () => {
    const cm = new CombatManager();
    const zombie = new UnitState('z1', 'veryFastWalker', 'zombies', 60, 15, 800, 0, 3);
    zombie.setPosition(2, 5);
    const plant = new UnitState('p1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    plant.setPosition(2, 2);
    const target = cm.findTarget(zombie, [zombie, plant]);
    expect(target).toBeNull();
  });
});
