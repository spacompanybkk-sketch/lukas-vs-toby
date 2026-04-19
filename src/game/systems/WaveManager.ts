import type { Faction } from '../types';

export type SpawnCallback = (unitKey: string, row: number) => void;

export class WaveManager {
  private aiFaction: Faction;
  private onSpawn: SpawnCallback;
  private spawnInterval: number = 6000;
  private lastSpawnTime: number = 0;
  private availableUnits: string[];
  private waveCount: number = 0;
  private firstSpawnDelay: number = 8000; // 8s grace period before first spawn

  constructor(aiFaction: Faction, onSpawn: SpawnCallback) {
    this.aiFaction = aiFaction;
    this.onSpawn = onSpawn;
    this.availableUnits = aiFaction === 'zombies'
      ? ['brainEater', 'veryFastWalker', 'skeletonWarrior']
      : ['peashooter', 'sunflower', 'walnutBomb'];
  }

  update(time: number): void {
    // Grace period at start
    if (time < this.firstSpawnDelay) return;

    if (time - this.lastSpawnTime < this.spawnInterval) return;
    this.lastSpawnTime = time;
    this.waveCount++;

    const unitKey = this.availableUnits[Math.floor(Math.random() * this.availableUnits.length)];
    const row = Math.floor(Math.random() * 5);
    this.onSpawn(unitKey, row);

    // Gradually speed up spawns over time (min 3s interval)
    if (this.waveCount % 10 === 0 && this.spawnInterval > 3000) {
      this.spawnInterval -= 500;
    }
  }

  getWaveCount(): number {
    return this.waveCount;
  }
}
