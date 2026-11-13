import { expect, test } from './fixtures';
import { logIn, openTitle, pickAndStart, waitLive } from './helpers';

// Phase 4a Task 5: the Marketplace on the fake cloud. Lukas buys by taps, the level is kept after
// a reload, the battle gets it on his side only, and the screen fits 1024x650 with big targets.

test('Lukas buys upgrades by taps; they are kept and reach his side in battle', async ({ page }) => {
  test.setTimeout(120_000);
  await openTitle(page);
  await logIn(page);
  await page.evaluate(async () => {
    const s = (window.__lvt as any).players;
    s.update((v: any) => ({ ...v, coins: 350 }));
    await s.flush();
  });

  await page.locator('[data-home="marketplace"]').click();
  await expect(page.locator('[data-screen="marketplace"]')).toHaveAttribute('data-side', 'plants');
  await expect(page.locator('[data-card]')).toHaveCount(10);
  await expect(page.locator('[data-coins]')).toHaveAttribute('data-coins', '350');

  await page.locator('[data-buy="peashooter"]').click();
  await expect(page.locator('[data-card="peashooter"] [data-pip].is-on')).toHaveCount(1);
  await expect(page.locator('[data-coins]')).toHaveAttribute('data-coins', '250');
  await page.locator('[data-buy="peashooter"]').click();
  await expect(page.locator('[data-card="peashooter"] [data-pip].is-on')).toHaveCount(2);
  await expect(page.locator('[data-coins]')).toHaveAttribute('data-coins', '50');
  // 300 for the third step, 50 left: the card shakes and nothing is bought.
  await page.locator('[data-buy="peashooter"]').click();
  await expect(page.locator('[data-card="peashooter"]')).toHaveClass(/is-deny-/);
  await expect(page.locator('[data-card="peashooter"] [data-pip].is-on')).toHaveCount(2);
  await page.evaluate(() => (window.__lvt as any).players.flush());

  // A reload (the iPad put away and opened again): logged in again, the level is still there.
  await openTitle(page);
  await logIn(page);
  await expect(page.locator('[data-coins]')).toHaveAttribute('data-coins', '50');
  await page.locator('[data-home="marketplace"]').click();
  await expect(page.locator('[data-card="peashooter"]')).toHaveAttribute('data-level', '2');
  await page.locator('[data-action="back"]').click();

  // In battle, on his side only; the computer has no upgrades.
  await pickAndStart(page, 'plants', 'easy');
  await waitLive(page);
  const ups = await page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.upgrades);
  expect(ups).toEqual({ plants: { peashooter: 2 }, zombies: {} });
});

test('the Marketplace fits 1024x650: every card and "+" on screen, every target at least 44 px', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1024, height: 650 });
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => (window.__lvt as any).players.update((v: any) => ({ ...v, coins: 900, upgrades: { brainEater: 10 } })));
  await page.locator('[data-home="marketplace"]').click();
  for (const side of ['plants', 'zombies'] as const) {
    await page.locator(`[data-tab="${side}"]`).click();
    await expect(page.locator('[data-screen="marketplace"]')).toHaveAttribute('data-side', side);
    await page.waitForTimeout(400); // the grid's pop-in
    const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-card], [data-buy], [data-tab], [data-action="back"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { what: el.getAttribute('data-card') ?? el.getAttribute('data-buy') ?? el.getAttribute('data-tab') ?? 'back', buy: el.hasAttribute('data-buy') || el.tagName === 'BUTTON', x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    }));
    for (const box of boxes) {
      expect(box.x, box.what).toBeGreaterThanOrEqual(0);
      expect(box.y, box.what).toBeGreaterThanOrEqual(0);
      expect(box.r, box.what).toBeLessThanOrEqual(1024);
      expect(box.b, box.what).toBeLessThanOrEqual(650);
      if (box.buy) {
        expect(box.w, box.what).toBeGreaterThanOrEqual(44);
        expect(box.h, box.what).toBeGreaterThanOrEqual(44);
      }
    }
  }
  // Every portrait (with its ink outline) sits inside its card, on both tabs, at each size.
  for (const size of [{ width: 1024, height: 650 }, { width: 1024, height: 704 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    for (const side of ['plants', 'zombies'] as const) {
      await page.locator(`[data-tab="${side}"]`).click();
      await page.waitForTimeout(500);
      const out = await page.evaluate(() => [...document.querySelectorAll('[data-card]')].flatMap((card) => {
        const c = card.getBoundingClientRect();
        const p = (card.querySelector('.market__pic') as HTMLElement).getBoundingClientRect();
        const ink = 3;
        return p.top - ink < c.top || p.left - ink < c.left || p.right + ink > c.right || p.bottom > c.bottom
          ? [`${card.getAttribute('data-card')}: pic ${p.top.toFixed(0)}..${p.bottom.toFixed(0)} card ${c.top.toFixed(0)}..${c.bottom.toFixed(0)}`]
          : [];
      }));
      expect(out, `${size.width}x${size.height} ${side}`).toEqual([]);
    }
  }
  // A portrait at the top of its hop still sits inside its card (1024x650, second row).
  await page.setViewportSize({ width: 1024, height: 650 });
  await page.locator('[data-tab="plants"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-buy="mangoPult"]').click();
  const hop = await page.evaluate(() => {
    const card = document.querySelector('[data-card="mangoPult"]') as HTMLElement;
    const pic = card.querySelector('.market__pic') as HTMLElement;
    for (const a of pic.getAnimations()) { a.pause(); a.currentTime = 105; }
    return { pic: pic.getBoundingClientRect().top, card: card.getBoundingClientRect().top, hopping: pic.getAnimations().length };
  });
  expect(hop.hopping).toBeGreaterThan(0);
  expect(hop.pic - 3).toBeGreaterThanOrEqual(hop.card);
  // The Brain Eater at level 10: a gold frame and nothing to buy.
  await page.locator('[data-tab="zombies"]').click();
  await expect(page.locator('[data-card="brainEater"]')).toHaveClass(/is-max/);
  await expect(page.locator('[data-buy="brainEater"]')).toHaveCount(0);
});
