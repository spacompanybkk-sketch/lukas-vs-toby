/**
 * The two sides. The simulation has the same union in `src/sim/types.ts`; this copy exists
 * because render code must build without it for now, and gives way to an import of the
 * simulation's type once both are in one checkout.
 */
export type Faction = 'plants' | 'zombies';
