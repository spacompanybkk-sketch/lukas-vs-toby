# Unit Leveling & Merge System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a merge/level system (L1-L5) where placing the same unit on a tile levels it up, with linear stat scaling and DALL-E evolution sprites.

**Architecture:** Add `level` and base stats to `UnitState`, create a `MergeManager` system for merge logic and zombie overlap timers, modify `DragDropManager` to support merge-on-occupied-tile, and wire everything into `BattleScene`. A new DALL-E script generates 80 evolution sprites.

**Tech Stack:** TypeScript, Phaser 3, OpenAI DALL-E 3 API

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/game/entities/Unit.ts` | Add `level`, base stats, `levelUp()` method |
| `src/game/constants.ts` | Add `MAX_UNIT_LEVEL`, `MERGE_OVERLAP_DURATION` |
| `src/game/systems/MergeManager.ts` | **New** — merge validation, execution, overlap timers |
| `src/game/systems/DragDropManager.ts` | Support merge callback when dropping on same-type unit |
| `src/game/scenes/BattleScene.ts` | Wire MergeManager, merge visuals, zombie auto-merge |
| `src/game/scenes/BootScene.ts` | Preload L2-L5 sprites |
| `scripts/generate-level-sprites.mjs` | **New** — DALL-E sprite generation for all 20 units x 4 levels |

---

### Task 1: Add level support to UnitState

**Files:**
- Modify: `src/game/entities/Unit.ts`

- [ ] **Step 1: Add level, base stats, and levelUp to UnitState**

```typescript
import type { Faction } from '../types';

export const MAX_UNIT_LEVEL = 5;

export class UnitState {
  public readonly id: string;
  public readonly key: string;
  public readonly faction: Faction;
  public maxHp: number;
  public damage: number;
  public attackSpeed: number;
  public readonly range: number;
  public readonly moveSpeed: number;
  public hp: number;
  public row: number = 0;
  public col: number = 0;
  public level: number = 1;
  private lastAttackTime: number = -Infinity;

  // Base stats preserved for level-up recalculation
  public readonly baseHp: number;
  public readonly baseDamage: number;
  public readonly baseAttackSpeed: number;

  constructor(
    id: string, key: string, faction: Faction,
    hp: number, damage: number, attackSpeed: number,
    range: number, moveSpeed: number,
  ) {
    this.id = id;
    this.key = key;
    this.faction = faction;
    this.baseHp = hp;
    this.baseDamage = damage;
    this.baseAttackSpeed = attackSpeed;
    this.maxHp = hp;
    this.hp = hp;
    this.damage = damage;
    this.attackSpeed = attackSpeed;
    this.range = range;
    this.moveSpeed = moveSpeed;
  }

  takeDamage(amount: number): void { this.hp = Math.max(0, this.hp - amount); }
  isAlive(): boolean { return this.hp > 0; }
  setPosition(row: number, col: number): void { this.row = row; this.col = col; }
  canAttack(currentTime: number): boolean {
    if (this.attackSpeed === 0) return false;
    return currentTime - this.lastAttackTime >= this.attackSpeed;
  }
  recordAttack(currentTime: number): void { this.lastAttackTime = currentTime; }
  isStationary(): boolean { return this.moveSpeed === 0; }

  /** Apply marketplace upgrade multipliers to HP and damage */
  applyUpgrade(hpMult: number, damageMult: number): void {
    this.maxHp = Math.round(this.maxHp * hpMult);
    this.hp = this.maxHp;
    this.damage = Math.round(this.damage * damageMult);
  }

  /** Level up: preserve HP percentage, scale all combat stats by new level */
  levelUp(): void {
    if (this.level >= MAX_UNIT_LEVEL) return;
    const hpPercent = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.level += 1;
    this.maxHp = this.baseHp * this.level;
    this.hp = Math.round(this.maxHp * hpPercent);
    this.damage = this.baseDamage * this.level;
    this.attackSpeed = this.baseAttackSpeed > 0
      ? Math.round(this.baseAttackSpeed / this.level)
      : 0;
  }

