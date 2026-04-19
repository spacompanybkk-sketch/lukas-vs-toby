import { Scene, GameObjects, Physics } from 'phaser';
import * as Phaser from 'phaser';
import {
  GRID_ROWS, GRID_COLS, TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y,
  GAME_WIDTH, BASE_HP, STARTING_ENERGY,
  ENERGY_TICK_INTERVAL, ENERGY_TICK_AMOUNT, ENERGY_KILL_REWARD,
  UNIT_COSTS,
} from '../constants';
import { GridManager } from '../systems/GridManager';
import { EnergyManager } from '../systems/EnergyManager';
import { CombatManager } from '../systems/CombatManager';
import { WaveManager } from '../systems/WaveManager';
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
import { getPlayerFaction, gameOptions } from '../main';

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

export class BattleScene extends Scene {
  private gridManager!: GridManager;
  private energyManager!: EnergyManager;
  private combatManager!: CombatManager;
  private waveManager!: WaveManager;
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
  private gameOver: boolean = false;
  private isFreeplay: boolean = false;
  private waveText!: GameObjects.Text;

  constructor() {
    super('BattleScene');
  }

  create(): void {
    // Reset state for replays
    this.units = [];
    this.projectiles = [];
    this.nextUnitId = 0;
    this.plantBaseHp = BASE_HP;
    this.zombieBaseHp = BASE_HP;
    this.lastEnergyTick = 0;
    this.lastSunflowerTick = 0;
    this.skeletonBlockTimers = new Map();
    this.gameOver = false;
    this.isFreeplay = gameOptions.mode === 'freeplay';
    this.playerFaction = getPlayerFaction();

    // Systems
    this.gridManager = new GridManager();
    this.energyManager = new EnergyManager(STARTING_ENERGY);
    this.combatManager = new CombatManager();

    // Draw battlefield
    this.drawGrid();
    this.drawBases();

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

    // Wave manager (AI spawns the opposing faction)
    const aiFaction: Faction = this.playerFaction === 'plants' ? 'zombies' : 'plants';
    const aiSpawnCol = this.playerFaction === 'plants' ? GRID_COLS - 1 : 0;
    this.waveManager = new WaveManager(aiFaction, (unitKey, row) => {
      this.spawnUnit(unitKey, row, aiSpawnCol, aiFaction);
    });

    // Drag drop (player places their faction's units)
    this.dragDropManager = new DragDropManager(
      this, this.gridManager, this.energyManager, this.playerFaction,
      (unitKey, row, col) => {
        this.spawnUnit(unitKey, row, col, this.playerFaction);
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
      window.location.href = '/';
    });

    // Wave counter (visible in all modes, prominent in freeplay)
    this.waveText = this.add.text(GAME_WIDTH / 2, 16, '', {
      fontSize: this.isFreeplay ? '20px' : '14px',
      color: this.isFreeplay ? '#ffaa00' : '#888888',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    if (this.isFreeplay) {
      this.add.text(GAME_WIDTH / 2, 40, 'FREE PLAY — Survive!', {
        fontSize: '12px', color: '#ffaa00',
      }).setOrigin(0.5, 0);
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

    // 3. AI wave spawning
    this.waveManager.update(time);

    // 4. Zombie movement
    this.updateMovement(delta);

    // 5. Combat (ranged fire projectiles, melee deal direct damage)
    this.updateCombat(time);

    // 6. Projectile movement and collision
    this.updateProjectiles(delta, time);

    // 7. Base damage from units reaching edges
    this.checkBaseDamage();

    // 8. Dead unit cleanup
    this.cleanupDeadUnits();

    // 9. HUD updates
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

    // 10. Wave counter update
    this.waveText.setText(`Wave: ${this.waveManager.getWaveCount()}`);

    // 11. Win condition
    if (this.isFreeplay) {
      // Freeplay: you lose when your base is destroyed
      const playerBaseHp = this.playerFaction === 'plants' ? this.plantBaseHp : this.zombieBaseHp;
      if (playerBaseHp <= 0) {
        this.gameOver = true;
        const waves = this.waveManager.getWaveCount();
        this.scene.start('GameOverScene', {
          winner: this.playerFaction === 'plants' ? 'zombies' : 'plants',
          freeplay: true,
          waves,
        });
      }
    } else {
      if (this.plantBaseHp <= 0) {
        this.gameOver = true;
        this.scene.start('GameOverScene', { winner: 'zombies' });
      } else if (this.zombieBaseHp <= 0) {
        this.gameOver = true;
        this.scene.start('GameOverScene', { winner: 'plants' });
      }
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
    // Scale down from 1024x1024 PNGs to fit tile size
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

      // Check if adjacent to an enemy — stop moving if so
      const allStates = this.units.map(u => u.state);
      const target = this.combatManager.findTarget(state, allStates);
      if (target) {
        // Adjacent enemy found within melee range — don't move
        const dist = Math.abs(target.col - state.col);
        if (dist <= 1) continue;
      }

      // Move toward the enemy base
      const direction = state.faction === 'zombies' ? -1 : 1;
      const moveAmount = state.moveSpeed * deltaSeconds;

      // Update col as a float for smooth movement
      const newCol = state.col + direction * moveAmount;
      state.col = newCol;

      // Update sprite position
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

      // WalnutBomb doesn't attack
      if (state.key === 'walnutBomb') continue;

      const target = this.combatManager.findTarget(state, allStates);

      const projectileKey = UNIT_PROJECTILE_MAP[state.key];
      if (projectileKey && state.range > 1) {
        // Ranged units always fire toward the enemy base, even without a target
        // This allows projectiles to reach and damage the base
        state.recordAttack(time);
        this.fireProjectile(state, projectileKey);
      } else if (target) {
        // Melee attack — only if there's an adjacent target
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
    sprite.setDisplaySize(16, 16); // Scale down projectile PNGs

    this.projectiles.push({
      sprite,
      config,
      row: attacker.row,
    });
  }

  private updateProjectiles(delta: number, time: number): void {
    const deltaSeconds = delta / 1000;
    const toRemove: number[] = [];

    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      const direction = proj.config.faction === 'plants' ? 1 : -1;
      const moveX = proj.config.speed * deltaSeconds * direction;
      proj.sprite.x += moveX;

      // Check collision with enemy units in the same row
      let hit = false;
      for (const unit of this.units) {
        if (!unit.state.isAlive()) continue;
        if (unit.state.faction === proj.config.faction) continue;
        if (unit.state.row !== proj.row) continue;

        const unitPixel = this.gridManager.toPixel(unit.state.row, unit.state.col);
        const dist = Math.abs(proj.sprite.x - unitPixel.x);

        if (dist < TILE_SIZE / 2) {
          // Skeleton Warrior projectile blocking
          if (unit.state.key === 'skeletonWarrior') {
            const lastBlock = this.skeletonBlockTimers.get(unit.state.id) ?? -Infinity;
            if (time - lastBlock >= SKELETON_BLOCK_COOLDOWN) {
              this.skeletonBlockTimers.set(unit.state.id, time);
              // Block the projectile — destroy it without dealing damage
              toRemove.push(i);
              hit = true;
              break;
            }
          }

          // Deal damage
          unit.state.takeDamage(proj.config.damage);
          toRemove.push(i);
          hit = true;
          break;
        }
      }

      if (hit) continue;

      // Check if projectile has left the field — damage base
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

    // Remove projectiles in reverse order
    const uniqueRemove = [...new Set(toRemove)].sort((a, b) => b - a);
    for (const idx of uniqueRemove) {
      this.projectiles[idx].sprite.destroy();
      this.projectiles.splice(idx, 1);
    }
  }

  private checkBaseDamage(): void {
    for (const unit of this.units) {
      if (!unit.state.isAlive()) continue;
      if (unit.state.isStationary()) continue;

      // Zombies reaching the left edge damage plant base
      if (unit.state.faction === 'zombies' && unit.state.col <= 0) {
        this.plantBaseHp -= unit.state.damage;
        unit.state.takeDamage(unit.state.hp); // Kill the unit
      }
      // Plants reaching the right edge damage zombie base (future-proofing)
      if (unit.state.faction === 'plants' && unit.state.col >= GRID_COLS - 1) {
        this.zombieBaseHp -= unit.state.damage;
        unit.state.takeDamage(unit.state.hp);
      }
    }
  }

  private cleanupDeadUnits(): void {
    const deadUnits = this.units.filter(u => !u.state.isAlive());

    for (const dead of deadUnits) {
      // WalnutBomb explosion on death
      if (dead.state.key === 'walnutBomb') {
        this.walnutExplosion(dead.state);
      }

      // Energy reward for killing enemy units
      if (dead.state.faction !== this.playerFaction) {
        this.energyManager.addKillReward(ENERGY_KILL_REWARD);
      }

      // Remove from grid
      if (dead.state.isStationary()) {
        this.gridManager.remove(dead.state.row, Math.round(dead.state.col));
      }

      // Clean up skeleton block timer
      this.skeletonBlockTimers.delete(dead.state.id);

      // Destroy visuals
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
    this.add.text(plantBaseX - 20, GRID_OFFSET_Y - 30, 'PLANT\nBASE', {
      fontSize: '12px', color: '#00cc00', align: 'center',
    });

    const zombieBaseX = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + TILE_SIZE / 2 + 10;
    for (let row = 0; row < GRID_ROWS; row++) {
      const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
      this.add.sprite(zombieBaseX, y, 'base').setTint(0x884488);
    }
    this.add.text(zombieBaseX - 20, GRID_OFFSET_Y - 30, 'ZOMBIE\nBASE', {
      fontSize: '12px', color: '#884488', align: 'center',
    });
  }
}
