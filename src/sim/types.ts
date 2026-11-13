export const TICKS_PER_SECOND = 30;
export const LANES = 5;
export const COLS = 10;
export const PLANT_COLS = 8; // plants occupy columns 0..7
export const ZOMBIE_SPAWN_X = 9.5;
export const BASE_STOP_X = 0.3; // a zombie at or left of this attacks the plant base
export const MAX_LEVEL = 5;
/** The top Marketplace level of a unit type (spec 9): ten steps, each adding health and damage. */
export const MAX_UPGRADE = 10;

export type Faction = 'plants' | 'zombies';
export type PlantKey =
  | 'peashooter' | 'sunflower' | 'walnutBomb' | 'potatoMine' | 'kernelPult'
  | 'mangoPult' | 'avocadoBunker' | 'torchwood' | 'cherryBomber' | 'pumpkinSquash';
export type ZombieKey =
  | 'brainEater' | 'veryFastWalker' | 'skeletonWarrior' | 'desertZombie'
  | 'skeletonArcher' | 'hotTopic' | 'cowboyZombie' | 'necromancer' | 'tridentZombie' | 'brainRot';
/** A unit a player can play from the hand. */
export type CardKey = PlantKey | ZombieKey;
/**
 * The bosses (spec 8): the Brain Titan (a zombie, ends the plants' Backyard) and the Elder Oak (a
 * plant, ends the zombies'). Never cards; a level brings one on through `MatchConfig.boss`.
 */
export type BossKey = 'brainTitan' | 'elderOak';
/**
 * How many lanes either side of its own a boss also stands in: its body's width (geometry, like
 * `LANES`, not a tuning number). The Elder Oak, set in lane 2, stands in lanes 1–3: it blocks and is
 * hit there as if it stood in each, and a lane-wide power or spell hits it once.
 */
export const BOSS_HALF_WIDTH: Record<BossKey, number> = { brainTitan: 0, elderOak: 1 };
/**
 * Every unit that can stand on the lawn: the cards, and those that are never cards: the Bone Minion
 * (a zombie), the rock of the Rock Wall spell (a plant: no attack, no merge, no bounty) and the bosses.
 */
export type UnitKey = CardKey | 'boneMinion' | 'rock' | BossKey;
/** The spells (spec 21), five a side. */
export type PlantSpell = 'thunderbolt' | 'vines' | 'sunShower' | 'healingRain' | 'rockWall';
export type ZombieSpell = 'meteor' | 'fog' | 'brainFeast' | 'frenzy' | 'graveRise';
export type SpellKey = PlantSpell | ZombieSpell;
/**
 * The area a spell covers: 0 none (not aimed), 1 the tapped tile, 2 a 2×2, 3 a 3×3 (see `spellArea`).
 */
export type SpellSize = 0 | 1 | 2 | 3;
export type ProjectileKind = 'pea' | 'brain' | 'kernel' | 'butter' | 'mango' | 'sand' | 'arrow' | 'bullet' | 'trident' | 'rot' | 'acorn';
/**
 * How a projectile travels. `straight` hits the first enemy it meets; `lobbed` arcs over everyone
 * and lands on the enemy it was aimed at; `piercing` hits each enemy it meets, up to a number.
 */
export type Flight = 'straight' | 'lobbed' | 'piercing';
/**
 * What can be wrong (or right) with a unit, each a count of ticks left (see `src/sim/status.ts`).
 * Stunned or tied, a unit cannot act; blind, its attacks miss; poisoned or burning, it loses health
 * every second; hasted (Frenzy), it walks and attacks faster.
 */
export type StatusKind = 'stun' | 'blind' | 'tied' | 'poison' | 'burn' | 'haste';
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
  expires: number; // ticks until it leaves the lawn (cause 'spent'), 0 = never; a Rock Wall's rock
  haste: number; // ticks left of Frenzy's haste, 0 = not hasted
  hasteCarry: number; // hasted timer countdown not yet taken, in 1/1000 of a tick; always whole
  hurt: number; // ticks left in which a Sun maker that took damage makes no Sun; 0 for everyone else
  // A boss's attack patterns (see `src/sim/boss.ts`); all 0 for everyone else.
  pattern: number; // which of its timed patterns comes next (an index into them, in table order)
  patternTimer: number; // ticks until that pattern goes off; a slam winds up over its last `windupSeconds`
  shieldLeft: number; // ticks left of its shield phase, 0 = no shield
  phase: number; // how many of its shield health marks it has passed (0 = none yet)
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
  spells: { key: SpellKey; timer: number }[]; // the spells dealt, in deal order, each with its ticks until ready
}

