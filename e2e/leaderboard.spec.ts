import { expect, test } from './fixtures';
import { logIn, openTitle, pickAndStart, waitLive } from './helpers';

// Phase 4a Task 4: the leaderboard on the fake cloud (never the live database). Two players; the
// one who wins moves up, the result shows the up arrow, and the board shows the new place.

test('two players: Lukas wins against the computer and his row moves up', async ({ page }) => {
  test.setTimeout(120_000);
  await openTitle(page);
  // Mia, made on "another device": two wins.
  await page.evaluate(async () => {
    const s = (window.__lvt as any).players;
    const r = await s.create('Mia', 'hotTopic', '321');
    if (typeof r !== 'object') throw new Error(`create Mia: ${r}`);
    s.update((v: any) => ({ ...v, computerWins: 2 }));
    await s.flush();
    s.logout();
  });
  await logIn(page);
  await page.evaluate(async () => {
    const s = (window.__lvt as any).players;
    s.update((v: any) => ({ ...v, computerWins: 1 }));
    await s.flush();
  });

  // Lukas is second, his row ringed.
  await page.locator('[data-home="leaderboard"]').click();
  await expect(page.locator('[data-screen="leaderboard"]')).toHaveAttribute('data-table', 'computer');
  await expect(page.locator('[data-row]')).toHaveCount(2);
  await expect(page.locator('[data-row]').first()).toHaveAttribute('data-row', 'p03');
  await expect(page.locator('[data-row="p01"]')).toHaveAttribute('data-place', '2');
  await expect(page.locator('[data-row="p01"]')).toHaveAttribute('data-me', '');
  await page.locator('[data-action="back"]').click();

  // A win: level with Mia, so first place (shared). The result says so with the up arrow.
  await pickAndStart(page, 'plants', 'easy');
  await waitLive(page);
  await page.evaluate(() => {
    (window.__lvt as any).damageBase('zombies', 1e9);
    (window.__lvt as any).fastForward(1);
  });
  await expect(page.locator('[data-screen="result"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-rank-up]')).toHaveAttribute('data-rank-up', '1');
  await expect(page.locator('[data-rank-up]')).toHaveAttribute('data-table', 'computer');
  await page.locator('[data-action="menu"]').click();

  await page.locator('[data-home="leaderboard"]').click();
  await expect(page.locator('[data-row="p01"]')).toHaveAttribute('data-place', '1');
  await expect(page.locator('[data-row="p01"] [data-score]')).toHaveAttribute('data-score', '2');

  // Offline: the board kept on this device, with the crossed-out cloud.
  await page.locator('[data-action="back"]').click();
  await page.evaluate(() => {
    (window.__lvt as any).board.configure({ cloud: new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : async () => 'offline') }) });
  });
  await page.locator('[data-home="leaderboard"]').click();
  await expect(page.locator('[data-offline]')).toBeVisible();
  await expect(page.locator('[data-row]')).toHaveCount(2);
});
