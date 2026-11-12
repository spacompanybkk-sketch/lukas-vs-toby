/** The two sides: the simulation's own type, so render and simulation can never disagree. */
export type { Faction } from '../sim/types';

// Phase 2 names the view draws before the simulation has them. They are spelled exactly as
// the phase 2 plan gives them (Tasks 1 and 4b); once the simulation exports them, each of
// these becomes a one-line re-export from '../sim/types'.

/** Everything that flies: the ten kinds of shot. */
export type ProjectileKind = 'pea' | 'brain' | 'kernel' | 'butter' | 'mango' | 'sand' | 'arrow' | 'bullet' | 'trident' | 'rot';
/** The six statuses a unit can carry (haste comes from the Frenzy spell). */
export type StatusKind = 'stun' | 'blind' | 'tied' | 'poison' | 'burn' | 'haste';
export type PlantSpell = 'thunderbolt' | 'vines' | 'sunShower' | 'healingRain' | 'rockWall';
export type ZombieSpell = 'meteor' | 'fog' | 'brainFeast' | 'frenzy' | 'graveRise';
export type SpellKey = PlantSpell | ZombieSpell;
