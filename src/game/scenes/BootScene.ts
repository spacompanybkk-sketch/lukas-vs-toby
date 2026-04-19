import { Scene } from 'phaser';
import { TILE_SIZE } from '../constants';
import { gameOptions } from '../main';

export class BootScene extends Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    // Load AI-generated PNG sprites
    this.load.image('peashooter', '/assets/sprites/peashooter.png');
    this.load.image('sunflower', '/assets/sprites/sunflower.png');
    this.load.image('walnutBomb', '/assets/sprites/walnutBomb.png');
    this.load.image('brainEater', '/assets/sprites/brainEater.png');
    this.load.image('veryFastWalker', '/assets/sprites/veryFastWalker.png');
    this.load.image('skeletonWarrior', '/assets/sprites/skeletonWarrior.png');
    this.load.image('pea', '/assets/sprites/pea.png');
    this.load.image('kernel', '/assets/sprites/kernel.png');
    this.load.image('brain', '/assets/sprites/brain.png');

    // Load base images if they exist, otherwise will use procedural fallback
    this.load.image('plantBase', '/assets/bases/plant-base.png');
    this.load.image('zombieBase', '/assets/bases/zombie-base.png');

    // Load tile images if they exist
    this.load.image('tileImg', '/assets/tiles/grass-light.png');
    this.load.image('tileDarkImg', '/assets/tiles/grass-dark.png');
  }

  create(): void {
    // Generate procedural fallback textures for tiles and bases
    // (in case PNGs haven't been generated yet)
    this.createFallbackTextures();

    if (gameOptions.mode === 'multiplayer') {
      this.scene.start('MultiplayerBattleScene');
    } else {
      this.scene.start('BattleScene');
    }
  }

  private createFallbackTextures(): void {
    // Tile fallbacks (used if PNG tiles not loaded)
    if (!this.textures.exists('tile')) {
      const g1 = this.add.graphics();
      g1.fillStyle(0x3d6b3d, 0.6);
      g1.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g1.lineStyle(2, 0x4a8a4a, 0.5);
      g1.strokeRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
      g1.generateTexture('tile', TILE_SIZE, TILE_SIZE);
      g1.destroy();
    }

    if (!this.textures.exists('tileDark')) {
      const g2 = this.add.graphics();
      g2.fillStyle(0x2d5a2d, 0.6);
      g2.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g2.lineStyle(2, 0x3a7a3a, 0.5);
      g2.strokeRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
      g2.generateTexture('tileDark', TILE_SIZE, TILE_SIZE);
      g2.destroy();
    }

    // Base fallback
    if (!this.textures.exists('base')) {
      const g3 = this.add.graphics();
      g3.fillStyle(0x4444aa);
      g3.fillRect(4, 20, TILE_SIZE - 8, TILE_SIZE * 2 - 24);
      g3.fillRect(4, 12, 12, 8);
      g3.fillRect(24, 12, 12, 8);
      g3.fillRect(44, 12, 8, 8);
      g3.fillStyle(0x222266);
      g3.fillRect(20, TILE_SIZE * 2 - 24, 16, 20);
      g3.fillStyle(0x6666cc);
      g3.fillRect(12, 36, 8, 8);
      g3.fillRect(36, 36, 8, 8);
      g3.generateTexture('base', TILE_SIZE, TILE_SIZE * 2);
      g3.destroy();
    }
  }
}
