import { describe, expect, it } from 'vitest';
import { BOARD_PICTURES } from '../../src/ui/screens/boardPictures';

describe('leaderboard and Almanac pictures', () => {
  it.each(Object.entries(BOARD_PICTURES))('%s: square rows of one width, every colour in the palette', (_name, art) => {
    const w = art.rows[0]?.length ?? 0;
    expect(w).toBeGreaterThan(0);
    expect(art.rows.length).toBe(w);
    for (const row of art.rows) {
      expect(row.length).toBe(w);
      for (const ch of row) if (ch !== '.') expect(art.palette[ch], `colour ${ch}`).toBeDefined();
    }
  });
});
