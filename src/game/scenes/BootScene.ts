import { Scene } from 'phaser';
import { TILE_SIZE } from '../constants';
import { gameOptions } from '../main';

export class BootScene extends Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    // Load AI-generated PNG sprites — Plants
    this.load.image('peashooter', '/assets/sprites/peashooter.png');
    this.load.image('sunflower', '/assets/sprites/sunflower.png');
    this.load.image('walnutBomb', '/assets/sprites/walnutBomb.png');
    this.load.image('potatoMine', '/assets/sprites/potatoMine.png');
    this.load.image('cherryBomber', '/assets/sprites/cherryBomber.png');
    this.load.image('avocadoBunker', '/assets/sprites/avocadoBunker.png');
    this.load.image('mangoPult', '/assets/sprites/mangoPult.png');
    this.load.image('kernelPult', '/assets/sprites/kernelPult.png');
    this.load.image('pumpkinSquash', '/assets/sprites/pumpkinSquash.png');
    this.load.image('torchwood', '/assets/sprites/torchwood.png');

    // Zombies
    this.load.image('brainEater', '/assets/sprites/brainEater.png');
    this.load.image('veryFastWalker', '/assets/sprites/veryFastWalker.png');
    this.load.image('skeletonWarrior', '/assets/sprites/skeletonWarrior.png');
    this.load.image('skeletonArcher', '/assets/sprites/skeletonArcher.png');
    this.load.image('necromancer', '/assets/sprites/necromancer.png');
    this.load.image('hotTopic', '/assets/sprites/hotTopic.png');
    this.load.image('tridentZombie', '/assets/sprites/tridentZombie.png');
    this.load.image('desertZombie', '/assets/sprites/desertZombie.png');
    this.load.image('cowboyZombie', '/assets/sprites/cowboyZombie.png');
    this.load.image('brainRot', '/assets/sprites/brainRot.png');

    // Load level-up evolution sprites (L2-L5 for all units)
    const allUnitKeys = [
      'peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'cherryBomber',
      'avocadoBunker', 'mangoPult', 'kernelPult', 'pumpkinSquash', 'torchwood',
      'brainEater', 'veryFastWalker', 'skeletonWarrior', 'skeletonArcher',
      'necromancer', 'hotTopic', 'tridentZombie', 'desertZombie', 'cowboyZombie', 'brainRot',
    ];
    for (const unitKey of allUnitKeys) {
      for (let lvl = 2; lvl <= 5; lvl++) {
        this.load.image(`${unitKey}-L${lvl}`, `/assets/sprites/${unitKey}-L${lvl}.png`);
      }
    }

    // Projectiles
    this.load.image('pea', '/assets/sprites/pea.png');
    this.load.image('kernel', '/assets/sprites/kernel.png');
    this.load.image('brain', '/assets/sprites/brain.png');
    this.load.image('mango', '/assets/sprites/mango.png');
    this.load.image('butter', '/assets/sprites/butter.png');
    this.load.image('boneArrow', '/assets/sprites/boneArrow.png');
    this.load.image('trident', '/assets/sprites/trident.png');
    this.load.image('rotBrain', '/assets/sprites/rotBrain.png');
    this.load.image('sand', '/assets/sprites/sand.png');

    // Load base images if they exist, otherwise will use procedural fallback
    this.load.image('plantBase', '/assets/bases/plant-base.png');
    this.load.image('zombieBase', '/assets/bases/zombie-base.png');

    // Load tile images
    this.load.image('tileImg', '/assets/tiles/grass-light.png');
    this.load.image('tileDarkImg', '/assets/tiles/grass-dark.png');

    // Load effects
    this.load.image('explosion', '/assets/effects/explosion.png');
    this.load.image('healEffect', '/assets/effects/heal.png');
    this.load.image('shieldBlock', '/assets/effects/shield-block.png');

    // Load game over backgrounds
    this.load.image('plantsWinBg', '/assets/gameover/plants-win.png');
    this.load.image('zombiesWinBg', '/assets/gameover/zombies-win.png');

    // Load battlefield background
    this.load.image('battlefield', '/assets/bg/battlefield.png');

    // Load VS splash
    this.load.image('vsSplash', '/assets/portraits/vs-splash.png');

    // UI frames and coins
    this.load.image('cardFramePlant', '/assets/ui/card-frame-plant.png');
    this.load.image('cardFrameZombie', '/assets/ui/card-frame-zombie.png');
    this.load.image('coinLukie', '/assets/ui/coin-lukie.png');
    this.load.image('coinToby', '/assets/ui/coin-toby.png');

    // Logo
    this.load.image('logo', '/assets/landing/logo.png');
  }

  create(): void {
    // Generate procedural fallback textures for tiles and bases
    // (in case PNGs haven't been generated yet)
    this.createFallbackTextures();

    if (gameOptions.mode === 'multiplayer') {
      this.scene.start('MultiplayerBattleScene');
    } else {
      // 'ai', 'freeplay', and 'campaign' all use BattleScene
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
