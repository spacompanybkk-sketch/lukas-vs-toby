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

  // World 2 (content design §3, plan Rulings 1–2). Written ahead of the level files (`p2.ts`,
  // `z2.ts`, Tasks 6–7): a lesson whose level is not in `LEVELS` yet is simply not used.
  //
  // The Moonlit Meadow's fog: the camera pans while a ghost pea flies and puffs out at the level's
  // reach; any tap ends it.
  'p2-1': [{ id: 'p2-1.fog', show: 'twist', until: 'tapped' }],
  // The Mango-pult, the first level that deals it: in the middle lane, a little forward.
  'p2-4': [
    { id: 'p2-4.mango-card', show: 'card', card: 'mangoPult', until: 'selected' },
    { id: 'p2-4.mango-tile', show: 'tile', card: 'mangoPult', lane: 2, col: 2, until: 'placed' },
  ],
  // The Avocado Bunker: in front, in the middle lane, holding the line.
  'p2-7': [
    { id: 'p2-7.avocado-card', show: 'card', card: 'avocadoBunker', until: 'selected' },
    { id: 'p2-7.avocado-tile', show: 'tile', card: 'avocadoBunker', lane: 2, col: 4, until: 'placed' },
  ],
  // The Frozen Tundra's ice: the icy lanes pulse and a ghost zombie slides down one; any tap ends it.
  'z2-1': [{ id: 'z2-1.ice', show: 'twist', until: 'tapped' }],
  // Hot Topic, the first level that deals it: down the back lane.
  'z2-4': [
    { id: 'z2-4.hot-card', show: 'card', card: 'hotTopic', until: 'selected' },
    { id: 'z2-4.hot-lane', show: 'tile', card: 'hotTopic', lane: 0, col: 9, until: 'placed' },
  ],
  // The Cowboy Zombie: down the middle lane.
  'z2-7': [
    { id: 'z2-7.cowboy-card', show: 'card', card: 'cowboyZombie', until: 'selected' },
    { id: 'z2-7.cowboy-lane', show: 'tile', card: 'cowboyZombie', lane: 2, col: 9, until: 'placed' },
  ],

  // World 3 (content design §3, plan Rulings 6-8). Written ahead of the level files (`p3.ts`,
  // `z3.ts`, Tasks 6-7), as world 2's were.
  //
  // The Desert Canyon's rocks: the camera eases along the boulders, a ghost Peashooter is refused on
  // one and hops beside it, a ghost Brain Eater walks over it (the zombies' side: it goes first);
  // any tap ends it.
  'p3-1': [{ id: 'p3-1.rocks', show: 'twist', until: 'tapped' }],
  // The Torchwood: in front of the head-start Peashooter at [2,1], so its peas burn.
  'p3-4': [
    { id: 'p3-4.torch-card', show: 'card', card: 'torchwood', until: 'selected' },
    { id: 'p3-4.torch-tile', show: 'tile', card: 'torchwood', lane: 2, col: 2, until: 'placed' },
  ],
  // The Cherry Bomber: its tile waits (no glove, nothing held) until the 40 s clump walking lane 2
  // is in front of it, so the blast lands on the clump and not on empty sand.
  'p3-7': [
    { id: 'p3-7.cherry-card', show: 'card', card: 'cherryBomber', until: 'selected' },
    { id: 'p3-7.cherry-tile', show: 'tile', card: 'cherryBomber', lane: 2, col: 4, until: 'placed', after: 'foe' },
  ],
  'z3-1': [{ id: 'z3-1.rocks', show: 'twist', until: 'tapped' }],
  // The Necromancer: down the middle lane.
  'z3-4': [
    { id: 'z3-4.necro-card', show: 'card', card: 'necromancer', until: 'selected' },
    { id: 'z3-4.necro-lane', show: 'tile', card: 'necromancer', lane: 2, col: 9, until: 'placed' },
  ],
  // The Trident Zombie: down lane 1.
  'z3-7': [
    { id: 'z3-7.trident-card', show: 'card', card: 'tridentZombie', until: 'selected' },
    { id: 'z3-7.trident-lane', show: 'tile', card: 'tridentZombie', lane: 1, col: 9, until: 'placed' },
  ],

  // World 4 (content design §3, plan Rulings 11-12). Written ahead of the level files (`p4.ts`,
  // `z4.ts`, Tasks 6-7), as the earlier worlds' were.
  //
  // The Frozen Tundra's ice for the plants: the icy lanes pulse and a ghost zombie slides down one;
  // any tap ends it.
  'p4-1': [{ id: 'p4-1.ice', show: 'twist', until: 'tapped' }],
  // The Pumpkin Squash: its tile on lane 1 (iced; the tile itself is free) waits, with no glove and
  // nothing held, until a foe stands within 2 tiles in front of it, so the squash lands on a zombie.
  'p4-4': [
    { id: 'p4-4.squash-card', show: 'card', card: 'pumpkinSquash', until: 'selected' },
    { id: 'p4-4.squash-tile', show: 'tile', card: 'pumpkinSquash', lane: 1, col: 3, until: 'placed', after: 'foe' },
  ],
  // The Meadow's fog for the zombies: the ghost Peashooter's pea puffs out at the reach, a ghost
  // Brain Eater walks to the puff point and on to the Peashooter; any tap ends it.
  'z4-1': [{ id: 'z4-1.fog', show: 'twist', until: 'tapped' }],
  // Brain Rot, the first level that deals it: down the third lane, the far end.
  'z4-4': [
    { id: 'z4-4.rot-card', show: 'card', card: 'brainRot', until: 'selected' },
    { id: 'z4-4.rot-lane', show: 'tile', card: 'brainRot', lane: 2, col: 9, until: 'placed' },
  ],
};
