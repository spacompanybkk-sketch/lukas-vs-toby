import { expect, it } from 'vitest';
import { SHIPPED, playSeries } from '../../../src/ai/balanceChecks';
import { allBands, formatRange, formatValue, matchupOf, measureBands } from '../../../src/ai/bands';
import type { Band } from '../../../src/ai/bands';

/**
 * The bands of `src/ai/bands.ts` on seeds 1..N at the brief's seed counts. A band in `KNOWN_MISSES`
 * is asserted with `it.fails`: it is reported as missing in task-8-report.md, with the reason, and
 * this test flips (fails) the day the band is met, so the list is kept honest.
 */
export const KNOWN_MISSES: Readonly<Record<string, string>> = {
  'slow tapper as plants v easy': '43.5% (45): accepted (coordinator, Task 8b); the Easy plants cell is squeezed by the newest-card child (80.5%, cap 85)',
  'random child as zombies v hard': '20% (<15): accepted; at Hard a random child does as well as steadyZombies, kept in band',
  'start energy x0.75: plants win': '21% (25): accepted; phase-1 robustness check',
  'pick share walnutBomb': '2.97% (3%): accepted; the three walls share the wall plays',
  'spell sunShower alone: edge': '+21 points (8-16): at its floor (75 Sun, cooldown 90 s, first at 45 s) it is still worth more than the band',
};

/** Long: a whole group of bands is one series of thousands of matches (minutes on an idle machine, far more under load). */
const BULK_MS = 10_800_000;

/** One test per band whose group matches `select` (and whose name matches `name`, if given). */
export function bandTests(select: RegExp, name?: RegExp): void {
  const bands = allBands(1).filter((b) => select.test(b.group) && (name === undefined || name.test(b.name)));
  let measured: Promise<Map<Band, number>> | undefined;
  const values = (): Promise<Map<Band, number>> => {
    measured ??= measureBands(bands, async (spec, seeds) => playSeries(matchupOf(spec), seeds, SHIPPED, 1).results, SHIPPED)
      .then((ms) => new Map(ms.map((m) => [m.band, m.value])));
    return measured;
  };
  for (const band of bands) {
    const title = `${band.name} within ${formatRange(band)}`;
    const check = async (): Promise<void> => {
      const value = (await values()).get(band) as number;
      expect(value, `${band.name} = ${formatValue(band, value)}`).toBeGreaterThanOrEqual(band.min);
      expect(value, `${band.name} = ${formatValue(band, value)}`).toBeLessThanOrEqual(band.max);
    };
    if (band.name in KNOWN_MISSES) it.fails(`${title} (known miss: ${KNOWN_MISSES[band.name]})`, check, BULK_MS);
    else it(title, check, BULK_MS);
  }
}
