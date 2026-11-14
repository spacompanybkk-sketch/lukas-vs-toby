import { mkdirSync } from 'node:fs';
import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { frames, plantAt, snapshot, startBattle, tilePoint, unitPoint } from './helpers';

// The iPad report: a level-3+ plant is so big that, seen from the raised camera, its body covers
// the tile behind it (a lane further back, higher on the screen), and a plant could not be put
// there. Placing goes by the ground tile under the finger. Both projects: a finger on the iPad
// (real touch), the mouse on the desktop. The tall plants are grown through the debug hooks.

const ipad = (): boolean => test.info().project.name === 'ipad';

async function tapAt(page: Page, at: { x: number; y: number }): Promise<void> {
  if (ipad()) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/** Money in hand and every card recharged (a test hook), so each tap is judged on the tile alone. */
function ready(page: Page): Promise<void> {
  return page.evaluate(() => {
    const me = (window.__lvt as any).session.controller.match.state.players.plants;
    me.energy = 9999;
    me.recharge = {};
  });
}

/** A Peashooter on (lane, col), merged up to `level` by the controller (debug hooks), then drawn at that size. */
async function grow(page: Page, lane: number, col: number, level: number): Promise<number> {
  const id = await page.evaluate(([l, c, n]) => {
    const lvt = window.__lvt as any;
    const ctl = lvt.session.controller;
    for (let i = 0; i < n; i++) {
      const me = ctl.match.state.players.plants;
      me.energy = 9999;
      me.recharge = {};
      ctl.select('peashooter');
      ctl.click({ lane: l, col: c }, null);
      lvt.fastForward(1);
    }
    const u = ctl.match.state.units.find((x: any) => x.faction === 'plants' && x.lane === l && Math.floor(x.x) === c);
    u.hp = u.maxHp = 1e6; // nothing eats it during the test
    return u.id as number;
  }, [lane, col, level] as const);
  await frames(page, 60); // the merge's grow-up plays out
  expect(plantAt(await snapshot(page), lane, col)?.level).toBe(level);
  return id;
}

/** The unit whose drawn model the pointer at a client point hits, or null. */
function bodyAt(page: Page, at: { x: number; y: number }): Promise<number | null> {
  return page.evaluate(({ x, y }) => {
    const lvt = window.__lvt as any;
    const r = (lvt.stage.canvas as HTMLCanvasElement).getBoundingClientRect();
    return lvt.session.view.unitHitByRay(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2) as number | null;
  }, at);
}

async function pickCard(page: Page, key: string): Promise<void> {
  const card = page.locator(`[data-card="${key}"]`);
  if ((await card.getAttribute('aria-pressed')) !== 'true') {
    if (ipad()) await card.tap();
    else await card.click();
  }
  await expect(card).toHaveAttribute('aria-pressed', 'true');
}

test('with level-3 and level-5 Peashooters in front, the Peashooter card goes on the tile behind each and on every tile of the top lanes', async ({ page }) => {
  await startBattle(page, 'plants', 'easy');
  const l3 = await grow(page, 3, 2, 3);
  const l5 = await grow(page, 3, 5, 5);
  // The report's case: the bodies cover the tiles right behind them.
  expect(await bodyAt(page, await tilePoint(page, 2, 2))).toBe(l3);
  expect(await bodyAt(page, await tilePoint(page, 2, 5))).toBe(l5);
  await pickCard(page, 'peashooter'); // their own card: the old merge-steal case
  const targets: [number, number][] = [[2, 2], [2, 5]];
  for (let lane = 0; lane <= 2; lane++) for (let col = 0; col < 8; col++) if (!targets.some(([l, c]) => l === lane && c === col)) targets.push([lane, col]);
  for (const [lane, col] of targets) {
    await ready(page);
    await pickCard(page, 'peashooter');
    await tapAt(page, await tilePoint(page, lane, col));
    await expect.poll(async () => plantAt(await snapshot(page), lane, col)?.key ?? null, { message: `tile ${lane},${col}` }).toBe('peashooter');
  }
  const after = await snapshot(page);
  expect(plantAt(after, 3, 2)?.level, 'nothing merged into the level-3').toBe(3);
  expect(plantAt(after, 3, 5)?.level, 'nothing merged into the level-5').toBe(5);
});

test('the shovel digs a tall plant by a tap on its body', async ({ page }) => {
  await startBattle(page, 'plants', 'easy');
  const id = await grow(page, 3, 5, 5);
  const shovel = page.locator('[data-shovel]');
  if (ipad()) await shovel.tap();
  else await shovel.click();
  await expect(shovel).toHaveAttribute('aria-pressed', 'true');
  const body = await unitPoint(page, id, 0.75);
  expect(await bodyAt(page, body)).toBe(id);
  await tapAt(page, body);
  await expect.poll(async () => plantAt(await snapshot(page), 3, 5)).toBeUndefined();
});

/**
 * Pictures for a person to look at, only when LVT_TALL_SHOTS names a folder (and only on the
 * iPad): a level-5 Peashooter with its card picked and a finger held on the covered tile behind it.
 */
test('picture: the covered tile behind a level-5 plant, its card picked and a finger on it', async ({ page }) => {
  const dir = process.env.LVT_TALL_SHOTS;
  test.skip(!dir || !ipad(), 'pictures only on request');
  mkdirSync(dir as string, { recursive: true });
  await page.setViewportSize({ width: 1024, height: 650 });
  await startBattle(page, 'plants', 'easy');
  await grow(page, 3, 4, 5);
  await grow(page, 4, 4, 5);
  await ready(page);
  await pickCard(page, 'peashooter');
  await frames(page, 70); // past the loud second of the place marks
  await page.screenshot({ path: `${dir}/${process.env.LVT_TALL_NAME ?? 'shot'}-picked.png` });
  const at = await tilePoint(page, 2, 4);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
  await frames(page, 10);
  await page.screenshot({ path: `${dir}/${process.env.LVT_TALL_NAME ?? 'shot'}-finger.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
});
