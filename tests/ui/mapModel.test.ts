import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/adventure/levels';
import { previewWorlds } from '../../src/app/previewWorlds';
import { newSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { mapIslands, mapStones, openingWorld, twistKinds } from '../../src/ui/screens/mapModel';

const NOW = 1_762_900_000_000;
const fresh = newSave('p01', 'Lukas', 'peashooter', NOW);
/** The shipped levels plus stand-in worlds 2 and 3 for each side (copies of world 1 with their twist). */
const MORE = previewWorlds(LEVELS);
const won = (prefix: string, n = 8): Record<string, 3> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}-${i + 1}`, 3]));

describe('mapIslands: one island per world, in the side\'s own order', () => {
  it('the plants travel backyard → citadel; the zombies citadel → backyard (Toby\'s first island is the Citadel)', () => {
    expect(mapIslands(fresh, 'plants').map((i) => i.arena)).toEqual(['backyard', 'meadow', 'desert', 'tundra', 'citadel']);
    expect(mapIslands(fresh, 'zombies').map((i) => i.arena)).toEqual(['citadel', 'tundra', 'desert', 'meadow', 'backyard']);
    expect(mapIslands(fresh, 'zombies').map((i) => i.world)).toEqual([1, 2, 3, 4, 5]);
  });

  it('shipped levels: world 1 is open for both sides; worlds 2–5 have no levels yet and are locked', () => {
    for (const side of ['plants', 'zombies'] as const) {
      expect(mapIslands(fresh, side).map((i) => i.locked)).toEqual([false, true, true, true, true]);
    }
  });

  it('a world with levels opens when its first level does (the last level of the world before won)', () => {
    expect(mapIslands(fresh, 'plants', MORE).map((i) => i.locked)).toEqual([false, true, true, true, true]);
    const s: Save = { ...fresh, plants: { stars: won('p1'), unlocked: [] } };
    expect(mapIslands(s, 'plants', MORE).map((i) => i.locked)).toEqual([false, false, true, true, true]);
    // The other side's progress is its own.
    expect(mapIslands(s, 'zombies', MORE).map((i) => i.locked)).toEqual([false, true, true, true, true]);
  });

  it('counts the stars won on each island', () => {
    const s: Save = { ...fresh, plants: { stars: { ...won('p1'), 'p2-1': 2 }, unlocked: [] } };
    expect(mapIslands(s, 'plants', MORE).map((i) => i.stars)).toEqual([24, 2, 0, 0, 0]);
  });
});

describe('openingWorld: the map opens on the world of the next level', () => {
  it('a new player opens on world 1', () => {
    expect(openingWorld(fresh, 'plants')).toBe(1);
    expect(openingWorld(fresh, 'zombies', MORE)).toBe(1);
  });
  it('world 1 won: world 2 when it has levels, else world 1 stays', () => {
    const s: Save = { ...fresh, zombies: { stars: won('z1'), unlocked: [] } };
    expect(openingWorld(s, 'zombies', MORE)).toBe(2);
    expect(openingWorld(s, 'zombies')).toBe(1);
  });
  it('everything won: the last world with levels', () => {
    const s: Save = { ...fresh, plants: { stars: { ...won('p1'), ...won('p2'), ...won('p3') }, unlocked: [] } };
    expect(openingWorld(s, 'plants', MORE)).toBe(3);
  });
});

describe('mapStones(save, side, world)', () => {
  it('world 1 is the default and the levels default to the shipped ones', () => {
    expect(mapStones(fresh, 'plants', 1)).toEqual(mapStones(fresh, 'plants'));
    expect(mapStones(fresh, 'plants', 1, LEVELS).map((s) => s.def.id)).toEqual(Array.from({ length: 8 }, (_, i) => `p1-${i + 1}`));
  });
  it('a later world\'s stones: closed until the world before is won, then its first is next', () => {
    expect(mapStones(fresh, 'plants', 2, MORE).map((s) => s.state)).toEqual(Array(8).fill('closed'));
    const s: Save = { ...fresh, plants: { stars: won('p1'), unlocked: [] } };
    const stones = mapStones(s, 'plants', 2, MORE);
    expect(stones.map((x) => x.def.id)[0]).toBe('p2-1');
    expect(stones.map((x) => x.state)).toEqual(['next', 'closed', 'closed', 'closed', 'closed', 'closed', 'closed', 'closed']);
  });
  it('a world without levels has no stones', () => {
    expect(mapStones(fresh, 'zombies', 4)).toEqual([]);
    expect(mapStones(fresh, 'zombies', 4, MORE)).toEqual([]);
  });
});

describe('twistKinds: the twist pictures a level card shows', () => {
  it('none for a level without a twist; one per twist set, in a fixed order', () => {
    const def = LEVELS[0]!;
    expect(twistKinds(def)).toEqual([]);
    expect(twistKinds({ ...def, twist: { fog: true } })).toEqual(['fog']);
    expect(twistKinds({ ...def, twist: { lavaTiles: [3], rocks: [1], iceLanes: [2], fog: true } })).toEqual(['fog', 'rocks', 'ice', 'lava']);
    // An empty list is no twist (as the sim reads it).
    expect(twistKinds({ ...def, twist: { rocks: [], iceLanes: [] } })).toEqual([]);
  });
  it('the stand-in worlds carry their arena\'s twist: plants meadow fog, zombies tundra ice', () => {
    expect(twistKinds(MORE.find((l) => l.id === 'p2-1')!)).toEqual(['fog']);
    expect(twistKinds(MORE.find((l) => l.id === 'z2-1')!)).toEqual(['ice']);
    expect(twistKinds(MORE.find((l) => l.id === 'p3-4')!)).toEqual(['rocks']);
  });
});
