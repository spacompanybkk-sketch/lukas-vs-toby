import type { TutorialStep } from '../types';

/**
 * The tutorial of each level, by level id, kept apart from the level data (`backyard.ts`) so a
 * retune of a level never touches its lessons. `LEVELS` puts each list on its level's `teaches`.
 *
 * Levels 1–3 of each side teach by pointing and doing, with no words (the younger player cannot
 * read); level 2 introduces the hero when it first becomes ready, level 4 the spells when the first
 * one does, level 5 (the conveyor) the belt. Tiles are chosen in lanes the level's first arrivals use (plants) or that nothing
 * guards (zombies), so the first unit placed does its job where the child can see it.
 */
export const TEACHES: Readonly<Record<string, readonly TutorialStep[]>> = {
  // Pick the Peashooter, put it in the lane the Brain Eaters walk down.
  'p1-1': [
    { id: 'p1-1.card', show: 'card', card: 'peashooter', until: 'selected' },
    { id: 'p1-1.tile', show: 'tile', card: 'peashooter', lane: 2, col: 1, until: 'placed' },
  ],
  // A Sunflower at the back (its Sun pays for more), then a Peashooter in front of it; the hero.
  'p1-2': [
    { id: 'p1-2.sun-card', show: 'card', card: 'sunflower', until: 'selected' },
    { id: 'p1-2.sun-tile', show: 'tile', card: 'sunflower', lane: 1, col: 0, until: 'placed' },
    { id: 'p1-2.pea-card', show: 'card', card: 'peashooter', until: 'selected' },
    { id: 'p1-2.pea-tile', show: 'tile', card: 'peashooter', lane: 1, col: 1, until: 'placed' },
    { id: 'p1-2.hero', show: 'hero', until: 'fired', after: 'hero' },
  ],
  // A Peashooter, then its card again onto it: the level-up arrow.
  'p1-3': [
    { id: 'p1-3.card', show: 'card', card: 'peashooter', until: 'selected' },
    { id: 'p1-3.tile', show: 'tile', card: 'peashooter', lane: 2, col: 1, until: 'placed' },
    { id: 'p1-3.merge-card', show: 'card', card: 'peashooter', until: 'selected' },
    { id: 'p1-3.merge', show: 'unit', card: 'peashooter', until: 'merged' },
  ],
  'p1-4': [{ id: 'p1-4.spell', show: 'spell', index: 0, until: 'fired', after: 'spell' }],
  // The belt: tap whatever card it brings first, put it in the lane the first Brain Eater walks.
  'p1-5': [
    { id: 'p1-5.belt', show: 'belt', until: 'selected' },
    { id: 'p1-5.belt-tile', show: 'belt-tile', lane: 2, col: 1, until: 'placed' },
  ],
  // Pick the Brain Eater, send it down the lane nothing guards.
  'z1-1': [
    { id: 'z1-1.card', show: 'card', card: 'brainEater', until: 'selected' },
    { id: 'z1-1.lane', show: 'tile', card: 'brainEater', lane: 2, col: 9, until: 'placed' },
  ],
  // The Very Fast Walker down an open lane; the hero.
  'z1-2': [
    { id: 'z1-2.card', show: 'card', card: 'veryFastWalker', until: 'selected' },
    { id: 'z1-2.lane', show: 'tile', card: 'veryFastWalker', lane: 0, col: 9, until: 'placed' },
    { id: 'z1-2.hero', show: 'hero', until: 'fired', after: 'hero' },
  ],
  // A Brain Eater down the open middle lane, then its card again onto it.
  'z1-3': [
    { id: 'z1-3.card', show: 'card', card: 'brainEater', until: 'selected' },
    { id: 'z1-3.lane', show: 'tile', card: 'brainEater', lane: 2, col: 9, until: 'placed' },
    { id: 'z1-3.merge-card', show: 'card', card: 'brainEater', until: 'selected' },
    { id: 'z1-3.merge', show: 'unit', card: 'brainEater', until: 'merged' },
  ],
  'z1-4': [{ id: 'z1-4.spell', show: 'spell', index: 0, until: 'fired', after: 'spell' }],
  // The belt: tap the card it brings first, send it down the middle lane.
  'z1-5': [
    { id: 'z1-5.belt', show: 'belt', until: 'selected' },
    { id: 'z1-5.belt-tile', show: 'belt-tile', lane: 2, col: 9, until: 'placed' },
  ],
};
