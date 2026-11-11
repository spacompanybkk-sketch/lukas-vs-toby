/** Rendering quality the player picks; the renderer maps it to pixel ratio, shadows and effects. */
export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

export interface Settings { music: number; sfx: number; muted: boolean; quality: Quality }

export const DEFAULT_SETTINGS: Settings = Object.freeze({ music: 0.6, sfx: 0.8, muted: false, quality: 'high' });

const KEY = 'lvt2_settings';

/** `localStorage`, or undefined where there is none or touching it throws (Safari private mode, node). */
function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const volume = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;

/** Reads the saved settings. Anything missing, malformed or out of range falls back field by field. */
export function loadSettings(storage: Storage | undefined = defaultStorage()): Settings {
  let raw: unknown = null;
  try {
    const text = storage?.getItem(KEY);
    raw = text === null || text === undefined ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    music: volume(o.music, d.music),
    sfx: volume(o.sfx, d.sfx),
    muted: typeof o.muted === 'boolean' ? o.muted : d.muted,
    quality: QUALITIES.includes(o.quality as Quality) ? (o.quality as Quality) : d.quality,
  };
}

/** Saves the settings; a full or blocked storage is ignored (the game keeps running on what it has). */
export function saveSettings(s: Settings, storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ music: s.music, sfx: s.sfx, muted: s.muted, quality: s.quality }));
  } catch {
    // Nothing to do: settings simply will not persist.
  }
}
