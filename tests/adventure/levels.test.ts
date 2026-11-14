import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import type { LevelDef } from '../../src/adventure/types';
import { BACKYARD } from '../../src/adventure/levels/backyard';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { LEVELS, levelById, levelsFor } from '../../src/adventure/levels';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { BALANCE } from '../../src/data/balance';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';

/** The plan's Task 8 table, in kind, cards, unlocks and spells. */
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

describe('the Backyard', () => {
  it('has eight levels a side, ids p1-1 … p1-8 and z1-1 … z1-8', () => {
    expect(BACKYARD).toHaveLength(16);
    expect(levelsFor('plants', 1).map((l) => l.id)).toEqual(['p1-1', 'p1-2', 'p1-3', 'p1-4', 'p1-5', 'p1-6', 'p1-7', 'p1-8']);
    expect(levelsFor('zombies', 1).map((l) => l.id)).toEqual(['z1-1', 'z1-2', 'z1-3', 'z1-4', 'z1-5', 'z1-6', 'z1-7', 'z1-8']);
    expect(levelsFor('plants', 2)).toEqual([]);
    // LEVELS is the Backyard, each level with its tutorial from TEACHES (Task 6).
    const bare = (ls: readonly LevelDef[]) => ls.map(({ teaches: _, ...rest }) => rest);
    expect(bare(LEVELS)).toEqual(bare(BACKYARD));
    for (const l of LEVELS) expect(l.teaches).toEqual(TEACHES[l.id] ?? null);
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

  it.each(['plants', 'zombies'] as const)('every %s level maps into a config the simulation accepts', (side) => {
    for (const l of levelsFor(side, 1)) {
      // A fresh player, and one who holds every card of the side (every level card dealt).
      const fresh = newSave(side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
      const all = { ...fresh, [side]: { ...fresh[side], unlocked: [...ALL_CARDS[side]] } };
      for (const save of [fresh, all]) {
        const c = levelConfig(l, save, 7);
        expect(() => checkLevel(c, BALANCE), l.id).not.toThrow();
        expect(c.mode, l.id).toBe(l.kind);
        // The belt is the player's own; nothing else of a level is the player's side.
        if (l.kind === 'conveyor') expect(c.belt?.side, l.id).toBe(side);
        else expect(c.belt, l.id).toBeNull();
        expect(c.noEnergy, l.id).toBe(l.kind === 'conveyor');
        // The plants' base is never made unhittable; the zombies' only on a plant survive/conveyor.
        expect(c.invulnerableBase, l.id).toBe(
          side === 'plants' && (l.kind === 'survive' || l.kind === 'conveyor') ? 'zombies' : null,
        );
        // A survive level always has its clock.
        if (l.kind === 'survive') expect(c.goalTicks, l.id).not.toBeNull();
      }
    }
  });

  it('a conveyor level has no computer opponent (it could not pay for cards without energy)', () => {
    const conveyors = BACKYARD.filter((l) => l.kind === 'conveyor');
    expect(conveyors.map((l) => l.id)).toEqual(['p1-5', 'z1-5']);
    for (const l of conveyors) expect(l.opponent, l.id).toBeNull();
  });
});
