import { isSlot, parseSave } from './save';
import type { Save, Slot } from './save';

/** The device copy of each player's save, and who played last. Storage is injected as in settings.ts. */
const saveKey = (slot: Slot): string => `lvt2_save_${slot}`;
const LAST_SLOT = 'lvt2_last_slot';

/** `localStorage`, or undefined where there is none or touching it throws (Safari private mode, node). */
function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The device copy of `slot`'s save; null when there is none or it is unreadable or someone else's. */
export function loadLocal(slot: Slot, storage: Storage | undefined = defaultStorage()): Save | null {
  try {
    const text = storage?.getItem(saveKey(slot));
    if (text === null || text === undefined) return null;
    const s = parseSave(JSON.parse(text));
    return s && s.slot === slot ? s : null;
  } catch {
    return null;
  }
}

/** Writes the device copy; a full or blocked storage is ignored (the game plays on from memory). */
export function saveLocal(s: Save, storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(saveKey(s.slot), JSON.stringify(s));
  } catch {
    // Nothing to do: this device simply keeps no copy.
  }
}

/** Forgets the device copy of `slot`'s save (the player was deleted). */
export function removeLocal(slot: Slot, storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(saveKey(slot));
  } catch {
    // Nothing to do.
  }
}

export function lastSlot(storage: Storage | undefined = defaultStorage()): Slot | null {
  try {
    const v = storage?.getItem(LAST_SLOT);
    return isSlot(v) ? v : null;
  } catch {
    return null;
  }
}

export function setLastSlot(slot: Slot | null, storage: Storage | undefined = defaultStorage()): void {
  try {
    if (slot === null) storage?.removeItem(LAST_SLOT);
    else storage?.setItem(LAST_SLOT, slot);
  } catch {
    // Nothing to do.
  }
}
