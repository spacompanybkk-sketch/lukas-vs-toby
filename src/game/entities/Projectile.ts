import type { Faction } from '../types';

export interface ProjectileConfig {
  textureKey: string;
  damage: number;
  speed: number;
  faction: Faction;
}

export const PROJECTILE_CONFIGS: Record<string, ProjectileConfig> = {
  pea: { textureKey: 'pea', damage: 25, speed: 400, faction: 'plants' },     // was 20dmg/300spd
  kernel: { textureKey: 'kernel', damage: 10, speed: 350, faction: 'plants' }, // was 250spd
  brain: { textureKey: 'brain', damage: 20, speed: 250, faction: 'zombies' }, // was 25dmg/200spd
};
