import { describe, expect, it } from 'vitest';
import { PICTURES, SLOTS, newSave, parseSave, totalStars, touch, validName } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { ALL_CARDS } from '../../src/data/units';

const T0 = 1_762_900_000_000;

describe('slots and pictures', () => {
  it('has 30 slots p01 … p30', () => {
    expect(SLOTS).toHaveLength(30);
    expect(SLOTS[0]).toBe('p01');
    expect(SLOTS[9]).toBe('p10');
    expect(SLOTS[29]).toBe('p30');
    expect(new Set(SLOTS).size).toBe(30);
  });

  it('offers the 20 unit cards as pictures, plants then zombies', () => {
    expect(PICTURES).toEqual([...ALL_CARDS.plants, ...ALL_CARDS.zombies]);
    expect(PICTURES).toHaveLength(20);
  });
});

describe('newSave', () => {
  it('starts with no coins, no upgrades, no progress and Medium for both sides', () => {
    expect(newSave('p01', 'Lukas', 'peashooter', T0)).toEqual({
      v: 1, slot: 'p01', name: 'Lukas', picture: 'peashooter',
      coins: 0, upgrades: {},
      plants: { stars: {}, unlocked: [] }, zombies: { stars: {}, unlocked: [] },
      bestWave: 0, versusWins: 0, computerWins: 0,
      difficulty: { plants: 'medium', zombies: 'medium' },
      importedOld: false, updatedAt: T0,
      lastBattle: null, teached: [], bestGarden: 0,
      adventureDifficulty: { plants: 'medium', zombies: 'medium' },
    });
  });

  it('gives every player the same defaults (Toby\'s Easy is set when he is created)', () => {
    expect(newSave('p02', 'Toby', 'brainEater', T0).difficulty).toEqual({ plants: 'medium', zombies: 'medium' });
  });

  it('is accepted by parseSave', () => {
    const s = newSave('p17', 'Ann7', 'brainRot', T0);
    expect(parseSave(s)).toEqual(s);
    expect(parseSave(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('validName', () => {
  it.each([
    ['Lukas', true], ['a', true], ['ABCDEFGHIJ', true], ['Toby2', true], ['  Toby  ', true],
    ['', false], ['   ', false], ['ABCDEFGHIJK', false], ['Toby!', false], ['Lu kas', false],
    ['Łukas', false], ['Toby_', false],
  ])('%j → %s', (name, ok) => {
    expect(validName(name)).toBe(ok);
  });
});

describe('parseSave', () => {
  const good: Save = {
    ...newSave('p05', 'Mia', 'sunflower', T0),
    coins: 120,
    upgrades: { peashooter: 3, brainEater: 10, sunflower: 0 },
    plants: { stars: { 'w1-1': 3, 'w1-2': 0 }, unlocked: ['peashooter', 'sunflower'] },
    zombies: { stars: { 'w1-1': 1 }, unlocked: ['brainEater'] },
    bestWave: 12, versusWins: 2, computerWins: 7,
    difficulty: { plants: 'hard', zombies: 'easy' },
    importedOld: true,
    lastBattle: 'b-17',
    teached: ['p1-1:0', 'p1-1:1'],
    bestGarden: 4,
    adventureDifficulty: { plants: 'medium', zombies: 'hard' },
  };
  const g = good as unknown as Record<string, unknown>;

  it('accepts a full, valid save', () => {
    expect(parseSave(good)).toEqual(good);
  });

  const without = (key: string): unknown => {
    const o: Record<string, unknown> = { ...g };
    delete o[key];
    return o;
  };

  it.each<[string, unknown]>([
    ['not an object', 'save'],
    ['null', null],
    ['an array', [good]],
    ['extra v (version 2)', { ...g, v: 2 }],
    ['unknown extra key', { ...g, hat: 'red' }],
    ['missing key coins', without('coins')],
    ['missing key updatedAt', without('updatedAt')],
    ['missing key importedOld', without('importedOld')],
    ['missing key zombies', without('zombies')],
    ['slot p00', { ...g, slot: 'p00' }],
    ['slot p31', { ...g, slot: 'p31' }],
    ['slot p5', { ...g, slot: 'p5' }],
    ['name of 11 letters', { ...g, name: 'ABCDEFGHIJK' }],
    ['empty name', { ...g, name: '' }],
    ['name with a space', { ...g, name: 'Mi a' }],
    ['untrimmed name', { ...g, name: ' Mia' }],
    ['unknown picture', { ...g, picture: 'boneMinion' }],
    ['picture not a string', { ...g, picture: 3 }],
    ['negative coins', { ...g, coins: -1 }],
    ['fractional coins', { ...g, coins: 1.5 }],
    ['coins as text', { ...g, coins: '5' }],
    ['coins NaN', { ...g, coins: Number.NaN }],
    ['coins Infinity', { ...g, coins: Number.POSITIVE_INFINITY }],
    ['upgrade 11', { ...g, upgrades: { peashooter: 11 } }],
    ['upgrade -1', { ...g, upgrades: { peashooter: -1 } }],
    ['upgrade 2.5', { ...g, upgrades: { peashooter: 2.5 } }],
    ['upgrade of a non-card', { ...g, upgrades: { boneMinion: 1 } }],
    ['upgrades an array', { ...g, upgrades: [1, 2] }],
    ['star 4', { ...g, plants: { stars: { 'w1-1': 4 }, unlocked: [] } }],
    ['star 1.5', { ...g, plants: { stars: { 'w1-1': 1.5 }, unlocked: [] } }],
    ['level id with a slash', { ...g, plants: { stars: { 'w1/1': 1 }, unlocked: [] } }],
    ['level id of digits', { ...g, plants: { stars: { '0': 1 }, unlocked: [] } }],
    ['level id starting with a digit', { ...g, plants: { stars: { '1-1': 1 }, unlocked: [] } }],
    ['level id starting with a dash', { ...g, plants: { stars: { '-a': 1 }, unlocked: [] } }],
    ['level id of 33 characters', { ...g, plants: { stars: { ['w'.repeat(33)]: 1 }, unlocked: [] } }],
    ['zombie unlocked on the plant side', { ...g, plants: { stars: {}, unlocked: ['brainEater'] } }],
    ['unlocked twice', { ...g, plants: { stars: {}, unlocked: ['peashooter', 'peashooter'] } }],
    ['side with an extra key', { ...g, plants: { stars: {}, unlocked: [], x: 1 } }],
    ['side missing unlocked', { ...g, plants: { stars: {} } }],
    ['negative bestWave', { ...g, bestWave: -1 }],
    ['fractional versusWins', { ...g, versusWins: 0.5 }],
    ['computerWins as text', { ...g, computerWins: '1' }],
    ['unknown difficulty', { ...g, difficulty: { plants: 'nightmare', zombies: 'easy' } }],
    ['difficulty missing a side', { ...g, difficulty: { plants: 'easy' } }],
    ['importedOld not a boolean', { ...g, importedOld: 1 }],
    ['lastBattle a number', { ...g, lastBattle: 7 }],
    ['lastBattle empty', { ...g, lastBattle: '' }],
    ['lastBattle of 65 characters', { ...g, lastBattle: 'b'.repeat(65) }],
    ['teached not a list', { ...g, teached: 'p1-1:0' }],
    ['teached with a number', { ...g, teached: [1] }],
    ['teached with an empty step', { ...g, teached: [''] }],
    ['teached with a step of 65 characters', { ...g, teached: ['t'.repeat(65)] }],
    ['teached twice', { ...g, teached: ['a', 'a'] }],
    ['bestGarden negative', { ...g, bestGarden: -1 }],
    ['bestGarden a fraction', { ...g, bestGarden: 1.5 }],
    ['bestGarden a string', { ...g, bestGarden: '3' }],
    ['bestGarden null', { ...g, bestGarden: null }],
    ['teached with 129 steps', { ...g, teached: Array.from({ length: 129 }, (_, i) => `s${i}`) }],
    ['negative updatedAt', { ...g, updatedAt: -5 }],
    ['fractional updatedAt', { ...g, updatedAt: 1.25 }],
  ])('rejects %s', (_what, raw) => {
    expect(parseSave(raw)).toBeNull();
  });

  it('reads a save written before lastBattle and teached existed, with their defaults', () => {
    const old: Record<string, unknown> = { ...g };
    delete old.lastBattle;
    delete old.teached;
    delete old.bestGarden;
    delete old.adventureDifficulty;
    expect(parseSave(old)).toEqual({
      ...good, lastBattle: null, teached: [], bestGarden: 0, adventureDifficulty: { plants: 'hard', zombies: 'easy' },
    });
  });

  it('review focus 4: a save written before adventureDifficulty reads with it seeded from difficulty', () => {
    const old: Record<string, unknown> = { ...g };
    delete old.adventureDifficulty;
    const parsed = parseSave(JSON.parse(JSON.stringify(old)))!;
    expect(parsed.adventureDifficulty).toEqual({ plants: 'hard', zombies: 'easy' });
    expect(parsed.difficulty).toEqual({ plants: 'hard', zombies: 'easy' });
    // The two are separate objects: changing one later never changes the other.
    expect(parsed.adventureDifficulty).not.toBe(parsed.difficulty);
  });

  it.each<[string, unknown]>([
    ['a skill that does not exist', { plants: 'insane', zombies: 'easy' }],
    ['a side missing', { plants: 'easy' }],
    ['an extra side', { plants: 'easy', zombies: 'easy', robots: 'easy' }],
    ['a string', 'easy'],
    ['null', null],
  ])('rejects adventureDifficulty with %s', (_what, value) => {
    expect(parseSave({ ...g, adventureDifficulty: value })).toBeNull();
  });

  it.each<[string, string]>([['lastBattle', 'teached'], ['teached', 'lastBattle']])(
    'reads a save that has only one of them (missing %s)', (missing, kept) => {
      const o: Record<string, unknown> = { ...g };
      delete o[missing];
      const parsed = parseSave(o)!;
      expect(parsed[kept as 'lastBattle' | 'teached']).toEqual(good[kept as 'lastBattle' | 'teached']);
      expect(parsed[missing as 'lastBattle' | 'teached']).toEqual(missing === 'lastBattle' ? null : []);
    },
  );

  it('accepts teached with exactly 128 steps', () => {
    const teached = Array.from({ length: 128 }, (_, i) => `s${i}`);
    expect(parseSave({ ...g, teached })?.teached).toEqual(teached);
  });

  it('accepts lastBattle null', () => {
    expect(parseSave({ ...g, lastBattle: null })).toEqual({ ...good, lastBattle: null });
  });

  it('returns a copy that does not share objects with its input', () => {
    const raw = JSON.parse(JSON.stringify(good)) as Save;
    const parsed = parseSave(raw)!;
    raw.upgrades.peashooter = 9;
    raw.plants.unlocked.push('torchwood');
    raw.teached.push('z1-1:0');
    expect(parsed.teached).toEqual(['p1-1:0', 'p1-1:1']);
    expect(parsed.upgrades.peashooter).toBe(3);
    expect(parsed.plants.unlocked).toEqual(['peashooter', 'sunflower']);
  });
});

describe('totalStars', () => {
  it('adds the stars of both sides', () => {
    const s = newSave('p03', 'Max', 'torchwood', T0);
    expect(totalStars(s)).toBe(0);
    const t: Save = { ...s, plants: { stars: { a: 3, b: 2 }, unlocked: [] }, zombies: { stars: { a: 1, c: 0 }, unlocked: [] } };
    expect(totalStars(t)).toBe(6);
  });
});

describe('touch', () => {
  it('sets updatedAt and leaves the original alone', () => {
    const s = newSave('p01', 'Lukas', 'peashooter', T0);
    const t = touch(s, T0 + 500);
    expect(t.updatedAt).toBe(T0 + 500);
    expect(s.updatedAt).toBe(T0);
    expect(t).not.toBe(s);
  });

  it('always moves forward, even when the clock does not', () => {
    const s = newSave('p01', 'Lukas', 'peashooter', T0);
    expect(touch(s, T0).updatedAt).toBe(T0 + 1);
    expect(touch(s, T0 - 9_000).updatedAt).toBe(T0 + 1);
  });
});
