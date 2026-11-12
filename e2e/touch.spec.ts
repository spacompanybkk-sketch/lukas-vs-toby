import { expect, test } from './fixtures';
import { frames, plantAt, snapshot, startBattle, tilePoint } from './helpers';

// iPad project only: the same game played with a finger (touch events, not a mouse).
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad', 'touch tests run in the ipad project');
});

test('a tap on a card and a tap on a tile places a unit', async ({ page }) => {
  await startBattle(page, 'plants');
  await page.locator('[data-card="sunflower"]').tap();
  await expect(page.locator('[data-card="sunflower"]')).toHaveAttribute('aria-pressed', 'true');
  const at = await tilePoint(page, 2, 1);
  await page.touchscreen.tap(at.x, at.y);
  await expect.poll(async () => plantAt(await snapshot(page), 2, 1)?.key ?? null).toBe('sunflower');
});

test('a drag from a card to a tile places a unit', async ({ page }) => {
  await startBattle(page, 'plants');
  const card = (await page.locator('[data-card="peashooter"]').boundingBox())!;
  const from = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
  const to = await tilePoint(page, 1, 4);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y as number, id: 1 }] });
  await touch('touchStart', from.x, from.y);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await frames(page, 1);
  }
  await touch('touchEnd');
  await expect.poll(async () => plantAt(await snapshot(page), 1, 4)?.key ?? null).toBe('peashooter');
});

test('held upright (portrait) the turn-your-device screen shows and the battle pauses', async ({ page }) => {
  await startBattle(page, 'plants');
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('[data-screen="rotate"]')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).paused).toBe(true);
  const tick = (await snapshot(page)).tick;
  await frames(page, 20);
  expect((await snapshot(page)).tick).toBe(tick);
  // Turning back shows the pause menu; the battle waits for Resume.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('[data-screen="rotate"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  expect((await snapshot(page)).paused).toBe(true);
});
