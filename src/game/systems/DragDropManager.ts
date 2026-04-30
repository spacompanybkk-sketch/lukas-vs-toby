import { Scene, Input, GameObjects } from 'phaser';
import { GridManager } from './GridManager';
import { EnergyManager } from './EnergyManager';
import { UNIT_COSTS, UNIT_STATS } from '../constants';
import { MAX_UNIT_LEVEL } from '../entities/Unit';
import type { UnitState } from '../entities/Unit';
import type { Faction } from '../types';

export type PlaceUnitCallback = (unitKey: string, row: number, col: number) => void;
export type MergeUnitCallback = (unitKey: string, row: number, col: number) => void;
export type FindUnitAtCallback = (row: number, col: number) => UnitState | null;

export class DragDropManager {
  private scene: Scene;
  private gridManager: GridManager;
  private energyManager: EnergyManager;
  private playerFaction: Faction;
  private onPlaceUnit: PlaceUnitCallback;
  private onMergeUnit: MergeUnitCallback;
  private findUnitAt: FindUnitAtCallback;
  private dragPreview: GameObjects.Sprite | null = null;
  private currentDragKey: string | null = null;

  constructor(
    scene: Scene, gridManager: GridManager, energyManager: EnergyManager,
    playerFaction: Faction, onPlaceUnit: PlaceUnitCallback,
    onMergeUnit: MergeUnitCallback, findUnitAt: FindUnitAtCallback,
  ) {
    this.scene = scene; this.gridManager = gridManager;
    this.energyManager = energyManager; this.playerFaction = playerFaction;
    this.onPlaceUnit = onPlaceUnit;
    this.onMergeUnit = onMergeUnit;
    this.findUnitAt = findUnitAt;
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
      const validCol = this.playerFaction === 'plants' ? col >= 0 && col <= 9 : col === 9;

      if (!this.gridManager.isValid(row, col) || !validCol) { this.cleanup(); return; }

      const isMoving = (UNIT_STATS[this.currentDragKey]?.moveSpeed ?? 0) > 0;

      // Check for merge first — if there's a same-type, same-faction unit on the tile
      const existing = this.findUnitAt(row, col);
      if (existing && existing.key === this.currentDragKey
        && existing.faction === this.playerFaction
        && existing.level < MAX_UNIT_LEVEL) {
        // Merge into existing unit
        const cost = UNIT_COSTS[this.currentDragKey];
        if (this.energyManager.spend(cost)) {
          this.onMergeUnit(this.currentDragKey, row, col);
        }
      } else if (isMoving || this.gridManager.isEmpty(row, col)) {
        // Empty tile (or moving unit that doesn't occupy grid) — place normally
        const cost = UNIT_COSTS[this.currentDragKey];
        if (this.energyManager.spend(cost)) {
          this.onPlaceUnit(this.currentDragKey, row, col);
        }
      }
      // Otherwise: blocked (different type, different faction, or max level)

      this.cleanup();
    });
  }

  private cleanup(): void {
    if (this.dragPreview) { this.dragPreview.destroy(); this.dragPreview = null; }
    this.currentDragKey = null;
  }
}
