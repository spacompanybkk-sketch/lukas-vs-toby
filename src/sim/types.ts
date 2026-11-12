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
/** A unit a player can play from the hand. */
export type CardKey = PlantKey | ZombieKey;
/** Every unit that can stand on the lawn: the cards, and the Bone Minion, which is never a card. */
export type UnitKey = CardKey | 'boneMinion';
export type ProjectileKind = 'pea' | 'brain' | 'kernel' | 'butter' | 'mango' | 'sand' | 'arrow' | 'bullet' | 'trident' | 'rot';
/**
 * How a projectile travels. `straight` hits the first enemy it meets; `lobbed` arcs over everyone
 * and lands on the enemy it was aimed at; `piercing` hits each enemy it meets, up to a number.
 */
export type Flight = 'straight' | 'lobbed' | 'piercing';
/**
 * What can be wrong with a unit, each a count of ticks left (see `src/sim/status.ts`). Stunned or
 * tied, a unit cannot act; blind, its attacks miss; poisoned or burning, it loses health every second.
 */
export type StatusKind = 'stun' | 'blind' | 'tied' | 'poison' | 'burn';
/** What a unit's `abilityUsed` event says it did. */
export type AbilityName = 'arm' | 'trigger' | 'fuse' | 'leap' | 'ignite' | 'grow' | 'lasso' | 'heal' | 'raise';

export interface Unit {
  id: number; key: UnitKey; faction: Faction; lane: number; x: number; level: number;
  hp: number; maxHp: number; spent: number;
  armor: number; // taken off every hit it takes; a hit always lands at least 1
  meleeTimer: number; shotTimer: number; abilityTimer: number; // ticks until ready
  auraTimer: number; // ticks until a Necromancer's heal is ready; 0 for everyone else
  blocked: boolean; // zombie halted by a plant or the base
  stun: number; blind: number; tied: number; // ticks left, 0 = not affected
  poison: number; poisonDps: number; burn: number; burnDps: number; // ticks left, damage per second
  stacks: number; // Hot Topic growth; 1 on a Potato Mine once it has armed; 0 for everyone else
  ownerId: number | null; // the Necromancer that raised a minion, null for everyone else
}

export interface Projectile {
  id: number; kind: ProjectileKind; faction: Faction; lane: number; x: number;
  speed: number; damage: number; ownerId: number; // speed in tiles per tick
  spawnTick: number; // the tick it was fired on; it first moves on the next tick
  flight: Flight;
  sourceKey: UnitKey; level: number; // what fired it, at which level (for what it does on landing)
  targetId: number | null; targetX: number | null; // lobbed at a unit only: whom it follows, where it lands
  pierceLeft: number; hitIds: number[]; // piercing only: how many more it may hit, whom it has hit
  burning: boolean; // set alight by a Torchwood
  burnDps: number; burnTicks: number; // the burn a burning one puts on whom it damages, level-scaled; 0 otherwise
}

/** Something left on the lawn that hurts the other side's units standing in it (a Brain Rot puddle). */
export interface Hazard {
  id: number; kind: 'rot'; faction: Faction; lane: number; x: number; radius: number;
  ticksLeft: number; dps: number;
  poisonTicks: number; // how long whoever stands in it stays poisoned, at least
}

export interface PlayerState {
  energy: number; // always a whole number
  carry: number; // income not yet paid out, in 1/30000 of an energy
  recharge: Partial<Record<CardKey, number>>; // ticks left per card
  heroTimer: number; // ticks until the hero power is ready; it stands still while the setup has it off
}

export interface MatchConfig {
  seed: number;
  startEnergy: Record<Faction, number>;
  baseHp: Record<Faction, number>;
  cards: Record<Faction, CardKey[]>;
  incomeMultiplier: Record<Faction, number>;
  suddenDeath: boolean;
  heroes: Record<Faction, boolean>; // whether each side has its hero power
}

export interface SimState {
  tick: number; rng: number; nextId: number;
  units: Unit[]; projectiles: Projectile[]; hazards: Hazard[];
  players: Record<Faction, PlayerState>;
  baseHp: Record<Faction, number>; baseMaxHp: Record<Faction, number>;
  baseDefenseTimers: number[]; // one per lane, ticks until the plant base can strike there again
  suddenDeath: boolean; winner: Faction | 'draw' | null;
  config: MatchConfig;
}

export type Command =
  | { type: 'place'; faction: Faction; unit: CardKey; lane: number; col: number }
  | { type: 'merge'; faction: Faction; unit: CardKey; targetId: number }
  | { type: 'remove'; faction: Faction; targetId: number }
  | { type: 'hero'; faction: Faction; lane: number };

export type CommandRejection =
  | 'match-over' | 'not-in-hand' | 'wrong-side' | 'no-energy'
  | 'recharging' | 'bad-lane' | 'bad-column' | 'occupied' | 'no-target' | 'wrong-type'
  | 'max-level' | 'not-yours' | 'plants-only' | 'hero-charging' | 'hero-off';

export type SimEvent =
  | { type: 'commandRejected'; command: Command; reason: CommandRejection }
  | { type: 'unitSpawned'; unitId: number; key: UnitKey; faction: Faction; lane: number; x: number }
  | { type: 'unitMerged'; unitId: number; level: number }
  | { type: 'unitAttacked'; unitId: number; attack: 'melee' | 'shot'; targetId: number | null; targetBase: Faction | null }
  | {
    type: 'projectileSpawned'; projectileId: number; kind: ProjectileKind; faction: Faction; lane: number; x: number;
    ownerId: number; flight: Flight; targetX: number | null;
  }
  | {
    type: 'projectileHit'; projectileId: number; lane: number; x: number; targetId: number | null;
    targetBase: Faction | null; blocked: boolean; burning: boolean;
  }
  | { type: 'unitDamaged'; unitId: number; amount: number; hp: number }
  | { type: 'unitDied'; unitId: number; key: UnitKey; faction: Faction; lane: number; x: number; level: number;
    cause: 'damage' | 'blast' | 'shovel' | 'spent'; // spent: a mine or cherry that went off; pays no bounty
  }
  | { type: 'explosion'; lane: number; x: number; radius: number; sourceKey: UnitKey }
  | { type: 'baseDamaged'; faction: Faction; amount: number; hp: number; lane: number | null }
  | { type: 'baseStruck'; lane: number; targetId: number } // the plant base hit a zombie that was biting it
  // unitId = the paying Sunflower, null for bounties
  | { type: 'energyGained'; faction: Faction; amount: number; source: 'sunflower' | 'bounty'; unitId: number | null; lane: number; x: number }
  | { type: 'statusApplied'; unitId: number; status: StatusKind; ticks: number; sourceId: number | null }
  | { type: 'statusEnded'; unitId: number; status: StatusKind }
  | { type: 'attackMissed'; unitId: number } // a blind unit's bite or shot
  | { type: 'unitHealed'; unitId: number; amount: number; hp: number }
  | { type: 'hazardSpawned'; hazardId: number; kind: 'rot'; lane: number; x: number; radius: number; ticks: number }
  | { type: 'hazardEnded'; hazardId: number }
  | { type: 'abilityUsed'; unitId: number; ability: AbilityName; lane: number; x: number; targetId: number | null }
  | { type: 'heroUsed'; faction: Faction; lane: number }
  | { type: 'heroReady'; faction: Faction }
  | { type: 'suddenDeath' }
  | { type: 'matchEnded'; winner: Faction | 'draw' };
