import { Scene, GameObjects } from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { PALETTE, FONT_HEADING, FONT_NUMERIC } from './palette';

export interface UnitCard {
  key: string;
  label: string;
  cost: number;
  textureKey: string;
}

export class HUD {
  private scene: Scene;
  private energyValueText!: GameObjects.Text;
  private energyLabelText!: GameObjects.Text;
  private coinSprite?: GameObjects.Sprite;
  private waveText!: GameObjects.Text;
  private levelText!: GameObjects.Text;
  private cards: GameObjects.Container[] = [];

  constructor(scene: Scene, unitCards: UnitCard[], onCardDragStart: (key: string) => void) {
    this.scene = scene;
    this.createEnergyChip();
    this.createUnitBar(unitCards);
  }

  updateEnergy(energy: number): void {
    this.energyValueText.setText(`${energy}`);

    // Tint cards based on affordability
    for (const container of this.cards) {
      const cost = container.getData('cost') as number;
      const preview = container.getData('preview') as GameObjects.Sprite;
      const costText = container.getData('costText') as GameObjects.Text;
      const bg = container.getData('bg') as GameObjects.Graphics;
      if (energy >= cost) {
        preview?.clearTint();
        preview?.setAlpha(1);
        costText?.setColor('#FFD23F');
      } else {
        preview?.setTint(0x666666);
        preview?.setAlpha(0.7);
        costText?.setColor('#666666');
      }
    }
  }

  private createEnergyChip(): void {
    const chipX = 16;
    const chipY = 10;
    const chipW = 160;
    const chipH = 46;

    // Parchment background
    const bg = this.scene.add.graphics().setDepth(20);
    bg.fillStyle(PALETTE.parchment);
    bg.fillRoundedRect(chipX, chipY, chipW, chipH, 6);
    bg.lineStyle(3, PALETTE.woodDark);
    bg.strokeRoundedRect(chipX, chipY, chipW, chipH, 6);

    // Coin sprite with bob
    if (this.scene.textures.exists('coinLukie')) {
      this.coinSprite = this.scene.add.sprite(chipX + 26, chipY + chipH / 2, 'coinLukie')
        .setDisplaySize(30, 30).setDepth(21);
      this.scene.tweens.add({
        targets: this.coinSprite,
        y: this.coinSprite.y - 3,
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Label
    this.energyLabelText = this.scene.add.text(chipX + 46, chipY + 6, 'LUKIE COINS', {
      fontFamily: FONT_HEADING,
      fontSize: '7px',
      color: '#4D2F18',
    }).setDepth(21);

    // Value
    this.energyValueText = this.scene.add.text(chipX + 46, chipY + 20, '0', {
      fontFamily: FONT_NUMERIC,
      fontSize: '22px',
      color: '#1A1410',
    }).setDepth(21);
  }

  private createUnitBar(unitCards: UnitCard[]): void {
    const count = unitCards.length;
    const maxWidth = GAME_WIDTH - 20;
    const cardSpacing = Math.min(88, Math.floor(maxWidth / count));
    const cardW = cardSpacing - 6;
    const cardH = 100;
    const previewSize = Math.min(48, cardW - 8);

    const barY = GAME_HEIGHT - cardH / 2 - 16;
    const totalWidth = count * cardSpacing;
    const startX = (GAME_WIDTH - totalWidth) / 2;

    // Bar background
    const barBg = this.scene.add.graphics().setDepth(18);
    barBg.fillStyle(PALETTE.wood, 0.85);
    barBg.fillRoundedRect(startX - 10, barY - cardH / 2 - 6, totalWidth + 20, cardH + 12, 8);
    barBg.lineStyle(3, PALETTE.woodDark);
    barBg.strokeRoundedRect(startX - 10, barY - cardH / 2 - 6, totalWidth + 20, cardH + 12, 8);

    unitCards.forEach((card, i) => {
      const x = startX + i * cardSpacing + cardSpacing / 2;
      const container = this.scene.add.container(x, barY).setDepth(19);

      // Parchment card background
      const bg = this.scene.add.graphics();
      bg.fillStyle(PALETTE.parchment, 0.9);
      bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 4);
      bg.lineStyle(2, PALETTE.woodDark);
      bg.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 4);
      container.add(bg);

      // Sprite preview
      const preview = this.scene.add.sprite(0, -14, card.textureKey)
        .setDisplaySize(previewSize, previewSize);
      container.add(preview);

      // Cost text
      const costText = this.scene.add.text(0, cardH / 2 - 18, `${card.cost}`, {
        fontFamily: FONT_HEADING,
        fontSize: '9px',
        color: '#FFD23F',
        stroke: '#4D2F18',
        strokeThickness: 1,
      }).setOrigin(0.5);
      container.add(costText);

      // Hit area for dragging
      const hitArea = this.scene.add.rectangle(0, 0, cardW, cardH)
        .setInteractive({ draggable: true });
      hitArea.setData('unitKey', card.key);
      container.add(hitArea);

      // Store refs for affordability tinting
      container.setData('cost', card.cost);
      container.setData('preview', preview);
      container.setData('costText', costText);
      container.setData('bg', bg);

      this.cards.push(container);
    });
  }
}
