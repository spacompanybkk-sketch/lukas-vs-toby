import { Scene, GameObjects, Physics } from 'phaser';
import * as Phaser from 'phaser';
import {
  GRID_ROWS, GRID_COLS, TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y,
  GAME_WIDTH, GAME_HEIGHT, BASE_HP, STARTING_ENERGY,
  ENERGY_TICK_INTERVAL, ENERGY_TICK_AMOUNT, ENERGY_KILL_REWARD,
  UNIT_COSTS, CAMPAIGN_LEVELS, LOSS_REWARD_PERCENT,
} from '../constants';
import { GridManager } from '../systems/GridManager';
import { EnergyManager } from '../systems/EnergyManager';
import { CombatManager } from '../systems/CombatManager';
import { WaveManager, type WaveManagerOptions } from '../systems/WaveManager';
import { DragDropManager } from '../systems/DragDropManager';
import { HUD } from '../ui/HUD';
import type { UnitCard } from '../ui/HUD';
import { HealthBar } from '../ui/HealthBar';
import { UnitState } from '../entities/Unit';
import { PROJECTILE_CONFIGS } from '../entities/Projectile';
import type { ProjectileConfig } from '../entities/Projectile';
// Plant imports
import { createPeashooter, PEASHOOTER_PROJECTILE } from '../entities/plants/Peashooter';
import { createSunflower, SUNFLOWER_PROJECTILE, SUNFLOWER_ENERGY_INTERVAL, SUNFLOWER_ENERGY_AMOUNT } from '../entities/plants/Sunflower';
import { createWalnutBomb, WALNUT_EXPLOSION_RADIUS, WALNUT_EXPLOSION_DAMAGE } from '../entities/plants/WalnutBomb';
import { createPotatoMine, POTATO_MINE_EXPLOSION_DAMAGE, POTATO_MINE_EXPLOSION_RADIUS } from '../entities/plants/PotatoMine';
import { createCherryBomber, CHERRY_EXPLOSION_DAMAGE, CHERRY_EXPLOSION_RADIUS } from '../entities/plants/CherryBomber';
import { createAvocadoBunker } from '../entities/plants/AvocadoBunker';
import { createMangoPult, MANGO_PROJECTILE } from '../entities/plants/MangoPult';
import { createKernelPult, KERNEL_PULT_PROJECTILE } from '../entities/plants/KernelPult';
import { createPumpkinSquash } from '../entities/plants/PumpkinSquash';
import { createTorchwood, TORCH_DAMAGE_MULTIPLIER } from '../entities/plants/Torchwood';
// Zombie imports
import { createBrainEater, BRAIN_EATER_PROJECTILE } from '../entities/zombies/BrainEater';
import { createVeryFastWalker } from '../entities/zombies/VeryFastWalker';
import { createSkeletonWarrior, SKELETON_BLOCK_COOLDOWN } from '../entities/zombies/SkeletonWarrior';
import { createSkeletonArcher, BONE_ARROW_PROJECTILE } from '../entities/zombies/SkeletonArcher';
import { createNecromancer, NECRO_HEAL_AMOUNT, NECRO_HEAL_INTERVAL } from '../entities/zombies/Necromancer';
import { createHotTopic, HP_GAIN_PER_EAT, DAMAGE_GAIN_PER_EAT } from '../entities/zombies/HotTopic';
import { createTridentZombie, TRIDENT_PROJECTILE } from '../entities/zombies/TridentZombie';
import { createDesertZombie, SAND_PROJECTILE } from '../entities/zombies/DesertZombie';
import { createCowboyZombie, COWBOY_PROJECTILE } from '../entities/zombies/CowboyZombie';
import { createBrainRot, ROT_BRAIN_PROJECTILE } from '../entities/zombies/BrainRot';

import type { Faction } from '../types';
import { getPlayerFaction, gameOptions } from '../main';
import { loadSave, saveSave, getUpgradeMultipliers } from '../SaveManager';

/** Projectile type mapping per unit key */
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

