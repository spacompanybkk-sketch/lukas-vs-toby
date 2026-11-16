import type { SimState } from '../sim/types';

/**
 * Every model a match can put on the lawn, to build before it starts so nothing hitches on
 * its first appearance: both hands of cards, and the Bone Minion when a Necromancer can raise
 * one or Grave Rise is dealt to the zombies, and the level's own boss (that one only: the other
 * bosses' models are never built). (The Rock Wall's rock is no unit model.)
 */
export function modelsFor(state: SimState): string[] {
  const cards = state.config.cards;
  const minions = cards.zombies.includes('necromancer') || state.players.zombies.spells.some((s) => s.key === 'graveRise');
  const boss = state.config.boss;
  return [...cards.plants, ...cards.zombies, ...(minions ? ['boneMinion'] : []), ...(boss ? [boss.key] : [])];
}
