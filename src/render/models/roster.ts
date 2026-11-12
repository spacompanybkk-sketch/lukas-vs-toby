// The units, by key, in unlock order: the one list the registry, the tests and the
// screenshot tool (`tools/shots.mjs`, which runs under plain Node) all take them from. It
// imports nothing, so Node can load it as it is.

/** The three plants of the first level. */
export const FIRST_PLANTS = ['peashooter', 'sunflower', 'walnutBomb'] as const;

/** The ten plants a player can field (spec section 6.6). */
export const PLANTS = [...FIRST_PLANTS, 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash'] as const;

/** The ten zombies a player can field. */
export const ZOMBIES = [
  'brainEater',
  'veryFastWalker',
  'skeletonWarrior',
  'desertZombie',
  'skeletonArcher',
  'hotTopic',
  'cowboyZombie',
  'necromancer',
  'tridentZombie',
  'brainRot',
] as const;

/** Units that are raised in battle rather than fielded: the Necromancer's Bone Minion. */
export const RAISED = ['boneMinion'] as const;

/** Every unit, in the order the registry lists them. */
export const UNITS = [...PLANTS, ...ZOMBIES, ...RAISED] as const;
