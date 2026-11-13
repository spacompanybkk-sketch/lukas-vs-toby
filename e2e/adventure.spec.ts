import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { glContexts, logIn, openTitle, waitLive } from './helpers';

// Phase 3 Task 4: the way into Adventure: the Play menu, the map on the shared stage, the level card.

/** A touch tap on the iPad project, a mouse click on the desktop. */
async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

/** Home → Play → Adventure → a side → the map, by taps only. */
async function toMap(page: Page, side: 'plants' | 'zombies' = 'plants'): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await expect(page.locator('[data-screen="play"]')).toBeVisible();
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
}

/**
 * The visible tap targets in `scope` smaller than 44 × 44 CSS pixels, at the smallest window the
 * game is made for (1024 × 650: an iPad with Safari's bars) and at the project's own size.
 */
async function smallTargets(page: Page, scope: string): Promise<string[]> {
  const own = page.viewportSize()!;
  const out: string[] = [];
  for (const size of [{ width: 1024, height: 650 }, own]) {
    await page.setViewportSize(size);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // Pop-in animations (which scale things down for a moment) finished; endless ones only grow things.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
    out.push(...await targetsBelow44(page, scope));
  }
  return out;
}

async function targetsBelow44(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(`${sel} button`)]
    .filter((b) => b.offsetParent !== null)
    .map((b) => ({ b, r: b.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ b, r }) => `${b.dataset.stone ?? b.dataset.skill ?? b.dataset.action ?? b.dataset.tab ?? b.className} ${Math.round(r.width)}x${Math.round(r.height)}`), scope);
}

test('from Home to the map, open p1-1, see its card and start it: a battle with the level\'s cards', async ({ page }) => {
  test.setTimeout(120_000);
  await openTitle(page);
  await logIn(page);
  await toMap(page);
  await expect(page.locator('[data-stone]')).toHaveCount(8);
  await expect(page.locator('[data-stone="p1-1"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="p1-2"]')).toHaveAttribute('data-state', 'closed');
  await expect(page.locator('[data-marker="p1-1"]')).toBeVisible();
  // Each stone sits where the 3D map projects it, on screen.
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  const vp = page.viewportSize()!;
  for (const box of await page.locator('[data-stone]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  }
  expect(await smallTargets(page, '[data-screen="map"]')).toEqual([]);

  // A closed stone: a padlock card that points to the next level.
  await press(page.locator('[data-stone="p1-4"]'));
  await expect(page.locator('[data-screen="level-card"][data-locked]')).toBeVisible();
  await press(page.locator('[data-action="go-next"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="p1-1"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));

  await press(page.locator('[data-stone="p1-1"]'));
  const card = page.locator('[data-screen="level-card"][data-level="p1-1"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-dealt] [data-picture="peashooter"]')).toBeVisible();
  await expect(card.locator('[data-star]')).toHaveCount(3);
  expect(await smallTargets(page, '[data-screen="level-card"]')).toEqual([]);
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  const options = await page.evaluate(() => (window.__lvt as any).screen.options);
  expect(options).toMatchObject({ playerFaction: 'plants', level: 'p1-1', cards: ['peashooter'] });
  await expect(page.locator('[data-card]')).toHaveCount(1);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('map') === undefined)).toBe(true);
});

test('the map opens and closes ten times on one WebGL context, leaving nothing behind; it follows a resize', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  await page.locator('[data-home="play"]').click();
  await expect(page.locator('[data-screen="play"]')).toBeVisible();
  const contexts = await glContexts(page);
  const sceneSize = (): Promise<number> => page.evaluate(() => {
    const lvt = window.__lvt as any;
    // The scene's own furniture, without the demo battle's units (which come and go as it plays).
    return lvt.stage.scene.children.filter((c: any) => ['lawn', 'sky', 'map'].includes(c.name) || c.isLight || c.type === 'Points').length;
  });
  const before = await sceneSize();
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-play="adventure"]').click();
    await page.locator(`[data-side="${i % 2 === 0 ? 'plants' : 'zombies'}"]`).click();
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map.isOpen)).toBe(true);
    await page.locator('[data-action="back"]').click();
    await expect(page.locator('[data-screen="play"]')).toBeVisible();
  }
  expect(await glContexts(page)).toBe(contexts);
  expect(await page.evaluate(() => (window.__lvt as any).stage.director === (window.__lvt as any).demo)).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('map') === undefined)).toBe(true);
  expect(await sceneSize()).toBe(before);

  // The stones follow the 3D map when the window changes size.
  await page.locator('[data-play="adventure"]').click();
  await page.locator('[data-side="plants"]').click();
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  const placed = (): Promise<boolean> => page.evaluate(() => {
    const l = (window.__lvt as any).map.layout();
    const el = document.querySelector<HTMLElement>('[data-stone="p1-8"]')!;
    return Math.abs(parseFloat(el.style.left) - l.stones['p1-8'].x) <= 1 && Math.abs(parseFloat(el.style.top) - l.stones['p1-8'].y) <= 1;
  });
  const at = await page.locator('[data-stone="p1-8"]').evaluate((e) => e.style.left);
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: Math.round(vp.width * 0.8), height: vp.height });
  await expect.poll(() => page.locator('[data-stone="p1-8"]').evaluate((e) => e.style.left)).not.toBe(at);
  await expect.poll(placed).toBe(true);
  await page.setViewportSize(vp);
  await expect.poll(placed).toBe(true);
  expect(await glContexts(page)).toBe(contexts);
});

test('a guest reaches Quick Battle only; the map side tabs switch between Lukas\'s and Toby\'s paths', async ({ page }) => {
  await openTitle(page);
  await page.evaluate(() => (window.__lvt as any).go({ name: 'play' }));
  await expect(page.locator('[data-play="adventure"][data-locked]')).toBeVisible();
  await page.locator('[data-play="adventure"]').click();
  await expect(page.locator('[data-screen="play"]')).toBeVisible();
  await page.locator('[data-play="quick"]').click();
  await expect(page.locator('[data-screen="sidepick"]')).toBeVisible();
  await page.locator('[data-action="back"]').click();
  await page.locator('[data-action="back"]').click();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();

  await logIn(page);
  await toMap(page, 'plants');
  await page.locator('[data-tab="zombies"]').click();
  await expect(page.locator('[data-stone="z1-1"]')).toHaveAttribute('data-state', 'next');
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('map-stone-z1-1') !== undefined)).toBe(true);
});
