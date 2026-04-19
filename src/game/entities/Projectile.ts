import type { Faction } from '../types';

export interface ProjectileConfig {
  textureKey: string;
  damage: number;
  speed: number;
  faction: Faction;
}

export const PROJECTILE_CONFIGS: Record<string, ProjectileConfig> = {
  pea:       { textureKey: 'pea',       damage: 7,  speed: 200, faction: 'plants' },
  kernel:    { textureKey: 'kernel',    damage: 5,  speed: 180, faction: 'plants' },
  mango:     { textureKey: 'mango',     damage: 15, speed: 150, faction: 'plants' },
  brain:     { textureKey: 'brain',     damage: 7,  speed: 150, faction: 'zombies' },
  boneArrow: { textureKey: 'boneArrow', damage: 12, speed: 220, faction: 'zombies' },
  trident:   { textureKey: 'trident',   damage: 20, speed: 180, faction: 'zombies' },
  rotBrain:  { textureKey: 'rotBrain',  damage: 10, speed: 130, faction: 'zombies' },
  sand:      { textureKey: 'sand',      damage: 3,  speed: 160, faction: 'zombies' },
};
