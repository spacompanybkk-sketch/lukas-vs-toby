import { Scene, GameObjects } from 'phaser';
import { PALETTE } from './palette';

export class HealthBar {
  private bar: GameObjects.Graphics;
  private x: number;
  private y: number;
  private width: number;
  private height: number;

  constructor(scene: Scene, x: number, y: number, width: number = 40, height: number = 6) {
    this.bar = scene.add.graphics();
    this.bar.setDepth(8);
    this.x = x; this.y = y; this.width = width; this.height = height;
  }

  update(current: number, max: number): void {
    this.bar.clear();
    const ratio = Math.max(0, current / max);
    const left = this.x - this.width / 2;

    // Black border background
    this.bar.fillStyle(0x000000);
    this.bar.fillRect(left - 1, this.y - 1, this.width + 2, this.height + 2);

    // Dark fill background
    this.bar.fillStyle(0x331111);
    this.bar.fillRect(left, this.y, this.width, this.height);

    // Color based on ratio: green > 50%, amber 25-50%, red < 25%
    let fillColor = PALETTE.hpGreen;
    if (ratio <= 0.25) fillColor = PALETTE.hpRed;
    else if (ratio <= 0.5) fillColor = PALETTE.hpAmber;

    // Health fill
    this.bar.fillStyle(fillColor);
    this.bar.fillRect(left, this.y, this.width * ratio, this.height);

    // 1px white shine at top
    this.bar.fillStyle(0xffffff, 0.3);
    this.bar.fillRect(left, this.y, this.width * ratio, 1);
  }

  setPosition(x: number, y: number): void { this.x = x; this.y = y; }
  destroy(): void { this.bar.destroy(); }
}
