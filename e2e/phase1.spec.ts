import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import {
  cardPrice, clickTile, frames, openTitle, pickAndStart, plantAt, snapshot, startBattle, tilePoint, waitCardReady, waitLive,
} from './helpers';

// Phase 1 played the way a child plays it: real clicks on real screens, in a real browser, with
// the test hooks (`__lvt.fastForward`, `__lvt.damageBase`) used only to save time or end a match.
// Every test also fails on any console error or uncaught exception (see fixtures.ts).

/** Selects a card unless it is selected already (a second click on a selected card would deselect it). */
async function selectCard(page: Page, key: string): Promise<void> {
  const card = page.locator(`[data-card="${key}"]`);
  if ((await card.getAttribute('aria-pressed')) !== 'true') await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
}

/** Places a card's unit on a tile with a card click and a tile click, and waits for it to stand there. */
async function place(page: Page, key: string, lane: number, col: number): Promise<void> {
  await selectCard(page, key);
  await clickTile(page, lane, col);
  await expect.poll(async () => plantAt(await snapshot(page), lane, col)?.key ?? null).toBe(key);
}

test('boots to the title without errors', async ({ page }) => {
  await openTitle(page);
  await expect(page.locator('[data-screen="title"] h1')).toHaveAttribute('aria-label', 'Lukas Plants vs Toby Zombies');
  await expect(page.locator('[data-action="play"]')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
  await frames(page, 30); // the title demo keeps drawing without trouble
});

test('plays as Lukas: a Sunflower and a Peashooter go where they were clicked, and cost their price', async ({ page }) => {
  await startBattle(page, 'plants');
  const before = await snapshot(page);
  const prices = { sunflower: await cardPrice(page, 'sunflower'), peashooter: await cardPrice(page, 'peashooter') };
  const trickle = await page.evaluate(() => (window.__lvt as any).session.controller.match.balance.trickle.plants as number);
  const startEnergy = await page.evaluate(() => (window.__lvt as any).session.controller.match.balance.startEnergy as number);
  expect(before.energy).toBeGreaterThanOrEqual(startEnergy);

  await place(page, 'sunflower', 2, 0);
  await page.keyboard.press(await page.locator('[data-card="peashooter"] .card__hotkey').innerText());
  await expect(page.locator('[data-card="peashooter"]')).toHaveAttribute('aria-pressed', 'true');
  await clickTile(page, 2, 3);
  await expect.poll(async () => plantAt(await snapshot(page), 2, 3)?.key ?? null).toBe('peashooter');

  const after = await snapshot(page);
  const sunflower = plantAt(after, 2, 0);
  const peashooter = plantAt(after, 2, 3);
  expect(sunflower?.x).toBe(0.5);
  expect(peashooter?.x).toBe(3.5);
  expect(sunflower?.spent).toBe(prices.sunflower);
  expect(peashooter?.spent).toBe(prices.peashooter);
  // Energy went down by both prices, less only what the trickle gave in between.
  const seconds = (after.tick - before.tick) / 30;
  expect(after.energy).toBeLessThanOrEqual(before.energy - prices.sunflower - prices.peashooter + Math.ceil(trickle * seconds) + 1);
  expect(after.energy).toBeLessThan(before.energy - 100);
});

test('merges by clicking a tile that already holds the same plant', async ({ page }) => {
  await startBattle(page, 'plants');
  await place(page, 'sunflower', 1, 1);
  await waitCardReady(page, 'sunflower');
  const before = await snapshot(page);
  await selectCard(page, 'sunflower');
  await clickTile(page, 1, 1);
  await expect.poll(async () => plantAt(await snapshot(page), 1, 1)?.level).toBe(2);
  const after = await snapshot(page);
  expect(after.units.filter((u) => u.faction === 'plants').length).toBe(before.units.filter((u) => u.faction === 'plants').length);
});

test('refuses a different plant on an occupied tile: nothing is added and the tray shakes', async ({ page }) => {
  await startBattle(page, 'plants');
  await place(page, 'sunflower', 2, 2);
  const before = await snapshot(page);
  // The shake lasts 300 ms, so watch for it instead of polling for it.
  await page.evaluate(() => {
    const w = window as unknown as { __sawDenied: boolean };
    w.__sawDenied = false;
    const tray = document.querySelector('[data-hud="tray"]') as HTMLElement;
    new MutationObserver(() => { if (tray.classList.contains('is-denied')) w.__sawDenied = true; })
      .observe(tray, { attributes: true, attributeFilter: ['class'] });
  });
  await selectCard(page, 'peashooter');
  await clickTile(page, 2, 2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sawDenied: boolean }).__sawDenied)).toBe(true);
  const after = await snapshot(page);
  expect(after.units.filter((u) => u.faction === 'plants').map((u) => u.id)).toEqual(before.units.filter((u) => u.faction === 'plants').map((u) => u.id));
  expect(plantAt(after, 2, 2)?.key).toBe('sunflower');
});

