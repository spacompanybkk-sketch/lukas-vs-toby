import { Scene, Input, GameObjects } from 'phaser';
import { GridManager } from './GridManager';
import { EnergyManager } from './EnergyManager';
import { UNIT_COSTS } from '../constants';
import type { Faction } from '../types';

export type PlaceUnitCallback = (unitKey: string, row: number, col: number) => void;

export class DragDropManager {
  private scene: Scene;
  private gridManager: GridManager;
  private energyManager: EnergyManager;
  private playerFaction: Faction;
  private onPlaceUnit: PlaceUnitCallback;
  private dragPreview: GameObjects.Sprite | null = null;
  private currentDragKey: string | null = null;

  constructor(
    scene: Scene, gridManager: GridManager, energyManager: EnergyManager,
    playerFaction: Faction, onPlaceUnit: PlaceUnitCallback,
  ) {
    this.scene = scene; this.gridManager = gridManager;
    this.energyManager = energyManager; this.playerFaction = playerFaction;
    this.onPlaceUnit = onPlaceUnit;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.scene.input.on('dragstart', (_pointer: Input.Pointer, gameObject: GameObjects.GameObject) => {
      const key = gameObject.getData('unitKey') as string;
      if (!key) return;
      const cost = UNIT_COSTS[key];
      if (this.energyManager.getEnergy() < cost) return;
      this.currentDragKey = key;
      this.dragPreview = this.scene.add.sprite(0, 0, key).setAlpha(0.6).setDisplaySize(72, 72);
    });

    this.scene.input.on('drag', (pointer: Input.Pointer) => {
      if (this.dragPreview) {
        this.dragPreview.setPosition(pointer.x, pointer.y);
      }
    });

    this.scene.input.on('dragend', (pointer: Input.Pointer) => {
      if (!this.dragPreview || !this.currentDragKey) { this.cleanup(); return; }
      const { row, col } = this.gridManager.toGrid(pointer.x, pointer.y);
      // Plants can place on any tile; zombies can only place on their first column (col 9)
      const validCol = this.playerFaction === 'plants' ? col >= 0 && col <= 9 : col === 9;
      if (this.gridManager.isValid(row, col) && validCol && this.gridManager.isEmpty(row, col)) {
        const cost = UNIT_COSTS[this.currentDragKey];
        if (this.energyManager.spend(cost)) {
          this.onPlaceUnit(this.currentDragKey, row, col);
        }
      }
      this.cleanup();
    });
  }

  private cleanup(): void {
    if (this.dragPreview) { this.dragPreview.destroy(); this.dragPreview = null; }
    this.currentDragKey = null;
  }
}
