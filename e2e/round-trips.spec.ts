import { expect, test } from './fixtures';
import { forceResult, glContexts, logIn, openTitle, waitLive } from './helpers';

// Phase 3 Task 9: one WebGL context through everything that shares the stage: the map, a level,
// its result, the Almanac, the Marketplace and a Free Play run, ten times round, with no console
// or page error and nothing left on the stage.

test('map ↔ level ↔ result ↔ Almanac ↔ Marketplace ↔ Free Play, ten round trips on one WebGL context', async ({ page }) => {
  test.setTimeout(420_000);
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((l) => (l.teaches ?? []).map((t) => t.id));
    lvt.players.update((s: any) => ({ ...s, teached: ids }));
  });
  expect(await glContexts(page)).toBe(1);
  const furniture = (): Promise<number> => page.evaluate(() => (window.__lvt as any).stage.scene.children
    .filter((c: any) => ['lawn', 'sky', 'map', 'almanac'].includes(c.name) || c.isLight || c.type === 'Points').length);
  const before = await furniture();
  for (let round = 0; round < 10; round++) {
    // The map, a level, its result, back to the map and Home.
    await page.locator('[data-home="play"]').click();
    await page.locator('[data-play="adventure"]').click();
    await page.locator('[data-side="plants"]').click();
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    await page.locator('[data-stone="p1-1"]').click();
    await page.locator('[data-action="start-level"]').click();
    await waitLive(page);
    await forceResult(page, 'zombies');
    await expect(page.locator('[data-level-result="p1-1"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-screen="result"] [data-action="map"]').click();
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    await page.locator('[data-screen="map"] [data-action="back"]').click();
    await page.locator('[data-screen="play"] [data-action="back"]').click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    // The Almanac's turntable.
    await page.locator('[data-home="almanac"]').click();
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).almanac.isOpen)).toBe(true);
    await page.locator('[data-action="back"]').click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    // The Marketplace.
    await page.locator('[data-home="marketplace"]').click();
    await expect(page.locator('[data-screen="marketplace"]')).toBeVisible();
    await page.locator('[data-action="back"]').click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    // A Free Play run, ended from the pause menu.
    await page.locator('[data-home="play"]').click();
    await page.locator('[data-play="free"]').click();
    await page.locator(`[data-side="${round % 2 === 0 ? 'plants' : 'zombies'}"]`).click();
    await waitLive(page);
    await page.locator('[data-hud="pause"]').click();
    await page.locator('[data-screen="pause"] [data-action="quit"]').click();
    await page.locator('[data-screen="pause"] [data-action="quit"]').click();
    await expect(page.locator('[data-free-result]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-screen="result"] [data-action="menu"]').click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    expect(await glContexts(page), `round ${round + 1}`).toBe(1);
  }
  // Home again: the title battle on the stage, no map, turntable or level battle left behind.
  expect(await page.evaluate(() => (window.__lvt as any).stage.director === (window.__lvt as any).demo)).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('map') === undefined)).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('almanac') === undefined)).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).session)).toBeNull();
  expect(await furniture()).toBe(before);
});
