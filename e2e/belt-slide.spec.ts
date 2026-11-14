import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { frames, glContexts, logIn, openTitle, tilePoint, waitLive } from './helpers';

// A child grabs a conveyor-belt card while it is still sliding in (its 600 ms belt-in animation):
// the card keeps moving under the finger, and the drag still lands on the tile it is let go over.
// Both projects: a finger (CDP touch) on the iPad, the mouse on the desktop.
//
// The slide is made deterministic: the card's belt-in animation is held part-way (as if the finger
// came down 250 ms into the slide), the press starts on the card there, and the animation is let
// go again before the first move, so the card slides away under the pressed finger.

async function press(page: Page, sel: string): Promise<void> {
  if (test.info().project.name === 'ipad') await page.locator(sel).tap();
  else await page.locator(sel).click();
}

/** Lukas on the map with p1-1…p1-4 won and the belt's lesson already learnt, then p1-5 live. */
async function openConveyor(page: Page): Promise<void> {
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => (window.__lvt as any).players.update((s: any) => ({
    ...s,
    teached: [...(s.teached ?? []), 'p1-5.belt', 'p1-5.belt-tile'],
    plants: { ...s.plants, stars: { ...s.plants.stars, 'p1-1': 3, 'p1-2': 3, 'p1-3': 3, 'p1-4': 3 }, unlocked: ['potatoMine'] },
  })));
  await press(page, '[data-home="play"]');
  await press(page, '[data-play="adventure"]');
  await press(page, '[data-side="plants"]');
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.locator('[data-stone="p1-5"][data-placed]').count()).toBe(1);
  await press(page, '[data-stone="p1-5"]');
  await press(page, '[data-action="start-level"]');
  await waitLive(page);
  await expect(page.locator('[data-tutorial]')).toHaveCount(0);
}

const plantKey = (page: Page, lane: number, col: number): Promise<string | null> => page.evaluate(([ln, c]) => (window.__lvt as any).session.controller.match.state.units
  .find((u: any) => u.faction === 'plants' && u.lane === ln && Math.floor(u.x) === c)?.key ?? null, [lane, col] as const);

test('a belt card grabbed while it is still sliding in is dragged onto the tile', async ({ page }) => {
  test.setTimeout(120_000);
  await openConveyor(page);
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    return page.locator('[data-belt][data-slot="0"]').count();
  }, { timeout: 30_000 }).toBe(1);
  const card = page.locator('[data-belt][data-slot="0"]');
  const dragged = await card.getAttribute('data-card');
  // The slide held 250 ms in: the card is still well to the right of its place on the belt.
  const held = await card.evaluate((el) => {
    const slide = el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'belt-in');
    if (slide === undefined) throw new Error('no belt-in animation on the card');
    slide.pause();
    slide.currentTime = 250;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, offset: new DOMMatrix(getComputedStyle(el).transform).m41, width: r.width };
  });
  expect(held.offset, 'held part-way: still more than half a card from its place').toBeGreaterThan(held.width / 2);
  await frames(page, 2);
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-belt]')?.getAttribute('data-slot') ?? null, [held.x, held.y] as const);
  expect(hit, 'the press lands on the sliding card').toBe('0');
  const to = await tilePoint(page, 3, 2);
  const letGo = (): Promise<void> => card.evaluate((el) => {
    el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'belt-in')?.play();
  });
  if (test.info().project.name === 'ipad') {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y as number, id: 1 }] });
    await touch('touchStart', held.x, held.y);
    await letGo();
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', held.x + ((to.x - held.x) * i) / 12, held.y + ((to.y - held.y) * i) / 12);
      await frames(page, 1);
    }
    await touch('touchEnd');
  } else {
    await page.mouse.move(held.x, held.y);
    await page.mouse.down();
    await letGo();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(held.x + ((to.x - held.x) * i) / 12, held.y + ((to.y - held.y) * i) / 12);
      await frames(page, 1);
    }
    await page.mouse.up();
  }
  await expect.poll(() => plantKey(page, 3, 2)).toBe(dragged);
  expect(await glContexts(page)).toBe(1);
});
