import { describe, expect, it } from 'vitest';
import { isPhone } from '../../src/app/phone';
import type { DeviceFacts } from '../../src/app/phone';

const dev = (screenWidth: number, screenHeight: number, touch = true): DeviceFacts => ({
  maxTouchPoints: touch ? 5 : 0, coarsePointer: touch, screenWidth, screenHeight,
});

describe('isPhone', () => {
  it('is true for phones, in either orientation', () => {
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
    expect(isPhone({ maxTouchPoints: 1, coarsePointer: false, screenWidth: 390, screenHeight: 844 })).toBe(true);
    expect(isPhone({ maxTouchPoints: 0, coarsePointer: true, screenWidth: 390, screenHeight: 844 })).toBe(true);
  });
});
