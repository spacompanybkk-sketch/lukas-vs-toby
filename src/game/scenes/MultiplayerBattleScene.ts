import { Scene, GameObjects } from 'phaser';
import {
  GRID_ROWS, GRID_COLS, TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y,
  GAME_WIDTH, GAME_HEIGHT, BASE_HP, STARTING_ENERGY,
  ENERGY_TICK_INTERVAL, ENERGY_TICK_AMOUNT, ENERGY_KILL_REWARD,
  UNIT_COSTS,
} from '../constants';
import { GridManager } from '../systems/GridManager';
import { EnergyManager } from '../systems/EnergyManager';
import { CombatManager } from '../systems/CombatManager';
import { DragDropManager } from '../systems/DragDropManager';
import { HUD } from '../ui/HUD';
import type { UnitCard } from '../ui/HUD';
import { HealthBar } from '../ui/HealthBar';
import { UnitState, MAX_UNIT_LEVEL } from '../entities/Unit';
import { MergeManager } from '../systems/MergeManager';
import { PROJECTILE_CONFIGS } from '../entities/Projectile';
import type { ProjectileConfig } from '../entities/Projectile';
import { createPeashooter, PEASHOOTER_PROJECTILE } from '../entities/plants/Peashooter';
import { createSunflower, SUNFLOWER_PROJECTILE, SUNFLOWER_ENERGY_INTERVAL, SUNFLOWER_ENERGY_AMOUNT } from '../entities/plants/Sunflower';
import { createWalnutBomb, WALNUT_EXPLOSION_RADIUS, WALNUT_EXPLOSION_DAMAGE } from '../entities/plants/WalnutBomb';
import { createPotatoMine, POTATO_MINE_EXPLOSION_DAMAGE, POTATO_MINE_EXPLOSION_RADIUS } from '../entities/plants/PotatoMine';
import { createCherryBomber, CHERRY_EXPLOSION_DAMAGE, CHERRY_EXPLOSION_RADIUS } from '../entities/plants/CherryBomber';
import { createAvocadoBunker } from '../entities/plants/AvocadoBunker';
import { createMangoPult, MANGO_PROJECTILE } from '../entities/plants/MangoPult';
import { createKernelPult, KERNEL_PULT_PROJECTILE } from '../entities/plants/KernelPult';
import { createPumpkinSquash } from '../entities/plants/PumpkinSquash';
import { createTorchwood } from '../entities/plants/Torchwood';
import { createBrainEater, BRAIN_EATER_PROJECTILE } from '../entities/zombies/BrainEater';
import { createVeryFastWalker } from '../entities/zombies/VeryFastWalker';
import { createSkeletonWarrior, SKELETON_BLOCK_COOLDOWN } from '../entities/zombies/SkeletonWarrior';
import { createSkeletonArcher, BONE_ARROW_PROJECTILE } from '../entities/zombies/SkeletonArcher';
import { createNecromancer } from '../entities/zombies/Necromancer';
import { createHotTopic } from '../entities/zombies/HotTopic';
import { createTridentZombie, TRIDENT_PROJECTILE } from '../entities/zombies/TridentZombie';
import { createDesertZombie, SAND_PROJECTILE } from '../entities/zombies/DesertZombie';
import { createCowboyZombie, COWBOY_PROJECTILE } from '../entities/zombies/CowboyZombie';
import { createBrainRot, ROT_BRAIN_PROJECTILE } from '../entities/zombies/BrainRot';
import { PALETTE, FONT_HEADING } from '../ui/palette';
import type { Faction } from '../types';
import { gameOptions, getPlayerFaction } from '../main';
import {
  sendAction, watchActions, setRoomStatus, sendGameState, watchGameState,
} from '../../firebase/multiplayer';
import type { GameAction, UnitSync, GameState } from '../../firebase/multiplayer';

