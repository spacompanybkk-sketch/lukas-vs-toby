import type { SfxName } from '../audio/sfx';

/** Where the menus' sounds go (the game's audio engine; nothing in tests unless one is set). */
let sink: ((name: SfxName, opts?: UiSoundOptions) => void) | null = null;

/** `pitch`: 1 is the sound as made, 2 an octave up. */
export interface UiSoundOptions { pitch?: number }

export function setUiSound(fn: ((name: SfxName, opts?: UiSoundOptions) => void) | null): void {
  sink = fn;
}

/** A menu sound: a key press, a refusal, a coin. Never throws. */
export function uiSound(name: SfxName, opts?: UiSoundOptions): void {
  try {
    if (opts === undefined) sink?.(name);
    else sink?.(name, opts);
  } catch (e) {
    console.error('ui sound failed', e);
  }
}
