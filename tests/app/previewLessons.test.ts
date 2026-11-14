import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { previewWorlds } from '../../src/app/previewWorlds';

// The map's stand-in worlds (debug hook only) can carry the world-2 lessons for the e2e.

describe('previewWorlds with lessons', () => {
  it('without: the copies teach nothing (as before)', () => {
    const more = previewWorlds(LEVELS, [2]);
    expect(more.filter((d) => d.world === 2).every((d) => d.teaches === null)).toBe(true);
  });

  it('with: each copy takes its id\'s lesson, and the lesson\'s card is dealt', () => {
    const more = previewWorlds(LEVELS, [2], TEACHES);
    const byId = (id: string) => more.find((d) => d.id === id)!;
    expect(byId('p2-1').teaches).toEqual(TEACHES['p2-1']);
    expect(byId('p2-1').twist).toEqual({ fog: true });
    expect(byId('z2-1').teaches).toEqual(TEACHES['z2-1']);
    expect(byId('z2-1').twist).toEqual({ iceLanes: [1, 3] });
    expect(byId('p2-4').cards).toContain('mangoPult');
    expect(byId('z2-7').cards).toContain('cowboyZombie');
    expect(byId('p2-2').teaches).toBeNull();
    // World 1 is untouched.
    expect(more.filter((d) => d.world === 1)).toEqual([...LEVELS]);
  });
});
