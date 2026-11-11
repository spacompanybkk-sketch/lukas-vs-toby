import type { Balance } from '../data/balance';
import type { SimEvent, SimState } from './types';

/** Step stage 4: units attack, in ascending id. Empty until the combat work fills it in. */
export function tickAttacks(s: SimState, b: Balance, events: SimEvent[]): void {}

/** Step stage 5: projectiles fly and hit, in ascending id. Empty until the combat work fills it in. */
export function tickProjectiles(s: SimState, b: Balance, events: SimEvent[]): void {}

/** Step stage 6: deaths, bounties and blasts, repeated until no unit is at or below zero. Empty for now. */
export function resolveDeaths(s: SimState, b: Balance, events: SimEvent[]): void {}
