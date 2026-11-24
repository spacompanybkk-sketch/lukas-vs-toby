import { describe, expect, it } from 'vitest';
import { levelConfig, nextLevel } from '../../src/adventure/campaign';
import { LEVELS, levelById, levelsFor } from '../../src/adventure/levels';
import { applyLevelResult } from '../../src/adventure/rewards';
import type { LevelDef } from '../../src/adventure/types';
import { freePlayCards } from '../../src/ai/levelChecks';
import { BALANCE } from '../../src/data/balance';
import { BOSS_HALF_WIDTH } from '../../src/sim/types';
import { newSave, parseSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { SAMPLE_BATTLE } from './sampleLevels';

// Worlds 4 plan, Task 1 (foundation): world 4 joining the campaign without disturbing a save from
// before it, the new boss keys, and a card unlocked in world 4 reaching the hand.

/** A world-4 level for `side`, number `n`: just enough to stand on the map. */
function w4(side: 'plants' | 'zombies', n: number, over: Partial<LevelDef> = {}): LevelDef {
  const p = side === 'plants' ? 'p' : 'z';
  return { ...SAMPLE_BATTLE, id: `${p}4-${n}`, side, world: 4, n, teaches: null, ...over };
}

const T0 = 1_762_900_000_000;

describe('a save from before world 4', () => {
  /** Every level of worlds 1 to 3 won (`only` limits it). */
  function oldSave(only?: (l: LevelDef) => boolean): Save {
    const s = newSave('p01', 'Lukas', 'peashooter', T0);
    const stars = (side: 'plants' | 'zombies'): Save['plants']['stars'] =>
      Object.fromEntries(LEVELS.filter((l) => l.side === side && l.world <= 3 && (only?.(l) ?? true)).map((l) => [l.id, 1 as const]));
    const raw = { ...s, plants: { stars: stars('plants'), unlocked: [] }, zombies: { stars: stars('zombies'), unlocked: [] } };
    const parsed = parseSave(JSON.parse(JSON.stringify(raw)));
    if (parsed === null) throw new Error('the old save does not parse');
    return parsed;
  }
  const WITH_W4: readonly LevelDef[] = [...LEVELS.filter((l) => l.world <= 3), w4('plants', 1), w4('zombies', 1)];

  it.each(['plants', 'zombies'] as const)('%s: world 4\'s first level is next once worlds 1 to 3 are won', (side) => {
    expect(nextLevel(oldSave(), side, WITH_W4)?.id).toBe(side === 'plants' ? 'p4-1' : 'z4-1');
  });

  it.each(['plants', 'zombies'] as const)('%s: with level 8 of world 3 unwon, world 4 is not next', (side) => {
    const save = oldSave((l) => !(l.side === side && l.world === 3 && l.n === 8));
    expect(nextLevel(save, side, WITH_W4)?.id).toBe(side === 'plants' ? 'p3-8' : 'z3-8');
  });

  it('the shipped levels name a world 4 only when it exists', () => {
    expect(levelsFor('plants', 4).every((l) => l.world === 4)).toBe(true);
    expect(levelsFor('zombies', 4).every((l) => l.world === 4)).toBe(true);
  });
});

describe('the world-4 bosses', () => {
  it('the Yeti walks one lane and the Glowcap stands as wide as the Oak', () => {
    expect(BOSS_HALF_WIDTH.yeti).toBe(0);
    expect(BOSS_HALF_WIDTH.glowcap).toBe(1);
  });

  it('have their rows: the Yeti\'s hp tuned to 10000 (Task 6), the Glowcap\'s to 19000 (Task 7)', () => {
    expect(BALANCE.bosses.yeti.hp).toBe(10000);
    expect(BALANCE.bosses.glowcap.hp).toBe(19000);
  });
});

describe('a card unlocked in world 4', () => {
  const PLANT_CARDS = ['peashooter', 'sunflower', 'walnutBomb', 'pumpkinSquash'] as LevelDef['cards'];
  const ZOMBIE_CARDS = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'brainRot'] as LevelDef['cards'];

  it.each([
    ['plants', 'pumpkinSquash', PLANT_CARDS],
    ['zombies', 'brainRot', ZOMBIE_CARDS],
  ] as const)('%s: unlocking %s puts it in the hand from level 4 on, not in level 3 itself', (side, card, cards) => {
    const l3 = w4(side, 3, { cards: cards.slice(0, 3), unlocks: card });
    const l4 = w4(side, 4, { cards });
    const before = newSave('p01', 'Lukas', 'peashooter', T0);
    expect(levelConfig(l3, before, 1).cards[side]).not.toContain(card);
    expect(levelConfig(l4, before, 1).cards[side]).not.toContain(card);
    const won = applyLevelResult(before, l3, 1, T0 + 1, 'b1');
    expect(won.unlocked).toBe(card);
    expect(levelConfig(l4, won.save, 1).cards[side]).toContain(card);
  });

  it.each([
    ['plants', 'pumpkinSquash'],
    ['zombies', 'brainRot'],
  ] as const)('%s: the graduate\'s Free Play hand holds %s once world 4 unlocks it, and not before', (side, card) => {
    const p = side === 'plants' ? 'p' : 'z';
    const unlock = levelById(`${p}4-3`);
    // The shipped campaign: the card is unlocked by the third level of world 4. A graduate of the campaign
    // without that level (and the world-4 levels after it) does not hold it; with the whole campaign he does.
    expect(unlock?.unlocks).toBe(card);
    const without = LEVELS.filter((l) => !(l.side === side && l.world === 4 && l.n >= 3));
    expect(without.some((l) => l.unlocks === card)).toBe(false);
    expect(freePlayCards(without)[side]).not.toContain(card);
    expect(freePlayCards(LEVELS)[side]).toContain(card);
  });
});
