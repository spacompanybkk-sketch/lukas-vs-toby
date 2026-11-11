import type { ModelDef } from '../voxel/types';
import { peashooter } from './plants/peashooter';

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

for (const def of [peashooter]) registerModel(def);
