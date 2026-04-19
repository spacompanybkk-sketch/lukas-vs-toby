import { Scene } from 'phaser';
import { GRID_ROWS, GRID_COLS, TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y, GAME_WIDTH, BASE_HP, STARTING_ENERGY } from '../constants';
import { GridManager } from '../systems/GridManager';

export class BattleScene extends Scene {
  private gridManager!: GridManager;

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.gridManager = new GridManager();
    this.drawGrid();
    this.drawBases();
  }

  update(time: number, delta: number): void {
    // Will be filled in Task 15
  }

  private drawGrid(): void {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const { x, y } = this.gridManager.toPixel(row, col);
        const tileKey = (row + col) % 2 === 0 ? 'tile' : 'tileDark';
        this.add.sprite(x, y, tileKey);
      }
    }
  }

  private drawBases(): void {
    const plantBaseX = GRID_OFFSET_X - TILE_SIZE / 2 - 10;
    for (let row = 0; row < GRID_ROWS; row++) {
      const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
      this.add.sprite(plantBaseX, y, 'base').setTint(0x00cc00);
    }
    this.add.text(plantBaseX - 20, GRID_OFFSET_Y - 30, 'PLANT\nBASE', {
      fontSize: '12px', color: '#00cc00', align: 'center',
    });

    const zombieBaseX = GRID_OFFSET_X + GRID_COLS * TILE_SIZE + TILE_SIZE / 2 + 10;
    for (let row = 0; row < GRID_ROWS; row++) {
      const y = GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2;
      this.add.sprite(zombieBaseX, y, 'base').setTint(0x884488);
    }
    this.add.text(zombieBaseX - 20, GRID_OFFSET_Y - 30, 'ZOMBIE\nBASE', {
      fontSize: '12px', color: '#884488', align: 'center',
    });
  }
}