export interface MatchConfig {
  seed: number;
  startEnergy: Record<Faction, number>;
  baseHp: Record<Faction, number>;
  cards: Record<Faction, CardKey[]>;
  incomeMultiplier: Record<Faction, number>;
  suddenDeath: boolean;
  heroes: Record<Faction, boolean>; // whether each side has its hero power
  spells: Record<Faction, number>; // how many spells each side is dealt (0 = no spells)
  /**
   * Marketplace levels (0..`MAX_UPGRADE`, whole) per side, by card of that side; a card with no
   * entry is at 0. A unit's health and its bite and shot damage are multiplied by
   * `upgradeScale` (see `src/sim/lookup.ts`). Empty for the computer, and always in Versus.
   */
  upgrades: Record<Faction, Partial<Record<CardKey, number>>>;
  /**
   * Which level rules are on (see `src/sim/script.ts` and `src/sim/belt.ts`). `'battle'` and
   * `'boss'` play as a plain match, sudden death as `suddenDeath` says; in `'survive'`,
   * `'breakthrough'` and `'conveyor'` sudden death is off and the plants win when `goalTicks`
   * ticks have been played (`goalReached`). Checked when the match is made (`checkLevel`).
   */
  mode: LevelMode;
  /**
   * Units that join on their tick (`tickScript`, the first stage of a step), in list order; sorted
   * by tick. A zombie with no `x` walks on at `ZOMBIE_SPAWN_X`; a plant needs `x` = a tile's middle
   * and is skipped (`waveSkipped`) if a plant already stands there.
   */
  script: ScriptEntry[];
  /** Units on the lawn from the start (spawned in list order on the step of tick 0); a plant's `x` is a tile's middle. */
  prepared: PreparedUnit[];
  /** The tick count at which the plants win (survive, breakthrough, conveyor); null in battle and boss. */
  goalTicks: number | null;
  /** The card belt of a conveyor level: who plays it, how often a card arrives, from which cards, how many may wait. */
  belt: BeltConfig | null;
  /** No trickle, no Sun, no bounty, no energy spell; energy stays 0, `place` and `merge` are refused `'no-energy'`. */
  noEnergy: boolean;
  /** The side whose base cannot be hurt (no `baseDamaged`, no health lost), or null; only `'zombies'` is allowed (`checkLevel`). */
  invulnerableBase: Faction | null;
  /**
   * The boss of a boss level (only in mode `'boss'`, which needs one), on the lawn from the step of
   * tick 0, after the prepared units: `key` on its own side (`faction`), in `lane` (the Elder Oak's
   * middle lane, 1..3). The match ends the moment it falls, its foes winning. See `src/sim/boss.ts`.
   */
  boss: BossConfig | null;
  /**
   * Free Play (see `src/sim/endless.ts`), or null: an endless, escalating source of the other side's
   * units. Only in `'survive'` (zombie waves on a timer; no clock needed; ends when the plant base
   * falls) and `'breakthrough'` (a garden of plants; each broken garden is replaced by a stronger one
   * and adds to the clock in `SimState.clock`; `goalTicks` must be null). Checked by `checkEndless`.
   */
  endless: EndlessConfig | null;
}

/**
 * See `MatchConfig.endless`: the cards the waves (or gardens) are drawn from, all of the side the
 * player plays against, and the ticks until the first wave (survive; 0 in breakthrough, whose first
 * garden is laid on the first step). Every other number is in `Balance.endless`.
 */
export interface EndlessConfig { cards: CardKey[]; firstWaveTicks: number }

/** A unit of a started Free Play wave still to walk on at `tick` (`index`: its place in the wave). */
export interface IncomingUnit { tick: number; unit: CardKey; lane: number; x: number; level: number; index: number }

/** See `MatchConfig.boss`. */
export interface BossConfig { key: BossKey; faction: Faction; lane: number }

/** What a boss can do (see `BossPattern` in `src/data/balance.ts`). */
export type BossPatternKind = 'slam' | 'summon' | 'barrage' | 'shield';

/** The level rules a match plays by (see `MatchConfig.mode`). */
export type LevelMode = 'battle' | 'survive' | 'breakthrough' | 'conveyor' | 'boss';

/** A unit a level puts on the lawn from the start, at `level` (1..`MAX_LEVEL`). */
export interface PreparedUnit { unit: UnitKey; faction: Faction; lane: number; x: number; level: number }

/** A unit a level's script brings on at `tick`; see `MatchConfig.script`. */
export interface ScriptEntry { tick: number; unit: UnitKey; faction: Faction; lane: number; x?: number; level: number }

/** See `MatchConfig.belt`. `cards` are `side`'s cards; at most `slots` wait on the belt. */
export interface BeltConfig { side: Faction; everyTicks: number; cards: CardKey[]; slots: number }

export interface SimState {
  tick: number; rng: number; nextId: number;
  units: Unit[]; projectiles: Projectile[]; hazards: Hazard[];
  players: Record<Faction, PlayerState>;
  baseHp: Record<Faction, number>; baseMaxHp: Record<Faction, number>;
  baseDefenseTimers: number[]; // one per lane, ticks until the plant base can strike there again
  suddenDeath: boolean; winner: Faction | 'draw' | null;
  config: MatchConfig;
  scriptIndex: number; // the next `config.script` entry to come on
  belt: CardKey[]; // the cards waiting on the belt, oldest first (slot 0)
  // Free Play (`config.endless`; all 0 / empty otherwise). The score is `wave`.
  wave: number; // survive: waves started so far; breakthrough: gardens broken so far
  waveTimer: number; // survive: ticks until the next wave starts; 0 otherwise
  clock: number; // breakthrough: ticks left on the clock (the match ends at 0); 0 otherwise
  incoming: IncomingUnit[]; // survive: units of started waves still to come, in wave order
}

