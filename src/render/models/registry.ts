import { prewarmModel } from '../voxel/build';
import { brainTitan } from './bosses/brainTitan';
import { elderOak } from './bosses/elderOak';
import type { BossKey } from '../../sim/types';
import type { ModelDef } from '../voxel/types';
import { avocadoBunker } from './plants/avocadoBunker';
import { cherryBomber } from './plants/cherryBomber';
import { kernelPult } from './plants/kernelPult';
import { mangoPult } from './plants/mangoPult';
import { peashooter } from './plants/peashooter';
import { potatoMine } from './plants/potatoMine';
import { pumpkinSquash } from './plants/pumpkinSquash';
import { sunflower } from './plants/sunflower';
import { torchwood } from './plants/torchwood';
import { walnutBomb } from './plants/walnutBomb';
import { boneMinion } from './zombies/boneMinion';
import { brainEater } from './zombies/brainEater';
import { brainRot } from './zombies/brainRot';
import { cowboyZombie } from './zombies/cowboyZombie';
import { desertZombie } from './zombies/desertZombie';
import { hotTopic } from './zombies/hotTopic';
import { necromancer } from './zombies/necromancer';
import { skeletonArcher } from './zombies/skeletonArcher';
import { skeletonWarrior } from './zombies/skeletonWarrior';
import { tridentZombie } from './zombies/tridentZombie';
import { veryFastWalker } from './zombies/veryFastWalker';

// Every model the game can show, by key. To add a unit: write its definition in
// `plants/` or `zombies/`, then add it to the list at the bottom of this file.

const models = new Map<string, ModelDef>();

/** Adds a model under its key. A second model with the same key replaces the first. */
export function registerModel(def: ModelDef): void {
  models.set(def.key, def);
}

export function hasModel(key: string): boolean {
  return models.has(key);
}

/** The model registered under `key`. Throws if there is none. */
export function getModelDef(key: string): ModelDef {
  const def = models.get(key);
  if (!def) throw new Error(`No model is registered as "${key}". Known models: ${[...models.keys()].join(', ')}`);
  return def;
}

/** Every registered key, in the order the models were registered. */
export function modelKeys(): string[] {
  return [...models.keys()];
}

/**
 * Builds the named models at the given levels (all five unless told otherwise) and makes
 * their materials, so that the first unit of each to appear, or a merge in the middle of a
 * match, has nothing left to build. Call it while a level loads.
 */
export function prewarmModels(keys: string[], levels: number[] = [1, 2, 3, 4, 5]): void {
  for (const key of keys) {
    const def = getModelDef(key);
    for (const level of levels) prewarmModel(def, level);
  }
}

/** Each boss's model, by its key (its looks and sounds are its row in `data/bossLooks.ts`). */
export const BOSS_MODELS: Readonly<Record<BossKey, ModelDef>> = {
  brainTitan,
  elderOak,
  // stub: Task 2. The world-2 bosses stand in the Titan's and the Oak's models (under their own keys).
  moonHowler: { ...brainTitan, key: 'moonHowler' },
  frostMelon: { ...elderOak, key: 'frostMelon' },
};

for (const def of [peashooter, sunflower, walnutBomb, potatoMine, kernelPult, mangoPult, avocadoBunker, torchwood, cherryBomber, pumpkinSquash, brainEater, veryFastWalker, skeletonWarrior, desertZombie, skeletonArcher, hotTopic, cowboyZombie, necromancer, tridentZombie, brainRot, boneMinion, ...Object.values(BOSS_MODELS)]) registerModel(def);
