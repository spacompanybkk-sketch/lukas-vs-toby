import type { Faction } from '../types';

export type SpawnCallback = (unitKey: string, row: number) => void;

export class WaveManager {
  private aiFaction: Faction;
  private onSpawn: SpawnCallback;
  private spawnInterval: number = 5500; // was 4000 — slower spawning
  private lastSpawnTime: number = 0;
  private availableUnits: string[];

  constructor(aiFaction: Faction, onSpawn: SpawnCallback) {
    this.aiFaction = aiFaction;
    this.onSpawn = onSpawn;
    this.availableUnits = aiFaction === 'zombies'
      ? ['brainEater', 'veryFastWalker', 'skeletonWarrior']
      : ['peashooter', 'sunflower', 'walnutBomb'];
  }

  update(time: number): void {
    if (time - this.lastSpawnTime < this.spawnInterval) return;
    this.lastSpawnTime = time;
    const unitKey = this.availableUnits[Math.floor(Math.random() * this.availableUnits.length)];
    const row = Math.floor(Math.random() * 5);
    this.onSpawn(unitKey, row);
  }
}
