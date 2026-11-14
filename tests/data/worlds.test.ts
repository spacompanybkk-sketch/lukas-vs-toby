import { describe, expect, it } from 'vitest';
import { WORLDS, WORLD_ORDER, arenaOf } from '../../src/data/worlds';
import type { WorldKey } from '../../src/data/worlds';
import { BACKYARD } from '../../src/adventure/levels/backyard';
import { LEVELS } from '../../src/adventure/levels';

describe('worlds', () => {
  it('lists the five worlds in the plants order', () => {
    expect(WORLD_ORDER).toEqual(['backyard', 'meadow', 'desert', 'tundra', 'citadel']);
  });

  it('gives every world a table row', () => {
    for (const key of WORLD_ORDER) {
      const row = WORLDS[key];
      expect(row).toBeDefined();
      expect(row.theme).toBe(key);
    }
    expect(Object.keys(WORLDS).sort()).toEqual([...WORLD_ORDER].sort());
  });

  it('pairs each world with its twist and weather', () => {
    const pairs = WORLD_ORDER.map((k) => [k, WORLDS[k].twist, WORLDS[k].weather]);
    expect(pairs).toEqual([
      ['backyard', 'none', 'none'],
      ['meadow', 'fog', 'fireflies'],
      ['desert', 'rocks', 'dust'],
      ['tundra', 'ice', 'snow'],
      ['citadel', 'lava', 'embers'],
    ]);
  });

  it('walks the plants forward and the zombies in reverse', () => {
    expect(arenaOf('plants', 1)).toBe('backyard');
    expect(arenaOf('plants', 2)).toBe('meadow');
    expect(arenaOf('plants', 5)).toBe('citadel');
    expect(arenaOf('zombies', 1)).toBe('citadel');
    expect(arenaOf('zombies', 3)).toBe('desert');
    expect(arenaOf('zombies', 5)).toBe('backyard');
    const worlds = [1, 2, 3, 4, 5] as const;
    const zombies: WorldKey[] = worlds.map((w) => arenaOf('zombies', w));
    expect(zombies).toEqual([...WORLD_ORDER].reverse());
  });
});

describe('LEVELS as a concatenation', () => {
  it('keeps the Backyard levels, ids and order', () => {
    expect(LEVELS.length).toBe(BACKYARD.length);
    expect(LEVELS.map((l) => l.id)).toEqual(BACKYARD.map((l) => l.id));
  });
});
