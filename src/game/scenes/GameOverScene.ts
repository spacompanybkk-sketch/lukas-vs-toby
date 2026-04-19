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

    if (data.freeplay) {
      // Freeplay game over — show survival stats
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, 'GAME OVER', {
        fontSize: '48px', color: '#ff4444', fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, `You survived ${data.waves || 0} waves!`, {
        fontSize: '28px', color: '#ffaa00', fontStyle: 'bold',
      }).setOrigin(0.5);
    } else {
      const message = isPlantWin ? 'PLANTS WIN!' : 'ZOMBIES WIN!';
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, message, {
        fontSize: '48px', color, fontStyle: 'bold',
      }).setOrigin(0.5);
    }

    const restartText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'Play Again', {
      fontSize: '24px', color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive();

    restartText.on('pointerdown', () => {
      this.scene.start('BattleScene');
    });

    const backText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 100, 'Back to Lobby', {
      fontSize: '18px', color: '#aaaaaa',
    }).setOrigin(0.5).setInteractive();

    backText.on('pointerdown', () => {
      window.location.href = '/';
    });
  }
}