export type Command =
  | { type: 'place'; faction: Faction; unit: CardKey; lane: number; col: number }
  | { type: 'merge'; faction: Faction; unit: CardKey; targetId: number }
  | { type: 'remove'; faction: Faction; targetId: number }
  | { type: 'hero'; faction: Faction; lane: number }
  | { type: 'spell'; faction: Faction; spell: SpellKey; lane: number; col: number }
  // Plays belt slot `slot`: a plant on (`lane`, `col`), a zombie into `lane` (`col` only aims a merge).
  | { type: 'belt'; faction: Faction; slot: number; lane: number; col: number };

export type CommandRejection =
  | 'match-over' | 'not-in-hand' | 'wrong-side' | 'no-energy'
  | 'recharging' | 'bad-lane' | 'bad-column' | 'occupied' | 'no-target' | 'wrong-type'
  | 'max-level' | 'not-yours' | 'plants-only' | 'hero-charging' | 'hero-off'
  | 'spell-charging' | 'spell-not-dealt' | 'spells-off'
  | 'no-belt' | 'bad-slot' // belt: this side has no belt; no card waits in that slot
  | 'boss'; // remove: a boss cannot be dug up

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
    // spent: a mine or cherry that went off, a rock that crumbled; base: felled by the plant base's
    // strike while `baseDefense.paysBounty` is false. Neither pays a bounty.
    cause: 'damage' | 'blast' | 'shovel' | 'spent' | 'base';
  }
  | { type: 'explosion'; lane: number; x: number; radius: number; sourceKey: UnitKey }
  | { type: 'baseDamaged'; faction: Faction; amount: number; hp: number; lane: number | null }
  | { type: 'baseStruck'; lane: number; targetId: number } // the plant base hit a zombie that was biting it
  // unitId = the paying Sunflower, null for bounties
  // spell: Sun Shower or Brain Feast, reported at the side's own base edge (lane 2, x 0 or 9.5)
  | { type: 'energyGained'; faction: Faction; amount: number; source: 'sunflower' | 'bounty' | 'spell'; unitId: number | null; lane: number; x: number }
  | { type: 'statusApplied'; unitId: number; status: StatusKind; ticks: number; sourceId: number | null }
  | { type: 'statusEnded'; unitId: number; status: StatusKind }
  | { type: 'attackMissed'; unitId: number } // a blind unit's bite or shot
  | { type: 'unitHealed'; unitId: number; amount: number; hp: number }
  | { type: 'hazardSpawned'; hazardId: number; kind: 'rot'; lane: number; x: number; radius: number; ticks: number }
  | { type: 'hazardEnded'; hazardId: number }
  | { type: 'abilityUsed'; unitId: number; ability: AbilityName; lane: number; x: number; targetId: number | null }
  | { type: 'heroUsed'; faction: Faction; lane: number }
  | { type: 'heroReady'; faction: Faction }
  | { type: 'spellCast'; faction: Faction; spell: SpellKey; lane: number; col: number; size: SpellSize }
  | { type: 'spellReady'; faction: Faction; spell: SpellKey }
  | { type: 'suddenDeath' }
  | { type: 'waveSpawned'; index: number; unit: UnitKey; lane: number } // script entry `index` came on (its unitSpawned follows)
  | { type: 'waveSkipped'; index: number; unit: UnitKey; lane: number; reason: 'occupied' } // a scripted plant's tile was taken
  | { type: 'beltCard'; card: CardKey } // a card joined the end of the belt
  | { type: 'beltUsed'; slot: number } // that slot's card was played; the later ones moved down
  // Free Play: wave (survive) or garden (breakthrough) number `wave` started, `units` units strong
  // (the big one included), bought with `budget` energy; its waveSpawned events follow (index = place in the wave).
  | { type: 'waveStarted'; wave: number; budget: number; units: number }
  | { type: 'gardenBroken'; wave: number } // breakthrough Free Play: the plant base fell; `wave` gardens broken so far
  | { type: 'goalReached'; winner: Faction } // the clock ran out (survive, breakthrough, conveyor); matchEnded follows
  // A boss's pattern: a slam's wind-up (`windup` true; `col` the tile column it will hit, in its lane
  // and the two beside it) and then its strike, a summon, a barrage (its acorns follow as
  // projectiles), a shield going up. `col` is null but for a slam.
  | { type: 'bossPattern'; unitId: number; kind: BossPatternKind; lane: number; col: number | null; windup: boolean }
  | { type: 'bossPhase'; unitId: number; phase: number } // the boss passed shield mark number `phase` (1, 2, …)
  | { type: 'bossDefeated'; unitId: number; key: BossKey; faction: Faction } // the boss fell; matchEnded follows
  | { type: 'matchEnded'; winner: Faction | 'draw' };