const UNIT_PROJECTILE_MAP: Record<string, string> = {
  peashooter: PEASHOOTER_PROJECTILE,
  sunflower: SUNFLOWER_PROJECTILE,
  mangoPult: MANGO_PROJECTILE,
  kernelPult: KERNEL_PULT_PROJECTILE,
  brainEater: BRAIN_EATER_PROJECTILE,
  skeletonArcher: BONE_ARROW_PROJECTILE,
  tridentZombie: TRIDENT_PROJECTILE,
  desertZombie: SAND_PROJECTILE,
  cowboyZombie: COWBOY_PROJECTILE,
  brainRot: ROT_BRAIN_PROJECTILE,
};

const UNIT_FACTORIES: Record<string, (id: string) => UnitState> = {
  peashooter: createPeashooter,
  sunflower: createSunflower,
  walnutBomb: createWalnutBomb,
  potatoMine: createPotatoMine,
  cherryBomber: createCherryBomber,
  avocadoBunker: createAvocadoBunker,
  mangoPult: createMangoPult,
  kernelPult: createKernelPult,
  pumpkinSquash: createPumpkinSquash,
  torchwood: createTorchwood,
  brainEater: createBrainEater,
  veryFastWalker: createVeryFastWalker,
  skeletonWarrior: createSkeletonWarrior,
  skeletonArcher: createSkeletonArcher,
  necromancer: createNecromancer,
  hotTopic: createHotTopic,
  tridentZombie: createTridentZombie,
  desertZombie: createDesertZombie,
  cowboyZombie: createCowboyZombie,
  brainRot: createBrainRot,
};

interface ActiveUnit {
  state: UnitState;
  sprite: GameObjects.Sprite;
  healthBar: HealthBar;
}

interface ActiveProjectile {
  sprite: GameObjects.Sprite;
  config: ProjectileConfig;
  damage: number;
  row: number;
}

/**
 * Host-authority multiplayer:
 * - Challenger = HOST: runs full simulation, syncs state to Firebase every 500ms
 * - Accepter = GUEST: only sends placement commands, renders state from host
 */
export class MultiplayerBattleScene extends Scene {
  private gridManager!: GridManager;
  private energyManager!: EnergyManager;
  private combatManager!: CombatManager;
  private mergeManager!: MergeManager;
  private dragDropManager!: DragDropManager;
  private hud!: HUD;

  private units: ActiveUnit[] = [];
  private projectiles: ActiveProjectile[] = [];
  private nextUnitId: number = 0;

  private plantBaseHp: number = BASE_HP;
  private zombieBaseHp: number = BASE_HP;
  private plantBaseBar!: HealthBar;
  private zombieBaseBar!: HealthBar;

  private lastEnergyTick: number = 0;
  private lastSunflowerTick: number = 0;
  private lastStateSyncTime: number = 0;
  private skeletonBlockTimers: Map<string, number> = new Map();

  private playerFaction!: Faction;
  private roomId!: string;
  private isHost!: boolean;
  private gameOver: boolean = false;
  private unsubscribeActions?: () => void;
  private unsubscribeState?: () => void;

  constructor() {
    super('MultiplayerBattleScene');
  }

