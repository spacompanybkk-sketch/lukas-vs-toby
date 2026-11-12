import type { CardKey } from '../sim/types';
import type { Save, SideProgress } from './save';

/**
 * Two copies of one player's save that both changed since they last agreed (two devices, or one
 * offline for a while), made into one so that nothing either side earned is lost:
 *
 * - stars: the best per level, per side; unlocked cards: the union;
 * - coins, bestWave, versusWins, computerWins, upgrade levels: the larger;
 * - name, picture, difficulty: from the copy with the newer `updatedAt`;
 * - importedOld: true if either copy imported the old save.
 *
 * A child who spends coins on both devices at once may keep a few coins or an upgrade for free;
 * that is accepted (losing progress is not). The result is stamped `now`, past both copies.
 */
export function mergeSaves(a: Save, b: Save, now: number): Save {
  if (a.slot !== b.slot) throw new Error(`cannot merge saves of ${a.slot} and ${b.slot}`);
  const [newer, older] = a.updatedAt >= b.updatedAt ? [a, b] : [b, a];

  const upgrades: Partial<Record<CardKey, number>> = { ...newer.upgrades };
  for (const [k, n] of Object.entries(older.upgrades) as [CardKey, number][]) {
    upgrades[k] = Math.max(upgrades[k] ?? 0, n);
  }

  const side = (n: SideProgress, o: SideProgress): SideProgress => {
    const stars: SideProgress['stars'] = { ...n.stars };
    for (const [id, s] of Object.entries(o.stars)) stars[id] = Math.max(stars[id] ?? 0, s) as 0 | 1 | 2 | 3;
    const unlocked = [...n.unlocked, ...o.unlocked.filter((k) => !n.unlocked.includes(k))];
    return { stars, unlocked };
  };

  return {
    v: 1,
    slot: newer.slot,
    name: newer.name,
    picture: newer.picture,
    coins: Math.max(a.coins, b.coins),
    upgrades,
    plants: side(newer.plants, older.plants),
    zombies: side(newer.zombies, older.zombies),
    bestWave: Math.max(a.bestWave, b.bestWave),
    versusWins: Math.max(a.versusWins, b.versusWins),
    computerWins: Math.max(a.computerWins, b.computerWins),
    difficulty: { ...newer.difficulty },
    importedOld: a.importedOld || b.importedOld,
    updatedAt: Math.max(Math.floor(now), newer.updatedAt + 1),
  };
}
