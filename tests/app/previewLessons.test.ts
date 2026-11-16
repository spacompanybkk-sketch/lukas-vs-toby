import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { previewWorlds } from '../../src/app/previewWorlds';

// The map's stand-in worlds (debug hook only) can carry the world-2 lessons for the e2e. A world with
// real levels (the plants' Moonlit Meadow) is never copied over.

const real = LEVELS.filter((d) => d.side === 'plants' && d.world === 2);
const isZ2 = (d: { side: string; world: number }) => d.side === 'zombies' && d.world === 2;

describe('previewWorlds with lessons', () => {
  it('the Meadow has its eight real levels; the copies never duplicate an id', () => {
    expect(real.map((d) => d.id)).toEqual(Array.from({ length: 8 }, (_, i) => `p2-${i + 1}`));
    for (const ws of [[2], [2, 3, 4, 5]] as const) {
      const more = previewWorlds(LEVELS, [...ws], TEACHES);
      const ids = more.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
      // The real Meadow levels come through untouched (their own fog reach, lessons and unlocks).
      expect(more.filter((d) => d.side === 'plants' && d.world === 2)).toEqual(real);
    }
  });

  it('without: the copies teach nothing (as before)', () => {
    const more = previewWorlds(LEVELS, [2]);
    expect(more.filter(isZ2).length).toBe(8);
    expect(more.filter(isZ2).every((d) => d.teaches === null)).toBe(true);
  });

  it('with: each copy takes its id\'s lesson, and the lesson\'s card is dealt', () => {
    const more = previewWorlds(LEVELS, [2], TEACHES);
    const byId = (id: string) => more.find((d) => d.id === id)!;
    expect(byId('p2-1').teaches).toEqual(TEACHES['p2-1']);
    expect(byId('p2-1').twist).toEqual({ fog: 7 });
    expect(byId('z2-1').teaches).toEqual(TEACHES['z2-1']);
    expect(byId('z2-1').twist).toEqual({ iceLanes: [1, 3] });
    expect(byId('p2-4').cards).toContain('mangoPult');
    expect(byId('z2-7').cards).toContain('cowboyZombie');
    expect(byId('z2-2').teaches).toBeNull();
    // The shipped levels are untouched.
    expect(more.slice(0, LEVELS.length)).toEqual([...LEVELS]);
  });

  it('a stand-in world beyond the real ones still fills (plants world 3, zombies 2–5)', () => {
    const more = previewWorlds(LEVELS, [2, 3, 4, 5]);
    expect(more.filter((d) => d.side === 'plants' && d.world === 3).length).toBe(8);
    for (const w of [2, 3, 4, 5]) expect(more.filter((d) => d.side === 'zombies' && d.world === w).length).toBe(8);
  });
});