  /** Get the texture key for this unit's current level */
  getTextureKey(): string {
    return this.level > 1 ? `${this.key}-L${this.level}` : this.key;
  }
}
```

Note: `attackSpeed` changes from `readonly` to mutable since `levelUp()` modifies it. The `canAttack` method uses `this.attackSpeed` so this just works.

- [ ] **Step 2: Build to verify no regressions**

Run: `cd /Users/michaglio/Projects/lukas-vs-toby && npm run build`
Expected: Build succeeds (all existing code uses UnitState the same way, new fields have defaults)

- [ ] **Step 3: Commit**

```bash
cd /Users/michaglio/Projects/lukas-vs-toby
git add src/game/entities/Unit.ts
git commit -m "feat: add level, base stats, and levelUp() to UnitState"
```

---

### Task 2: Add merge constants

**Files:**
- Modify: `src/game/constants.ts`

- [ ] **Step 1: Add merge constants to constants.ts**

Add at the end of the file, before the closing:

```typescript
// Merge system
export const MERGE_OVERLAP_DURATION = 1000; // ms for zombie auto-merge
```

Note: `MAX_UNIT_LEVEL` lives on `UnitState` since that's where `levelUp()` checks it.

- [ ] **Step 2: Commit**

```bash
cd /Users/michaglio/Projects/lukas-vs-toby
git add src/game/constants.ts
git commit -m "feat: add merge overlap duration constant"
```

---

### Task 3: Create MergeManager

**Files:**
- Create: `src/game/systems/MergeManager.ts`

- [ ] **Step 1: Create MergeManager**

```typescript
import { UnitState, MAX_UNIT_LEVEL } from '../entities/Unit';
import { MERGE_OVERLAP_DURATION } from '../constants';

export interface MergeResult {
  survivor: UnitState;
  consumed: UnitState;
  newTextureKey: string;
}

export class MergeManager {
  // Overlap timers keyed by sorted unit ID pair: "id1|id2" -> elapsed ms
  private overlapTimers: Map<string, number> = new Map();

  /** Check if two units can merge */
  canMerge(unitA: UnitState, unitB: UnitState): boolean {
    if (unitA.key !== unitB.key) return false;
    if (unitA.faction !== unitB.faction) return false;
    if (unitA.level >= MAX_UNIT_LEVEL) return false;
    if (unitB.level >= MAX_UNIT_LEVEL) return false;
    return true;
  }

  /** Merge two units. The higher-level (or older) unit survives and levels up. */
  merge(unitA: UnitState, unitB: UnitState): MergeResult {
    // Higher level survives. If equal, unitA (older/existing) survives.
    const survivor = unitA.level >= unitB.level ? unitA : unitB;
    const consumed = survivor === unitA ? unitB : unitA;

    survivor.levelUp();

    return {
      survivor,
      consumed,
      newTextureKey: survivor.getTextureKey(),
    };
  }

  /**
   * Track overlap between two same-type moving units.
   * Returns MergeResult after MERGE_OVERLAP_DURATION ms of continuous overlap,
   * or null if timer hasn't elapsed yet.
   */
  trackOverlap(unitA: UnitState, unitB: UnitState, delta: number): MergeResult | null {
    if (!this.canMerge(unitA, unitB)) return null;

    const key = this.pairKey(unitA.id, unitB.id);
    const elapsed = (this.overlapTimers.get(key) ?? 0) + delta;
    this.overlapTimers.set(key, elapsed);

    if (elapsed >= MERGE_OVERLAP_DURATION) {
      this.overlapTimers.delete(key);
      return this.merge(unitA, unitB);
    }

    return null;
  }

  /** Reset overlap timer for a pair (called when units separate) */
  resetOverlap(unitA: UnitState, unitB: UnitState): void {
    this.overlapTimers.delete(this.pairKey(unitA.id, unitB.id));
  }

  /** Clear all timers involving a specific unit (called on death) */
  clearTimers(unitId: string): void {
    for (const key of this.overlapTimers.keys()) {
      if (key.includes(unitId)) {
        this.overlapTimers.delete(key);
      }
    }
  }

