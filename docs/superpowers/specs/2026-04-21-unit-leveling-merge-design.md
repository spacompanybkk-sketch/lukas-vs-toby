# Unit Leveling & Merge System Design

## Overview

Units can be leveled up (L1-L5) by merging two of the same type on a single tile. Players merge by dragging a duplicate unit onto an existing one. Moving zombies auto-merge when overlapping the same tile for 1 second. All combat stats scale linearly with level. Each level gets a unique DALL-E generated evolution sprite.

## Stats Scaling

All combat stats multiply by the unit's level:

| Level | Damage | Attack Speed | HP | Range |
|-------|--------|-------------|-----|-------|
| L1 | 1x | 1x | 1x | fixed |
| L2 | 2x | 2x | 2x | fixed |
| L3 | 3x | 3x | 3x | fixed |
| L4 | 4x | 4x | 4x | fixed |
| L5 | 5x | 5x | 5x | fixed |

- **Damage:** Base damage * level (e.g., Peashooter L3 = 7 * 3 = 21)
- **Attack Speed:** Base interval / level (e.g., Peashooter L3 = 2700ms / 3 = 900ms)
- **HP:** Base HP * level (e.g., Peashooter L3 = 180 * 3 = 540)
- **Range:** Stays fixed at base value. Doubling range would break the 10-column grid.
- **Explosion damage** (cherry bomb, walnut bomb, potato mine): Also scales by level multiplier.
- **Cost per merge:** The unit's base energy cost each time. A L5 Peashooter costs 5 x 100 = 500 total energy.

## Merge Mechanics

### Player Merge (drag-drop)

1. Player drags a unit card onto a tile occupied by the **same unit type**
2. Energy is spent (normal unit cost)
3. Existing unit levels up: L1 -> L2, L2 -> L3, etc.
4. HP is preserved as a percentage: if the existing unit was at 60% HP, the merged unit starts at 60% of the new level's max HP
5. Sprite swaps to the new level's DALL-E image
6. Brief scale-up pulse animation plays

**Blocked conditions:**
- Tile has a different unit type -> blocked (no placement)
- Tile unit is already L5 -> blocked
- Not enough energy -> blocked

### Zombie Auto-Merge (moving units)

1. When two same-type zombies occupy the same grid cell (col rounded to nearest integer), a 1-second overlap timer starts
2. After 1 second of continuous overlap, they merge
3. The higher-level unit absorbs the lower-level one. If same level, the older unit (earlier spawn) absorbs the newer one
4. Timer resets if they separate before 1 second completes
5. L5 units don't trigger merge checks
6. HP percentage is preserved on the surviving unit (same rule as player merge)

### What Cannot Merge

- Different unit types
- Different factions
- Units already at L5
- Stationary plants don't auto-merge (only via player drag-drop)

## Architecture

### UnitState Changes (`src/game/entities/Unit.ts`)

Add to `UnitState`:
- `level: number` property (default 1, max 5)
- `levelUp(newLevel: number): void` method:
  - Stores current HP percentage
  - Recalculates maxHp, damage, attackSpeed based on base stats * newLevel
  - Restores HP to the stored percentage of new maxHp

Base stats need to be stored on construction so level multipliers can be recalculated:
- `baseHp`, `baseDamage`, `baseAttackSpeed` (readonly, set in constructor)

### MergeManager (`src/game/systems/MergeManager.ts`)

New system class following the existing Manager pattern (like CombatManager, EnergyManager):

```
MergeManager
  canMerge(unitA: UnitState, unitB: UnitState): boolean
    - Same key (unit type)
    - Same faction
    - Neither at L5

  merge(existing: UnitState, incoming: UnitState): MergeResult
    - Levels up the existing unit
    - Returns { survivor: UnitState, consumed: UnitState, newTextureKey: string }

  trackOverlap(unitA: UnitState, unitB: UnitState, delta: number): MergeResult | null
    - Manages per-pair timers (keyed by sorted unit ID pair)
    - Returns MergeResult after 1 second of overlap, null otherwise

  clearTimer(unitId: string): void
    - Removes all timers involving this unit (called on unit death)
```

`MergeResult`:
```typescript
interface MergeResult {
  survivor: UnitState;
  consumed: UnitState;
  newTextureKey: string;  // e.g., 'peashooter-L3'
}
```

### DragDropManager Changes (`src/game/systems/DragDropManager.ts`)

Currently blocks placement on occupied tiles. Change the `dragend` handler:

1. If tile is empty -> place as normal (existing behavior)
2. If tile is occupied:
   a. Find the unit on that tile
   b. If same type and can merge -> spend energy, call `onMergeUnit(unitKey, row, col)` callback
   c. Otherwise -> blocked (do nothing)

New callback: `onMergeUnit: (unitKey: string, row: number, col: number) => void`

