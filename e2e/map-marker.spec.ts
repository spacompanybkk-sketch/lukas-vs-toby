import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { logIn, openTitle } from './helpers';

// The player's picture on the next stone's flag must never cover that stone's number (the badge
// over the stone). Every world, both sides, with the next stone being the last one (the boss),
// which is where the flag's cloth and the badge met on world 4. Pictures go to LVT_W4_SHOTS (ipad).
const dir = process.env.LVT_W4_SHOTS;

interface Box { left: number; top: number; right: number; bottom: number }

async function seed(page: Page, side: 'plants' | 'zombies', world: number, won: number): Promise<void> {
  const prefix = side === 'plants' ? 'p' : 'z';
  await page.evaluate(([s, pre, w, n]) => {
    const stars: Record<string, number> = {};
    for (let a = 1; a <= (w as number); a++) for (let b = 1; b <= (a === w ? (n as number) : 8); b++) stars[`${pre}${a}-${b}`] = 2;
    (window.__lvt as any).players.update((p: any) => ({ ...p, [s as string]: { ...p[s as string], stars } }));
  }, [side, prefix, world, won] as const);
}

async function toMap(page: Page, side: 'plants' | 'zombies', world: number): Promise<void> {
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-play="adventure"]').click();
  await page.locator(`[data-side="${side}"]`).click();
  await expect(page.locator('[data-screen="map"]')).toHaveAttribute('data-world', String(world));
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  await expect(page.locator('[data-marker][data-placed]')).toHaveCount(1);
}

const overlap = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const side of ['plants', 'zombies'] as const) {
  for (const world of [1, 2, 3, 4]) {
    for (const won of [7, 4]) {
      test(`${side} world ${world}: the marker on the next stone (${won + 1}) does not cover its number`, async ({ page }) => {
        test.setTimeout(90_000);
        await openTitle(page);
        await logIn(page);
        await seed(page, side, world, won);
        await toMap(page, side, world);
        const id = `${side === 'plants' ? 'p' : 'z'}${world}-${won + 1}`;
        await expect(page.locator(`[data-stone="${id}"]`)).toHaveAttribute('data-state', 'next');
        // The marker rests at the bottom of its hop; the picture only ever goes up from there.
        const boxes = await page.evaluate((stone) => {
          const rect = (el: Element): Box => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
          const m = document.querySelector('[data-marker]')!;
          const n = document.querySelector(`[data-stone="${stone}"] .stone__n`)!;
          const b = document.querySelector(`[data-stone="${stone}"] .stone__badge`)!;
          return { marker: rect(m), number: rect(n), badge: rect(b) };
        }, id);
        if (dir !== undefined && test.info().project.name === 'ipad') await page.screenshot({ path: `${dir}/map-marker-${side}-w${world}-s${won + 1}.png` });
        expect(overlap(boxes.marker, boxes.number), JSON.stringify(boxes)).toBe(false);
      });
    }
  }
}
