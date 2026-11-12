import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { Cloud } from '../../src/cloud/types';
import { PICTURES, SLOTS, newSave } from '../../src/progress/save';
import type { Save, Slot } from '../../src/progress/save';

export const T0 = 1_762_900_000_000;

/** A hand-turned clock: tests move it with `clock.t = …`. */
export function makeClock(t = T0): { t: number; now: () => number } {
  const c = { t, now: () => c.t };
  return c;
}

export function setup(root: 'v2' | 'v2test' = 'v2'): { db: FakeDatabase; cloud: Cloud; clock: ReturnType<typeof makeClock> } {
  const clock = makeClock();
  const db = new FakeDatabase({ now: clock.now });
  return { db, cloud: createFakeCloud(db, root), clock };
}

export const saveFor = (slot: Slot, name = `N${slot}`, t = T0): Save =>
  newSave(slot, name, PICTURES[(SLOTS.indexOf(slot) + 20) % 20]!, t);

/** 64 hex digits that are nobody's pin hash. */
export const hex = (c: string): string => c.repeat(64);
