import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { BACKYARD } from '../../src/adventure/levels/backyard';
import { LEVELS, levelById, levelsFor } from '../../src/adventure/levels';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { Match } from '../../src/sim/match';

/** The plan's Task 8 table, in kind, cards, unlocks and spells (the numbers are placeholders). */
const TABLE = {
  plants: [
    ['battle', 1, null, false], ['battle', 2, null, false], ['survive', 3, 'potatoMine', false],
    ['battle', 4, null, true], ['conveyor', 3, null, true], ['survive', 4, 'kernelPult', true],
    ['battle', 5, null, true], ['boss', 5, null, true],
  ],
  zombies: [
    ['battle', 1, null, false], ['battle', 2, null, false], ['breakthrough', 3, 'desertZombie', false],
    ['battle', 4, null, true], ['conveyor', 4, null, true], ['breakthrough', 4, 'skeletonArcher', true],
    ['battle', 5, null, true], ['boss', 5, null, true],
  ],
} as const;

describe('the Backyard (placeholder data)', () => {
  it('has eight levels a side, ids p1-1 … p1-8 and z1-1 … z1-8', () => {
    expect(BACKYARD).toHaveLength(16);
    expect(levelsFor('plants', 1).map((l) => l.id)).toEqual(['p1-1', 'p1-2', 'p1-3', 'p1-4', 'p1-5', 'p1-6', 'p1-7', 'p1-8']);
    expect(levelsFor('zombies', 1).map((l) => l.id)).toEqual(['z1-1', 'z1-2', 'z1-3', 'z1-4', 'z1-5', 'z1-6', 'z1-7', 'z1-8']);
    expect(levelsFor('plants', 2)).toEqual([]);
    expect(LEVELS).toBe(BACKYARD);
    expect(levelById('z1-5')?.kind).toBe('conveyor');
    expect(levelById('nope')).toBeNull();
  });

  it.each(['plants', 'zombies'] as const)('%s follow the table in kind, cards, unlocks and spells', (side) => {
    levelsFor(side, 1).forEach((l, i) => {
      const [kind, cards, unlocks, spells] = TABLE[side][i]!;
      expect(l.kind, l.id).toBe(kind);
      expect(l.side).toBe(side);
      expect(l.n).toBe(i + 1);
      // The level deals its side's first cards in spec 6.6 order; a conveyor deals its belt's.
      if (kind === 'conveyor') expect(l.cards, l.id).toEqual(l.belt?.cards);
      else expect(l.cards, l.id).toEqual(ALL_CARDS[side].slice(0, cards));
      expect(l.unlocks, l.id).toBe(unlocks);
      expect(l.spells, l.id).toBe(spells);
      expect(l.boss !== null, l.id).toBe(kind === 'boss');
      expect(l.belt !== null, l.id).toBe(kind === 'conveyor');
      expect(l.seconds !== null, l.id).toBe(kind === 'survive' || kind === 'breakthrough' || kind === 'conveyor');
      // Scripted arrivals are the enemy's.
      for (const s of l.waves) expect(factionOf(s.unit), `${l.id} ${s.unit}`).not.toBe(side);
    });
  });

  it('every level builds a match a fresh player can start', () => {
    for (const l of BACKYARD) {
      const save = newSave('p01', 'Lukas', 'peashooter', 0);
      expect(() => new Match(levelConfig(l, save, 7)), l.id).not.toThrow();
    }
  });
});
