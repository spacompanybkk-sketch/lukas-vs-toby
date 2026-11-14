import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lawnOf, nextLevel } from '../../src/adventure/campaign';
import { flag, garden, regrow, trickle } from '../../src/adventure/levels/helpers';
import { LEVELS, levelsFor } from '../../src/adventure/levels';
import { P2 } from '../../src/adventure/levels/p2';
import { Z2 } from '../../src/adventure/levels/z2';
import type { LevelDef, LevelTwist } from '../../src/adventure/types';
import { BALANCE } from '../../src/data/balance';
import { newSave, parseSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { mapIslands, mapStones, openingWorld, twistKinds } from '../../src/ui/screens/mapModel';
import { SAMPLE_BATTLE } from './sampleLevels';

// Campaign step 2, Task 1 (foundation): world 2's level files join the campaign without touching
// world 1, the fog reach is per level, and a save from before world 2 opens it once it has levels.

/** World 1's levels as JSON, written before the helpers moved out of `backyard.ts`. */
const WORLD1_BEFORE = JSON.parse(readFileSync(new URL('./fixtures/world1-levels.json', import.meta.url), 'utf8')) as unknown;

describe('world 1 after the move', () => {
  it('is the same data, level for level', () => {
    const now = JSON.parse(JSON.stringify(LEVELS.filter((l) => l.world === 1))) as unknown;
    expect(now).toEqual(WORLD1_BEFORE);
  });

  it('is all of LEVELS while world 2 has no levels yet', () => {
    expect(P2).toEqual([]);
    expect(Z2).toEqual([]);
    expect(LEVELS.every((l) => l.world === 1)).toBe(true);
    expect(LEVELS).toHaveLength(16);
  });
});

describe('the level helpers', () => {
  it('trickle cycles its lanes at a steady beat', () => {
    expect(trickle('brainEater', 10, 5, 3, [1, 3])).toEqual([
      { at: 10, unit: 'brainEater', lane: 1, level: 1 },
      { at: 15, unit: 'brainEater', lane: 3, level: 1 },
      { at: 20, unit: 'brainEater', lane: 1, level: 1 },
    ]);
  });

  it('flag, garden and regrow say where and when', () => {
    expect(flag('brainEater', 30, [0, 4], 1, 2)).toEqual([
      { at: 30, unit: 'brainEater', lane: 0, level: 2 },
      { at: 31, unit: 'brainEater', lane: 4, level: 2 },
    ]);
    expect(garden('peashooter', [[1, 2]])).toEqual([{ at: 0, unit: 'peashooter', lane: 1, col: 2, level: 1 }]);
    expect(regrow('peashooter', [[40, 3, 1]])).toEqual([{ at: 40, unit: 'peashooter', lane: 3, col: 1 }]);
  });
});

describe('fog reach per level', () => {
  it('a number is the reach; true is the balance reach', () => {
    expect(lawnOf({ fog: 7 }).fog).toBe(7);
    expect(lawnOf({ fog: 5 }).fog).toBe(5);
    expect(lawnOf({ fog: true }).fog).toBe(BALANCE.twists.fog.reach);
    expect(lawnOf({ rocks: [1] }).fog).toBeNull();
  });

  it('the level card draws the fog for a numeric fog too', () => {
    const def: LevelDef = { ...SAMPLE_BATTLE, twist: { fog: 7 } };
    expect(twistKinds(def)).toEqual(['fog']);
    const both: LevelTwist = { fog: 5, iceLanes: [1] };
    expect(twistKinds({ ...SAMPLE_BATTLE, twist: both })).toEqual(['fog', 'ice']);
  });
});

/** A world-2 level for `side`, number `n`: just enough to stand on the map. */
function w2(side: 'plants' | 'zombies', n: number): LevelDef {
  const p = side === 'plants' ? 'p' : 'z';
  return { ...SAMPLE_BATTLE, id: `${p}2-${n}`, side, world: 2, n, teaches: null, twist: side === 'plants' ? { fog: 7 } : { iceLanes: [0, 4] } };
}

describe('a save from before world 2', () => {
  const T0 = 1_762_900_000_000;
  /** p1-8 and z1-8 done: every world-1 level with stars, as a save written before this plan. */
  function oldSave(): Save {
    const s = newSave('p01', 'Lukas', 'peashooter', T0);
    const stars = (side: 'plants' | 'zombies'): Save['plants']['stars'] =>
      Object.fromEntries(levelsFor(side, 1).map((l, i) => [l.id, ((i % 3) + 1) as 1 | 2 | 3]));
    const raw = { ...s, plants: { stars: stars('plants'), unlocked: ['potatoMine', 'kernelPult'] }, zombies: { stars: stars('zombies'), unlocked: ['desertZombie', 'skeletonArcher'] } };
    const parsed = parseSave(JSON.parse(JSON.stringify(raw)));
    if (parsed === null) throw new Error('the old save does not parse');
    return parsed;
  }
  const WITH_W2: readonly LevelDef[] = [...LEVELS, w2('plants', 1), w2('plants', 2), w2('zombies', 1), w2('zombies', 2)];

  it.each(['plants', 'zombies'] as const)('%s: world 2\'s first level is next and its island opens', (side) => {
    const save = oldSave();
    const next = nextLevel(save, side, WITH_W2);
    expect(next?.id).toBe(side === 'plants' ? 'p2-1' : 'z2-1');
    expect(openingWorld(save, side, WITH_W2)).toBe(2);
    const islands = mapIslands(save, side, WITH_W2);
    expect(islands.find((i) => i.world === 2)?.locked).toBe(false);
    expect(islands.filter((i) => i.world > 2).every((i) => i.locked)).toBe(true);
    expect(mapStones(save, side, 2, WITH_W2).map((s) => s.state)).toEqual(['next', 'closed']);
  });

  it.each(['plants', 'zombies'] as const)('%s: world 1 reads the same as without world 2', (side) => {
    const save = oldSave();
    expect(mapStones(save, side, 1, WITH_W2)).toEqual(mapStones(save, side, 1, LEVELS));
    expect(mapIslands(save, side, WITH_W2)[0]).toEqual(mapIslands(save, side, LEVELS)[0]);
  });

  it.each(['plants', 'zombies'] as const)('%s: with the shipped (empty) world 2 nothing changes: world 1, all done', (side) => {
    const save = oldSave();
    expect(nextLevel(save, side, LEVELS)).toBeNull();
    expect(openingWorld(save, side, LEVELS)).toBe(1);
  });
});
