import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import {
  frames, mergedEvents, plantAt, recordMerges, snapshot, startBattle, tilePoint, unitPoint, waitCardReady,
} from './helpers';

// The same game played with a finger (touch events, not a mouse). Only the ipad project runs this
// file (see `testIgnore` on the desktop project in playwright.config.ts).

/** Records every pointer event the page gets, so a test can say that fingers, not a mouse, did the work. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __pointers: string[] }).__pointers = log;
    for (const type of ['pointerdown', 'pointerup'] as const) {
      document.addEventListener(type, (e) => log.push(`${type}:${(e as PointerEvent).pointerType}`), true);
    }
  });
});

const pointers = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __pointers: string[] }).__pointers);
const clearPointers = (page: Page): Promise<void> => page.evaluate(() => { (window as unknown as { __pointers: string[] }).__pointers.length = 0; });

test('a tap on a card and a tap on a tile places a unit', async ({ page }) => {
  await startBattle(page, 'plants');
  await clearPointers(page);
  await page.locator('[data-card="sunflower"]').tap();
  await expect(page.locator('[data-card="sunflower"]')).toHaveAttribute('aria-pressed', 'true');
  const at = await tilePoint(page, 2, 1);
  await page.touchscreen.tap(at.x, at.y);
  await expect.poll(async () => plantAt(await snapshot(page), 2, 1)?.key ?? null).toBe('sunflower');
  // Two taps, all by touch: no mouse event took part.
  expect(await pointers(page)).toEqual(['pointerdown:touch', 'pointerup:touch', 'pointerdown:touch', 'pointerup:touch']);
});

test('a drag from a card to a tile places a unit', async ({ page }) => {
  await startBattle(page, 'plants');
  const card = (await page.locator('[data-card="peashooter"]').boundingBox())!;
  const from = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
  const to = await tilePoint(page, 1, 4);
  await clearPointers(page);
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
  // One finger down on the card and up over the lawn.
  expect(await pointers(page)).toEqual(['pointerdown:touch', 'pointerup:touch']);
});

/** One finger from `from` to wherever `to()` says at each step (it may follow a walking unit), then up. */
async function dragTouch(page: Page, from: { x: number; y: number }, to: () => Promise<{ x: number; y: number }>): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y as number, id: 1 }] });
  await touch('touchStart', from.x, from.y);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const at = await to();
    await touch('touchMove', from.x + ((at.x - from.x) * i) / steps, from.y + ((at.y - from.y) * i) / steps);
    await frames(page, 1);
  }
  await touch('touchEnd');
}

async function cardMiddle(page: Page, key: string): Promise<{ x: number; y: number }> {
  const card = (await page.locator(`[data-card="${key}"]`).boundingBox())!;
  return { x: card.x + card.width / 2, y: card.y + card.height / 2 };
}

test('Lukas merges by touch: a tap on the Peashooter, and a drag of its card onto it', async ({ page }) => {
  await startBattle(page, 'plants');
  await recordMerges(page);
  const card = page.locator('[data-card="peashooter"]');
  if ((await card.getAttribute('aria-pressed')) !== 'true') await card.tap();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const tile = await tilePoint(page, 2, 3);
  await page.touchscreen.tap(tile.x, tile.y);
  await expect.poll(async () => plantAt(await snapshot(page), 2, 3)?.key ?? null).toBe('peashooter');
  const plant = plantAt(await snapshot(page), 2, 3)!;
  await waitCardReady(page, 'peashooter');
  const top = await unitPoint(page, plant.id, 0.85);
  await page.touchscreen.tap(top.x, top.y);
  await expect.poll(() => mergedEvents(page)).toContainEqual({ unitId: plant.id, level: 2 });
  await waitCardReady(page, 'peashooter');
  await card.tap(); // deselect: the drag starts from a card not yet selected
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await dragTouch(page, await cardMiddle(page, 'peashooter'), () => unitPoint(page, plant.id, 0.6));
  await expect.poll(() => mergedEvents(page)).toContainEqual({ unitId: plant.id, level: 3 });
  expect((await snapshot(page)).units.filter((u) => u.key === 'peashooter'), 'no second Peashooter').toHaveLength(1);
});

test('Toby merges by touch: a tap on the walking zombie, and a drag of its card onto it', async ({ page }) => {
  await startBattle(page, 'zombies');
  await recordMerges(page);
  const card = page.locator('[data-card="brainEater"]');
  if ((await card.getAttribute('aria-pressed')) !== 'true') await card.tap();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const lane = await tilePoint(page, 1, 9);
  await page.touchscreen.tap(lane.x, lane.y);
  await expect.poll(async () => (await snapshot(page)).units.some((u) => u.faction === 'zombies' && u.key === 'brainEater')).toBe(true);
  const zombie = (await snapshot(page)).units.find((u) => u.faction === 'zombies' && u.key === 'brainEater')!;
  await waitCardReady(page, 'brainEater');
  const head = await unitPoint(page, zombie.id, 0.8);
  await page.touchscreen.tap(head.x, head.y);
  await expect.poll(() => mergedEvents(page)).toContainEqual({ unitId: zombie.id, level: 2 });
  await waitCardReady(page, 'brainEater');
  await card.tap(); // deselect: the drag starts from a card not yet selected
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await dragTouch(page, await cardMiddle(page, 'brainEater'), () => unitPoint(page, zombie.id, 0.5));
  await expect.poll(() => mergedEvents(page)).toContainEqual({ unitId: zombie.id, level: 3 });
  const zombies = (await snapshot(page)).units.filter((u) => u.faction === 'zombies' && u.key === 'brainEater');
  expect(zombies, 'no second Brain Eater').toHaveLength(1);
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

test('a finger drags the hero onto a lane: it fires, nothing buzzes after, and the card comes back for the next tap', async ({ page }) => {
  await startBattle(page, 'plants');
  await page.locator('[data-card="sunflower"]').tap();
  await page.evaluate(() => (window.__lvt as any).fastForward(46 * 30));
  const hero = page.locator('[data-hero]');
  await expect(hero).toHaveClass(/is-ready/);
  const box = (await hero.boundingBox())!;
  const denied = (): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.hud.denied.value as number);
  const used = (): Promise<boolean> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.players.plants.heroTimer > 0);
  const before = await denied();
  await dragTouch(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, () => tilePoint(page, 2, 5));
  await expect.poll(used).toBe(true);
  await frames(page, 30);
  expect(await denied(), 'no buzz from the drag that fired the hero').toBe(before);
  await expect(hero).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-card="sunflower"]')).toHaveAttribute('aria-pressed', 'true');
  const at = await tilePoint(page, 4, 1);
  await page.touchscreen.tap(at.x, at.y);
  await expect.poll(async () => plantAt(await snapshot(page), 4, 1)?.key ?? null).toBe('sunflower');
  expect(await denied()).toBe(before);
});
