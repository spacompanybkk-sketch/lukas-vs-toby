import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { forceResult, logIn, openTitle, waitLive } from './helpers';

// Phase 3 Task 7b: Free Play — from the Play menu straight into the run, to wave 3 by
// fast-forward, the result paying 10 coins and setting bestWave once.

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

const save = (page: Page): Promise<{ coins: number; bestWave: number }> =>
  page.evaluate(() => {
    const s = (window.__lvt as any).players.player.value;
    return { coins: s.coins as number, bestWave: s.bestWave as number };
  });

async function toRun(page: Page, side: 'plants' | 'zombies'): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="free"]'));
  await press(page.locator(`[data-side="${side}"]`));
  await waitLive(page);
}

test('survive to wave 3 by fast-forward: the flag counter, then the result pays 10 coins and sets the best wave', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  const before = await save(page);
  expect(before.bestWave).toBe(0);
  await toRun(page, 'plants');
  expect(await page.evaluate(() => (window.__lvt as any).screen.options.free.side)).toBe('plants');
  await expect(page.locator('[data-hud="free-wave"]')).toHaveAttribute('data-wave', '0');
  await expect(page.locator('[data-hud="next-wave"]')).toBeVisible();
  await page.evaluate(() => (window.__lvt as any).fastForward(30 * 51));
  await expect(page.locator('[data-hud="free-wave"]')).toHaveAttribute('data-wave', '3');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner)).toBeNull();

  await forceResult(page, 'plants');
  const result = page.locator('[data-free-result="plants"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toHaveAttribute('data-wave', '3');
  await expect(result).toHaveAttribute('data-best', '');
  await expect(page.locator('[data-coins-earned="10"]')).toBeVisible();
  expect(await save(page)).toEqual({ coins: before.coins + 10, bestWave: 3 });
  expect(await page.evaluate(() => localStorage.getItem('lvt2f_pending_p01'))).toBeNull();

  // A reload pays nothing more; the board row carries the wave.
  await openTitle(page);
  await logIn(page);
  expect(await save(page)).toEqual({ coins: before.coins + 10, bestWave: 3 });
  await press(page.locator('[data-home="leaderboard"]'));
  await expect(page.locator('[data-screen="leaderboard"]')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const v = await (window.__lvt as any).board?.fetch?.();
    return v?.rows?.find((r: any) => r.slot === 'p01')?.wave ?? null;
  })).toBe(3);
});

test('breakthrough: straight into a garden with the clock; Quit from pause banks the gardens broken (bestGarden)', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  const before = await save(page);
  await toRun(page, 'zombies');
  await expect(page.locator('[data-hud="free-clock"]')).toBeVisible();
  await expect(page.locator('[data-hud="free-wave"]')).toHaveAttribute('data-wave', '0');
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    lvt.damageBase('plants', 999999);
    lvt.fastForward(2);
  });
  await expect(page.locator('[data-hud="free-wave"]')).toHaveAttribute('data-wave', '1');
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await expect(page.locator('[data-bank] [data-bank-coins="5"]')).toBeVisible();
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  const result = page.locator('[data-free-result="zombies"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toHaveAttribute('data-wave', '1');
  await expect(result).toHaveAttribute('data-best', '');
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).players.player.value.bestGarden)).toBe(1);
  expect(await save(page)).toEqual({ coins: before.coins + 5, bestWave: 0 });
  await press(page.locator('[data-screen="result"] [data-action="menu"]'));
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
});
