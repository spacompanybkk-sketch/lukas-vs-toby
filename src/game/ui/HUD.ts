import { Scene, GameObjects } from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';

export interface UnitCard {
  key: string;
  label: string;
  cost: number;
  textureKey: string;
}

export class HUD {
  private scene: Scene;
  private energyText!: GameObjects.Text;
  private cards: GameObjects.Container[] = [];

  constructor(scene: Scene, unitCards: UnitCard[], onCardDragStart: (key: string) => void) {
    this.scene = scene;
    this.createEnergyDisplay();
    this.createUnitBar(unitCards);
  }

  updateEnergy(energy: number): void {
    this.energyText.setText(`LukieCoins: ${energy}`);
  }

  private createEnergyDisplay(): void {
    this.energyText = this.scene.add.text(16, 16, 'LukieCoins: 0', {
      fontSize: '20px', color: '#ffcc00', fontStyle: 'bold',
    });
  }

  private createUnitBar(unitCards: UnitCard[]): void {
    // Adaptive sizing based on number of cards
    const count = unitCards.length;
    const maxWidth = GAME_WIDTH - 40;
    const cardSpacing = Math.min(100, Math.floor(maxWidth / count));
    const cardW = cardSpacing - 8;
    const cardH = 66;
    const previewSize = Math.min(40, cardW - 10);

    const barY = GAME_HEIGHT - 70;
    const totalWidth = count * cardSpacing;
    const startX = (GAME_WIDTH - totalWidth) / 2;

    unitCards.forEach((card, i) => {
      const x = startX + i * cardSpacing + cardSpacing / 2;
      const container = this.scene.add.container(x, barY);

      const bg = this.scene.add.graphics();
      bg.fillStyle(0x333333, 0.8);
      bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 6);
      container.add(bg);

      const preview = this.scene.add.sprite(0, -8, card.textureKey).setDisplaySize(previewSize, previewSize);
      container.add(preview);

      const costText = this.scene.add.text(0, cardH / 2 - 14, `${card.cost}`, {
        fontSize: '10px', color: '#ffcc00', align: 'center',
      }).setOrigin(0.5);
      container.add(costText);

      const hitArea = this.scene.add.rectangle(0, 0, cardW, cardH).setInteractive({ draggable: true });
      hitArea.setData('unitKey', card.key);
      container.add(hitArea);

      this.cards.push(container);
    });
  }
}
