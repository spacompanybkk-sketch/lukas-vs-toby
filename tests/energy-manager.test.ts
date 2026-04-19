import { describe, it, expect } from 'vitest';
import { EnergyManager } from '../src/game/systems/EnergyManager';

describe('EnergyManager', () => {
  it('starts with the configured starting energy', () => {
    const em = new EnergyManager(50);
    expect(em.getEnergy()).toBe(50);
  });

  it('spends energy and returns true if affordable', () => {
    const em = new EnergyManager(100);
    expect(em.spend(60)).toBe(true);
    expect(em.getEnergy()).toBe(40);
  });

  it('rejects spend if not enough energy', () => {
    const em = new EnergyManager(30);
    expect(em.spend(50)).toBe(false);
    expect(em.getEnergy()).toBe(30);
  });

  it('adds energy from passive tick', () => {
    const em = new EnergyManager(50);
    em.addPassive(5);
    expect(em.getEnergy()).toBe(55);
  });

  it('adds energy from kill reward', () => {
    const em = new EnergyManager(50);
    em.addKillReward(10);
    expect(em.getEnergy()).toBe(60);
  });

  it('adds energy from producer', () => {
    const em = new EnergyManager(50);
    em.addFromProducer(25);
    expect(em.getEnergy()).toBe(75);
  });
});
