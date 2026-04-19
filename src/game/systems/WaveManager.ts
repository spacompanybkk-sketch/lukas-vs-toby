import type { Faction } from '../types';

export type SpawnCallback = (unitKey: string, row: number) => void;

export interface WaveManagerOptions {
  interval?: number;
  firstDelay?: number;
  maxWaves?: number;
}

export class WaveManager {
  private aiFaction: Faction;
  private onSpawn: SpawnCallback;
  private spawnInterval: number;
  private lastSpawnTime: number = 0;
  private availableUnits: string[];
  private waveCount: number = 0;
  private firstSpawnDelay: number;
  private maxWaves: number | undefined;
  private allWavesSpawned: boolean = false;

  constructor(aiFaction: Faction, onSpawn: SpawnCallback, options?: WaveManagerOptions) {
    this.aiFaction = aiFaction;
    this.onSpawn = onSpawn;
    this.spawnInterval = options?.interval ?? 8000;
    this.firstSpawnDelay = options?.firstDelay ?? 12000;
    this.maxWaves = options?.maxWaves;
    this.availableUnits = aiFaction === 'zombies'
      ? ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'skeletonArcher', 'necromancer', 'hotTopic', 'tridentZombie', 'desertZombie', 'cowboyZombie', 'brainRot']
      : ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'cherryBomber', 'avocadoBunker', 'mangoPult', 'kernelPult', 'pumpkinSquash', 'torchwood'];
  }

  update(time: number): void {
    // Grace period at start
    if (time < this.firstSpawnDelay) return;

    // Stop spawning if maxWaves reached
    if (this.maxWaves !== undefined && this.waveCount >= this.maxWaves) {
      this.allWavesSpawned = true;
      return;
    }

    if (time - this.lastSpawnTime < this.spawnInterval) return;
    this.lastSpawnTime = time;
    this.waveCount++;

    const unitKey = this.availableUnits[Math.floor(Math.random() * this.availableUnits.length)];
    const row = Math.floor(Math.random() * 5);
    this.onSpawn(unitKey, row);

    // Gradually speed up spawns over time (min 4s interval)
    if (this.waveCount % 15 === 0 && this.spawnInterval > 4000) {
      this.spawnInterval -= 500;
    }
  }

  getWaveCount(): number {
    return this.waveCount;
  }

  getMaxWaves(): number | undefined {
    return this.maxWaves;
  }

  areAllWavesSpawned(): boolean {
    return this.allWavesSpawned;
  }
}
