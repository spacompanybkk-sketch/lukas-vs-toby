import { Scene } from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';

export class GameOverScene extends Scene {
  constructor() {
    super('GameOverScene');
  }

  create(data: { winner: 'plants' | 'zombies' }): void {
    const isPlantWin = data.winner === 'plants';
    const color = isPlantWin ? '#00cc00' : '#884488';
    const message = isPlantWin ? 'PLANTS WIN!' : 'ZOMBIES WIN!';

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, message, {
      fontSize: '48px', color, fontStyle: 'bold',
    }).setOrigin(0.5);

    const restartText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'Click to play again', {
      fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5).setInteractive();

    restartText.on('pointerdown', () => {
      this.scene.start('BattleScene');
    });

    const backText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 90, 'Back to Lobby', {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setInteractive();

    backText.on('pointerdown', () => {
      window.location.href = '/';
    });
  }
}
