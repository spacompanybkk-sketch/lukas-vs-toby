import { expect, it } from 'vitest';
import { SHIPPED, playSeries } from '../../../src/ai/balanceChecks';
import { allBands, formatRange, formatValue, matchupOf, measureBands } from '../../../src/ai/bands';
import type { Band } from '../../../src/ai/bands';

/**
 * The bands of `src/ai/bands.ts` on seeds 1..N at the brief's seed counts. A band in `KNOWN_MISSES`
 * is asserted with `it.fails`: it is reported as missing in task-8-report.md, with the reason, and
 * this test flips (fails) the day the band is met, so the list is kept honest.
 */
export const KNOWN_MISSES: Readonly<Record<string, string>> = {};

/** Long: a whole group of bands is one series of thousands of matches. */
const BULK_MS = 1_800_000;

/** One test per band whose name or group matches `select`. */
export function bandTests(select: RegExp): void {
  const bands = allBands(1).filter((b) => select.test(b.group));
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
