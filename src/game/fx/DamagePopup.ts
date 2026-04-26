import { Scene } from 'phaser';
import { FONT_HEADING } from '../ui/palette';

/** Show floating damage number that rises and fades */
export function showDamagePopup(scene: Scene, x: number, y: number, amount: number): void {
  const text = scene.add.text(x, y - 10, `-${amount}`, {
    fontFamily: FONT_HEADING,
    fontSize: '14px',
    color: '#E63946',
    stroke: '#1A1410',
    strokeThickness: 2,
  }).setOrigin(0.5).setDepth(20);

  scene.tweens.add({
    targets: text,
    y: y - 30,
    alpha: 0,
    duration: 600,
    ease: 'Quad.easeOut',
    onComplete: () => text.destroy(),
  });
}