test('the shovel removes a plant', async ({ page }) => {
  await startBattle(page, 'plants');
  await place(page, 'sunflower', 3, 1);
  await page.locator('[data-shovel]').click();
  await expect(page.locator('[data-shovel]')).toHaveAttribute('aria-pressed', 'true');
  await clickTile(page, 3, 1);
  await expect.poll(async () => plantAt(await snapshot(page), 3, 1)).toBeUndefined();
});

test('pauses and resumes, by button and by Space: the clock stops and restarts', async ({ page }) => {
  await startBattle(page, 'plants');
  const running = async (): Promise<boolean> => {
    const a = (await snapshot(page)).tick;
    await frames(page, 30);
    return (await snapshot(page)).tick > a;
  };
  expect(await running()).toBe(true);

  await page.locator('[data-hud="pause"]').click();
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  expect(await running()).toBe(false);
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator('[data-screen="pause"]')).toHaveCount(0);
  expect(await running()).toBe(true);

  await page.keyboard.press('Space');
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  expect(await running()).toBe(false);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-screen="pause"]')).toHaveCount(0);
  expect(await running()).toBe(true);
});

test('pauses when the tab is hidden and does not resume by itself', async ({ page }) => {
  await startBattle(page, 'plants');
  const setHidden = (hidden: boolean): Promise<void> => page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await setHidden(true);
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await setHidden(false);
  await frames(page, 20);
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  expect((await snapshot(page)).paused).toBe(true);
});

