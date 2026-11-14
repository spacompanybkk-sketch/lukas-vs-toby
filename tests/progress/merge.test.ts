import { describe, expect, it } from 'vitest';
import { mergeSaves } from '../../src/progress/merge';
import { newSave, parseSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';

const T0 = 1_762_900_000_000;
const base = newSave('p01', 'Lukas', 'peashooter', T0);

const older: Save = {
  ...base,
  name: 'Lukas', picture: 'peashooter', difficulty: { plants: 'easy', zombies: 'hard' },
  coins: 300, upgrades: { peashooter: 4, sunflower: 1 },
  plants: { stars: { w1: 3, w2: 1 }, unlocked: ['peashooter', 'sunflower'] },
  zombies: { stars: { w1: 1 }, unlocked: ['brainEater'] },
  bestWave: 20, versusWins: 1, computerWins: 9, importedOld: true, updatedAt: T0 + 100,
  lastBattle: 'old-battle', teached: ['p1-1:0', 'p1-2:0'], bestGarden: 9,
  adventureDifficulty: { plants: 'hard', zombies: 'hard' },
};
const newer: Save = {
  ...base,
  name: 'LukasK', picture: 'torchwood', difficulty: { plants: 'hard', zombies: 'medium' },
  coins: 120, upgrades: { peashooter: 2, brainEater: 3 },
  plants: { stars: { w1: 2, w3: 2 }, unlocked: ['peashooter', 'walnutBomb'] },
  zombies: { stars: {}, unlocked: [] },
  bestWave: 7, versusWins: 4, computerWins: 2, importedOld: false, updatedAt: T0 + 200,
  lastBattle: 'new-battle', teached: ['z1-1:0', 'p1-1:0'], bestGarden: 3,
  adventureDifficulty: { plants: 'easy', zombies: 'medium' },
};

describe('mergeSaves: nothing either side earned is lost', () => {
  const m = mergeSaves(older, newer, T0 + 500);

  it.each<[string, unknown]>([
    ['coins = the larger', m.coins === 300],
    ['upgrades = the higher level per unit', JSON.stringify(m.upgrades) === JSON.stringify({ peashooter: 4, brainEater: 3, sunflower: 1 })],
    ['plant stars = the best per level', JSON.stringify(m.plants.stars) === JSON.stringify({ w1: 3, w3: 2, w2: 1 })],
    ['zombie stars = the best per level', JSON.stringify(m.zombies.stars) === JSON.stringify({ w1: 1 })],
    ['unlocked = the union (newer\'s order first)', JSON.stringify(m.plants.unlocked) === JSON.stringify(['peashooter', 'walnutBomb', 'sunflower'])],
    ['zombie unlocked = the union', JSON.stringify(m.zombies.unlocked) === JSON.stringify(['brainEater'])],
    ['bestWave = the larger', m.bestWave === 20],
    ['bestGarden = the larger', m.bestGarden === 9],
    ['versusWins = the larger', m.versusWins === 4],
    ['computerWins = the larger', m.computerWins === 9],
    ['name from the newer', m.name === 'LukasK'],
    ['picture from the newer', m.picture === 'torchwood'],
    ['difficulty from the newer', JSON.stringify(m.difficulty) === JSON.stringify({ plants: 'hard', zombies: 'medium' })],
    ['adventureDifficulty from the newer (as difficulty)', JSON.stringify(m.adventureDifficulty) === JSON.stringify({ plants: 'easy', zombies: 'medium' })],
    ['importedOld = either', m.importedOld === true],
    ['lastBattle from the newer', m.lastBattle === 'new-battle'],
    ['teached = the union (the older copy\'s own steps, then the newer\'s)', JSON.stringify(m.teached) === JSON.stringify(['p1-2:0', 'z1-1:0', 'p1-1:0'])],
    ['stamped now, newer than both', m.updatedAt === T0 + 500],
  ])('%s', (_what, ok) => {
    expect(ok).toBe(true);
  });

  it('is a valid save', () => {
    expect(parseSave(m)).toEqual(m);
  });

  it('does not depend on the order of its arguments', () => {
    expect(mergeSaves(newer, older, T0 + 500)).toEqual(m);
  });

  it('is stamped past both even when the clock lags', () => {
    expect(mergeSaves(older, newer, T0).updatedAt).toBe(T0 + 201);
  });

  it('changes neither input', () => {
    const before = JSON.stringify([older, newer]);
    mergeSaves(older, newer, T0 + 500);
    expect(JSON.stringify([older, newer])).toBe(before);
  });

  it('keeps the newer lastBattle even when it is null', () => {
    expect(mergeSaves(older, { ...newer, lastBattle: null }, T0 + 500).lastBattle).toBeNull();
  });

  it('keeps the newest 128 tutorial steps (the newer copy\'s, then the older\'s own latest), in a stable order', () => {
    const steps = (from: number, n: number): string[] => Array.from({ length: n }, (_, i) => `s${from + i}`);
    const m2 = mergeSaves({ ...older, teached: steps(100, 128) }, { ...newer, teached: steps(0, 128) }, T0 + 500);
    expect(m2.teached).toEqual(steps(0, 128));
    const m3 = mergeSaves({ ...older, teached: steps(50, 100) }, { ...newer, teached: steps(0, 100) }, T0 + 500);
    // The older copy's own steps (100..149) come first; the oldest of them go: 122..149, then 0..99.
    expect(m3.teached).toEqual([...steps(122, 28), ...steps(0, 100)]);
    expect(mergeSaves({ ...newer, teached: steps(0, 100) }, { ...older, teached: steps(50, 100) }, T0 + 500)).toEqual(m3);
    expect(parseSave(m3)).toEqual(m3);
  });

  it('refuses to merge two different slots', () => {
    expect(() => mergeSaves(older, { ...newer, slot: 'p02' }, T0)).toThrow();
  });
});