  private pairKey(idA: string, idB: string): string {
    return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
  }
}
```

- [ ] **Step 2: Build to verify**

Run: `cd /Users/michaglio/Projects/lukas-vs-toby && npm run build`
Expected: Build succeeds (MergeManager not imported anywhere yet, but should compile)

- [ ] **Step 3: Commit**

```bash
cd /Users/michaglio/Projects/lukas-vs-toby
git add src/game/systems/MergeManager.ts
git commit -m "feat: add MergeManager with merge logic and overlap timers"
```

---

### Task 4: Update DragDropManager to support merging

**Files:**
- Modify: `src/game/systems/DragDropManager.ts`

- [ ] **Step 1: Add merge callback and findUnitAt helper**

The DragDropManager needs to:
1. Accept a new `onMergeUnit` callback
2. Accept a `findUnitAt` function to look up what unit is on a tile
3. When tile is occupied by same-type unit (level < 5), call merge instead of blocking

Replace the entire file:

```typescript
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

      if (isMoving || this.gridManager.isEmpty(row, col)) {
        // Empty tile (or moving unit) — place normally
        const cost = UNIT_COSTS[this.currentDragKey];
        if (this.energyManager.spend(cost)) {
          this.onPlaceUnit(this.currentDragKey, row, col);
        }
      } else {
        // Tile occupied — check for merge
        const existing = this.findUnitAt(row, col);
        if (existing && existing.key === this.currentDragKey && existing.level < MAX_UNIT_LEVEL) {
          const cost = UNIT_COSTS[this.currentDragKey];
          if (this.energyManager.spend(cost)) {
            this.onMergeUnit(this.currentDragKey, row, col);
          }
        }
        // Otherwise: blocked (different type or max level)
      }

      this.cleanup();
    });
  }

  private cleanup(): void {
    if (this.dragPreview) { this.dragPreview.destroy(); this.dragPreview = null; }
    this.currentDragKey = null;
  }
}
```

- [ ] **Step 2: Build** (will fail — BattleScene constructor call needs updating, that's Task 6)

Note: Don't commit yet. BattleScene needs to be updated to pass the new callbacks.

---

### Task 5: Load level sprites in BootScene

**Files:**
- Modify: `src/game/scenes/BootScene.ts`

- [ ] **Step 1: Add level sprite loading loop after existing sprite loads**

After the existing zombie sprite loads (line 33, after `brainRot`), add:

```typescript
    // Load level-up evolution sprites (L2-L5 for all units)
    const allUnitKeys = [
      'peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'cherryBomber',
      'avocadoBunker', 'mangoPult', 'kernelPult', 'pumpkinSquash', 'torchwood',
      'brainEater', 'veryFastWalker', 'skeletonWarrior', 'skeletonArcher',
      'necromancer', 'hotTopic', 'tridentZombie', 'desertZombie', 'cowboyZombie', 'brainRot',
    ];
    for (const unitKey of allUnitKeys) {
      for (let lvl = 2; lvl <= 5; lvl++) {
        this.load.image(`${unitKey}-L${lvl}`, `/assets/sprites/${unitKey}-L${lvl}.png`);
      }
    }
```

This goes right after line 33 (`this.load.image('brainRot', ...)`), before the `// Projectiles` comment.

- [ ] **Step 2: Commit**

```bash
cd /Users/michaglio/Projects/lukas-vs-toby
git add src/game/scenes/BootScene.ts
git commit -m "feat: preload L2-L5 evolution sprites in BootScene"
```

---

### Task 6: Wire MergeManager into BattleScene

**Files:**
- Modify: `src/game/scenes/BattleScene.ts`

This is the largest task. It integrates MergeManager and adds:
1. Player merge via drag-drop
2. Zombie auto-merge in movement
3. Level badge visuals
4. Merge pulse animation

- [ ] **Step 1: Add imports**

Add to the imports section at the top of BattleScene.ts:

```typescript
import { MergeManager } from '../systems/MergeManager';
import { MAX_UNIT_LEVEL } from '../entities/Unit';
import { MERGE_OVERLAP_DURATION } from '../constants';
```

- [ ] **Step 2: Add mergeManager field**

In the class properties section (after `private dragDropManager!: DragDropManager;`), add:

```typescript
  private mergeManager!: MergeManager;
```

- [ ] **Step 3: Initialize MergeManager in create()**

In the `create()` method, after `this.combatManager = new CombatManager();` (line 159), add:

```typescript
    this.mergeManager = new MergeManager();
```

- [ ] **Step 4: Update DragDropManager constructor call**

Replace the existing DragDropManager construction (lines 214-219):

```typescript
    // Drag drop (player places their faction's units)
    this.dragDropManager = new DragDropManager(
      this, this.gridManager, this.energyManager, this.playerFaction,
      (unitKey, row, col) => {
        this.spawnUnit(unitKey, row, col, this.playerFaction);
      },
    );
```

With:

```typescript
    // Drag drop (player places their faction's units)
    this.dragDropManager = new DragDropManager(
      this, this.gridManager, this.energyManager, this.playerFaction,
      (unitKey, row, col) => {
        this.spawnUnit(unitKey, row, col, this.playerFaction);
      },
      (unitKey, row, col) => {
        this.mergeUnitAt(unitKey, row, col);
      },
      (row, col) => {
        return this.findStaticUnitAt(row, col);
      },
    );
```

