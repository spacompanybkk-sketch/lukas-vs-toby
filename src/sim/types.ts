export const TICKS_PER_SECOND = 30;
export const LANES = 5;
export const COLS = 10;
export const PLANT_COLS = 8; // plants occupy columns 0..7
export const ZOMBIE_SPAWN_X = 9.5;
export const BASE_STOP_X = 0.3; // a zombie at or left of this attacks the plant base
export const MAX_LEVEL = 5;

export type Faction = 'plants' | 'zombies';
export type PlantKey =
  | 'peashooter' | 'sunflower' | 'walnutBomb' | 'potatoMine' | 'kernelPult'
  | 'mangoPult' | 'avocadoBunker' | 'torchwood' | 'cherryBomber' | 'pumpkinSquash';
export type ZombieKey =
  | 'brainEater' | 'veryFastWalker' | 'skeletonWarrior' | 'desertZombie'
  | 'skeletonArcher' | 'hotTopic' | 'cowboyZombie' | 'necromancer' | 'tridentZombie' | 'brainRot';
export type UnitKey = PlantKey | ZombieKey;
export type ProjectileKind = 'pea' | 'brain';

export interface Unit {
  id: number; key: UnitKey; faction: Faction; lane: number; x: number; level: number;
  hp: number; maxHp: number; spent: number;
  armor: number; // taken off every hit it takes; a hit always lands at least 1
  meleeTimer: number; shotTimer: number; abilityTimer: number; // ticks until ready
  blocked: boolean; // zombie halted by a plant or the base
}

export interface Projectile {
  id: number; kind: ProjectileKind; faction: Faction; lane: number; x: number;
  speed: number; damage: number; ownerId: number; // speed in tiles per tick
  spawnTick: number; // the tick it was fired on; it first moves on the next tick
}

export interface PlayerState {
  energy: number; // always a whole number
  carry: number; // income not yet paid out, in 1/30000 of an energy
  recharge: Partial<Record<UnitKey, number>>; // ticks left per card
}

export interface MatchConfig {
  seed: number;
  startEnergy: Record<Faction, number>;
  baseHp: Record<Faction, number>;
  cards: Record<Faction, UnitKey[]>;
  incomeMultiplier: Record<Faction, number>;
  suddenDeath: boolean;
}

export interface SimState {
  tick: number; rng: number; nextId: number;
  units: Unit[]; projectiles: Projectile[];
  players: Record<Faction, PlayerState>;
  baseHp: Record<Faction, number>; baseMaxHp: Record<Faction, number>;
  suddenDeath: boolean; winner: Faction | 'draw' | null;
  config: MatchConfig;
}

export type Command =
  | { type: 'place'; faction: Faction; unit: UnitKey; lane: number; col: number }
  | { type: 'merge'; faction: Faction; unit: UnitKey; targetId: number }
  | { type: 'remove'; faction: Faction; targetId: number };

export type CommandRejection =
  | 'match-over' | 'not-in-hand' | 'wrong-side' | 'no-energy'
  | 'recharging' | 'bad-lane' | 'bad-column' | 'occupied' | 'no-target' | 'wrong-type'
  | 'max-level' | 'not-yours' | 'plants-only';

export type SimEvent =
  | { type: 'commandRejected'; command: Command; reason: CommandRejection }
  | { type: 'unitSpawned'; unitId: number; key: UnitKey; faction: Faction; lane: number; x: number }
  | { type: 'unitMerged'; unitId: number; level: number }
  | { type: 'unitAttacked'; unitId: number; attack: 'melee' | 'shot'; targetId: number | null; targetBase: Faction | null }
  | { type: 'projectileSpawned'; projectileId: number; kind: ProjectileKind; faction: Faction; lane: number; x: number; ownerId: number }
  | { type: 'projectileHit'; projectileId: number; lane: number; x: number; targetId: number | null; targetBase: Faction | null; blocked: boolean }
  | { type: 'unitDamaged'; unitId: number; amount: number; hp: number }
  | { type: 'unitDied'; unitId: number; key: UnitKey; faction: Faction; lane: number; x: number; level: number; cause: 'damage' | 'blast' | 'shovel' }
  | { type: 'explosion'; lane: number; x: number; radius: number; sourceKey: UnitKey }
  | { type: 'baseDamaged'; faction: Faction; amount: number; hp: number; lane: number | null }
  // unitId = the paying Sunflower, null for bounties
  | { type: 'energyGained'; faction: Faction; amount: number; source: 'sunflower' | 'bounty'; unitId: number | null; lane: number; x: number }
  | { type: 'suddenDeath' }
  | { type: 'matchEnded'; winner: Faction | 'draw' };
