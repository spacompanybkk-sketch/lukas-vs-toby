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
    const barY = GAME_HEIGHT - 80;
    const startX = GAME_WIDTH / 2 - (unitCards.length * 100) / 2;

    unitCards.forEach((card, i) => {
      const x = startX + i * 100 + 50;
      const container = this.scene.add.container(x, barY);

      const bg = this.scene.add.graphics();
      bg.fillStyle(0x333333, 0.8);
      bg.fillRoundedRect(-44, -36, 88, 76, 10);
      container.add(bg);

      const preview = this.scene.add.sprite(0, -10, card.textureKey).setDisplaySize(50, 50);
      container.add(preview);

      const costText = this.scene.add.text(0, 24, `${card.cost}`, {
        fontSize: '12px', color: '#ffcc00', align: 'center',
      }).setOrigin(0.5);
      container.add(costText);

      const hitArea = this.scene.add.rectangle(0, 0, 88, 76).setInteractive({ draggable: true });
      hitArea.setData('unitKey', card.key);
      container.add(hitArea);

      this.cards.push(container);
    });
  }
}
