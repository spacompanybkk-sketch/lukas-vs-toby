/**
 * An older build cached on this device cannot read a save a newer build wrote (the save keeps
 * keys strictly: an unknown one makes it unreadable). At the pin pad that would leave a child on
 * a device with no copy of their own looking at a cross for ever. So, in that one case, the page
 * reloads once to fetch the current build: only online, only before anyone is logged in (never
 * in the middle of play), and at most once per browser session (a flag in `sessionStorage`), so
 * a save that stays unreadable after the reload gets the ordinary refusal, not a loop.
 */
export const STALE_RELOAD_KEY = 'lvt2_stale_reload';

export interface StaleBuildDeps {
  /** The browser session's storage (`sessionStorage`); without one there is no guard, so no reload. */
  session: Storage | undefined;
  online(): boolean;
  /** Whether a player is logged in (then this is a sync during play, not the pin pad). */
  loggedIn(): boolean;
  reload(): void;
}

/** Reloads the page for a newer build when that is safe (see above); true if it did. */
export function reloadForUnreadableSave(d: StaleBuildDeps): boolean {
  if (!d.online() || d.loggedIn() || d.session === undefined) return false;
  try {
    if (d.session.getItem(STALE_RELOAD_KEY) !== null) return false;
    d.session.setItem(STALE_RELOAD_KEY, '1');
  } catch {
    return false;
  }
  d.reload();
  return true;
}
