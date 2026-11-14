import { levelById } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import type { LevelDef, LevelTwist } from '../../src/adventure/types';
import { BattleController } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import { stepsToTeach } from '../../src/app/tutorial';
import { newSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import type { CardKey, Faction } from '../../src/sim/types';

/**
 * Stand-ins for the world-2 levels that teach (p2-1, z2-1 and the four new-card levels): the real
 * `p2.ts` / `z2.ts` are written by Tasks 6–7. Each is a world-1 level under the world-2 id, with
 * the twist and cards the content design gives that level (§1) and its lesson from `TEACHES`.
 */
function standIn(from: string, id: string, twist: LevelTwist, cards?: CardKey[]): LevelDef {
  const def = levelById(from)!;
  const n = Number(id.split('-')[1]);
  return { ...def, id, world: 2, n, twist, unlocks: null, cards: cards ?? def.cards, teaches: [...(TEACHES[id] ?? [])] };
}

export const W2: Record<string, LevelDef> = {
  'p2-1': standIn('p1-1', 'p2-1', { fog: 7 }),
  'p2-4': standIn('p1-7', 'p2-4', { fog: 6 }, ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult']),
  'p2-7': standIn('p1-6', 'p2-7', { fog: 5 }, ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker']),
  'z2-1': standIn('z1-1', 'z2-1', { iceLanes: [2] }),
  'z2-4': standIn('z1-4', 'z2-4', { iceLanes: [1, 3] }, ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'hotTopic']),
  'z2-7': standIn('z1-7', 'z2-7', { iceLanes: [0, 1, 3, 4] }, ['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie']),
};

/** A player who has unlocked every card of world 1 and world 2 on `side`. */
export function w2Save(side: Faction): Save {
  const save = newSave(side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
  const unlocked: CardKey[] = side === 'plants'
    ? ['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker']
    : ['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie'];
  return { ...save, [side]: { ...save[side], unlocked } };
}

/** `def` played by `save`'s owner with the steps they have not done (all with `replay`). */
export function lessonController(def: LevelDef, seed = 3, save: Save = w2Save(def.side), replay = false): BattleController {
  return new BattleController(levelOptions({ ...prepareLevel(def, save, seed), teach: stepsToTeach(def.teaches, save, replay) }));
}
