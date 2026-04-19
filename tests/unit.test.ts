import { describe, it, expect } from 'vitest';
import { UnitState } from '../src/game/entities/Unit';

describe('UnitState', () => {
  it('initializes with full HP', () => {
    const unit = new UnitState('u1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    expect(unit.hp).toBe(100);
    expect(unit.maxHp).toBe(100);
    expect(unit.isAlive()).toBe(true);
  });

  it('takes damage and reduces HP', () => {
    const unit = new UnitState('u1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    unit.takeDamage(30);
    expect(unit.hp).toBe(70);
    expect(unit.isAlive()).toBe(true);
  });

  it('dies when HP reaches zero', () => {
    const unit = new UnitState('u1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    unit.takeDamage(100);
    expect(unit.hp).toBe(0);
    expect(unit.isAlive()).toBe(false);
  });

  it('does not go below zero HP', () => {
    const unit = new UnitState('u1', 'peashooter', 'plants', 50, 20, 1000, 9, 0);
    unit.takeDamage(999);
    expect(unit.hp).toBe(0);
  });

  it('tracks grid position', () => {
    const unit = new UnitState('u1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    unit.setPosition(2, 5);
    expect(unit.row).toBe(2);
    expect(unit.col).toBe(5);
  });

  it('can attack if enough time elapsed since last attack', () => {
    const unit = new UnitState('u1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    expect(unit.canAttack(0)).toBe(true);
    unit.recordAttack(0);
    expect(unit.canAttack(500)).toBe(false);
    expect(unit.canAttack(1000)).toBe(true);
  });

  it('stationary units have moveSpeed 0', () => {
    const unit = new UnitState('u1', 'peashooter', 'plants', 100, 20, 1000, 9, 0);
    expect(unit.isStationary()).toBe(true);
  });

  it('mobile units have moveSpeed > 0', () => {
    const unit = new UnitState('u1', 'brainEater', 'zombies', 120, 25, 2000, 4, 1);
    expect(unit.isStationary()).toBe(false);
  });
});
