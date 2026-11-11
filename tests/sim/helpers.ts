import type { Command, Faction, SimEvent, UnitKey } from '../../src/sim/types';

export type PlaceCommand = Extract<Command, { type: 'place' }>;

export function place(faction: Faction, unit: UnitKey, lane: number, col: number): PlaceCommand {
  return { type: 'place', faction, unit, lane, col };
}

/** The events of one type, narrowed to that type. */
export function eventsOf<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Array<Extract<SimEvent, { type: T }>> {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}
