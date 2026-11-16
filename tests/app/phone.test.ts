import { describe, expect, it } from 'vitest';
import { isPhone } from '../../src/app/phone';
import type { DeviceFacts } from '../../src/app/phone';

/** A device: touch ones have no fine pointer unless `fine` says so; computers without touch have one. */
const dev = (screenWidth: number, screenHeight: number, touch = true, fine = !touch): DeviceFacts => ({
  maxTouchPoints: touch ? 5 : 0, coarsePointer: touch, finePointer: fine, screenWidth, screenHeight,
});

describe('isPhone', () => {
  it('is true for phones (touch, no fine pointer), in either orientation', () => {
    expect(isPhone(dev(320, 568))).toBe(true); // iPhone SE
    expect(isPhone(dev(568, 320))).toBe(true);
    expect(isPhone(dev(430, 932))).toBe(true); // iPhone 15 Pro Max
    expect(isPhone(dev(599, 900))).toBe(true);
  });
  it('is false at 600 and above on the shorter side', () => {
    expect(isPhone(dev(600, 960))).toBe(false); // a 600-wide Android
    expect(isPhone(dev(744, 1133))).toBe(false); // iPad mini
    expect(isPhone(dev(1024, 768))).toBe(false); // iPad
    expect(isPhone(dev(1366, 768))).toBe(false); // touch laptop
  });
  it('is false without touch, even in a small screen or window', () => {
    expect(isPhone(dev(1920, 1080, false))).toBe(false);
    expect(isPhone(dev(400, 800, false))).toBe(false);
  });
  it('counts either touch signal', () => {
    expect(isPhone({ maxTouchPoints: 1, coarsePointer: false, finePointer: false, screenWidth: 390, screenHeight: 844 })).toBe(true);
    expect(isPhone({ maxTouchPoints: 0, coarsePointer: true, finePointer: false, screenWidth: 390, screenHeight: 844 })).toBe(true);
  });
  it('is false for a touch device with a fine pointer too, whatever its screen reports', () => {
    // A Windows touch laptop, 1920x1080 at 200 % scaling: the short side reads 540, but it has a trackpad.
    expect(isPhone(dev(1920 / 2, 1080 / 2, true, true))).toBe(false);
    expect(isPhone(dev(960, 540, true, false))).toBe(true); // the same screen with no fine pointer: as a phone
    expect(isPhone(dev(744, 1133, true, true))).toBe(false); // iPad mini with a pen
    expect(isPhone(dev(1024, 768, true, true))).toBe(false); // iPad with a trackpad
    expect(isPhone(dev(390, 844, true, true))).toBe(false); // even a small touch screen with a mouse attached
  });
});
