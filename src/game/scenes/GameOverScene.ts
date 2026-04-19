import { Scene } from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';

interface GameOverData {
  winner: 'plants' | 'zombies';
  freeplay?: boolean;
  waves?: number;
}

export class GameOverScene extends Scene {
  constructor() {
    super('GameOverScene');
  }

  create(data: GameOverData): void {
    const isPlantWin = data.winner === 'plants';
    const color = isPlantWin ? '#00cc00' : '#884488';

    // Background image
    const bgKey = isPlantWin ? 'plantsWinBg' : 'zombiesWinBg';
    if (this.textures.exists(bgKey)) {
      const bg = this.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, bgKey);
      bg.setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      bg.setAlpha(0.3);
    }

    if (data.freeplay) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, 'GAME OVER', {
        fontSize: '56px', color: '#ff4444', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5);

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, `You survived ${data.waves || 0} waves!`, {
        fontSize: '32px', color: '#ffaa00', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5);
    } else {
      const message = isPlantWin ? 'PLANTS WIN!' : 'ZOMBIES WIN!';
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, message, {
        fontSize: '56px', color, fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5);
    }

    const restartText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 50, 'Play Again', {
      fontSize: '28px', color: '#ffffff',
      backgroundColor: '#444444',
      padding: { x: 24, y: 12 },
    }).setOrigin(0.5).setInteractive();

    restartText.on('pointerover', () => restartText.setStyle({ backgroundColor: '#666666' }));
    restartText.on('pointerout', () => restartText.setStyle({ backgroundColor: '#444444' }));
    restartText.on('pointerdown', () => {
      this.scene.start('BattleScene');
    });

    const backText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 120, 'Back to Lobby', {
      fontSize: '20px', color: '#aaaaaa',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive();

    backText.on('pointerover', () => backText.setStyle({ color: '#ffffff' }));
    backText.on('pointerout', () => backText.setStyle({ color: '#aaaaaa' }));
    backText.on('pointerdown', () => {
      window.location.href = '/';
    });
  }
}
