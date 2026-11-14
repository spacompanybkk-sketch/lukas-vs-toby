/** What the page can tell about the device (all of it read once, before the game mounts). */
export interface DeviceFacts {
  /** `navigator.maxTouchPoints`. */
  maxTouchPoints: number;
  /** `matchMedia('(pointer: coarse)').matches`. */
  coarsePointer: boolean;
  /** `screen.width` and `screen.height` in CSS px (the device's screen, not the window). */
  screenWidth: number;
  screenHeight: number;
}

/** A phone's screen is under this on its shorter side; the smallest iPad (mini) is 744. */
export const PHONE_SCREEN_MAX = 600;

/**
 * Whether this is a phone: a touch device whose SCREEN is under 600 CSS px on its shorter side.
 * The window does not count, so a small browser window on a computer, or an iPad in split view,
 * still gets the game.
 */
export function isPhone(d: DeviceFacts): boolean {
  const touch = d.maxTouchPoints > 0 || d.coarsePointer;
  return touch && Math.min(d.screenWidth, d.screenHeight) < PHONE_SCREEN_MAX;
}

/** Reads the device facts from the browser. */
export function readDeviceFacts(): DeviceFacts {
  return {
    maxTouchPoints: navigator.maxTouchPoints || 0,
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    screenWidth: screen.width,
    screenHeight: screen.height,
  };
}
