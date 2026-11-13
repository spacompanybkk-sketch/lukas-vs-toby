import type { LevelDef } from '../../src/adventure/types';

/** Two small sample levels for the tests (not real content: the Backyard's sixteen come in Task 8). */

/** A plant Battle against an Easy computer, with a card the player has not unlocked yet. */
export const SAMPLE_BATTLE: LevelDef = {
  id: 'p1-1', side: 'plants', world: 1, n: 1, kind: 'battle',
  cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine'],
  opponent: { skill: 'easy', cards: ['brainEater', 'veryFastWalker'], incomeScale: 0.8 },
  waves: [], prepared: [], seconds: null, belt: null, boss: null, startEnergy: null,
  spells: false, unlocks: null,
  teaches: [{ show: 'card', target: 'peashooter', until: 'selected' }],
};

/** A plant Survive with scripted waves (out of order), a prepared Peashooter, a clock and an unlock. */
export const SAMPLE_SURVIVE: LevelDef = {
  id: 'p1-2', side: 'plants', world: 1, n: 2, kind: 'survive',
  cards: ['peashooter', 'sunflower'],
  opponent: null,
  waves: [
    { at: 10, unit: 'brainEater', lane: 2 },
    { at: 4.5, unit: 'veryFastWalker', lane: 0, level: 2 },
  ],
  prepared: [{ at: 0, unit: 'peashooter', lane: 1, col: 2 }],
  seconds: 90, belt: null, boss: null, startEnergy: 250,
  spells: true, unlocks: 'potatoMine', teaches: null,
};