test('wins: VICTORY, then Play again starts a fresh battle', async ({ page }) => {
  await startBattle(page, 'plants');
  await page.evaluate(() => { (window as any).__old = (window.__lvt as any).session; });
  await page.evaluate(() => (window.__lvt as any).damageBase('zombies', 99999));
  const panel = page.locator('[data-screen="result"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('h2')).toHaveText('VICTORY!');
  await panel.locator('[data-action="play-again"]').click();
  await expect.poll(() => page.evaluate(() => {
    const s = (window.__lvt as any).session;
    return s !== null && s !== (window as any).__old;
  })).toBe(true);
  await waitLive(page);
  const fresh = await snapshot(page);
  expect(fresh.winner).toBeNull();
  expect(fresh.tick).toBeLessThan(300);
  await expect(page.locator('[data-screen="result"]')).toHaveCount(0);
});

test('loses as Toby on Easy: DEFEAT shows when the zombie base falls', async ({ page }) => {
  await startBattle(page, 'zombies', 'easy');
  await page.evaluate(() => (window.__lvt as any).damageBase('zombies', 99999));
  const panel = page.locator('[data-screen="result"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('h2')).toHaveText('DEFEAT');
});

test('plays as Toby: a card and a lane put a zombie at the right edge of that lane', async ({ page }) => {
  await startBattle(page, 'zombies');
  const before = await snapshot(page);
  await selectCard(page, 'brainEater');
  await clickTile(page, 3, 9);
  await expect.poll(async () => (await snapshot(page)).units.find(
    (u) => u.faction === 'zombies' && u.key === 'brainEater' && u.lane === 3 && !before.units.some((b) => b.id === u.id),
  )?.x ?? 0).toBeGreaterThan(8.5);
  const after = await snapshot(page);
  expect(after.energy).toBeLessThan(before.energy);
});

test('plays a whole match by fast-forward to a result', async ({ page }) => {
  await startBattle(page, 'plants', 'easy');
  await page.evaluate(() => (window.__lvt as any).fastForward(14_400));
  const panel = page.locator('[data-screen="result"]');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('h2')).toHaveText(/VICTORY!|DEFEAT|DRAW/);
  expect((await snapshot(page)).winner).not.toBeNull();
});

for (const [width, height] of [[1280, 720], [1024, 768], [2560, 1080]] as const) {
  test(`fits a ${width} x ${height} window: HUD inside the screen, apart, tray below the lawn`, async ({ page }) => {
    await startBattle(page, 'plants');
    await page.setViewportSize({ width, height });
    await frames(page, 10);
    const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-hud]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('data-hud') as string, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }));
    expect(boxes.map((b) => b.name).sort()).toEqual(['base-plants', 'base-zombies', 'energy', 'pause', 'topbar', 'tray']);
    for (const b of boxes) {
      expect(b.left, `${b.name} left`).toBeGreaterThanOrEqual(-0.5);
      expect(b.top, `${b.name} top`).toBeGreaterThanOrEqual(-0.5);
      expect(b.right, `${b.name} right`).toBeLessThanOrEqual(width + 0.5);
      expect(b.bottom, `${b.name} bottom`).toBeLessThanOrEqual(height + 0.5);
      expect(b.right - b.left, `${b.name} width`).toBeGreaterThan(0);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const apart = a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
        expect(apart, `${a.name} and ${b.name} overlap`).toBe(true);
      }
    }
    // The lowest lane of the lawn on screen (the nearest to the player) stays clear of the tray.
    const lane = Math.max(...(await Promise.all([0, 4].map(async (l) => (await tilePoint(page, l, 0)).y))));
    const tray = boxes.find((b) => b.name === 'tray')!;
    expect(tray.top).toBeGreaterThan(lane + 40);
  });
}

test('quit to the menu and a second match: one canvas, one WebGL context, a fresh start', async ({ page, problems }) => {
  await startBattle(page, 'plants');
  await page.evaluate(() => { (window as any).__first = { session: (window.__lvt as any).session, stage: (window.__lvt as any).stage }; });
  await page.locator('[data-hud="pause"]').click();
  await page.locator('[data-action="quit"]').click();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  await pickAndStart(page, 'zombies', 'easy');
  // The new session has just been made: its clock has not moved.
  await page.waitForFunction(() => {
    const s = (window.__lvt as any).session;
    return s !== null && s !== (window as any).__first.session;
  });
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick)).toBe(0);
  await waitLive(page);
  expect(await page.locator('canvas').count()).toBe(1);
  expect(await page.evaluate(() => (window.__lvt as any).stage === (window as any).__first.stage)).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).renderer.webgl.getContext().isContextLost())).toBe(false);
  expect(problems.contextWarnings).toEqual([]);
  await frames(page, 30);
});

test('settings: volume and quality are kept across a reload', async ({ page }) => {
  await openTitle(page);
  await page.locator('[data-action="settings"]').click();
  const panel = page.locator('[data-screen="settings"]');
  await panel.locator('input[aria-label="Music"]').fill('30');
  await panel.locator('input[aria-label="Effects"]').fill('45');
  await panel.locator('[data-quality="low"]').click();
  await expect(panel.locator('[data-quality="low"]')).toHaveAttribute('aria-pressed', 'true');
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('lvt2_settings'))) ?? 'null');
  expect(saved).toMatchObject({ music: 0.3, sfx: 0.45, quality: 'low' });

  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('[data-screen="settings"] input[aria-label="Music"]')).toHaveValue('30');
  await expect(page.locator('[data-screen="settings"] input[aria-label="Effects"]')).toHaveValue('45');
  await expect(page.locator('[data-screen="settings"] [data-quality="low"]')).toHaveAttribute('aria-pressed', 'true');
});