/** Factory mapping */
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
  private isCampaign: boolean = false;
  private campaignLevel: number = 0;
  private waveText!: GameObjects.Text;
  private levelText!: GameObjects.Text;

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
    this.isCampaign = gameOptions.mode === 'campaign';
    this.campaignLevel = gameOptions.level ?? 1;
    this.playerFaction = getPlayerFaction();

    // Campaign: override base HP from level config
    const levelConfig = this.isCampaign
      ? CAMPAIGN_LEVELS.find(l => l.level === this.campaignLevel)
      : undefined;
    if (this.isCampaign && levelConfig) {
      this.plantBaseHp = levelConfig.baseHp;
      this.zombieBaseHp = levelConfig.baseHp;
    }

    // Systems
    this.gridManager = new GridManager();
    this.energyManager = new EnergyManager(STARTING_ENERGY);
    this.combatManager = new CombatManager();

    // Draw battlefield
    this.drawGrid();
    this.drawBases();

    // HUD — show unit cards for the player's faction
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

    // Wave manager (AI spawns the opposing faction)
    const aiFaction: Faction = this.playerFaction === 'plants' ? 'zombies' : 'plants';
    const waveOptions: WaveManagerOptions | undefined = this.isCampaign && levelConfig
      ? { interval: levelConfig.waveInterval, firstDelay: levelConfig.firstDelay, maxWaves: levelConfig.maxWaves }
      : undefined;
    this.waveManager = new WaveManager(aiFaction, (unitKey, row) => {
      if (aiFaction === 'zombies') {
        // Zombies always spawn on the rightmost column
        this.spawnUnit(unitKey, row, GRID_COLS - 1, aiFaction);
      } else {
        // AI plants spawn on a random column (plants can go anywhere)
        const col = Math.floor(Math.random() * GRID_COLS);
        this.spawnUnit(unitKey, row, col, aiFaction);
      }
    }, waveOptions);

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
    const maxBaseHp = this.isCampaign && levelConfig ? levelConfig.baseHp : BASE_HP;
    this.plantBaseBar = new HealthBar(this, plantBaseX, barY, 60, 8);
    this.plantBaseBar.update(this.plantBaseHp, maxBaseHp);
    this.zombieBaseBar = new HealthBar(this, zombieBaseX, barY, 60, 8);
    this.zombieBaseBar.update(this.zombieBaseHp, maxBaseHp);

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

    // Wave counter (visible in all modes, prominent in freeplay/campaign)
    const waveStyle = this.isFreeplay || this.isCampaign;
    this.waveText = this.add.text(GAME_WIDTH / 2, 16, '', {
      fontSize: waveStyle ? '20px' : '14px',
      color: waveStyle ? '#ffaa00' : '#888888',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    // Level name for campaign
    this.levelText = this.add.text(GAME_WIDTH / 2, 40, '', {
      fontSize: '12px', color: '#ffaa00',
    }).setOrigin(0.5, 0);

    if (this.isFreeplay) {
      this.levelText.setText('FREE PLAY — Survive!');
    } else if (this.isCampaign && levelConfig) {
      this.levelText.setText(`Level ${levelConfig.level}: ${levelConfig.name}`);
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
    const currentMaxBaseHp = this.isCampaign
      ? (CAMPAIGN_LEVELS.find(l => l.level === this.campaignLevel)?.baseHp ?? BASE_HP)
      : BASE_HP;
    this.hud.updateEnergy(this.energyManager.getEnergy());
    this.plantBaseBar.update(this.plantBaseHp, currentMaxBaseHp);
    this.zombieBaseBar.update(this.zombieBaseHp, currentMaxBaseHp);

    // Update unit health bars
    for (const unit of this.units) {
      if (unit.state.isAlive()) {
        const { x, y } = this.gridManager.toPixel(unit.state.row, unit.state.col);
        unit.healthBar.setPosition(x, y - TILE_SIZE / 2 - 4);
        unit.healthBar.update(unit.state.hp, unit.state.maxHp);
      }
    }

    // 10. Wave counter update
    const maxWaves = this.waveManager.getMaxWaves();
    if (maxWaves !== undefined) {
      this.waveText.setText(`Wave: ${this.waveManager.getWaveCount()}/${maxWaves}`);
    } else {
      this.waveText.setText(`Wave: ${this.waveManager.getWaveCount()}`);
    }

    // 11. Win condition
    if (this.isCampaign) {
      const playerBaseHp = this.playerFaction === 'plants' ? this.plantBaseHp : this.zombieBaseHp;
      const enemyBaseHp = this.playerFaction === 'plants' ? this.zombieBaseHp : this.plantBaseHp;

      // Player loses if their base is destroyed
      if (playerBaseHp <= 0) {
        this.gameOver = true;
        this.scene.start('GameOverScene', {
          winner: this.playerFaction === 'plants' ? 'zombies' : 'plants',
          campaign: true,
          campaignLevel: this.campaignLevel,
          campaignWin: false,
        });
        return;
      }

      // Player wins if enemy base destroyed OR all waves spawned and no enemy units alive
      const enemyBaseDead = enemyBaseHp <= 0;
      const allWavesDone = this.waveManager.areAllWavesSpawned();
      const noEnemyUnits = !this.units.some(u =>
        u.state.isAlive() && u.state.faction !== this.playerFaction
      );

      if (enemyBaseDead || (allWavesDone && noEnemyUnits)) {
        this.gameOver = true;
        this.scene.start('GameOverScene', {
          winner: this.playerFaction,
          campaign: true,
          campaignLevel: this.campaignLevel,
          campaignWin: true,
        });
      }
    } else if (this.isFreeplay) {
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

    // Apply campaign upgrades for the player's units
    if (this.isCampaign && faction === this.playerFaction) {
      const save = loadSave(gameOptions.player);
      const upgradeLevel = save.upgrades[unitKey] ?? 0;
      if (upgradeLevel > 0) {
        const { hpMult, damageMult } = getUpgradeMultipliers(upgradeLevel);
        unitState.applyUpgrade(hpMult, damageMult);
      }
    }

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

      // Update col as a float for smooth movement, clamp to grid bounds
      const newCol = state.col + direction * moveAmount;
      state.col = Math.max(0, Math.min(GRID_COLS - 1, newCol));

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
    sprite.setDisplaySize(20, 20); // Scale down projectile PNGs

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
              this.showBlockEffect(unitPixel.x, unitPixel.y);
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
    const time = this.time?.now ?? 0;

    for (const unit of this.units) {
      if (!unit.state.isAlive()) continue;
      if (unit.state.isStationary()) continue;

      // Zombies reaching the left edge — stay and attack the plant base
      if (unit.state.faction === 'zombies' && unit.state.col <= 0) {
        unit.state.col = 0; // Clamp position at the base
        if (unit.state.canAttack(time)) {
          unit.state.recordAttack(time);
          this.plantBaseHp -= unit.state.damage;
        }
      }
      // Plants reaching the right edge — stay and attack the zombie base
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
      // WalnutBomb explosion on death
      if (dead.state.key === 'walnutBomb') {
        this.walnutExplosion(dead.state);
        const { x, y } = this.gridManager.toPixel(dead.state.row, dead.state.col);
        this.showExplosion(x, y);
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
    // Battlefield background
    if (this.textures.exists('battlefield')) {
      const bg = this.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'battlefield');
      bg.setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      bg.setAlpha(0.15);
    }

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const { x, y } = this.gridManager.toPixel(row, col);
        // Use AI-generated tile images if available, fallback to procedural
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

    // Plant base — use AI image if available
    if (this.textures.exists('plantBase')) {
      const pb = this.add.sprite(plantBaseX, baseCenterY, 'plantBase');
      pb.setDisplaySize(TILE_SIZE + 10, baseHeight);
    } else {
      for (let row = 0; row < GRID_ROWS; row++) {
        const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
        this.add.sprite(plantBaseX, y, 'base').setTint(0x00cc00);
      }
    }
    this.add.text(plantBaseX, GRID_OFFSET_Y - 20, 'PLANT BASE', {
      fontSize: '11px', color: '#00cc00', align: 'center', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Zombie base — use AI image if available
    if (this.textures.exists('zombieBase')) {
      const zb = this.add.sprite(zombieBaseX, baseCenterY, 'zombieBase');
      zb.setDisplaySize(TILE_SIZE + 10, baseHeight);
    } else {
      for (let row = 0; row < GRID_ROWS; row++) {
        const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
        this.add.sprite(zombieBaseX, y, 'base').setTint(0x884488);
      }
    }
    this.add.text(zombieBaseX, GRID_OFFSET_Y - 20, 'ZOMBIE BASE', {
      fontSize: '11px', color: '#884488', align: 'center', fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  /** Show explosion effect at a position */
  private showExplosion(x: number, y: number): void {
    if (!this.textures.exists('explosion')) return;
    const fx = this.add.sprite(x, y, 'explosion');
    fx.setDisplaySize(TILE_SIZE * 1.5, TILE_SIZE * 1.5);
    fx.setAlpha(0.9);
    this.tweens.add({
      targets: fx,
      alpha: 0,
      scale: 1.5,
      duration: 500,
      onComplete: () => fx.destroy(),
    });
  }

  /** Show shield block effect */
  private showBlockEffect(x: number, y: number): void {
    if (!this.textures.exists('shieldBlock')) return;
    const fx = this.add.sprite(x, y, 'shieldBlock');
    fx.setDisplaySize(TILE_SIZE, TILE_SIZE);
    fx.setAlpha(0.8);
    this.tweens.add({
      targets: fx,
      alpha: 0,
      y: y - 20,
      duration: 400,
      onComplete: () => fx.destroy(),
    });
  }
}