- [ ] **Step 5: Add helper methods for merge**

Add these methods to the BattleScene class (before `private updateMovement`):

```typescript
  /** Find a stationary unit at a specific grid cell (for merge targeting) */
  private findStaticUnitAt(row: number, col: number): UnitState | null {
    const unitId = this.gridManager.getUnitAt(row, col);
    if (!unitId) return null;
    const unit = this.units.find(u => u.state.id === unitId);
    return unit?.state ?? null;
  }

  /** Merge a new unit into an existing one at (row, col) via drag-drop */
  private mergeUnitAt(unitKey: string, row: number, col: number): void {
    const existing = this.units.find(u =>
      u.state.isAlive() && u.state.key === unitKey &&
      u.state.row === row && Math.round(u.state.col) === col
    );
    if (!existing) return;

    // Create a temporary unit to act as the "incoming" for merge
    const factory = UNIT_FACTORIES[unitKey];
    if (!factory) return;
    const tempUnit = factory(`merge_temp_${this.nextUnitId++}`);

    if (!this.mergeManager.canMerge(existing.state, tempUnit)) return;

    const result = this.mergeManager.merge(existing.state, tempUnit);
    // result.survivor is always existing.state (higher level since tempUnit is L1)

    // Swap sprite texture to evolved version
    const newKey = result.newTextureKey;
    if (this.textures.exists(newKey)) {
      existing.sprite.setTexture(newKey);
    }
    existing.sprite.setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4);

    // Update or create level badge
    this.updateLevelBadge(existing);

    // Pulse animation
    this.tweens.add({
      targets: existing.sprite,
      scaleX: existing.sprite.scaleX * 1.3,
      scaleY: existing.sprite.scaleY * 1.3,
      duration: 150,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /** Update or create the level badge for a unit */
  private updateLevelBadge(unit: ActiveUnit): void {
    const level = unit.state.level;
    if (level <= 1) return;

    const { x, y } = this.gridManager.toPixel(unit.state.row, unit.state.col);
    const badgeColors: Record<number, string> = {
      2: '#CD7F32', // bronze
      3: '#C0C0C0', // silver
      4: '#FFD700', // gold
      5: '#B265FF', // purple/diamond
    };
    const color = badgeColors[level] ?? '#ffffff';
    const stars = '\u2605'.repeat(level - 1); // ★ repeated

    if (unit.levelBadge) {
      unit.levelBadge.setText(stars);
      unit.levelBadge.setColor(color);
      unit.levelBadge.setPosition(x + TILE_SIZE / 2 - 4, y - TILE_SIZE / 2 + 2);
    } else {
      unit.levelBadge = this.add.text(
        x + TILE_SIZE / 2 - 4,
        y - TILE_SIZE / 2 + 2,
        stars,
        { fontSize: '10px', color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 2 }
      ).setOrigin(1, 0).setDepth(10);
    }
  }
```

- [ ] **Step 6: Add zombie auto-merge logic after movement**

In the `update()` method, after step `// 4. Zombie movement` (`this.updateMovement(delta);`), add a new step:

```typescript
    // 4b. Zombie auto-merge (moving units overlapping same tile)
    this.checkZombieMerges(delta);
```

Then add the method to the class:

