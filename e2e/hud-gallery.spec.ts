import { expect, test } from './fixtures';
import type { Page } from './fixtures';

// The phase-2 HUD (ten cards, the hero button, two spells) laid over the lawn by
// `?scene=hud-gallery`, at every size it must work at (see SIZES).
// Runs in both projects: with a mouse (desktop) and with a finger (ipad).

// The three screen sizes, then iPad Safari with its address and tab bars showing (10.2", a short
// 10.2" window, 10.9" Air, 11" Pro, 12.9" Pro).
const SIZES = [
  { width: 1024, height: 768, rows: 2 },
  { width: 1180, height: 820, rows: 2 },
  { width: 1440, height: 900, rows: 1 },
  { width: 1024, height: 704, rows: 2 },
  { width: 1024, height: 650, rows: 1 },
  { width: 1180, height: 746, rows: 1 },
  { width: 1194, height: 760, rows: 1 },
  { width: 1366, height: 950, rows: 1 },
] as const;
const SIDES = ['plants', 'zombies'] as const;

interface Box { name: string; x: number; y: number; w: number; h: number }
interface Point { x: number; y: number }

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?scene=hud-gallery&debug&cloud=fake&${query}`);
  await page.waitForFunction(() => (window.__lvt as { hudReady?: Promise<void> }).hudReady?.then(() => true));
}

/** Every button of the HUD with its box (selected cards included, as raised as they are). */
function buttons(page: Page): Promise<Box[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#ui button')].map((el) => {
    const r = el.getBoundingClientRect();
    const name = el.dataset.card ?? el.dataset.spell ?? el.dataset.hero ?? el.dataset.hud ?? (el.dataset.shovel !== undefined ? 'shovel' : el.className);
    return { name, x: r.x, y: r.y, w: r.width, h: r.height };
  }));
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether a box and a convex polygon share any area (separating axis test). */
function boxHitsPolygon(b: Box, poly: Point[]): boolean {
  const rect: Point[] = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  const axes: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] as Point;
    axes.push({ x: -(q.y - p.y), y: q.x - p.x });
  });
  for (const ax of axes) {
    const proj = (pts: Point[]): [number, number] => {
      const v = pts.map((p) => p.x * ax.x + p.y * ax.y);
      return [Math.min(...v), Math.max(...v)];
    };
    const [a0, a1] = proj(rect);
    const [b0, b1] = proj(poly);
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}

async function press(page: Page, selector: string, touch: boolean): Promise<void> {
  if (touch) await page.locator(selector).tap();
  else await page.locator(selector).click();
}

for (const size of SIZES) {
  for (const side of SIDES) {
    test(`${size.width}x${size.height} ${side}: ten cards, hero and spells fit, never overlap and keep off the lanes`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open(page, `side=${side}&cards=10`);

      const tray = page.locator('[data-hud="tray"]');
      await expect(tray).toHaveClass(new RegExp(`hud-tray--rows-${size.rows}`));
      await expect(page.locator('[data-card]')).toHaveCount(10);
      await expect(page.locator('[data-hero]')).toHaveCount(1);
      await expect(page.locator('[data-spell]')).toHaveCount(2);

      const all = await buttons(page);
      expect(all.length).toBeGreaterThanOrEqual(14);

      // Big enough for a small finger, and all on screen.
      for (const b of all) {
        expect(b.w, `${b.name} width`).toBeGreaterThanOrEqual(44);
        expect(b.h, `${b.name} height`).toBeGreaterThanOrEqual(44);
        expect(b.x, `${b.name} left`).toBeGreaterThanOrEqual(0);
        expect(b.y, `${b.name} top`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w, `${b.name} right`).toBeLessThanOrEqual(size.width);
        expect(b.y + b.h, `${b.name} bottom`).toBeLessThanOrEqual(size.height);
      }
      for (const key of await page.locator('[data-card]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card ?? ''))) {
        const b = all.find((x) => x.name === key);
        expect(b, key).toBeDefined();
        expect(b!.w, `${key} width`).toBeGreaterThanOrEqual(64);
        expect(b!.h, `${key} height`).toBeGreaterThanOrEqual(80);
      }

      // No two buttons share a pixel.
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          expect(overlaps(all[i]!, all[j]!), `${all[i]!.name} overlaps ${all[j]!.name}`).toBe(false);
        }
      }

      // Nothing at the bottom covers lanes 0–4.
      const lawn = await page.evaluate(() => (window.__lvt as unknown as { lawnCorners(): Point[] | null }).lawnCorners());
      expect(lawn).not.toBeNull();
      const bottom = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.battle__bottom > *, .battle__bottom button')].map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.className, x: r.x, y: r.y, w: r.width, h: r.height };
      }));
      for (const b of bottom) expect(boxHitsPolygon(b, lawn!), `${b.name} covers the lawn`).toBe(false);

      // A tap in the middle of each button lands on that button and nothing else.
      const hits = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-card], [data-hero], [data-spell]')].map((el) => {
        const r = el.getBoundingClientRect();
        const pts = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]] as const;
        return pts.every(([fx, fy]) => document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy)?.closest('button') === el);
      }));
      expect(hits.every(Boolean), 'every button owns its own middle and corners').toBe(true);
    });
  }
}

test('every card, the hero and each spell answers a tap or a click', async ({ page }, info) => {
  const touch = info.project.name === 'ipad';
  await open(page, 'side=plants&cards=10');
  const keys = await page.locator('[data-card]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card ?? ''));
  // The first card starts selected (a tap on it would deselect), so it is tapped last.
  for (const key of [...keys.slice(1), keys[0] as string]) {
    await press(page, `[data-card="${key}"]`, touch);
    await expect(page.locator(`[data-card="${key}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-card][aria-pressed="true"]')).toHaveCount(1);
  }
  await press(page, '[data-hero]', touch);
  await expect(page.locator('[data-hero]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-hero]')).toHaveAccessibleName('Mega Mower');
  await press(page, '[data-spell="thunderbolt"]', touch);
  await expect(page.locator('[data-spell="thunderbolt"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-hero]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-spell="vines"]')).toHaveAccessibleName('Vines');
});

test('Quit asks for a second tap, with a tick on it', async ({ page }, info) => {
  const touch = info.project.name === 'ipad';
  await open(page, 'side=zombies&cards=10');
  await press(page, '[data-hud="pause"]', touch);
  await press(page, '[data-action="quit"]', touch);
  await expect(page.locator('[data-action="quit"]')).toHaveClass(/is-armed/);
  await expect(page.locator('[data-action="quit"] .pixel-icon')).toBeVisible();
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
});
