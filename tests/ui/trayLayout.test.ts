import { describe, expect, it } from 'vitest';
import { CARD_MIN, SPELL_MIN, lawnFrontY, trayLayout } from '../../src/ui/hud/trayLayout';

// iPad screens, iPad Safari with its bars showing, and two laptops.
const SIZES = [
  [1024, 768, 2], [1024, 704, 2], [1024, 650, 1], [1180, 746, 1], [1194, 760, 1],
  [1366, 950, 1], [1180, 820, 2], [1440, 900, 1],
] as const;
const view = (width: number, height: number) => ({ width, height, gutterX: 12, gutterBottom: 10 });

describe('trayLayout', () => {
  for (const [w, h, rows] of SIZES) {
    it(`${w}x${h}: ${rows} row(s), cards at least 64 px, spells and hero finger-sized`, () => {
      const l = trayLayout(10, view(w, h));
      expect(l.rows).toBe(rows);
      expect(l.cols).toBe(rows === 2 ? 5 : 10);
      expect(l.card).toBeGreaterThanOrEqual(64);
      expect(l.card * 1.27).toBeGreaterThanOrEqual(80);
      expect(l.spell).toBeGreaterThanOrEqual(44);
      expect(l.hero).toBeGreaterThan(l.spell);
    });
  }

  it('never makes cards bigger than the usual size', () => {
    expect(trayLayout(3, view(2560, 1440)).card).toBe(124);
    expect(trayLayout(10, view(1440, 900)).card).toBeCloseTo(93.6, 1);
  });

  it('shrinks cards rather than reach the lawn when the window is short', () => {
    const tall = trayLayout(10, view(1180, 820));
    const short = trayLayout(10, view(1180, 746));
    expect(short.card).toBeLessThanOrEqual(tall.card);
  });

  it('lawnFrontY: the near edge of the lanes as the camera frames them', () => {
    expect(lawnFrontY(1024, 768)).toBeCloseTo(495, -1);
    expect(lawnFrontY(1440, 900)).toBeCloseTo(614, -1);
    expect(lawnFrontY(1024, 650)).toBeLessThan(lawnFrontY(1024, 768));
  });

  it('never goes below 64 px cards and 44 px spells, even on a window smaller than supported (900x600)', () => {
    for (const [w, h] of [[900, 600], [800, 500], [1024, 560]] as const) {
      const l = trayLayout(10, view(w, h));
      expect(l.card, `${w}x${h}`).toBeGreaterThanOrEqual(CARD_MIN);
      expect(l.card * 1.27, `${w}x${h}`).toBeGreaterThanOrEqual(80);
      expect(l.spell, `${w}x${h}`).toBeGreaterThanOrEqual(SPELL_MIN);
      expect(l.hero, `${w}x${h}`).toBeGreaterThanOrEqual(l.spell);
    }
    // At 900 px ten cards of 64 px do not fit across beside the powers, so they fold into two rows.
    expect(trayLayout(10, view(900, 600)).rows).toBe(2);
  });
});
