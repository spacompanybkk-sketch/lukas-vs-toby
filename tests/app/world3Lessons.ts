import { levelById } from '../../src/adventure/levels';
import { rocks, trickle } from '../../src/adventure/levels/helpers';
import { TEACHES } from '../../src/adventure/levels/teaches';
import type { LevelDef, LevelTwist, Spawn } from '../../src/adventure/types';
import type { BattleController } from '../../src/app/BattleController';
import { w2Save, lessonController } from './world2Lessons';
import type { Save } from '../../src/progress/save';
import type { CardKey, Faction } from '../../src/sim/types';

/**
 * Stand-ins for the world-3 levels that teach (plan Ruling 10): the real `p3.ts` / `z3.ts` are
 * written by Tasks 6-7, so these are world-1 levels under the world-3 id, with the rocks and cards
 * the content design gives that level and its lesson from `TEACHES`. A rock sits on no glove tile.
 */
function standIn(from: string, id: string, twist: LevelTwist, cards: CardKey[] | undefined, extra: Partial<LevelDef> = {}): LevelDef {
  const def = levelById(from)!;
  const n = Number(id.split('-')[1]);
  return { ...def, id, world: 3, n, twist, unlocks: null, cards: cards ?? def.cards, teaches: [...(TEACHES[id] ?? [])], ...extra };
}

const PLANTS: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'];
const ZOMBIES: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'];

/** The 40 s clump of p3-7, walking lane 2. */
export const CLUMP: Spawn[] = trickle('brainEater', 40, 0.5, 4, [2]);

export const W3: Record<string, LevelDef> = {
  'p3-1': standIn('p1-1', 'p3-1', { rocks: rocks([[0, 3], [1, 5], [2, 2], [3, 6], [4, 4]]) }, undefined),
  'p3-4': standIn('p1-1', 'p3-4', { rocks: rocks([[0, 3], [1, 5], [3, 6], [4, 4]]) }, [...PLANTS, 'torchwood']),
  'p3-7': standIn('p1-1', 'p3-7', { rocks: rocks([[0, 3], [1, 5], [3, 6], [4, 4]]) }, [...PLANTS, 'torchwood', 'cherryBomber'], { waves: CLUMP }),
  'z3-1': standIn('z1-1', 'z3-1', { rocks: rocks([[0, 3], [1, 5], [2, 2], [3, 6], [4, 4]]) }, undefined),
  'z3-4': standIn('z1-1', 'z3-4', { rocks: rocks([[0, 3], [1, 5], [3, 6], [4, 4]]) }, [...ZOMBIES, 'necromancer']),
  'z3-7': standIn('z1-1', 'z3-7', { rocks: rocks([[0, 3], [1, 5], [3, 6], [4, 4]]) }, [...ZOMBIES, 'necromancer', 'tridentZombie']),
};

/** A player who has every card of worlds 1-3 on `side`. */
export function w3Save(side: Faction): Save {
  const save = w2Save(side);
  const more: CardKey[] = side === 'plants' ? ['torchwood', 'cherryBomber'] : ['necromancer', 'tridentZombie'];
  return { ...save, [side]: { ...save[side], unlocked: [...save[side].unlocked, ...more] } };
}

/** `def` played by `save`'s owner with the steps they have not done (all with `replay`). */
export function w3Controller(def: LevelDef, seed = 3, save: Save = w3Save(def.side), replay = false): BattleController {
  return lessonController(def, seed, save, replay);
}
