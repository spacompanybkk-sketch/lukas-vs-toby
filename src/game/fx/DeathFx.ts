import { Scene, GameObjects } from 'phaser';
import { PALETTE } from '../ui/palette';

/**
 * Plant death: shake + shrink-fade + leafy crumb particles
 */
export function chompPlant(scene: Scene, x: number, y: number): void {
  // Leafy crumb particles
  const crumbColors = [PALETTE.plantGreen, PALETTE.plantGreenDark, PALETTE.plantLeafBright, PALETTE.coinGold];
  for (let i = 0; i < 4; i++) {
    const crumb = scene.add.graphics().setDepth(15);
    crumb.fillStyle(crumbColors[i]);
    crumb.fillRect(-4, -4, 8, 8);
    crumb.setPosition(x + (Math.random() - 0.5) * 10, y);

    const angle = (Math.PI / 4) + (Math.random() * Math.PI / 2); // spread upward-ish
    const speed = 40 + Math.random() * 30;
    const vx = Math.cos(angle) * speed * (i < 2 ? -1 : 1);
    const vy = -Math.sin(angle) * speed;

    scene.tweens.add({
      targets: crumb,
      x: crumb.x + vx,
      y: crumb.y - vy + 40, // gravity pull down
      alpha: 0,
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => crumb.destroy(),
    });
  }
}

/**
 * Zombie death: flash + body rise-fade + voxel chunk burst
 */
export function evaporateZombie(scene: Scene, x: number, y: number): void {
  // Flash
  const flash = scene.add.graphics().setDepth(15);
  flash.fillStyle(0xffffff, 0.8);
  flash.fillCircle(x, y, 40);
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration: 400,
    onComplete: () => flash.destroy(),
  });

  // Voxel chunk burst
  const chunkColors = [PALETTE.zombiePurple, PALETTE.zombieRot, PALETTE.zombiePurpleDark, 0xB270E0];
  for (let i = 0; i < 7; i++) {
    const chunk = scene.add.graphics().setDepth(15);
    const color = chunkColors[i % chunkColors.length];
    chunk.fillStyle(color);
    chunk.fillRect(-6, -6, 12, 12);
    chunk.setPosition(x, y);

    const angle = (Math.PI * 2 / 7) * i + Math.random() * 0.5;
    const speed = 40 + Math.random() * 10;

    scene.tweens.add({
      targets: chunk,
      x: x + Math.cos(angle) * speed,
      y: y + Math.sin(angle) * speed,
      alpha: 0,
      angle: -90 + Math.random() * 180,
      duration: 1200,
      ease: 'Quad.easeOut',
      onComplete: () => chunk.destroy(),
    });
  }
}

/**
 * Explosion death: red splash + expanding ring (cherry bomb, walnut, potato mine)
 */
export function explosionBurst(scene: Scene, x: number, y: number): void {
  // Expanding gold rings
  for (let i = 0; i < 3; i++) {
    const ring = scene.add.graphics().setDepth(15);
    ring.lineStyle(3, PALETTE.coinGold, 0.8);
    ring.strokeCircle(0, 0, 10);
    ring.setPosition(x, y);

    scene.tweens.add({
      targets: ring,
      scaleX: 3 + i,
      scaleY: 3 + i,
      alpha: 0,
      duration: 400,
      delay: i * 100,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
  }
}