### BattleScene Integration (`src/game/scenes/BattleScene.ts`)

1. **Instantiate MergeManager** in `create()` alongside other managers

2. **DragDropManager merge callback:**
   - Find existing unit at (row, col)
   - Call `mergeManager.merge(existing, newUnit)`
   - Destroy the consumed unit's sprite/healthbar
   - Swap survivor's sprite texture to `newTextureKey`
   - Play pulse animation
   - Update level badge

3. **Zombie auto-merge in `updateMovement()`:**
   - After moving all zombies, find same-type pairs sharing the same rounded col + row
   - Pass pairs to `mergeManager.trackOverlap(a, b, delta)`
   - If merge returned, destroy consumed unit visuals, swap survivor sprite, animate

4. **Cleanup:** In `cleanupDeadUnits()`, call `mergeManager.clearTimer(deadUnit.id)`

### Level Badge Overlay

- Phaser text object attached to each unit sprite
- Positioned at bottom-right of the sprite
- Shows star count: L1=none, L2=bronze star, L3=silver stars, L4=gold stars, L5=purple/diamond stars
- Color scheme: L2=#CD7F32, L3=#C0C0C0, L4=#FFD700, L5=#B265FF
- Created alongside sprite in `spawnUnit()`, updated on level-up

## Sprite Generation

### Script: `scripts/generate-level-sprites.mjs`

Follows the existing `generate-phase2-sprites.mjs` pattern:
- Uses DALL-E 3, standard quality, 1024x1024
- Skips existing files (idempotent)
- 80 new images: 20 units x 4 levels (L2-L5)
- File naming: `{unitKey}-L{level}.png` (e.g., `peashooter-L2.png`)
- Output directory: `public/assets/sprites/`
- Estimated cost: ~$8-10 in DALL-E credits

### Prompt Strategy (Evolution Style)

Each unit gets progressively more evolved prompts. All prompts end with the standard suffix:
`"Minecraft pixel art style, blocky voxel look, game sprite, solid dark background, no text, centered"`

**Level progression pattern:**
- **L2:** Slightly larger version with minor enhancements (leaf shield, small spikes, reinforced)
- **L3:** Visible armor or aura, color intensification, additional features
- **L4:** Major transformation with elemental effects (fire, electricity, crystal)
- **L5:** Final legendary/epic form, fully evolved, glowing, dramatic

Example — Peashooter:
- L2: "A bigger peashooter plant with a small leaf shield and double-barrel mouth"
- L3: "An armored peashooter with iron plating, glowing green eyes, triple barrels"
- L4: "A battle-mech peashooter with cannon barrels, electric aura, crystal armor"
- L5: "A massive legendary golden peashooter mech, quad cannons, radiant energy field, epic final form"

Each of the 20 units will have custom per-level prompts written in the generation script.

### BootScene Changes

Load all level sprites in `preload()`:
```typescript
const allUnits = ['peashooter', 'sunflower', ...all 20 unit keys];
for (const unit of allUnits) {
  for (let lvl = 2; lvl <= 5; lvl++) {
    this.load.image(`${unit}-L${lvl}`, `/assets/sprites/${unit}-L${lvl}.png`);
  }
}
```

L1 continues using the existing texture key (no suffix change).

## Constants Changes (`src/game/constants.ts`)

Add:
```typescript
export const MAX_UNIT_LEVEL = 5;
export const MERGE_OVERLAP_DURATION = 1000; // ms for zombie auto-merge
```

Level multiplier helper:
```typescript
export function getLevelMultipliers(level: number): { hpMult: number; damageMult: number; attackSpeedMult: number } {
  return { hpMult: level, damageMult: level, attackSpeedMult: level };
}
```

## Files Changed

| File | Change |
|------|--------|
| `src/game/entities/Unit.ts` | Add level, baseStats, levelUp() |
| `src/game/systems/MergeManager.ts` | **New file** — merge logic & overlap timers |
| `src/game/systems/DragDropManager.ts` | Support merge-on-occupied-tile |
| `src/game/systems/GridManager.ts` | Add `getUnitKeyAt()` helper (optional) |
| `src/game/scenes/BattleScene.ts` | Wire up MergeManager, handle merge visuals |
| `src/game/scenes/BootScene.ts` | Load level sprites |
| `src/game/constants.ts` | Add MAX_UNIT_LEVEL, MERGE_OVERLAP_DURATION, getLevelMultipliers |
| `scripts/generate-level-sprites.mjs` | **New file** — DALL-E generation for L2-L5 sprites |

## Out of Scope

- Merging across different unit types (no "fusion")
- Level-based unlock gating (all levels available if you can afford it)
- AI using merge strategy (AI spawns individual units, doesn't merge)
- Multiplayer merge synchronization (handled separately if needed)
