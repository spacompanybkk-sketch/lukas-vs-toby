import { expect, test } from './fixtures';
import { glContexts, logIn, openTitle } from './helpers';

// Phase 4a Task 6: the Almanac's turntable lives on the one shared stage.

test('the Almanac opens and closes ten times on one WebGL context; units, levels and the move', async ({ page }) => {
  test.setTimeout(120_000);
  await openTitle(page);
  await logIn(page);
  const contexts = await glContexts(page);
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-home="almanac"]').click();
    await expect(page.locator('[data-screen="almanac"]')).toBeVisible();
    await page.locator('[data-action="back"]').click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
  }
  expect(await glContexts(page)).toBe(contexts);
  // Back on Home, the title battle is on the stage again and the turntable is gone.
  expect(await page.evaluate(() => (window.__lvt as any).stage.director === (window.__lvt as any).demo)).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('almanac') === undefined)).toBe(true);

  await page.locator('[data-home="almanac"]').click();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).almanac.isOpen)).toBe(true);
  await page.locator('[data-unit="cowboyZombie"]').click();
  await page.locator('[data-level="4"]').click();
  await expect.poll(() => page.evaluate(() => {
    const m = (window.__lvt as any).almanac.current;
    return m ? `${m.def.key} ${m.level}` : null;
  })).toBe('cowboyZombie 4');
  await page.locator('[data-action="act"]').click();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).almanac.current?.clip)).not.toBe('idle');
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).almanac.current?.clip), { timeout: 10_000 }).toBe('idle');

  await page.locator('[data-unit="boneMinion"]').click();
  await expect(page.locator('[data-level]')).toHaveCount(1);
  expect(await glContexts(page)).toBe(contexts);
});
