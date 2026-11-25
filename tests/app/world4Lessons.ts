import { levelById } from '../../src/adventure/levels';
import { trickle } from '../../src/adventure/levels/helpers';
import { TEACHES } from '../../src/adventure/levels/teaches';
import type { LevelDef, LevelTwist } from '../../src/adventure/types';
import type { BattleController } from '../../src/app/BattleController';
import { w3Save } from './world3Lessons';
import { lessonController } from './world2Lessons';
import type { Save } from '../../src/progress/save';
import type { CardKey, Faction } from '../../src/sim/types';

/**
 * Stand-ins for the world-4 levels that teach (p4-1, p4-4, z4-1, z4-4): the real `p4.ts` / `z4.ts`
 * are written by Tasks 6-7, so these are world-1 levels under the world-4 id, with the twist and
 * cards the content design gives that level and its lesson from `TEACHES`. A glove tile is on no
 * rock; p4-4's lane 1 is iced (its tile is not).
 */
function standIn(from: string, id: string, twist: LevelTwist, cards: CardKey[] | undefined, extra: Partial<LevelDef> = {}): LevelDef {
  const def = levelById(from)!;
  const n = Number(id.split('-')[1]);
  return { ...def, id, world: 4, n, twist, unlocks: null, cards: cards ?? def.cards, teaches: [...(TEACHES[id] ?? [])], ...extra };
}

const PLANTS: CardKey[] = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult'];
const ZOMBIES: CardKey[] = ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher'];

/** p4-4's scripted trickle (plan Ruling 12): a Brain Eater down lane 1 from 20 s, one every 6 s. */
export const SQUASH_TRICKLE = trickle('brainEater', 20, 6, 4, [1]);

export const W4: Record<string, LevelDef> = {
  'p4-1': standIn('p1-1', 'p4-1', { iceLanes: [1, 3] }, undefined),
  'p4-4': standIn('p1-1', 'p4-4', { iceLanes: [1, 3] }, [...PLANTS, 'pumpkinSquash'], { waves: SQUASH_TRICKLE }),
  'z4-1': standIn('z1-1', 'z4-1', { fog: 6 }, undefined),
  'z4-4': standIn('z1-1', 'z4-4', { fog: 6 }, [...ZOMBIES, 'brainRot']),
};

/** A player who has every card of worlds 1-4 (so far) on `side`. */
export function w4Save(side: Faction): Save {
  const save = w3Save(side);
  const more: CardKey[] = side === 'plants' ? ['pumpkinSquash'] : ['brainRot'];
  return { ...save, [side]: { ...save[side], unlocked: [...save[side].unlocked, ...more] } };
}

/** `def` played by `save`'s owner with the steps they have not done (all with `replay`). */
export function w4Controller(def: LevelDef, seed = 3, save: Save = w4Save(def.side), replay = false): BattleController {
  return lessonController(def, seed, save, replay);
}