  create(): void {
    this.units = [];
    this.projectiles = [];
    this.nextUnitId = 0;
    this.plantBaseHp = BASE_HP;
    this.zombieBaseHp = BASE_HP;
    this.lastEnergyTick = 0;
    this.lastSunflowerTick = 0;
    this.lastStateSyncTime = 0;
    this.skeletonBlockTimers = new Map();
    this.gameOver = false;

    this.playerFaction = getPlayerFaction();
    this.roomId = gameOptions.roomId || '';
    // Challenger (lukas by convention, or whoever created the room) is host
    // We detect host by checking if this player initiated the challenge
    // Simple heuristic: the player whose faction matches what's in the URL is host
    // More reliable: store host in room data. For now, use player name as tie-break
    this.isHost = gameOptions.player === 'lukas';

    this.gridManager = new GridManager();
    this.energyManager = new EnergyManager(STARTING_ENERGY);
    this.combatManager = new CombatManager();
    this.mergeManager = new MergeManager();

    this.drawGrid();
    this.drawBases();

    // Label
    const roleLabel = this.isHost ? 'HOST' : 'GUEST';
    this.add.text(GAME_WIDTH / 2, 16, `MULTIPLAYER (${roleLabel})`, {
      fontFamily: FONT_HEADING,
      fontSize: '10px',
      color: '#ff4444',
    }).setOrigin(0.5, 0);

    // HUD — all units
    const plantCards: UnitCard[] = [
      { key: 'peashooter', label: 'Pea', cost: UNIT_COSTS.peashooter, textureKey: 'peashooter' },
      { key: 'sunflower', label: 'Sun', cost: UNIT_COSTS.sunflower, textureKey: 'sunflower' },
      { key: 'walnutBomb', label: 'Walnut', cost: UNIT_COSTS.walnutBomb, textureKey: 'walnutBomb' },
      { key: 'potatoMine', label: 'Mine', cost: UNIT_COSTS.potatoMine, textureKey: 'potatoMine' },
      { key: 'cherryBomber', label: 'Cherry', cost: UNIT_COSTS.cherryBomber, textureKey: 'cherryBomber' },
      { key: 'avocadoBunker', label: 'Avo', cost: UNIT_COSTS.avocadoBunker, textureKey: 'avocadoBunker' },
      { key: 'mangoPult', label: 'Mango', cost: UNIT_COSTS.mangoPult, textureKey: 'mangoPult' },
      { key: 'kernelPult', label: 'Kernel', cost: UNIT_COSTS.kernelPult, textureKey: 'kernelPult' },
      { key: 'pumpkinSquash', label: 'Pump', cost: UNIT_COSTS.pumpkinSquash, textureKey: 'pumpkinSquash' },
      { key: 'torchwood', label: 'Torch', cost: UNIT_COSTS.torchwood, textureKey: 'torchwood' },
    ];
    const zombieCards: UnitCard[] = [
      { key: 'brainEater', label: 'Brain', cost: UNIT_COSTS.brainEater, textureKey: 'brainEater' },
      { key: 'veryFastWalker', label: 'Fast', cost: UNIT_COSTS.veryFastWalker, textureKey: 'veryFastWalker' },
      { key: 'skeletonWarrior', label: 'Skel', cost: UNIT_COSTS.skeletonWarrior, textureKey: 'skeletonWarrior' },
      { key: 'skeletonArcher', label: 'Arch', cost: UNIT_COSTS.skeletonArcher, textureKey: 'skeletonArcher' },
      { key: 'necromancer', label: 'Necro', cost: UNIT_COSTS.necromancer, textureKey: 'necromancer' },
      { key: 'hotTopic', label: 'Hot', cost: UNIT_COSTS.hotTopic, textureKey: 'hotTopic' },
      { key: 'tridentZombie', label: 'Trid', cost: UNIT_COSTS.tridentZombie, textureKey: 'tridentZombie' },
      { key: 'desertZombie', label: 'Desert', cost: UNIT_COSTS.desertZombie, textureKey: 'desertZombie' },
      { key: 'cowboyZombie', label: 'Cow', cost: UNIT_COSTS.cowboyZombie, textureKey: 'cowboyZombie' },
      { key: 'brainRot', label: 'Rot', cost: UNIT_COSTS.brainRot, textureKey: 'brainRot' },
    ];
    const unitCards = this.playerFaction === 'plants' ? plantCards : zombieCards;
    this.hud = new HUD(this, unitCards, () => {});
    this.hud.updateEnergy(this.energyManager.getEnergy());

    // Drag drop — both host and guest send placement/merge actions
    this.dragDropManager = new DragDropManager(
      this, this.gridManager, this.energyManager, this.playerFaction,
      (unitKey, row, col) => {
        if (this.isHost) {
          this.spawnUnit(unitKey, row, col, this.playerFaction);
        }
        if (this.roomId) {
          sendAction(this.roomId, {
            type: 'place_unit',
            player: gameOptions.player,
            unitKey, row, col,
          });
        }
      },
      (unitKey, row, col) => {
        if (this.isHost) {
          this.mergeUnitAt(unitKey, row, col, this.playerFaction);
        }
        if (this.roomId) {
          sendAction(this.roomId, {
            type: 'place_unit', // reuse place_unit with merge flag
            player: gameOptions.player,
            unitKey, row, col,
          });
        }
      },
      (row, col) => {
        const unitId = this.gridManager.getUnitAt(row, col);
        if (!unitId) return null;
        const unit = this.units.find(u => u.state.id === unitId);
        return unit?.state ?? null;
      },
    );

    // Base health bars
    const plantBaseX = GRID_OFFSET_X - TILE_SIZE / 2 - 10;
    const zombieBaseX = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + TILE_SIZE / 2 + 10;
    const barY = GRID_OFFSET_Y - 15;
    this.plantBaseBar = new HealthBar(this, plantBaseX, barY, 60, 8);
    this.plantBaseBar.update(this.plantBaseHp, BASE_HP);
    this.zombieBaseBar = new HealthBar(this, zombieBaseX, barY, 60, 8);
    this.zombieBaseBar.update(this.zombieBaseHp, BASE_HP);

    // Quit button
    const quitHit = this.add.rectangle(GAME_WIDTH - 47, 26, 66, 32)
      .setInteractive({ useHandCursor: true }).setDepth(22).setAlpha(0.001);
    const quitBg = this.add.graphics().setDepth(20);
    quitBg.fillStyle(PALETTE.parchment);
    quitBg.fillRect(GAME_WIDTH - 80, 10, 66, 32);
    this.add.text(GAME_WIDTH - 47, 26, 'QUIT', {
      fontFamily: FONT_HEADING, fontSize: '10px', color: '#E63946',
    }).setOrigin(0.5).setDepth(21);
    quitHit.on('pointerdown', () => {
      this.gameOver = true;
      this.cleanup();
      window.location.href = '/';
    });

    // Set room to playing
    if (this.roomId) {
      setRoomStatus(this.roomId, 'playing');
    }

    if (this.isHost) {
      // HOST: watch for guest's placement/merge actions
      this.unsubscribeActions = watchActions(this.roomId, (action: GameAction) => {
        if (action.player === gameOptions.player) return;
        if (action.type === 'place_unit' && action.unitKey && action.row != null && action.col != null) {
          const guestFaction: Faction = this.playerFaction === 'plants' ? 'zombies' : 'plants';
          // Try merge first — if there's a same-type unit on that tile, merge it
          const existing = this.units.find(u =>
            u.state.isAlive() && u.state.key === action.unitKey &&
            u.state.row === action.row && Math.round(u.state.col) === action.col
          );
          if (existing && existing.state.level < MAX_UNIT_LEVEL) {
            this.mergeUnitAt(action.unitKey, action.row, action.col, guestFaction);
          } else {
            this.spawnUnit(action.unitKey, action.row, action.col, guestFaction);
          }
        }
      });
    } else {
      // GUEST: watch for host's state sync
      this.unsubscribeState = watchGameState(this.roomId, (state: GameState) => {
        this.applyGameState(state);
      });
    }
  }

