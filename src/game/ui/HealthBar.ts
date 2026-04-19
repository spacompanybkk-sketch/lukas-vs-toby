import { Scene, GameObjects } from 'phaser';

export class HealthBar {
  private bar: GameObjects.Graphics;
  private x: number;
  private y: number;
  private width: number;
  private height: number;

  constructor(scene: Scene, x: number, y: number, width: number = 40, height: number = 6) {
    this.bar = scene.add.graphics();
    this.x = x; this.y = y; this.width = width; this.height = height;
  }

  update(current: number, max: number): void {
    this.bar.clear();
    const ratio = Math.max(0, current / max);
    this.bar.fillStyle(0xff0000);
    this.bar.fillRect(this.x - this.width / 2, this.y, this.width, this.height);
    this.bar.fillStyle(0x00ff00);
    this.bar.fillRect(this.x - this.width / 2, this.y, this.width * ratio, this.height);
  }

  setPosition(x: number, y: number): void { this.x = x; this.y = y; }
  destroy(): void { this.bar.destroy(); }
}
