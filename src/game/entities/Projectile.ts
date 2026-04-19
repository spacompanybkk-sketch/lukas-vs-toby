import type { Faction } from '../types';

export interface ProjectileConfig {
  textureKey: string;
  damage: number;
  speed: number;
  faction: Faction;
}

export const PROJECTILE_CONFIGS: Record<string, ProjectileConfig> = {
  pea: { textureKey: 'pea', damage: 20, speed: 300, faction: 'plants' },
  kernel: { textureKey: 'kernel', damage: 10, speed: 250, faction: 'plants' },
  brain: { textureKey: 'brain', damage: 25, speed: 200, faction: 'zombies' },
};
