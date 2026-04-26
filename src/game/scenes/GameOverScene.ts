import { Scene, GameObjects } from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, CAMPAIGN_LEVELS, LOSS_REWARD_PERCENT, UNIT_UNLOCK_LEVELS } from '../constants';
import { PALETTE, FONT_HEADING, FONT_NUMERIC } from '../ui/palette';
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
    const won = data.campaign ? data.campaignWin! : isPlantWin === (gameOptions.faction === 'plants');

    // Radial gradient background
    if (won) {
      this.cameras.main.setBackgroundColor('#4D2F18');
      const glow = this.add.graphics();
      glow.fillStyle(0xFFE9A8, 0.3);
      glow.fillCircle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 300);
    } else {
      this.cameras.main.setBackgroundColor('#0F0419');
      const glow = this.add.graphics();
      glow.fillStyle(PALETTE.zombiePurple, 0.2);
      glow.fillCircle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 300);
    }

    // Confetti particles
    const confettiColors = won
      ? [0xFFD23F, 0x7FBE26, 0xE63946, 0xF0DCA8]
      : [0x7E3FBC, 0x5A2B7A, 0xB270E0, 0x3E1F66];
    for (let i = 0; i < 24; i++) {
      const confetti = this.add.graphics();
      const color = confettiColors[i % confettiColors.length];
      confetti.fillStyle(color, 0.7);
      confetti.fillRect(-6, -6, 12, 12);
      confetti.setPosition(
        Math.random() * GAME_WIDTH,
        -20 - Math.random() * GAME_HEIGHT
      );
      confetti.setAngle(Math.random() * 360);

      this.tweens.add({
        targets: confetti,
        y: GAME_HEIGHT + 20,
        angle: confetti.angle + (Math.random() - 0.5) * 360,
        duration: 2000 + Math.random() * 2000,
        repeat: -1,
        ease: 'Linear',
      });
    }

    if (data.campaign && data.campaignLevel !== undefined) {
      this.showCampaignResult(data, won);
    } else if (data.freeplay) {
      this.showFreeplayResult(data, won);
    } else {
      this.showAiResult(data, won);
    }
  }

  private showFreeplayResult(data: GameOverData, won: boolean): void {
    const title = won ? 'VICTORY!' : 'DEFEAT!';
    const titleColor = won ? '#FFD23F' : '#E63946';

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, title, {
      fontFamily: FONT_HEADING,
      fontSize: '48px',
      color: titleColor,
      stroke: '#1A1410',
      strokeThickness: 4,
    }).setOrigin(0.5);

    const subtitle = won ? 'THE LAWN IS SAFE.' : `You survived ${data.waves || 0} waves!`;
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, subtitle, {
      fontFamily: FONT_HEADING,
      fontSize: '12px',
      color: '#F4EFE2',
      letterSpacing: 2,
    }).setOrigin(0.5);

    // Hero sprite
    const heroKey = won ? 'peashooter-L5' : 'brainEater';
    if (this.textures.exists(heroKey)) {
      const hero = this.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, heroKey)
        .setDisplaySize(120, 120);
      this.tweens.add({
        targets: hero, y: hero.y - 5, duration: 1200,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    this.createButtons(won, false);
  }

  private showAiResult(data: GameOverData, won: boolean): void {
    const isPlantWin = data.winner === 'plants';
    const title = isPlantWin ? 'PLANTS WIN!' : 'ZOMBIES WIN!';
    const titleColor = won ? '#FFD23F' : '#E63946';

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, title, {
      fontFamily: FONT_HEADING,
      fontSize: '40px',
      color: titleColor,
      stroke: '#1A1410',
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.createButtons(won, false);
  }

  private showCampaignResult(data: GameOverData, won: boolean): void {
    const levelNum = data.campaignLevel!;
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
    const title = won ? 'VICTORY!' : 'DEFEAT!';
    const titleColor = won ? '#FFD23F' : '#E63946';
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 110, title, {
      fontFamily: FONT_HEADING,
      fontSize: '48px',
      color: titleColor,
      stroke: '#1A1410',
      strokeThickness: 4,
    }).setOrigin(0.5);

    const subtitle = won ? 'THE LAWN IS SAFE.' : 'THE BRAINS ARE EATEN.';
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, subtitle, {
      fontFamily: FONT_HEADING,
      fontSize: '10px',
      color: '#F4EFE2',
      letterSpacing: 2,
    }).setOrigin(0.5);

    // Level name
    if (levelConfig) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 35, `Level ${levelNum}: ${levelConfig.name}`, {
        fontFamily: FONT_HEADING, fontSize: '9px', color: '#C9A66B',
      }).setOrigin(0.5);
    }

    // Toby Dollars earned — parchment card
    const cardW = 200;
    const cardH = 50;
    const cardX = GAME_WIDTH / 2 - cardW / 2;
    const cardY = GAME_HEIGHT / 2 - 10;
    const cardBg = this.add.graphics();
    cardBg.fillStyle(PALETTE.parchment, 0.9);
    cardBg.fillRoundedRect(cardX, cardY, cardW, cardH, 6);
    cardBg.lineStyle(2, PALETTE.woodDark);
    cardBg.strokeRoundedRect(cardX, cardY, cardW, cardH, 6);

    this.add.text(GAME_WIDTH / 2, cardY + 14, `+${earned} TOBY DOLLARS`, {
      fontFamily: FONT_HEADING, fontSize: '10px', color: '#4D2F18',
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, cardY + 34, `Balance: ${save.tobyDollars} TD`, {
      fontFamily: FONT_NUMERIC, fontSize: '16px', color: '#7A4F2A',
    }).setOrigin(0.5);

    // Newly unlocked units
    if (won) {
      const nextLevel = levelNum + 1;
      const newUnlocks = Object.entries(UNIT_UNLOCK_LEVELS)
        .filter(([, unlockAt]) => unlockAt === nextLevel)
        .map(([key]) => key);
      if (newUnlocks.length > 0) {
        this.add.text(GAME_WIDTH / 2, cardY + cardH + 14, `NEW UNLOCK: ${newUnlocks.join(', ')}`, {
          fontFamily: FONT_HEADING, fontSize: '9px', color: '#A4DC4A',
          stroke: '#1A1410', strokeThickness: 1,
        }).setOrigin(0.5);
      }
    }

    // Buttons
    const actionLabel = won ? 'NEXT LEVEL' : 'RETRY';
    const nextLevel = won ? Math.min(levelNum + 1, CAMPAIGN_LEVELS.length) : levelNum;

    this.createParchmentButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 90, actionLabel, won ? PALETTE.coinGold : PALETTE.hpRed, () => {
      if (won && levelNum >= CAMPAIGN_LEVELS.length) {
        window.location.href = `/lobby?player=${gameOptions.player}`;
        return;
      }
      gameOptions.level = nextLevel;
      this.scene.start('BattleScene');
    });

    this.createParchmentButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 140, 'MENU', PALETTE.parchment, () => {
      window.location.href = `/lobby?player=${gameOptions.player}`;
    });
  }

  private createButtons(won: boolean, isCampaign: boolean): void {
    this.createParchmentButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 110, 'PLAY AGAIN', PALETTE.coinGold, () => {
      this.scene.start('BattleScene');
    });

    this.createParchmentButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 160, 'MENU', PALETTE.parchment, () => {
      window.location.href = `/lobby?player=${gameOptions.player}`;
    });
  }

  private createParchmentButton(x: number, y: number, label: string, color: number, onClick: () => void): void {
    const w = 180;
    const h = 36;
    const bg = this.add.graphics();
    bg.fillStyle(color, 0.9);
    bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, 6);
    bg.lineStyle(3, PALETTE.woodDark);
    bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 6);

    const text = this.add.text(x, y, label, {
      fontFamily: FONT_HEADING,
      fontSize: '11px',
      color: '#1A1410',
    }).setOrigin(0.5).setInteractive();

    const hitArea = this.add.rectangle(x, y, w, h).setInteractive();
    hitArea.on('pointerover', () => bg.setAlpha(0.7));
    hitArea.on('pointerout', () => bg.setAlpha(1));
    hitArea.on('pointerdown', onClick);
  }
}
