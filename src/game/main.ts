import { Game, AUTO } from 'phaser';
import type { Types } from 'phaser';
import { BootScene } from './scenes/BootScene';
import { BattleScene } from './scenes/BattleScene';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';

export function launchGame(parent: string): Game {
  const config: Types.Core.GameConfig = {
    type: AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent,
    backgroundColor: '#1a1a2e',
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scene: [BootScene, BattleScene],
  };

  return new Game(config);
}
