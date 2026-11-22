import { describe, expect, it } from 'vitest';
import { levelConfig, nextLevel } from '../../src/adventure/campaign';
import { rocks } from '../../src/adventure/levels/helpers';
import { LEVELS, levelsFor } from '../../src/adventure/levels';
import { applyLevelResult } from '../../src/adventure/rewards';
import type { LevelDef } from '../../src/adventure/types';
import { newSave, parseSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { SAMPLE_BATTLE } from './sampleLevels';

// Campaign step 3, Task 1 (foundation): the rocks helper, and world 3 joining the campaign
// without disturbing a save from before it.

/** A world-3 level for `side`, number `n`: just enough to stand on the map. */
function w3(side: 'plants' | 'zombies', n: number, over: Partial<LevelDef> = {}): LevelDef {
  const p = side === 'plants' ? 'p' : 'z';
  return { ...SAMPLE_BATTLE, id: `${p}3-${n}`, side, world: 3, n, teaches: null, ...over };
}

const T0 = 1_762_900_000_000;

describe('rocks', () => {
  it('turns [lane, col] pairs into plant-tile indices (lane * 8 + col)', () => {
    expect(rocks([[1, 4], [2, 5], [3, 3]])).toEqual([12, 21, 27]);
    expect(rocks([])).toEqual([]);
  });
});

describe('a save from before world 3', () => {
  /** Every level of worlds 1 and 2 won, as a save written before this step (`only` limits it). */
  function oldSave(only?: (l: LevelDef) => boolean): Save {
    const s = newSave('p01', 'Lukas', 'peashooter', T0);
    const stars = (side: 'plants' | 'zombies'): Save['plants']['stars'] =>
      Object.fromEntries(LEVELS.filter((l) => l.side === side && l.world <= 2 && (only?.(l) ?? true)).map((l) => [l.id, 1 as const]));
    const raw = { ...s, plants: { stars: stars('plants'), unlocked: [] }, zombies: { stars: stars('zombies'), unlocked: [] } };
    const parsed = parseSave(JSON.parse(JSON.stringify(raw)));
    if (parsed === null) throw new Error('the old save does not parse');
    return parsed;
  }
  const WITH_W3: readonly LevelDef[] = [...LEVELS.filter((l) => l.world <= 2), w3('plants', 1), w3('zombies', 1)];

  it.each(['plants', 'zombies'] as const)('%s: world 3\'s first level is next once worlds 1 and 2 are won', (side) => {
    expect(nextLevel(oldSave(), side, WITH_W3)?.id).toBe(side === 'plants' ? 'p3-1' : 'z3-1');
  });

  it('with p2-7 won but not p2-8, p3-1 is not next', () => {
    const save = oldSave((l) => !(l.side === 'plants' && l.world === 2 && l.n === 8));
    expect(nextLevel(save, 'plants', WITH_W3)?.id).toBe('p2-8');
  });

  it('the shipped levels name a world 3 only when it exists', () => {
    expect(levelsFor('plants', 3).every((l) => l.world === 3)).toBe(true);
  });
});

describe('a card unlocked in world 3', () => {
  it('z3-3 unlocking the Necromancer puts it in the hand from z3-4 on', () => {
    const cards = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'necromancer'] as LevelDef['cards'];
    const z33 = w3('zombies', 3, { cards: cards.slice(0, 3), unlocks: 'necromancer' });
    const z34 = w3('zombies', 4, { cards });
    const before = newSave('p01', 'Lukas', 'peashooter', T0);
    expect(levelConfig(z34, before, 1).cards.zombies).not.toContain('necromancer');
    const won = applyLevelResult(before, z33, 1, T0 + 1, 'b1');
    expect(won.unlocked).toBe('necromancer');
    expect(levelConfig(z34, won.save, 1).cards.zombies).toContain('necromancer');
  });
});

