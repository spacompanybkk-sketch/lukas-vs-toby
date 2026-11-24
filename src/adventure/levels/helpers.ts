import { PLANT_COLS } from '../../sim/types';
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

/** Rocks on the plant tiles `[lane, col]`, as `LevelTwist.rocks` indexes them (`lane * PLANT_COLS + col`). */
export const rocks = (tiles: [number, number][]): number[] => tiles.map(([lane, col]) => lane * PLANT_COLS + col);

/**
 * A garden that grows: `unit` arrives on the next free tile, the first at `first` s and one more
 * every `every` s, `count` of them. Free tiles are taken lane by lane in `lanes` order and, within a
 * lane, in `cols` order, skipping every tile in `taken` (rocks and the starting garden as `[lane, col]`).
 */
export function growing(
  unit: Spawn['unit'], taken: [number, number][], lanes: number[], cols: number[],
  { first = 20, every = 12, count = 20 }: { first?: number; every?: number; count?: number } = {},
): Spawn[] {
  const used = new Set(taken.map(([lane, col]) => lane * PLANT_COLS + col));
  const free: [number, number][] = [];
  for (const lane of lanes) {
    for (const col of cols) if (!used.has(lane * PLANT_COLS + col)) free.push([lane, col]);
  }
  return regrow(unit, free.slice(0, count).map(([lane, col], i): [number, number, number] => [first + i * every, lane, col]));
}