```typescript
  /** Check for zombie auto-merges: same-type moving units on the same tile */
  private checkZombieMerges(delta: number): void {
    const movingUnits = this.units.filter(u =>
      u.state.isAlive() && !u.state.isStationary() && u.state.level < MAX_UNIT_LEVEL
    );

    // Track which pairs are currently overlapping this frame
    const overlappingPairs = new Set<string>();

    for (let i = 0; i < movingUnits.length; i++) {
      for (let j = i + 1; j < movingUnits.length; j++) {
        const a = movingUnits[i];
        const b = movingUnits[j];

        if (a.state.key !== b.state.key) continue;
        if (a.state.faction !== b.state.faction) continue;
        if (a.state.row !== b.state.row) continue;

        const aCol = Math.round(a.state.col);
        const bCol = Math.round(b.state.col);
        if (aCol !== bCol) continue;

        // Same tile — track overlap
        const pairId = a.state.id < b.state.id
          ? `${a.state.id}|${b.state.id}`
          : `${b.state.id}|${a.state.id}`;
        overlappingPairs.add(pairId);

        const result = this.mergeManager.trackOverlap(a.state, b.state, delta);
        if (result) {
          const consumed = result.consumed === a.state ? a : b;
          const survivor = result.survivor === a.state ? a : b;

          // Swap survivor sprite texture
          const newKey = result.newTextureKey;
          if (this.textures.exists(newKey)) {
            survivor.sprite.setTexture(newKey);
          }
          survivor.sprite.setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4);

          // Update level badge
          this.updateLevelBadge(survivor);

          // Pulse animation
          this.tweens.add({
            targets: survivor.sprite,
            scaleX: survivor.sprite.scaleX * 1.3,
            scaleY: survivor.sprite.scaleY * 1.3,
            duration: 150,
            yoyo: true,
            ease: 'Quad.easeOut',
          });

          // Destroy consumed unit
          consumed.state.takeDamage(Infinity);
          consumed.sprite.destroy();
          consumed.healthBar.destroy();
          if (consumed.levelBadge) consumed.levelBadge.destroy();

          return; // Process one merge per frame to avoid iterator issues
        }
      }
    }
  }
```

- [ ] **Step 7: Update cleanupDeadUnits to clear merge timers**

In `cleanupDeadUnits()`, after the line `this.skeletonBlockTimers.delete(dead.state.id);`, add:

```typescript
      // Clean up merge overlap timers
      this.mergeManager.clearTimers(dead.state.id);
```

- [ ] **Step 8: Update spawnUnit level badge to use stars instead of marketplace number**

Replace the existing level badge code in `spawnUnit` (the block starting with `// Level badge in top-right corner for upgraded units`):

```typescript
    // Level badge (shown for merge levels AND marketplace upgrades)
    let levelBadge: GameObjects.Text | undefined;

    this.units.push({ state: unitState, sprite, healthBar, levelBadge });
```

The badge will be created by `updateLevelBadge()` when units actually level up via merge. The marketplace upgrade badge we added earlier gets replaced by this system — marketplace upgrades don't need a separate badge since the merge level badge will handle it.

- [ ] **Step 9: Update explosion damage scaling for leveled units**

In `cleanupDeadUnits()`, update the explosion handlers to scale by level:

Replace:
```typescript
      // WalnutBomb explosion on death
      if (dead.state.key === 'walnutBomb') {
        this.aoeExplosion(dead.state, WALNUT_EXPLOSION_DAMAGE, WALNUT_EXPLOSION_RADIUS);
```

With:
```typescript
      // WalnutBomb explosion on death (damage scales with level)
      if (dead.state.key === 'walnutBomb') {
        this.aoeExplosion(dead.state, WALNUT_EXPLOSION_DAMAGE * dead.state.level, WALNUT_EXPLOSION_RADIUS);
```

Same for CherryBomber:
```typescript
      // CherryBomber explosion on death (damage scales with level)
      if (dead.state.key === 'cherryBomber') {
        this.aoeExplosion(dead.state, CHERRY_EXPLOSION_DAMAGE * dead.state.level, CHERRY_EXPLOSION_RADIUS);
```

Same for PotatoMine:
```typescript
      // PotatoMine explosion on death (damage scales with level)
      if (dead.state.key === 'potatoMine') {
        this.aoeExplosion(dead.state, POTATO_MINE_EXPLOSION_DAMAGE * dead.state.level, POTATO_MINE_EXPLOSION_RADIUS);
```

- [ ] **Step 10: Build and verify**

Run: `cd /Users/michaglio/Projects/lukas-vs-toby && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 11: Commit**

```bash
cd /Users/michaglio/Projects/lukas-vs-toby
git add src/game/entities/Unit.ts src/game/constants.ts src/game/systems/MergeManager.ts src/game/systems/DragDropManager.ts src/game/scenes/BattleScene.ts src/game/scenes/BootScene.ts
git commit -m "feat: implement unit merge/level system (L1-L5) with drag-drop and zombie auto-merge"
```

---

### Task 7: Create DALL-E level sprite generation script

**Files:**
- Create: `scripts/generate-level-sprites.mjs`

- [ ] **Step 1: Create the generation script**

This script generates 80 sprites (20 units x 4 levels: L2-L5). Each unit has custom evolution prompts. The script follows the exact pattern of `scripts/generate-phase2-sprites.mjs`.

```javascript
#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = path.join(__dirname, '..', 'public', 'assets', 'sprites');
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const SUFFIX = ', Minecraft pixel art style, blocky voxel look, game sprite, solid dark background, no text, centered';