  update(time: number, delta: number): void {
    if (this.gameOver) return;

    if (this.isHost) {
      // HOST runs full simulation
      if (time - this.lastEnergyTick >= ENERGY_TICK_INTERVAL) {
        this.lastEnergyTick = time;
        this.energyManager.addPassive(ENERGY_TICK_AMOUNT);
      }

      if (time - this.lastSunflowerTick >= SUNFLOWER_ENERGY_INTERVAL) {
        this.lastSunflowerTick = time;
        const sunflowerCount = this.units.filter(
          u => u.state.key === 'sunflower' && u.state.isAlive(),
        ).length;
        if (sunflowerCount > 0) {
          this.energyManager.addFromProducer(SUNFLOWER_ENERGY_AMOUNT * sunflowerCount);
        }
      }

      this.updateMovement(delta);
      this.updateCombat(time);
      this.updateProjectiles(delta, time);
      this.checkBaseDamage();
      this.cleanupDeadUnits();

      // Sync state to Firebase every 500ms
      if (time - this.lastStateSyncTime >= 500) {
        this.lastStateSyncTime = time;
        this.syncState();
      }

      // Win condition (host decides)
      if (this.plantBaseHp <= 0) {
        this.endGame('zombies');
      } else if (this.zombieBaseHp <= 0) {
        this.endGame('plants');
      }
    } else {
      // GUEST: only does energy for local HUD display + projectile rendering
      if (time - this.lastEnergyTick >= ENERGY_TICK_INTERVAL) {
        this.lastEnergyTick = time;
        this.energyManager.addPassive(ENERGY_TICK_AMOUNT);
      }

      // Move projectiles locally for smooth rendering
      this.updateProjectilesVisualOnly(delta);
    }

    // Both: HUD updates
    this.hud.updateEnergy(this.energyManager.getEnergy());
    this.plantBaseBar.update(this.plantBaseHp, BASE_HP);
    this.zombieBaseBar.update(this.zombieBaseHp, BASE_HP);

    for (const unit of this.units) {
      if (unit.state.isAlive()) {
        const { x, y } = this.gridManager.toPixel(unit.state.row, unit.state.col);
        unit.healthBar.setPosition(x, y - TILE_SIZE / 2 - 4);
        unit.healthBar.update(unit.state.hp, unit.state.maxHp);
      }
    }
  }

