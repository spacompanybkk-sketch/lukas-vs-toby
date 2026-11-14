import type { Spawn } from '../types';

// The level files' shorthands for scripted arrivals and standing gardens (moved out of
// `backyard.ts` so every world's file shares them; what they make is unchanged).

/** `count` arrivals of `unit`, `every` seconds apart from `from`, cycling through `lanes`. */
export function trickle(unit: Spawn['unit'], from: number, every: number, count: number, lanes: number[], level = 1): Spawn[] {
  return Array.from({ length: count }, (_, i) => ({ at: from + i * every, unit, lane: lanes[i % lanes.length]!, level }));
}

/** A flag wave: `count` of `unit` at once (`gap` seconds apart), across `lanes`. */
export function flag(unit: Spawn['unit'], at: number, lanes: number[], gap = 0.5, level = 1): Spawn[] {
  return lanes.map((lane, i) => ({ at: at + i * gap, unit, lane, level }));
}

/** Plants standing at the start: `[lane, col]` pairs of `unit`. */
export const garden = (unit: Spawn['unit'], tiles: [number, number][], level = 1): Spawn[] =>
  tiles.map(([lane, col]) => ({ at: 0, unit, lane, col, level }));

/** Plants arriving later on their tiles (a garden that regrows): `[at, lane, col]`. */
export const regrow = (unit: Spawn['unit'], at: [number, number, number][]): Spawn[] =>
  at.map(([t, lane, col]) => ({ at: t, unit, lane, col }));