// Evolution prompts: unitKey -> [L2, L3, L4, L5]
const EVOLUTION_PROMPTS = {
  peashooter: [
    'A bigger peashooter plant with a small leaf shield and double-barrel mouth' + SUFFIX,
    'An armored peashooter with iron plating, glowing green eyes, triple barrels' + SUFFIX,
    'A battle-mech peashooter with cannon barrels, electric aura, crystal armor' + SUFFIX,
    'A massive legendary golden peashooter mech, quad cannons, radiant energy field, epic final form' + SUFFIX,
  ],
  sunflower: [
    'A bigger sunflower with extra petals and a glowing golden center' + SUFFIX,
    'An armored sunflower with metallic petals, radiating warm light beams' + SUFFIX,
    'A crystal sunflower with diamond petals, solar flare aura, prismatic light' + SUFFIX,
    'A legendary cosmic sunflower, massive radiant star core, galaxy petal ring, divine glow' + SUFFIX,
  ],
  walnutBomb: [
    'A bigger walnut bomb with iron reinforced shell, larger fuse, angrier face' + SUFFIX,
    'An armored walnut bomb with steel plating, glowing red fuse, spikes on shell' + SUFFIX,
    'A crystal walnut bomb encased in volcanic rock, lava cracks, massive fuse, fire aura' + SUFFIX,
    'A legendary nuclear walnut bomb, golden shell, atomic glow, devastating final form' + SUFFIX,
  ],
  potatoMine: [
    'A bigger potato mine with metal casing, double fuses, sharper angry eyes' + SUFFIX,
    'An armored potato mine with steel shell, proximity sensor antenna, red warning glow' + SUFFIX,
    'A high-tech potato mine with circuit board patterns, electric sparks, ticking timer' + SUFFIX,
    'A legendary nuclear potato mine, golden casing, radiation glow, ultimate explosive' + SUFFIX,
  ],
  cherryBomber: [
    'Bigger twin cherry bombs with iron stems, larger fuses, fiercer angry faces' + SUFFIX,
    'Armored twin cherry bombs with steel casings, fire trail, glowing red aura' + SUFFIX,
    'Crystal twin cherry bombs encased in magma, volcanic fuses, explosive energy waves' + SUFFIX,
    'Legendary twin cherry bombs, golden shells, nuclear glow, devastating final form' + SUFFIX,
  ],
  avocadoBunker: [
    'A bigger avocado bunker with reinforced rind, metal studs, thicker walls' + SUFFIX,
    'An iron-plated avocado fortress with turret slots, fortress walls, steel reinforcement' + SUFFIX,
    'A crystal avocado citadel with diamond-hard shell, energy shield bubble, glowing core' + SUFFIX,
    'A legendary avocado mega-fortress, golden walls, impenetrable force field, divine shield' + SUFFIX,
  ],
  mangoPult: [
    'A bigger mango catapult with reinforced wooden arm, two mangoes loaded' + SUFFIX,
    'An armored mango catapult with iron frame, triple mango payload, fire-tipped' + SUFFIX,
    'A crystal mango siege engine with golden frame, explosive magma mangoes' + SUFFIX,
    'A legendary mango artillery cannon, golden barrel, nuclear mango payload, epic form' + SUFFIX,
  ],
  kernelPult: [
    'A bigger corn kernel catapult with double arm, butter-coated kernels' + SUFFIX,
    'An armored kernel catapult with steel frame, rapid-fire mechanism, golden kernels' + SUFFIX,
    'A crystal kernel gatling gun with diamond barrel, electric butter rounds' + SUFFIX,
    'A legendary kernel artillery, golden corn cannon, nuclear butter payload, epic form' + SUFFIX,
  ],
  pumpkinSquash: [
    'A bigger pumpkin squash warrior with iron vine legs, fiercer face, larger body' + SUFFIX,
    'An armored pumpkin knight with steel helmet, shield vines, battle-scarred' + SUFFIX,
    'A crystal pumpkin berserker with flaming body, magma veins, devastating stomp power' + SUFFIX,
    'A legendary pumpkin titan, golden armor, colossal size, seismic slam power, epic form' + SUFFIX,
  ],
  torchwood: [
    'A bigger burning torch stump with taller flames, reinforced bark' + SUFFIX,
    'An iron-banded torchwood with blue-hot flames, molten core visible' + SUFFIX,
    'A crystal torchwood with white-hot plasma flames, diamond bark, energy rings' + SUFFIX,
    'A legendary torchwood inferno, golden trunk, solar flare flames, epic final form' + SUFFIX,
  ],
  brainEater: [
    'A bigger zombie brain eater with armored shoulders, holding two brains' + SUFFIX,
    'An armored zombie brain eater with iron helmet, glowing purple eyes, chain mail' + SUFFIX,
    'A mutant brain eater with crystal skull, psychic aura, telekinetic floating brains' + SUFFIX,
    'A legendary brain eater overlord, golden armor, massive psychic crown, epic form' + SUFFIX,
  ],
  veryFastWalker: [
    'A bigger fast zombie with spiked boots, wind trails, more muscular' + SUFFIX,
    'An armored speed zombie with jet-pack exhaust, lightning streaks, chrome plating' + SUFFIX,
    'A crystal speed demon zombie with electric aura, afterimage trails, sonic speed' + SUFFIX,
    'A legendary speed phantom zombie, golden blur, light-speed trails, epic final form' + SUFFIX,
  ],
  skeletonWarrior: [
    'A bigger skeleton warrior with larger sword, iron shield, reinforced bones' + SUFFIX,
    'An armored skeleton knight with full plate armor, flaming sword, tower shield' + SUFFIX,
    'A crystal skeleton champion with diamond bones, energy blade, force shield' + SUFFIX,
    'A legendary skeleton death knight, golden armor, soul-fire greatsword, epic form' + SUFFIX,
  ],
  skeletonArcher: [
    'A bigger skeleton archer with reinforced bow, quiver of iron arrows' + SUFFIX,
    'An armored skeleton marksman with crossbow, scope, steel-tipped bolts' + SUFFIX,
    'A crystal skeleton sniper with energy bow, homing arrows, glowing targeting eye' + SUFFIX,
    'A legendary skeleton arch-ranger, golden bow, explosive star arrows, epic form' + SUFFIX,
  ],
  necromancer: [
    'A bigger necromancer zombie with taller staff, darker robes, stronger aura' + SUFFIX,
    'An armored necromancer with iron-bound tome, double staff, swirling spirits' + SUFFIX,
    'A crystal lich necromancer with phylactery, soul storm, diamond staff' + SUFFIX,
    'A legendary arch-lich, golden robes, reality-warping power, army of spirits, epic form' + SUFFIX,
  ],
  hotTopic: [
    'A bigger hungry zombie with wider jaw, drool puddle, thicker body' + SUFFIX,
    'An armored glutton zombie with iron jaw brace, chain stomach, acid drool' + SUFFIX,
    'A crystal abomination zombie with mutated jaws, bio-acid spray, grotesque power' + SUFFIX,
    'A legendary devourer zombie, golden teeth, void stomach, all-consuming, epic form' + SUFFIX,
  ],
  tridentZombie: [
    'A bigger trident zombie with reinforced trident, shoulder armor, stronger stance' + SUFFIX,
    'An armored trident warrior zombie with full battle gear, electric trident' + SUFFIX,
    'A crystal poseidon zombie with diamond trident, water vortex, storm aura' + SUFFIX,
    'A legendary trident god zombie, golden trident, tsunami power, divine form' + SUFFIX,
  ],
  desertZombie: [
    'A bigger desert mummy zombie with thicker bandages, sand cloud, reinforced wraps' + SUFFIX,
    'An armored pharaoh zombie with golden headpiece, sandstorm aura, ancient power' + SUFFIX,
    'A crystal sphinx zombie with diamond wraps, tornado sand attacks, ancient magic' + SUFFIX,
    'A legendary desert emperor zombie, golden sarcophagus armor, apocalypse sandstorm, epic form' + SUFFIX,
  ],
  cowboyZombie: [
    'A bigger cowboy zombie with reinforced hat, double revolvers, leather armor' + SUFFIX,
    'An armored sheriff zombie with metal badge, shotgun, steel-plated hat' + SUFFIX,
    'A crystal gunslinger zombie with diamond revolvers, bullet-time aura, glowing eyes' + SUFFIX,
    'A legendary outlaw king zombie, golden guns, explosive rounds, epic western form' + SUFFIX,
  ],
  brainRot: [
    'A bigger rotting brain zombie with more toxic aura, double brain throws' + SUFFIX,
    'An armored plague zombie with gas mask, toxic barrel backpack, acid spray' + SUFFIX,
    'A crystal bio-hazard zombie with nuclear brain, radiation rings, mutation aura' + SUFFIX,
    'A legendary plague lord zombie, golden hazmat, nuclear meltdown aura, epic form' + SUFFIX,
  ],
};