  /** HOST: sync full game state to Firebase */
  private syncState(): void {
    const unitSyncs: UnitSync[] = this.units
      .filter(u => u.state.isAlive())
      .map(u => ({
        id: u.state.id,
        key: u.state.key,
        faction: u.state.faction,
        row: u.state.row,
        col: Math.round(u.state.col * 100) / 100, // reduce precision for Firebase
        hp: u.state.hp,
        maxHp: u.state.maxHp,
        level: u.state.level,
      }));

    sendGameState(this.roomId, {
      units: unitSyncs,
      plantBaseHp: this.plantBaseHp,
      zombieBaseHp: this.zombieBaseHp,
      gameOver: false,
    });
  }

  /** GUEST: apply state received from host */
  private applyGameState(state: GameState): void {
    if (state.gameOver && state.winner) {
      this.gameOver = true;
      this.cleanup();
      this.scene.start('GameOverScene', { winner: state.winner });
      return;
    }

    this.plantBaseHp = state.plantBaseHp;
    this.zombieBaseHp = state.zombieBaseHp;

    if (!state.units) return;

    const receivedIds = new Set(state.units.map(u => u.id));

    // Remove units that no longer exist in host state
    for (const unit of this.units) {
      if (!receivedIds.has(unit.state.id)) {
        unit.sprite.destroy();
        unit.healthBar.destroy();
        unit.state.takeDamage(Infinity);
      }
    }
    this.units = this.units.filter(u => u.state.isAlive());

    // Update existing units or create new ones
    for (const sync of state.units) {
      const existing = this.units.find(u => u.state.id === sync.id);
      if (existing) {
        // Update position and HP
        existing.state.hp = sync.hp;
        existing.state.maxHp = sync.maxHp;
        existing.state.col = sync.col;
        existing.state.row = sync.row;
        existing.state.level = sync.level;
        const { x, y } = this.gridManager.toPixel(sync.row, sync.col);
        existing.sprite.setPosition(x, y);

        // Update texture if level changed
        const textureKey = sync.level > 1 ? `${sync.key}-L${sync.level}` : sync.key;
        if (this.textures.exists(textureKey) && existing.sprite.texture.key !== textureKey) {
          existing.sprite.setTexture(textureKey);
          existing.sprite.setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4);
        }
      } else {
        // New unit — create it
        this.createUnitFromSync(sync);
      }
    }
  }

  private createUnitFromSync(sync: UnitSync): void {
    const factory = UNIT_FACTORIES[sync.key];
    if (!factory) return;

    const unitState = factory(sync.id);
    unitState.setPosition(sync.row, sync.col);
    unitState.hp = sync.hp;
    unitState.maxHp = sync.maxHp;
    unitState.level = sync.level;

    const { x, y } = this.gridManager.toPixel(sync.row, sync.col);
    const textureKey = sync.level > 1 ? `${sync.key}-L${sync.level}` : sync.key;
    const spriteKey = this.textures.exists(textureKey) ? textureKey : sync.key;
    const sprite = this.add.sprite(x, y, spriteKey);
    sprite.setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4);
    const healthBar = new HealthBar(this, x, y - TILE_SIZE / 2 - 4);
    healthBar.update(unitState.hp, unitState.maxHp);

    this.units.push({ state: unitState, sprite, healthBar });
  }

  private endGame(winner: 'plants' | 'zombies'): void {
    this.gameOver = true;
    // Send final state with game over
    sendGameState(this.roomId, {
      units: [],
      plantBaseHp: this.plantBaseHp,
      zombieBaseHp: this.zombieBaseHp,
      gameOver: true,
      winner,
    });
    setRoomStatus(this.roomId, 'finished');
    this.cleanup();
    this.scene.start('GameOverScene', { winner });
  }

  private cleanup(): void {
    if (this.unsubscribeActions) { this.unsubscribeActions(); this.unsubscribeActions = undefined; }
    if (this.unsubscribeState) { this.unsubscribeState(); this.unsubscribeState = undefined; }
  }

  // ── Simulation (HOST only) ──────────────────────────────────────

  private mergeUnitAt(unitKey: string, row: number, col: number, faction: Faction): void {
    const existing = this.units.find(u =>
      u.state.isAlive() && u.state.key === unitKey &&
      u.state.faction === faction &&
      u.state.row === row && Math.round(u.state.col) === col
    );
    if (!existing) return;

    const factory = UNIT_FACTORIES[unitKey];
    if (!factory) return;
    const tempUnit = factory(`merge_temp_${this.nextUnitId++}`);
    if (!this.mergeManager.canMerge(existing.state, tempUnit)) return;

    const result = this.mergeManager.merge(existing.state, tempUnit);
    const newKey = result.newTextureKey;
    if (this.textures.exists(newKey)) {
      existing.sprite.setTexture(newKey);
    }
    existing.sprite.setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4);

    // Pulse animation
    this.tweens.add({
      targets: existing.sprite,
      scaleX: existing.sprite.scaleX * 1.3,
      scaleY: existing.sprite.scaleY * 1.3,
      duration: 150,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  private spawnUnit(unitKey: string, row: number, col: number, faction: Faction): void {
    const factory = UNIT_FACTORIES[unitKey];
    if (!factory) return;

    const id = `unit_${this.nextUnitId++}`;
    const unitState = factory(id);
    unitState.setPosition(row, col);

    if (unitState.isStationary()) {
      if (!this.gridManager.place(row, col, id)) return;
    }

    const { x, y } = this.gridManager.toPixel(row, col);
    const sprite = this.add.sprite(x, y, unitKey);
    sprite.setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4);
    const healthBar = new HealthBar(this, x, y - TILE_SIZE / 2 - 4);
    healthBar.update(unitState.hp, unitState.maxHp);

    this.units.push({ state: unitState, sprite, healthBar });
  }

  private updateMovement(delta: number): void {
    const deltaSeconds = delta / 1000;
    for (const unit of this.units) {
      const { state, sprite } = unit;
      if (!state.isAlive() || state.isStationary()) continue;

      const allStates = this.units.map(u => u.state);
      const target = this.combatManager.findTarget(state, allStates);
      if (target) {
        const dist = Math.abs(target.col - state.col);
        if (dist <= 1) continue;
      }

      const direction = state.faction === 'zombies' ? -1 : 1;
      state.col = Math.max(0, Math.min(GRID_COLS - 1, state.col + state.moveSpeed * deltaSeconds * direction));

      const { x, y } = this.gridManager.toPixel(state.row, state.col);
      sprite.setPosition(x, y);
    }
  }

  private updateCombat(time: number): void {
    const allStates = this.units.map(u => u.state);
    for (const unit of this.units) {
      const { state } = unit;
      if (!state.isAlive() || !state.canAttack(time)) continue;
      if (state.key === 'walnutBomb') continue;

      const target = this.combatManager.findTarget(state, allStates);
      const projectileKey = UNIT_PROJECTILE_MAP[state.key];
      if (projectileKey && state.range > 1) {
        state.recordAttack(time);
        this.fireProjectile(state, projectileKey);
      } else if (target) {
        state.recordAttack(time);
        target.takeDamage(state.damage);
      }
    }
  }

  private fireProjectile(attacker: UnitState, projectileKey: string): void {
    const config = PROJECTILE_CONFIGS[projectileKey];
    if (!config) return;
    const { x, y } = this.gridManager.toPixel(attacker.row, attacker.col);
    const sprite = this.add.sprite(x, y, config.textureKey).setDisplaySize(20, 20);
    this.projectiles.push({ sprite, config, damage: attacker.damage, row: attacker.row });
  }

  private updateProjectiles(delta: number, time: number): void {
    const deltaSeconds = delta / 1000;
    const toRemove: number[] = [];

    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      const direction = proj.config.faction === 'plants' ? 1 : -1;
      proj.sprite.x += proj.config.speed * deltaSeconds * direction;

      let hit = false;
      for (const unit of this.units) {
        if (!unit.state.isAlive()) continue;
        if (unit.state.faction === proj.config.faction) continue;
        if (unit.state.row !== proj.row) continue;

        const unitPixel = this.gridManager.toPixel(unit.state.row, unit.state.col);
        if (Math.abs(proj.sprite.x - unitPixel.x) < TILE_SIZE / 2) {
          if (unit.state.key === 'skeletonWarrior') {
            const lastBlock = this.skeletonBlockTimers.get(unit.state.id) ?? -Infinity;
            if (time - lastBlock >= SKELETON_BLOCK_COOLDOWN) {
              this.skeletonBlockTimers.set(unit.state.id, time);
              toRemove.push(i); hit = true; break;
            }
          }
          unit.state.takeDamage(proj.damage);
          toRemove.push(i); hit = true; break;
        }
      }
      if (hit) continue;

      const leftEdge = GRID_OFFSET_X;
      const rightEdge = GRID_OFFSET_X + GRID_COLS * TILE_SIZE;
      if (proj.config.faction === 'plants' && proj.sprite.x > rightEdge) {
        this.zombieBaseHp -= proj.damage; toRemove.push(i);
      } else if (proj.config.faction === 'zombies' && proj.sprite.x < leftEdge) {
        this.plantBaseHp -= proj.damage; toRemove.push(i);
      }
    }

    for (const idx of [...new Set(toRemove)].sort((a, b) => b - a)) {
      this.projectiles[idx].sprite.destroy();
      this.projectiles.splice(idx, 1);
    }
  }

  /** GUEST: just move projectile sprites for smooth visuals */
  private updateProjectilesVisualOnly(delta: number): void {
    const deltaSeconds = delta / 1000;
    const toRemove: number[] = [];
    const leftEdge = GRID_OFFSET_X - 50;
    const rightEdge = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + 50;

    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      const direction = proj.config.faction === 'plants' ? 1 : -1;
      proj.sprite.x += proj.config.speed * deltaSeconds * direction;

      if (proj.sprite.x < leftEdge || proj.sprite.x > rightEdge) {
        toRemove.push(i);
      }
    }

    for (const idx of [...new Set(toRemove)].sort((a, b) => b - a)) {
      this.projectiles[idx].sprite.destroy();
      this.projectiles.splice(idx, 1);
    }
  }

  private checkBaseDamage(): void {
    const time = this.time?.now ?? 0;
    for (const unit of this.units) {
      if (!unit.state.isAlive() || unit.state.isStationary()) continue;
      if (unit.state.faction === 'zombies' && unit.state.col <= 0) {
        unit.state.col = 0;
        if (unit.state.canAttack(time)) {
          unit.state.recordAttack(time);
          this.plantBaseHp -= unit.state.damage;
        }
      }
      if (unit.state.faction === 'plants' && unit.state.col >= GRID_COLS - 1) {
        unit.state.col = GRID_COLS - 1;
        if (unit.state.canAttack(time)) {
          unit.state.recordAttack(time);
          this.zombieBaseHp -= unit.state.damage;
        }
      }
    }
  }

  private cleanupDeadUnits(): void {
    const explodingUnits = this.units.filter(u => !u.state.isAlive() &&
      (u.state.key === 'walnutBomb' || u.state.key === 'cherryBomber' || u.state.key === 'potatoMine')
    );
    for (const dead of explodingUnits) {
      if (dead.state.key === 'walnutBomb')
        this.aoeExplosion(dead.state, WALNUT_EXPLOSION_DAMAGE * dead.state.level, WALNUT_EXPLOSION_RADIUS);
      if (dead.state.key === 'cherryBomber')
        this.aoeExplosion(dead.state, CHERRY_EXPLOSION_DAMAGE * dead.state.level, CHERRY_EXPLOSION_RADIUS);
      if (dead.state.key === 'potatoMine')
        this.aoeExplosion(dead.state, POTATO_MINE_EXPLOSION_DAMAGE * dead.state.level, POTATO_MINE_EXPLOSION_RADIUS);
    }

    const deadUnits = this.units.filter(u => !u.state.isAlive());
    for (const dead of deadUnits) {
      if (dead.state.faction !== this.playerFaction) {
        this.energyManager.addKillReward(ENERGY_KILL_REWARD);
      }
      if (dead.state.isStationary()) {
        this.gridManager.remove(dead.state.row, Math.round(dead.state.col));
      }
      this.skeletonBlockTimers.delete(dead.state.id);
      dead.sprite.destroy();
      dead.healthBar.destroy();
    }
    this.units = this.units.filter(u => u.state.isAlive());
  }

  private aoeExplosion(source: UnitState, damage: number, radius: number): void {
    for (const unit of this.units) {
      if (!unit.state.isAlive() || unit.state.faction === source.faction) continue;
      if (Math.abs(unit.state.row - source.row) <= radius && Math.abs(unit.state.col - source.col) <= radius) {
        unit.state.takeDamage(damage);
      }
    }
  }

  // ── Rendering ───────────────────────────────────────────────────

  private drawGrid(): void {
    if (this.textures.exists('battlefield')) {
      const bg = this.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'battlefield');
      bg.setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      bg.setAlpha(0.15);
    }
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const { x, y } = this.gridManager.toPixel(row, col);
        const lightKey = this.textures.exists('tileImg') ? 'tileImg' : 'tile';
        const darkKey = this.textures.exists('tileDarkImg') ? 'tileDarkImg' : 'tileDark';
        const tileKey = (row + col) % 2 === 0 ? lightKey : darkKey;
        const tile = this.add.sprite(x, y, tileKey);
        tile.setDisplaySize(TILE_SIZE, TILE_SIZE);
        tile.setAlpha(0.7);
      }
    }
  }

  private drawBases(): void {
    const plantBaseX = GRID_OFFSET_X - TILE_SIZE / 2 - 20;
    const zombieBaseX = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + TILE_SIZE / 2 + 20;
    const baseHeight = GRID_ROWS * TILE_SIZE;
    const baseCenterY = GRID_OFFSET_Y + baseHeight / 2;

    if (this.textures.exists('plantBase')) {
      this.add.sprite(plantBaseX, baseCenterY, 'plantBase').setDisplaySize(TILE_SIZE + 10, baseHeight);
    } else {
      for (let row = 0; row < GRID_ROWS; row++) {
        const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
        this.add.sprite(plantBaseX, y, 'base').setTint(0x00cc00);
      }
    }
    this.add.text(plantBaseX, GRID_OFFSET_Y - 20, 'PLANT BASE', {
      fontSize: '11px', color: '#00cc00', fontStyle: 'bold',
    }).setOrigin(0.5);

    if (this.textures.exists('zombieBase')) {
      this.add.sprite(zombieBaseX, baseCenterY, 'zombieBase').setDisplaySize(TILE_SIZE + 10, baseHeight);
    } else {
      for (let row = 0; row < GRID_ROWS; row++) {
        const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
        this.add.sprite(zombieBaseX, y, 'base').setTint(0x884488);
      }
    }
    this.add.text(zombieBaseX, GRID_OFFSET_Y - 20, 'ZOMBIE BASE', {
      fontSize: '11px', color: '#884488', fontStyle: 'bold',
    }).setOrigin(0.5);
  }
}
