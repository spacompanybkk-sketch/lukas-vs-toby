import { Scene, GameObjects } from 'phaser';
import {
  GRID_ROWS, GRID_COLS, TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y,
  GAME_WIDTH, BASE_HP, STARTING_ENERGY,
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
import { UnitState } from '../entities/Unit';
import { PROJECTILE_CONFIGS } from '../entities/Projectile';
import type { ProjectileConfig } from '../entities/Projectile';
import { createPeashooter, PEASHOOTER_PROJECTILE } from '../entities/plants/Peashooter';
import { createSunflower, SUNFLOWER_PROJECTILE, SUNFLOWER_ENERGY_INTERVAL, SUNFLOWER_ENERGY_AMOUNT } from '../entities/plants/Sunflower';
import { createWalnutBomb, WALNUT_EXPLOSION_RADIUS, WALNUT_EXPLOSION_DAMAGE } from '../entities/plants/WalnutBomb';
import { createBrainEater, BRAIN_EATER_PROJECTILE } from '../entities/zombies/BrainEater';
import { createVeryFastWalker } from '../entities/zombies/VeryFastWalker';
import { createSkeletonWarrior, SKELETON_BLOCK_COOLDOWN } from '../entities/zombies/SkeletonWarrior';
import type { Faction } from '../types';
import { gameOptions, getPlayerFaction } from '../main';
import { sendAction, watchActions, setRoomStatus } from '../../firebase/multiplayer';
import type { GameAction } from '../../firebase/multiplayer';

/** Projectile type mapping per unit key */
const UNIT_PROJECTILE_MAP: Record<string, string> = {
  peashooter: PEASHOOTER_PROJECTILE,
  sunflower: SUNFLOWER_PROJECTILE,
  brainEater: BRAIN_EATER_PROJECTILE,
};

/** Factory mapping */
const UNIT_FACTORIES: Record<string, (id: string) => UnitState> = {
  peashooter: createPeashooter,
  sunflower: createSunflower,
  walnutBomb: createWalnutBomb,
  brainEater: createBrainEater,
  veryFastWalker: createVeryFastWalker,
  skeletonWarrior: createSkeletonWarrior,
};

interface ActiveUnit {
  state: UnitState;
  sprite: GameObjects.Sprite;
  healthBar: HealthBar;
}

interface ActiveProjectile {
  sprite: GameObjects.Sprite;
  config: ProjectileConfig;
  row: number;
}

export class MultiplayerBattleScene extends Scene {
  private gridManager!: GridManager;
  private energyManager!: EnergyManager;
  private combatManager!: CombatManager;
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
  private skeletonBlockTimers: Map<string, number> = new Map();

  private playerFaction!: Faction;
  private roomId!: string;
  private gameOver: boolean = false;
  private unsubscribeActions?: () => void;

  constructor() {
    super('MultiplayerBattleScene');
  }

  create(): void {
    // Reset state
    this.units = [];
    this.projectiles = [];
    this.nextUnitId = 0;
    this.plantBaseHp = BASE_HP;
    this.zombieBaseHp = BASE_HP;
    this.lastEnergyTick = 0;
    this.lastSunflowerTick = 0;
    this.skeletonBlockTimers = new Map();
    this.gameOver = false;

    this.playerFaction = getPlayerFaction();
    this.roomId = gameOptions.roomId || '';

    // Systems
    this.gridManager = new GridManager();
    this.energyManager = new EnergyManager(STARTING_ENERGY);
    this.combatManager = new CombatManager();

    // Draw battlefield
    this.drawGrid();
    this.drawBases();

    // MULTIPLAYER label
    this.add.text(GAME_WIDTH / 2, 16, 'MULTIPLAYER', {
      fontSize: '16px', color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    // HUD — show unit cards for the player's faction
    const plantCards: UnitCard[] = [
      { key: 'peashooter', label: 'Peashooter', cost: UNIT_COSTS.peashooter, textureKey: 'peashooter' },
      { key: 'sunflower', label: 'Sunflower', cost: UNIT_COSTS.sunflower, textureKey: 'sunflower' },
      { key: 'walnutBomb', label: 'WalnutBomb', cost: UNIT_COSTS.walnutBomb, textureKey: 'walnutBomb' },
    ];
    const zombieCards: UnitCard[] = [
      { key: 'brainEater', label: 'BrainEater', cost: UNIT_COSTS.brainEater, textureKey: 'brainEater' },
      { key: 'veryFastWalker', label: 'FastWalker', cost: UNIT_COSTS.veryFastWalker, textureKey: 'veryFastWalker' },
      { key: 'skeletonWarrior', label: 'Skeleton', cost: UNIT_COSTS.skeletonWarrior, textureKey: 'skeletonWarrior' },
    ];
    const unitCards = this.playerFaction === 'plants' ? plantCards : zombieCards;
    this.hud = new HUD(this, unitCards, () => {});
    this.hud.updateEnergy(this.energyManager.getEnergy());

    // No WaveManager — opponent actions come from Firebase

    // Drag drop (player places their faction's units, also sends action to Firebase)
    this.dragDropManager = new DragDropManager(
      this, this.gridManager, this.energyManager, this.playerFaction,
      (unitKey, row, col) => {
        this.spawnUnit(unitKey, row, col, this.playerFaction);
        // Send placement action to Firebase
        if (this.roomId) {
          sendAction(this.roomId, {
            type: 'place_unit',
            player: gameOptions.player,
            unitKey,
            row,
            col,
          });
        }
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
    const quitBtn = this.add.text(GAME_WIDTH - 16, 16, 'QUIT', {
      fontSize: '16px',
      color: '#ff4444',
      backgroundColor: '#333333',
      padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setInteractive();

    quitBtn.on('pointerdown', () => {
      this.gameOver = true;
      this.cleanup();
      window.location.href = '/';
    });

    // Set room to playing
    if (this.roomId) {
      setRoomStatus(this.roomId, 'playing');
    }

    // Watch for opponent actions from Firebase
    if (this.roomId) {
      this.unsubscribeActions = watchActions(this.roomId, (action: GameAction) => {
        this.handleRemoteAction(action);
      });
    }
  }

  private handleRemoteAction(action: GameAction): void {
    // Ignore our own actions
    if (action.player === gameOptions.player) return;

    if (action.type === 'place_unit' && action.unitKey != null && action.row != null && action.col != null) {
      const opponentFaction: Faction = this.playerFaction === 'plants' ? 'zombies' : 'plants';
      this.spawnUnit(action.unitKey, action.row, action.col, opponentFaction);
    } else if (action.type === 'game_over') {
      if (!this.gameOver && action.winner) {
        this.gameOver = true;
        this.cleanup();
        this.scene.start('GameOverScene', { winner: action.winner });
      }
    }
  }

  update(time: number, delta: number): void {
    if (this.gameOver) return;

    // 1. Passive energy tick
    if (time - this.lastEnergyTick >= ENERGY_TICK_INTERVAL) {
      this.lastEnergyTick = time;
      this.energyManager.addPassive(ENERGY_TICK_AMOUNT);
    }

    // 2. Sunflower energy production
    if (time - this.lastSunflowerTick >= SUNFLOWER_ENERGY_INTERVAL) {
      this.lastSunflowerTick = time;
      const sunflowerCount = this.units.filter(
        u => u.state.key === 'sunflower' && u.state.isAlive(),
      ).length;
      if (sunflowerCount > 0) {
        this.energyManager.addFromProducer(SUNFLOWER_ENERGY_AMOUNT * sunflowerCount);
      }
    }

    // No WaveManager update — multiplayer has no AI

    // 3. Unit movement
    this.updateMovement(delta);

    // 4. Combat
    this.updateCombat(time);

    // 5. Projectile movement and collision
    this.updateProjectiles(delta, time);

    // 6. Base damage from units reaching edges
    this.checkBaseDamage();

    // 7. Dead unit cleanup
    this.cleanupDeadUnits();

    // 8. HUD updates
    this.hud.updateEnergy(this.energyManager.getEnergy());
    this.plantBaseBar.update(this.plantBaseHp, BASE_HP);
    this.zombieBaseBar.update(this.zombieBaseHp, BASE_HP);

    // Update unit health bars
    for (const unit of this.units) {
      if (unit.state.isAlive()) {
        const { x, y } = this.gridManager.toPixel(unit.state.row, unit.state.col);
        unit.healthBar.setPosition(x, y - TILE_SIZE / 2 - 4);
        unit.healthBar.update(unit.state.hp, unit.state.maxHp);
      }
    }

    // 9. Win condition
    if (this.plantBaseHp <= 0) {
      this.gameOver = true;
      const winner = 'zombies' as const;
      if (this.roomId) {
        sendAction(this.roomId, { type: 'game_over', player: gameOptions.player, winner });
        setRoomStatus(this.roomId, 'finished');
      }
      this.cleanup();
      this.scene.start('GameOverScene', { winner });
    } else if (this.zombieBaseHp <= 0) {
      this.gameOver = true;
      const winner = 'plants' as const;
      if (this.roomId) {
        sendAction(this.roomId, { type: 'game_over', player: gameOptions.player, winner });
        setRoomStatus(this.roomId, 'finished');
      }
      this.cleanup();
      this.scene.start('GameOverScene', { winner });
    }
  }

  private cleanup(): void {
    if (this.unsubscribeActions) {
      this.unsubscribeActions();
      this.unsubscribeActions = undefined;
    }
  }

  private spawnUnit(unitKey: string, row: number, col: number, faction: Faction): void {
    const factory = UNIT_FACTORIES[unitKey];
    if (!factory) return;

    const id = `unit_${this.nextUnitId++}`;
    const unitState = factory(id);
    unitState.setPosition(row, col);

    // Place on grid (only for stationary units)
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
      const moveAmount = state.moveSpeed * deltaSeconds;
      state.col = state.col + direction * moveAmount;

      const { x, y } = this.gridManager.toPixel(state.row, state.col);
      sprite.setPosition(x, y);
    }
  }

  private updateCombat(time: number): void {
    const allStates = this.units.map(u => u.state);

    for (const unit of this.units) {
      const { state } = unit;
      if (!state.isAlive()) continue;
      if (!state.canAttack(time)) continue;
      if (state.key === 'walnutBomb') continue;

      const target = this.combatManager.findTarget(state, allStates);

      const projectileKey = UNIT_PROJECTILE_MAP[state.key];
      if (projectileKey && state.range > 1) {
        // Ranged units always fire toward enemy base, even without a target
        state.recordAttack(time);
        this.fireProjectile(state, projectileKey);
      } else if (target) {
        // Melee attack — only if adjacent target
        state.recordAttack(time);
        target.takeDamage(state.damage);
      }
    }
  }

  private fireProjectile(attacker: UnitState, projectileKey: string): void {
    const config = PROJECTILE_CONFIGS[projectileKey];
    if (!config) return;

    const { x, y } = this.gridManager.toPixel(attacker.row, attacker.col);
    const sprite = this.add.sprite(x, y, config.textureKey);
    sprite.setDisplaySize(20, 20);

    this.projectiles.push({ sprite, config, row: attacker.row });
  }

  private updateProjectiles(delta: number, time: number): void {
    const deltaSeconds = delta / 1000;
    const toRemove: number[] = [];

    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      const direction = proj.config.faction === 'plants' ? 1 : -1;
      const moveX = proj.config.speed * deltaSeconds * direction;
      proj.sprite.x += moveX;

      let hit = false;
      for (const unit of this.units) {
        if (!unit.state.isAlive()) continue;
        if (unit.state.faction === proj.config.faction) continue;
        if (unit.state.row !== proj.row) continue;

        const unitPixel = this.gridManager.toPixel(unit.state.row, unit.state.col);
        const dist = Math.abs(proj.sprite.x - unitPixel.x);

        if (dist < TILE_SIZE / 2) {
          if (unit.state.key === 'skeletonWarrior') {
            const lastBlock = this.skeletonBlockTimers.get(unit.state.id) ?? -Infinity;
            if (time - lastBlock >= SKELETON_BLOCK_COOLDOWN) {
              this.skeletonBlockTimers.set(unit.state.id, time);
              toRemove.push(i);
              hit = true;
              break;
            }
          }

          unit.state.takeDamage(proj.config.damage);
          toRemove.push(i);
          hit = true;
          break;
        }
      }

      if (hit) continue;

      const leftEdge = GRID_OFFSET_X;
      const rightEdge = GRID_OFFSET_X + GRID_COLS * TILE_SIZE;

      if (proj.config.faction === 'plants' && proj.sprite.x > rightEdge) {
        this.zombieBaseHp -= proj.config.damage;
        toRemove.push(i);
      } else if (proj.config.faction === 'zombies' && proj.sprite.x < leftEdge) {
        this.plantBaseHp -= proj.config.damage;
        toRemove.push(i);
      }
    }

    const uniqueRemove = [...new Set(toRemove)].sort((a, b) => b - a);
    for (const idx of uniqueRemove) {
      this.projectiles[idx].sprite.destroy();
      this.projectiles.splice(idx, 1);
    }
  }

  private checkBaseDamage(): void {
    const time = this.time?.now ?? 0;

    for (const unit of this.units) {
      if (!unit.state.isAlive()) continue;
      if (unit.state.isStationary()) continue;

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
    const deadUnits = this.units.filter(u => !u.state.isAlive());

    for (const dead of deadUnits) {
      if (dead.state.key === 'walnutBomb') {
        this.walnutExplosion(dead.state);
      }

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

  private walnutExplosion(walnut: UnitState): void {
    for (const unit of this.units) {
      if (!unit.state.isAlive()) continue;
      if (unit.state.faction === walnut.faction) continue;

      const rowDist = Math.abs(unit.state.row - walnut.row);
      const colDist = Math.abs(unit.state.col - walnut.col);

      if (rowDist <= WALNUT_EXPLOSION_RADIUS && colDist <= WALNUT_EXPLOSION_RADIUS) {
        unit.state.takeDamage(WALNUT_EXPLOSION_DAMAGE);
      }
    }
  }

  private drawGrid(): void {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const { x, y } = this.gridManager.toPixel(row, col);
        const tileKey = (row + col) % 2 === 0 ? 'tile' : 'tileDark';
        this.add.sprite(x, y, tileKey);
      }
    }
  }

  private drawBases(): void {
    const plantBaseX = GRID_OFFSET_X - TILE_SIZE / 2 - 10;
    for (let row = 0; row < GRID_ROWS; row++) {
      const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
      this.add.sprite(plantBaseX, y, 'base').setTint(0x00cc00);
    }
    this.add.text(plantBaseX - 20, GRID_OFFSET_Y - 30, 'LUKAS\nBASE', {
      fontSize: '12px', color: '#00cc00', align: 'center',
    });

    const zombieBaseX = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + TILE_SIZE / 2 + 10;
    for (let row = 0; row < GRID_ROWS; row++) {
      const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
      this.add.sprite(zombieBaseX, y, 'base').setTint(0x884488);
    }
    this.add.text(zombieBaseX - 20, GRID_OFFSET_Y - 30, 'TOBY\nBASE', {
      fontSize: '12px', color: '#884488', align: 'center',
    });
  }
}
