import { Scene } from 'phaser';
import { TILE_SIZE } from '../constants';

export class BootScene extends Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.createPlaceholderTexture('peashooter', 0x00cc00);
    this.createPlaceholderTexture('sunflower', 0xffcc00);
    this.createPlaceholderTexture('walnutBomb', 0x8b4513);
    this.createPlaceholderTexture('brainEater', 0x884488);
    this.createPlaceholderTexture('veryFastWalker', 0xaa3333);
    this.createPlaceholderTexture('skeletonWarrior', 0x666666);
    this.createPlaceholderTexture('pea', 0x00ff00, 12);
    this.createPlaceholderTexture('kernel', 0xffee00, 10);
    this.createPlaceholderTexture('brain', 0xff88cc, 14);
    this.createPlaceholderTexture('tile', 0x335533, TILE_SIZE, TILE_SIZE, 0.3);
    this.createPlaceholderTexture('tileDark', 0x2a4a2a, TILE_SIZE, TILE_SIZE, 0.3);
    this.createPlaceholderTexture('base', 0x4444ff, TILE_SIZE, TILE_SIZE * 2);
  }

  create(): void {
    this.scene.start('BattleScene');
  }

  private createPlaceholderTexture(
    key: string,
    color: number,
    width: number = TILE_SIZE - 8,
    height: number = TILE_SIZE - 8,
    alpha: number = 1
  ): void {
    const gfx = this.add.graphics();
    gfx.fillStyle(color, alpha);
    gfx.fillRect(0, 0, width, height);
    gfx.generateTexture(key, width, height);
    gfx.destroy();
  }
}
