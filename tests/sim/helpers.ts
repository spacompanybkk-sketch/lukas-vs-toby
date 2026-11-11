import { defaultConfig } from '../../src/sim/match';
import type { Command, Faction, MatchConfig, SimEvent, UnitKey } from '../../src/sim/types';

/**
 * The default setup with the energy and base health these tests were written for, 200 and 3000 a
 * side, so a test of the rules keeps testing them whatever the tuner does to the shipped starting
 * values in `BALANCE`.
 */
export function classicConfig(seed: number): MatchConfig {
  const config = defaultConfig(seed);
  config.startEnergy = { plants: 200, zombies: 200 };
  config.baseHp = { plants: 3000, zombies: 3000 };
  return config;
}

export type PlaceCommand = Extract<Command, { type: 'place' }>;
export type MergeCommand = Extract<Command, { type: 'merge' }>;
export type RemoveCommand = Extract<Command, { type: 'remove' }>;

export function place(faction: Faction, unit: UnitKey, lane: number, col: number): PlaceCommand {
  return { type: 'place', faction, unit, lane, col };
}

export function merge(faction: Faction, unit: UnitKey, targetId: number): MergeCommand {
  return { type: 'merge', faction, unit, targetId };
}

export function remove(faction: Faction, targetId: number): RemoveCommand {
  return { type: 'remove', faction, targetId };
}

/** The events of one type, narrowed to that type. */
export function eventsOf<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Array<Extract<SimEvent, { type: T }>> {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}
