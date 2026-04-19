import type { Faction } from '../types';

export interface ProjectileConfig {
  textureKey: string;
  damage: number;
  speed: number;
  faction: Faction;
}

// Auto-balanced via AI simulation
export const PROJECTILE_CONFIGS: Record<string, ProjectileConfig> = {
  pea: { textureKey: 'pea', damage: 7, speed: 200, faction: 'plants' },
  kernel: { textureKey: 'kernel', damage: 5, speed: 180, faction: 'plants' },
  brain: { textureKey: 'brain', damage: 7, speed: 150, faction: 'zombies' },
};
