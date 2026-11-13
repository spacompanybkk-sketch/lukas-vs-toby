import { expect, test } from './fixtures';
import { forceResult, openTitle, typePin, waitLive } from './helpers';

// Phase 4a: players, numbers, the lock-out and coins, by taps only, on the fake cloud (the app's
// default until the database rules are deployed). Battles are fast-forwarded and ended with the
// debug hook; what is checked is the screens and the coins, never who would have won.

test('create a player by taps, log out, three wrong numbers lock, the lock ends, log in, win, coins; reload keeps it', async ({ page }) => {
  test.setTimeout(120_000);
  await openTitle(page);

  // A new player: + → picture → name → number twice.
  await page.locator('[data-action="play"]').click();
  await expect(page.locator('[data-player="p01"]')).toBeVisible();
  await expect(page.locator('[data-player="p02"]')).toBeVisible();
  await page.locator('[data-action="new-player"]').click();
  await page.locator('[data-pick="hotTopic"]').click();
  for (const ch of 'MIA') await page.locator(`[data-letter="${ch}"]`).click();
  await expect(page.locator('[data-name-field]')).toHaveText('Mia');
  await page.locator('[data-action="name-ok"]').click();
  await expect(page.locator('[data-pin-step="1"]')).toBeVisible();
  await typePin(page, '321');
  await expect(page.locator('[data-pin-step="2"]')).toBeVisible();
  await typePin(page, '321');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.locator('[data-me]')).toHaveAttribute('data-me', 'p03');
  await expect(page.locator('[data-coins]')).toHaveAttribute('data-coins', '0');

  // Log out by the door: Mia is first now, and pulsing.
  await page.locator('[data-action="logout"]').click();
  await expect(page.locator('[data-player]').first()).toHaveAttribute('data-player', 'p03');
  await expect(page.locator('[data-player="p03"]')).toHaveClass(/is-last/);

  // Three wrong numbers: the hourglass.
  await page.locator('[data-player="p03"]').click();
  for (const pin of ['111', '222', '333']) {
    await expect(page.locator('[data-pin-box].is-filled')).toHaveCount(0);
    await typePin(page, pin);
    await expect(page.locator('[data-pin-boxes]')).toHaveClass(/is-wrong/);
    await expect(page.locator('[data-pin-boxes]')).not.toHaveClass(/is-wrong/);
  }
  await expect(page.locator('[data-lock]')).toBeVisible();
  await expect(page.locator('[data-keys]')).toHaveAttribute('aria-disabled', 'true');
  // Back always works; the picture shows it is locked.
  await page.locator('[data-action="back"]').click();
  await expect(page.locator('[data-player="p03"] [data-locked]')).toBeVisible();

  // A fast clock: the 30 s pass at once.
  await page.locator('[data-player="p03"]').click();
  await expect(page.locator('[data-lock]')).toBeVisible();
  await page.evaluate(() => (window.__lvt as any).skipClock(30_000));
  await expect(page.locator('[data-lock]')).toHaveCount(0);
  await typePin(page, '321');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();

  // Play, win (the base knocked down by the debug hook), see the coins fall, back Home with them.
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-side="zombies"]').click();
  await page.locator('[data-skill="easy"]').click();
  await page.locator('[data-action="start"]').click();
  await waitLive(page);
  await page.evaluate(() => {
    (window.__lvt as any).fastForward(300);
    (window.__lvt as any).damageBase('plants', 1e9);
    (window.__lvt as any).fastForward(1);
  });
  await expect(page.locator('[data-screen="result"]')).toBeVisible({ timeout: 20_000 });
  const earned = Number(await page.locator('[data-coins-earned]').getAttribute('data-coins-earned'));
  // Easy: 20, or 30 with the base kept at 80% or more.
  expect([20, 30]).toContain(earned);
  await expect(page.locator('.coin-rain__block').first()).toBeVisible();
  await page.locator('[data-action="menu"]').click();
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.locator('[data-coins]')).toHaveAttribute('data-coins', String(earned));

  // The difficulty chosen for zombies was saved with the player.
  // On the fake cloud the device copy is kept under the fake's own prefix, never the real lvt2_ keys.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lvt2f_save_p03') ?? 'null'));
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lvt2_') && k !== 'lvt2_settings' && k !== 'lvt2_fake_cloud'))).toEqual([]);
  expect(saved).toMatchObject({ coins: earned, computerWins: 1, difficulty: { zombies: 'easy' } });

  // Reload: Mia is still first on this device, and her coins come back with her number.
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await page.locator('[data-action="play"]').click();
  await expect(page.locator('[data-player]').first()).toHaveAttribute('data-player', 'p03');
  await page.locator('[data-player="p03"]').click();
  await typePin(page, '321');
  await expect(page.locator('[data-coins]')).toHaveAttribute('data-coins', String(earned));
});

test('the lock-out survives a reload, and Lukas and Toby are there from the first start', async ({ page }) => {
  await openTitle(page);
  await page.locator('[data-action="play"]').click();
  await page.locator('[data-player="p02"]').click();
  await expect(page.locator('[data-pin-step="1"]')).toBeVisible();
  await typePin(page, '555');
  await typePin(page, '555');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await page.locator('[data-action="logout"]').click();
  await page.locator('[data-player="p02"]').click();
  for (const pin of ['111', '222', '333']) {
    await expect(page.locator('[data-pin-box].is-filled')).toHaveCount(0);
    await typePin(page, pin);
    await expect(page.locator('[data-pin-boxes]')).toHaveClass(/is-wrong/);
  }
  await expect(page.locator('[data-lock]')).toBeVisible();
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await page.locator('[data-action="play"]').click();
  await expect(page.locator('[data-player="p02"] [data-locked]')).toBeVisible();
  await page.locator('[data-player="p02"]').click();
  await expect(page.locator('[data-lock]')).toBeVisible();
});

test('offline on a fresh device: play anyway as a guest, no player and no coins, and the result goes back to the title', async ({ page }) => {
  await openTitle(page);
  // The cloud stops answering (a fresh iPad with no connection): every call is "offline".
  await page.evaluate(() => {
    (window.__lvt as any).players.configure({
      cloud: new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : async () => 'offline') }),
      mode: 'fake',
    });
  });
  await page.locator('[data-action="play"]').click();
  await expect(page.locator('[data-offline]')).toBeVisible();
  await page.locator('[data-action="guest"]').click();
  await expect(page.locator('[data-screen="sidepick"]')).toBeVisible();
  await page.locator('[data-side="zombies"]').click();
  await page.locator('[data-action="start"]').click();
  await waitLive(page);
  await forceResult(page, 'plants');
  await expect(page.locator('[data-screen="result"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-coins-earned]')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__lvt as any).players.player.value)).toBeNull();
  await page.locator('[data-action="menu"]').click();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
});

