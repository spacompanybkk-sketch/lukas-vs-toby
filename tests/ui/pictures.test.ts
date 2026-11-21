import { describe, expect, it } from 'vitest';
import { ALL_PICTURES, DIGITS, outlined, overlay } from '../../src/ui/screens/pictures';
import { ALL_VERSUS_PICTURES } from '../../src/ui/versus/pictures';

describe('player screen pictures', () => {
  it.each(Object.entries({ ...ALL_PICTURES, ...Object.fromEntries(Object.entries(DIGITS).map(([d, a]) => [`digit ${d}`, a])) }))(
    '%s: rows of one width, every colour in the palette', (_name, art) => {
      const w = art.rows[0]?.length ?? 0;
      expect(w).toBeGreaterThan(0);
      for (const row of art.rows) {
        expect(row.length).toBe(w);
        for (const ch of row) if (ch !== '.') expect(art.palette[ch], `colour ${ch}`).toBeDefined();
      }
    },
  );

  it('outlined rings fills with ink; overlay draws on top', () => {
    expect(outlined(['...', '.w.', '...'])).toEqual(['ooo', 'owo', 'ooo']);
    expect(overlay(['ab', 'cd'], ['.x', '..'])).toEqual(['ax', 'cd']);
  });
});

describe('Versus pictures', () => {
  it('registers all ten named in the plan, the minus and the crown', () => {
    expect(Object.keys(ALL_VERSUS_PICTURES).sort()).toEqual(
      ['BENCH', 'CRACKED_BLOCK', 'CROWN', 'MINUS', 'PAUSE_SIGN', 'QUESTION', 'SHRUG', 'SWAP', 'TABLETS_SWORDS', 'UPDATE', 'WHITE_FLAG', 'ZZZ'],
    );
  });

  it.each(Object.entries(ALL_VERSUS_PICTURES))('%s: rows of one width, every colour in the palette, something drawn', (_name, art) => {
    const w = art.rows[0]?.length ?? 0;
    expect(w).toBeGreaterThan(0);
    expect(art.rows.length).toBeGreaterThan(0);
    for (const row of art.rows) {
      expect(row.length).toBe(w);
      for (const ch of row) if (ch !== '.') expect(art.palette[ch], `colour ${ch}`).toBeDefined();
    }
    expect(art.rows.join('').replace(/[.o]/g, '').length).toBeGreaterThan(8);
  });
});
