import type { SimState } from '../sim/types';

/**
 * Every model a match can put on the lawn, to build before it starts so nothing hitches on
 * its first appearance: both hands of cards, and the Bone Minion when a Necromancer can raise
 * one or Grave Rise is dealt to the zombies. (The Rock Wall's rock is no unit model.)
 */
export function modelsFor(state: SimState): string[] {
  const cards = state.config.cards;
  const minions = cards.zombies.includes('necromancer') || state.players.zombies.spells.some((s) => s.key === 'graveRise');
  return [...cards.plants, ...cards.zombies, ...(minions ? ['boneMinion'] : [])];
}
