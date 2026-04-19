import { Scene } from 'phaser';
import { TILE_SIZE } from '../constants';
import { gameOptions } from '../main';

const S = TILE_SIZE - 8; // sprite size (56px)

export class BootScene extends Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.drawPeashooter();
    this.drawSunflower();
    this.drawWalnutBomb();
    this.drawBrainEater();
    this.drawVeryFastWalker();
    this.drawSkeletonWarrior();
    this.drawProjectiles();
    this.drawTiles();
    this.drawBase();
  }

  create(): void {
    if (gameOptions.mode === 'multiplayer') {
      this.scene.start('MultiplayerBattleScene');
    } else {
      this.scene.start('BattleScene');
    }
  }

  // ---- PLANTS ----

  private drawPeashooter(): void {
    const g = this.add.graphics();
    // Stem/body (green rectangle)
    g.fillStyle(0x228b22);
    g.fillRect(20, 20, 16, 30);
    // Head (bright green circle)
    g.fillStyle(0x00cc00);
    g.fillCircle(28, 16, 14);
    // Eyes (white + black pupil)
    g.fillStyle(0xffffff);
    g.fillCircle(24, 13, 4);
    g.fillCircle(32, 13, 4);
    g.fillStyle(0x000000);
    g.fillCircle(26, 13, 2);
    g.fillCircle(34, 13, 2);
    // Mouth/barrel (dark green tube pointing right)
    g.fillStyle(0x006600);
    g.fillRect(36, 12, 14, 8);
    g.fillStyle(0x004400);
    g.fillRect(48, 10, 4, 12);
    // Leaves at base
    g.fillStyle(0x00aa00);
    g.fillEllipse(20, 48, 16, 8);
    g.fillEllipse(36, 48, 16, 8);
    g.generateTexture('peashooter', S, S);
    g.destroy();
  }

  private drawSunflower(): void {
    const g = this.add.graphics();
    // Stem
    g.fillStyle(0x228b22);
    g.fillRect(24, 28, 8, 24);
    // Petals (yellow circles around center)
    g.fillStyle(0xffdd00);
    const cx = 28, cy = 18;
    for (let angle = 0; angle < 360; angle += 45) {
      const rad = (angle * Math.PI) / 180;
      const px = cx + Math.cos(rad) * 12;
      const py = cy + Math.sin(rad) * 12;
      g.fillCircle(px, py, 6);
    }
    // Center (brown)
    g.fillStyle(0x8b4513);
    g.fillCircle(cx, cy, 8);
    // Face
    g.fillStyle(0x000000);
    g.fillCircle(25, 16, 2);
    g.fillCircle(31, 16, 2);
    // Smile
    g.lineStyle(1, 0x000000);
    g.beginPath();
    g.arc(28, 20, 4, 0, Math.PI);
    g.strokePath();
    // Leaves
    g.fillStyle(0x00aa00);
    g.fillEllipse(18, 40, 14, 6);
    g.fillEllipse(38, 40, 14, 6);
    g.generateTexture('sunflower', S, S);
    g.destroy();
  }

  private drawWalnutBomb(): void {
    const g = this.add.graphics();
    // Main body (brown oval)
    g.fillStyle(0x8b6914);
    g.fillEllipse(28, 28, 40, 44);
    // Shell texture lines
    g.lineStyle(2, 0x6b4f12);
    g.beginPath();
    g.arc(28, 28, 16, -0.5, 0.5);
    g.strokePath();
    g.beginPath();
    g.arc(28, 28, 16, 2.5, 3.5);
    g.strokePath();
    // Angry eyes
    g.fillStyle(0xffffff);
    g.fillCircle(22, 22, 5);
    g.fillCircle(34, 22, 5);
    g.fillStyle(0x000000);
    g.fillCircle(23, 23, 3);
    g.fillCircle(35, 23, 3);
    // Angry eyebrows
    g.lineStyle(2, 0x000000);
    g.lineBetween(17, 16, 25, 18);
    g.lineBetween(39, 16, 31, 18);
    // Gritted teeth
    g.fillStyle(0xffffff);
    g.fillRect(22, 34, 12, 5);
    g.lineStyle(1, 0x000000);
    g.lineBetween(25, 34, 25, 39);
    g.lineBetween(28, 34, 28, 39);
    g.lineBetween(31, 34, 31, 39);
    // Fuse on top
    g.lineStyle(2, 0x444444);
    g.lineBetween(28, 6, 28, 0);
    g.fillStyle(0xff4400);
    g.fillCircle(28, 0, 3);
    g.generateTexture('walnutBomb', S, S);
    g.destroy();
  }

  // ---- ZOMBIES ----

  private drawBrainEater(): void {
    const g = this.add.graphics();
    // Body (tattered shirt)
    g.fillStyle(0x554477);
    g.fillRect(16, 24, 24, 22);
    // Tattered edges
    g.fillStyle(0x443366);
    g.fillRect(14, 42, 6, 6);
    g.fillRect(36, 42, 6, 6);
    // Head (pale green/purple)
    g.fillStyle(0x7a6b8a);
    g.fillCircle(28, 16, 13);
    // Zombie eyes (yellow, uneven)
    g.fillStyle(0xccff00);
    g.fillCircle(23, 14, 4);
    g.fillCircle(34, 13, 3);
    g.fillStyle(0x000000);
    g.fillCircle(24, 14, 2);
    g.fillCircle(35, 13, 1.5);
    // Open mouth
    g.fillStyle(0x330000);
    g.fillRect(22, 22, 12, 6);
    // Teeth
    g.fillStyle(0xccccaa);
    g.fillRect(23, 22, 3, 3);
    g.fillRect(30, 22, 3, 3);
    // Arms reaching out
    g.fillStyle(0x7a6b8a);
    g.fillRect(2, 28, 14, 6);
    g.fillRect(40, 26, 14, 6);
    // Brain in hand
    g.fillStyle(0xff88aa);
    g.fillCircle(50, 28, 5);
    g.lineStyle(1, 0xcc6688);
    g.lineBetween(48, 26, 52, 28);
    g.lineBetween(49, 30, 51, 27);
    g.generateTexture('brainEater', S, S);
    g.destroy();
  }

  private drawVeryFastWalker(): void {
    const g = this.add.graphics();
    // Thin body (running pose)
    g.fillStyle(0x994444);
    g.fillRect(22, 22, 12, 18);
    // Head (pale red)
    g.fillStyle(0xbb5555);
    g.fillCircle(28, 14, 11);
    // Wild eyes (red, crazed)
    g.fillStyle(0xff0000);
    g.fillCircle(24, 12, 3);
    g.fillCircle(33, 12, 3);
    g.fillStyle(0x000000);
    g.fillCircle(25, 12, 1.5);
    g.fillCircle(34, 12, 1.5);
    // Open screaming mouth
    g.fillStyle(0x330000);
    g.fillEllipse(28, 20, 8, 5);
    // Running legs (spread apart)
    g.fillStyle(0x663333);
    g.fillRect(18, 40, 6, 14);
    g.fillRect(32, 40, 6, 14);
    // Arms forward
    g.fillStyle(0xbb5555);
    g.fillRect(6, 24, 16, 5);
    g.fillRect(34, 26, 16, 5);
    // Speed lines
    g.lineStyle(1, 0xffaa44, 0.5);
    g.lineBetween(0, 20, 8, 20);
    g.lineBetween(0, 30, 6, 30);
    g.lineBetween(0, 40, 4, 40);
    g.generateTexture('veryFastWalker', S, S);
    g.destroy();
  }

  private drawSkeletonWarrior(): void {
    const g = this.add.graphics();
    // Armor body (grey)
    g.fillStyle(0x666666);
    g.fillRect(16, 22, 24, 24);
    // Armor plate detail
    g.lineStyle(1, 0x888888);
    g.lineBetween(18, 28, 38, 28);
    g.lineBetween(18, 34, 38, 34);
    // Skull head
    g.fillStyle(0xddddcc);
    g.fillCircle(28, 14, 12);
    // Eye sockets (dark)
    g.fillStyle(0x000000);
    g.fillCircle(23, 12, 4);
    g.fillCircle(33, 12, 4);
    // Red eye glow
    g.fillStyle(0xff0000);
    g.fillCircle(23, 12, 2);
    g.fillCircle(33, 12, 2);
    // Nose hole
    g.fillStyle(0x000000);
    g.fillTriangle(28, 17, 26, 21, 30, 21);
    // Jaw
    g.fillStyle(0xbbbbaa);
    g.fillRect(21, 22, 14, 4);
    g.lineStyle(1, 0x000000);
    g.lineBetween(24, 22, 24, 26);
    g.lineBetween(28, 22, 28, 26);
    g.lineBetween(32, 22, 32, 26);
    // Sword (right side)
    g.fillStyle(0xaaaaaa);
    g.fillRect(42, 4, 3, 36);
    // Sword handle
    g.fillStyle(0x664400);
    g.fillRect(38, 36, 11, 4);
    // Shield (left side)
    g.fillStyle(0x555555);
    g.fillRect(4, 22, 12, 18);
    g.lineStyle(1, 0x777777);
    g.lineBetween(10, 24, 10, 38);
    g.lineBetween(6, 31, 14, 31);
    g.generateTexture('skeletonWarrior', S, S);
    g.destroy();
  }

  // ---- PROJECTILES ----

  private drawProjectiles(): void {
    // Pea (green circle with highlight)
    let g = this.add.graphics();
    g.fillStyle(0x00cc00);
    g.fillCircle(6, 6, 6);
    g.fillStyle(0x44ff44, 0.6);
    g.fillCircle(4, 4, 2);
    g.generateTexture('pea', 12, 12);
    g.destroy();

    // Kernel (yellow oval)
    g = this.add.graphics();
    g.fillStyle(0xffdd00);
    g.fillEllipse(5, 5, 8, 10);
    g.fillStyle(0xffee66, 0.5);
    g.fillCircle(4, 3, 2);
    g.generateTexture('kernel', 10, 10);
    g.destroy();

    // Brain (pink blob)
    g = this.add.graphics();
    g.fillStyle(0xff88aa);
    g.fillCircle(7, 7, 7);
    g.lineStyle(1, 0xcc6688);
    g.beginPath();
    g.arc(7, 7, 4, 0, Math.PI);
    g.strokePath();
    g.beginPath();
    g.arc(7, 5, 3, Math.PI, 0);
    g.strokePath();
    g.generateTexture('brain', 14, 14);
    g.destroy();
  }

  // ---- TILES & BASE ----

  private drawTiles(): void {
    // Light tile
    let g = this.add.graphics();
    g.fillStyle(0x335533, 0.3);
    g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    g.lineStyle(1, 0x446644, 0.2);
    g.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
    g.generateTexture('tile', TILE_SIZE, TILE_SIZE);
    g.destroy();

    // Dark tile
    g = this.add.graphics();
    g.fillStyle(0x2a4a2a, 0.3);
    g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    g.lineStyle(1, 0x3a5a3a, 0.2);
    g.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
    g.generateTexture('tileDark', TILE_SIZE, TILE_SIZE);
    g.destroy();
  }

  private drawBase(): void {
    const g = this.add.graphics();
    // Base structure (blocky castle/tower)
    g.fillStyle(0x4444aa);
    g.fillRect(4, 20, TILE_SIZE - 8, TILE_SIZE * 2 - 24);
    // Battlements on top
    g.fillRect(4, 12, 12, 8);
    g.fillRect(24, 12, 12, 8);
    g.fillRect(44, 12, 8, 8);
    // Door
    g.fillStyle(0x222266);
    g.fillRect(20, TILE_SIZE * 2 - 24, 16, 20);
    // Window
    g.fillStyle(0x6666cc);
    g.fillRect(12, 36, 8, 8);
    g.fillRect(36, 36, 8, 8);
    g.generateTexture('base', TILE_SIZE, TILE_SIZE * 2);
    g.destroy();
  }
}
