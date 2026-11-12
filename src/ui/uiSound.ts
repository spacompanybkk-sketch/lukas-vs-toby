import type { SfxName } from '../audio/sfx';

/** Where the menus' sounds go (the game's audio engine; nothing in tests unless one is set). */
let sink: ((name: SfxName) => void) | null = null;

export function setUiSound(fn: ((name: SfxName) => void) | null): void {
  sink = fn;
}

/** A menu sound: a key press, a refusal, a coin. Never throws. */
export function uiSound(name: SfxName): void {
  try {
    sink?.(name);
  } catch (e) {
    console.error('ui sound failed', e);
  }
}
