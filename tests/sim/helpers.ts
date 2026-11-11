import type { Command, Faction, SimEvent, UnitKey } from '../../src/sim/types';

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
