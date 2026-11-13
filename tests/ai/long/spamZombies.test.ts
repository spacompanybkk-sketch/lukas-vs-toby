import { describe } from 'vitest';
import { bandTests } from './bandTest';

describe('balance bands: spam, zombies cards (seeds 1..N)', () => {
  bandTests(/^spam$/, / (brainEater|veryFastWalker|skeletonWarrior|desertZombie|skeletonArcher|hotTopic|cowboyZombie|necromancer|tridentZombie|brainRot)$/);
});
