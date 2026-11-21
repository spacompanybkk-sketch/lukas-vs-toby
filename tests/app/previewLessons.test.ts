import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { previewWorlds } from '../../src/app/previewWorlds';

// The map's stand-in worlds (debug hook only) can carry lessons for the e2e. A world with real levels
// (the Moonlit Meadow, the Frozen Tundra) is never copied over.

const real = LEVELS.filter((d) => d.world === 2);
const W1 = LEVELS.filter((d) => d.world === 1);
const isZ2 = (d: { side: string; world: number }) => d.side === 'zombies' && d.world === 2;

describe('previewWorlds with lessons', () => {
  it('both world 2s have their eight real levels; the copies never duplicate an id', () => {
    expect(real.map((d) => d.id)).toEqual(['p', 'z'].flatMap((s) => Array.from({ length: 8 }, (_, i) => `${s}2-${i + 1}`)));
    for (const ws of [[2], [2, 3, 4, 5]] as const) {
      const more = previewWorlds(LEVELS, [...ws], TEACHES);
      const ids = more.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
      // The real levels come through untouched (their own twists, lessons and unlocks).
      expect(more.filter((d) => d.world === 2)).toEqual(real);
    }
  });

  it('world 2 of the shipped levels is not copied: asking for it alone adds nothing', () => {
    expect(previewWorlds(LEVELS, [2], TEACHES)).toEqual([...LEVELS]);
  });

  it('without lessons: the copies of world 1 teach nothing (as before)', () => {
    const more = previewWorlds(W1, [2]);
    expect(more.filter(isZ2).length).toBe(8);
    expect(more.filter(isZ2).every((d) => d.teaches === null)).toBe(true);
  });

  it('with: each copy of world 1 takes its id\'s lesson, and the lesson\'s card is dealt', () => {
    const more = previewWorlds(W1, [2], TEACHES);
    const byId = (id: string) => more.find((d) => d.id === id)!;
    expect(byId('p2-1').teaches).toEqual(TEACHES['p2-1']);
    expect(byId('p2-1').twist).toEqual({ fog: true });
    expect(byId('z2-1').teaches).toEqual(TEACHES['z2-1']);
    expect(byId('z2-1').twist).toEqual({ iceLanes: [1, 3] });
    expect(byId('p2-4').cards).toContain('mangoPult');
    expect(byId('z2-7').cards).toContain('cowboyZombie');
    expect(byId('z2-2').teaches).toBeNull();
    // The levels given are untouched.
    expect(more.slice(0, W1.length)).toEqual([...W1]);
  });

  it('a stand-in world beyond the real ones still fills (worlds 3–5 on both sides)', () => {
    const more = previewWorlds(LEVELS, [2, 3, 4, 5]);
    for (const side of ['plants', 'zombies']) {
      for (const w of [3, 4, 5]) expect(more.filter((d) => d.side === side && d.world === w).length, `${side} ${w}`).toBe(8);
    }
  });
});