fs.mkdirSync(SPRITES_DIR, { recursive: true });

async function generate(name, prompt) {
  const filePath = path.join(SPRITES_DIR, `${name}.png`);
  if (fs.existsSync(filePath)) { console.log(`  Skip: ${name}`); return true; }
  console.log(`  Generating: ${name}...`);
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json' }),
    });
    if (!res.ok) { const e = await res.json(); console.error(`  ERROR: ${e.error?.message}`); return false; }
    const data = await res.json();
    fs.writeFileSync(filePath, Buffer.from(data.data[0].b64_json, 'base64'));
    console.log(`  Saved: ${name}`);
    return true;
  } catch (e) { console.error(`  ERROR: ${e.message}`); return false; }
}

async function main() {
  const entries = [];
  for (const [unitKey, prompts] of Object.entries(EVOLUTION_PROMPTS)) {
    for (let lvl = 0; lvl < prompts.length; lvl++) {
      entries.push([`${unitKey}-L${lvl + 2}`, prompts[lvl]]);
    }
  }

  // Allow filtering by unit key: node scripts/generate-level-sprites.mjs peashooter sunflower
  const filterKeys = process.argv.slice(2);
  const filtered = filterKeys.length > 0
    ? entries.filter(([name]) => filterKeys.some(k => name.startsWith(k)))
    : entries;

  console.log(`Generating ${filtered.length} level sprites...\n`);
  let ok = 0, fail = 0;
  for (let i = 0; i < filtered.length; i++) {
    console.log(`[${i + 1}/${filtered.length}]`);
    const [name, prompt] = filtered[i];
    (await generate(name, prompt)) ? ok++ : fail++;
    if (i < filtered.length - 1) await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`\nDone! ${ok} generated, ${fail} failed.`);
}

