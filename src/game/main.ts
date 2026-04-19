import { Game, AUTO } from 'phaser';
import type { Types } from 'phaser';
import { BootScene } from './scenes/BootScene';
import { BattleScene } from './scenes/BattleScene';
import { GameOverScene } from './scenes/GameOverScene';
import { MultiplayerBattleScene } from './scenes/MultiplayerBattleScene';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';
import type { Faction } from './types';

export interface GameOptions {
  mode: 'ai' | 'multiplayer' | 'freeplay' | 'campaign';
  player: 'lukas' | 'toby';
  faction: Faction;
  roomId?: string;
  level?: number;
}

export let gameOptions: GameOptions = { mode: 'ai', player: 'lukas', faction: 'plants' };

export function getPlayerFaction(): Faction {
  return gameOptions.faction;
}

export function launchGame(parent: string, options?: GameOptions): Game {
  if (options) {
    gameOptions = options;
  }

  const config: Types.Core.GameConfig = {
    type: AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent,
    backgroundColor: '#1a1a2e',
    scale: {
      mode: 2, // Phaser.Scale.FIT
      autoCenter: 1, // Phaser.Scale.CENTER_BOTH
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scene: [BootScene, BattleScene, GameOverScene, MultiplayerBattleScene],
  };

  return new Game(config);
}
