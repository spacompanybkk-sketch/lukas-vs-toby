import { Scene } from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, CAMPAIGN_LEVELS, LOSS_REWARD_PERCENT, UNIT_UNLOCK_LEVELS } from '../constants';
import { loadSave, saveSave } from '../SaveManager';
import { gameOptions } from '../main';

interface GameOverData {
  winner: 'plants' | 'zombies';
  freeplay?: boolean;
  waves?: number;
  campaign?: boolean;
  campaignLevel?: number;
  campaignWin?: boolean;
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

    if (data.campaign && data.campaignLevel !== undefined) {
      this.showCampaignResult(data);
    } else if (data.freeplay) {
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

    // Only show generic buttons for non-campaign modes
    if (!data.campaign) {
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

  private showCampaignResult(data: GameOverData): void {
    const levelNum = data.campaignLevel!;
    const won = data.campaignWin!;
    const levelConfig = CAMPAIGN_LEVELS.find(l => l.level === levelNum);
    const reward = levelConfig?.reward ?? 0;
    const earned = won ? reward : Math.floor(reward * LOSS_REWARD_PERCENT);

    // Update save data
    const save = loadSave(gameOptions.player);
    save.tobyDollars += earned;
    if (won && save.currentLevel === levelNum && levelNum < CAMPAIGN_LEVELS.length) {
      save.currentLevel = levelNum + 1;
    }
    saveSave(gameOptions.player, save);

    // Title
    const title = won ? 'Level Complete!' : 'Level Failed';
    const titleColor = won ? '#00ff66' : '#ff4444';
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, title, {
      fontSize: '48px', color: titleColor, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);

    // Level name
    if (levelConfig) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50, `Level ${levelNum}: ${levelConfig.name}`, {
        fontSize: '20px', color: '#cccccc',
      }).setOrigin(0.5);
    }

    // Toby Dollars earned
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `+${earned} Toby Dollars`, {
      fontSize: '28px', color: '#ffdd00', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, `Balance: ${save.tobyDollars} TD`, {
      fontSize: '16px', color: '#aaaaaa',
    }).setOrigin(0.5);

    // Show newly unlocked units
    if (won) {
      const nextLevel = levelNum + 1;
      const newUnlocks = Object.entries(UNIT_UNLOCK_LEVELS)
        .filter(([, unlockAt]) => unlockAt === nextLevel)
        .map(([key]) => key);
      if (newUnlocks.length > 0) {
        const names = newUnlocks.join(', ');
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 55, `NEW UNIT UNLOCKED: ${names}!`, {
          fontSize: '18px', color: '#00ffaa', fontStyle: 'bold',
          stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0.5);
      }
    }

    // Next Level / Retry button
    const actionLabel = won ? 'Next Level' : 'Retry';
    const nextLevel = won ? Math.min(levelNum + 1, CAMPAIGN_LEVELS.length) : levelNum;

    const actionBtn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 80, actionLabel, {
      fontSize: '28px', color: '#ffffff',
      backgroundColor: won ? '#226622' : '#662222',
      padding: { x: 24, y: 12 },
    }).setOrigin(0.5).setInteractive();

    actionBtn.on('pointerover', () => actionBtn.setStyle({ backgroundColor: won ? '#338833' : '#883333' }));
    actionBtn.on('pointerout', () => actionBtn.setStyle({ backgroundColor: won ? '#226622' : '#662222' }));
    actionBtn.on('pointerdown', () => {
      if (won && levelNum >= CAMPAIGN_LEVELS.length) {
        // Completed all levels — go to lobby
        window.location.href = `/lobby?player=${gameOptions.player}`;
        return;
      }
      gameOptions.level = nextLevel;
      this.scene.start('BattleScene');
    });

    // Back to Lobby button
    const backText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 150, 'Back to Lobby', {
      fontSize: '20px', color: '#aaaaaa',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive();

    backText.on('pointerover', () => backText.setStyle({ color: '#ffffff' }));
    backText.on('pointerout', () => backText.setStyle({ color: '#aaaaaa' }));
    backText.on('pointerdown', () => {
      window.location.href = `/lobby?player=${gameOptions.player}`;
    });
  }
}