main();
```

- [ ] **Step 2: Commit**

```bash
cd /Users/michaglio/Projects/lukas-vs-toby
git add scripts/generate-level-sprites.mjs
git commit -m "feat: add DALL-E level sprite generation script (80 evolution sprites)"
```

- [ ] **Step 3: Run the script to generate sprites (requires OPENAI_API_KEY)**

```bash
cd /Users/michaglio/Projects/lukas-vs-toby
OPENAI_API_KEY=sk-... node scripts/generate-level-sprites.mjs
```

This will take ~15-20 minutes and cost ~$8-10. You can also generate one unit at a time to test:

```bash
OPENAI_API_KEY=sk-... node scripts/generate-level-sprites.mjs peashooter
```

---

### Task 8: Final build and manual test

- [ ] **Step 1: Full build**

Run: `cd /Users/michaglio/Projects/lukas-vs-toby && npm run build`
Expected: Build succeeds

- [ ] **Step 2: Manual test checklist**

Run: `cd /Users/michaglio/Projects/lukas-vs-toby && npm run dev`

Test these scenarios:
1. **Plant merge:** Play as plants. Place a peashooter, then drag another peashooter onto it. Should level up to L2 with stars badge and pulse animation.
2. **Level cap:** Merge a unit 4 times to reach L5. Try to merge again — should be blocked.
3. **Different type block:** Try to merge a sunflower onto a peashooter — should be blocked.
4. **Zombie spawn on occupied tile:** Play as zombies. Place a plant on col 9 (AI should). Spawn your zombie on col 9 — should work.
5. **Zombie auto-merge:** Play as plants. Watch AI zombies. If two same-type zombies overlap on the same row/col for 1 second, they should merge.
6. **HP preservation:** Damage a unit to ~50% HP, then merge it. The merged unit should be at ~50% of its new max HP.
7. **Explosion scaling:** Place a L3 cherry bomb and let it die. It should deal 900 damage (300 * 3) in a 2-tile radius.
8. **Sprite swap:** If L2+ sprites exist, the sprite should change on level-up. If sprites don't exist yet (not generated), the unit keeps its L1 sprite (fallback).

- [ ] **Step 3: Final commit if any fixes needed**

```bash
cd /Users/michaglio/Projects/lukas-vs-toby
git add -A
git commit -m "fix: address issues found during merge system testing"
```
