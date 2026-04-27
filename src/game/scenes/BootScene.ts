import { Scene, GameObjects } from 'phaser';
import { TILE_SIZE, GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { PALETTE, FONT_HEADING, FONT_NUMERIC } from '../ui/palette';
import { gameOptions } from '../main';

export class BootScene extends Scene {
  private progressBar!: GameObjects.Graphics;
  private progressBox!: GameObjects.Graphics;
  private loadingText!: GameObjects.Text;
  private percentText!: GameObjects.Text;
  private assetText!: GameObjects.Text;

  constructor() {
    super('BootScene');
  }

  preload(): void {
    // ── Loading screen ──────────────────────────────────────────
    const centerX = GAME_WIDTH / 2;
    const centerY = GAME_HEIGHT / 2;
    const barW = 320;
    const barH = 30;

    // Dark background
    this.cameras.main.setBackgroundColor('#0a0a1a');

    // Progress box (border)
    this.progressBox = this.add.graphics();
    this.progressBox.fillStyle(PALETTE.woodDark, 0.8);
    this.progressBox.fillRoundedRect(centerX - barW / 2 - 4, centerY - barH / 2 - 4, barW + 8, barH + 8, 6);
    this.progressBox.lineStyle(2, PALETTE.parchment, 0.6);
    this.progressBox.strokeRoundedRect(centerX - barW / 2 - 4, centerY - barH / 2 - 4, barW + 8, barH + 8, 6);

    // Progress bar (fills up)
    this.progressBar = this.add.graphics();

    // Title
    this.loadingText = this.add.text(centerX, centerY - 60, 'LOADING', {
      fontFamily: FONT_HEADING,
      fontSize: '18px',
      color: '#F0DCA8',
    }).setOrigin(0.5);

    // Percentage
    this.percentText = this.add.text(centerX, centerY, '0%', {
      fontFamily: FONT_NUMERIC,
      fontSize: '28px',
      color: '#FFD23F',
    }).setOrigin(0.5);

    // Current asset name
    this.assetText = this.add.text(centerX, centerY + 50, '', {
      fontFamily: FONT_HEADING,
      fontSize: '8px',
      color: '#C9A66B',
    }).setOrigin(0.5);

    // Loading dots animation
    let dots = 0;
    const dotTimer = this.time.addEvent({
      delay: 400,
      callback: () => {
        dots = (dots + 1) % 4;
        this.loadingText.setText('LOADING' + '.'.repeat(dots));
      },
      loop: true,
    });

    // ── Progress events ─────────────────────────────────────────
    this.load.on('progress', (value: number) => {
      this.progressBar.clear();
      this.progressBar.fillStyle(PALETTE.coinGold);
      this.progressBar.fillRoundedRect(
        centerX - barW / 2, centerY - barH / 2,
        barW * value, barH, 4
      );
      // Shine highlight
      this.progressBar.fillStyle(0xffffff, 0.15);
      this.progressBar.fillRect(
        centerX - barW / 2, centerY - barH / 2,
        barW * value, barH / 3
      );
      this.percentText.setText(`${Math.round(value * 100)}%`);
    });

    this.load.on('fileprogress', (file: { key: string }) => {
      this.assetText.setText(file.key);
    });

    this.load.on('complete', () => {
      dotTimer.destroy();
      this.progressBar.destroy();
      this.progressBox.destroy();
      this.loadingText.destroy();
      this.percentText.destroy();
      this.assetText.destroy();
    });

    // ── Asset loading ───────────────────────────────────────────
    // Plants
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

    // Level-up evolution sprites (L2-L5 for all units)
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

    // Bases
    this.load.image('plantBase', '/assets/bases/plant-base.png');
    this.load.image('zombieBase', '/assets/bases/zombie-base.png');

    // Tiles
    this.load.image('tileImg', '/assets/tiles/grass-light.png');
    this.load.image('tileDarkImg', '/assets/tiles/grass-dark.png');

    // Effects
    this.load.image('explosion', '/assets/effects/explosion.png');
    this.load.image('healEffect', '/assets/effects/heal.png');
    this.load.image('shieldBlock', '/assets/effects/shield-block.png');

    // Game over backgrounds
    this.load.image('plantsWinBg', '/assets/gameover/plants-win.png');
    this.load.image('zombiesWinBg', '/assets/gameover/zombies-win.png');

    // Battlefield background
    this.load.image('battlefield', '/assets/bg/battlefield.png');

    // VS splash
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
    this.createFallbackTextures();

    if (gameOptions.mode === 'multiplayer') {
      this.scene.start('MultiplayerBattleScene');
    } else {
      this.scene.start('BattleScene');
    }
  }

  private createFallbackTextures(): void {
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
