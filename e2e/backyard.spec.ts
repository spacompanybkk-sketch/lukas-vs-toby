import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { forceResult, frames, glContexts, logIn, openTitle, tilePoint, waitLive } from './helpers';

// Phase 3 Task 9: the Backyard end to end, one save carried through the file's tests (in order,
// on both projects): a brand-new player walks the first three levels of each side by following
// the glove with taps, sees the unlocks and the map showing them; a conveyor level by taps and by
// drag; a breakthrough lost on the clock; both bosses from the map; Free Play to wave 3 and a quit
// that banks; then a reload shows the same stars, coins, unlocks and best wave. One WebGL context
// in every test, and no console or page error (the fixture).
//
// The save lives in the page's storage (the fake cloud and the device keys). Each test leaves its
// storage in `carried` (per project), and the next one starts from it.

test.describe.configure({ mode: 'serial' });

const carried = new Map<string, Record<string, string>>();

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

async function tapAt(page: Page, at: { x: number; y: number }): Promise<void> {
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/** The title, with the storage the previous test left (if any), and Lukas logged in on Home. */
async function resume(page: Page): Promise<void> {
  const saved = carried.get(test.info().project.name);
  await openTitle(page);
  if (saved !== undefined) {
    await page.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, saved);
    await openTitle(page);
  }
  await logIn(page);
}

/** Flushes the save to the (fake) cloud and keeps the page's storage for the next test. */
async function keep(page: Page): Promise<void> {
  await page.evaluate(() => (window.__lvt as any).players.flush());
  carried.set(test.info().project.name, await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out[k] = localStorage.getItem(k)!;
    }
    return out;
  }));
}

interface Progress { coins: number; bestWave: number; plants: { stars: Record<string, number>; unlocked: string[] }; zombies: { stars: Record<string, number>; unlocked: string[] } }
const progress = (page: Page): Promise<Progress> => page.evaluate(() => {
  const s = (window.__lvt as any).players.player.value;
  return JSON.parse(JSON.stringify({ coins: s.coins, bestWave: s.bestWave, plants: s.plants, zombies: s.zombies }));
});

async function toMap(page: Page, side: 'plants' | 'zombies'): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
}

async function startFromMap(page: Page, id: string): Promise<void> {
  await press(page.locator(`[data-stone="${id}"]`));
  await expect(page.locator(`[data-screen="level-card"][data-level="${id}"]`)).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await page.evaluate(() => (window.__lvt as any).screen.options.level)).toBe(id);
}

/**
 * Follows the level's glove until every step of its tutorial is remembered, by taps only: a tap
 * where the glove stands whenever it holds still; while it waits for something (a card to
 * recharge, the hero to be ready), the match is moved on by fast-forward. Each place the glove
 * points at is on screen.
 */
async function followTutorial(page: Page, id: string): Promise<string[]> {
  const ids = await page.evaluate((lv) => ((window.__lvt as any).levels as { id: string; teaches: { id: string }[] | null }[])
    .find((l) => l.id === lv)!.teaches!.map((t) => t.id), id);
  const vp = page.viewportSize()!;
  const seen: string[] = [];
  for (let i = 0; i < 400; i++) {
    const done = await page.evaluate((want) => {
      const t: string[] = (window.__lvt as any).players.player.value.teached ?? [];
      return want.every((x) => t.includes(x));
    }, ids);
    if (done) break;
    const hand = page.locator('[data-tutorial] [data-glove][data-holding="true"][data-glove-x]');
    if (await hand.count() > 0) {
      await frames(page, 3);
      const g = await hand.evaluate((e: HTMLElement) => ({ step: e.dataset.gloveStep!, x: Number(e.dataset.gloveX), y: Number(e.dataset.gloveY) }))
        .catch(() => null);
      if (g === null) continue;
      expect(g.x, `${g.step} on screen`).toBeGreaterThan(0);
      expect(g.x).toBeLessThan(vp.width);
      expect(g.y, `${g.step} on screen`).toBeGreaterThan(0);
      expect(g.y).toBeLessThan(vp.height);
      if (seen.at(-1) !== g.step) seen.push(g.step);
      await tapAt(page, g);
      await frames(page, 3);
    } else {
      await page.evaluate(() => (window.__lvt as any).fastForward(15));
      await frames(page, 2);
    }
  }
  expect(await page.evaluate(() => (window.__lvt as any).players.player.value.teached)).toEqual(expect.arrayContaining(ids));
  return seen;
}

/** Wins the running level (a little play, then the enemy base falls) and waits for the result. */
async function win(page: Page, id: string, enemy: 'plants' | 'zombies'): Promise<void> {
  await page.evaluate(() => (window.__lvt as any).fastForward(150));
  await forceResult(page, enemy);
  await expect(page.locator(`[data-level-result="${id}"]`)).toBeVisible({ timeout: 30_000 });
}

/** A side's first three levels from a fresh save, by the glove; the unlock after level 3 shown and kept. */
async function walk(page: Page, side: 'plants' | 'zombies', unlock: string): Promise<void> {
  const l = side === 'plants' ? 'p' : 'z';
  const enemy = side === 'plants' ? 'zombies' : 'plants';
  await toMap(page, side);
  await expect(page.locator(`[data-stone="${l}1-1"]`)).toHaveAttribute('data-state', 'next');
  // Level 3 shows what it brings: the silhouette with a "?".
  await expect(page.locator(`[data-stone="${l}1-3"] [data-unlock="${unlock}"]`)).toHaveCount(1);
  await startFromMap(page, `${l}1-1`);
  for (const n of [1, 2, 3]) {
    const id = `${l}1-${n}`;
    const steps = await followTutorial(page, id);
    expect(steps.length, `${id}: glove steps followed`).toBeGreaterThan(0);
    const before = (await progress(page)).coins;
    await win(page, id, enemy);
    // Stars by the base (or the clock) left after the tutorial's play: at least one, 30 coins each.
    const stars = Number(await page.locator(`[data-level-result="${id}"]`).getAttribute('data-stars'));
    expect(stars).toBeGreaterThanOrEqual(1);
    await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
    await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
    expect((await progress(page)).coins).toBe(before + 30 * stars);
    expect((await progress(page))[side].stars[id]).toBe(stars);
    if (n < 3) {
      // The next level, straight from the result by its picture button.
      await press(page.locator(`[data-action="next-level"][data-next="${l}1-${n + 1}"]`));
      await waitLive(page);
      expect(await page.evaluate(() => (window.__lvt as any).screen.options.level)).toBe(`${l}1-${n + 1}`);
    }
  }
  // Level 3's unlock: the unit on the turntable.
  await expect(page.locator(`[data-screen="result"][data-step="unlock"] [data-unlock="${unlock}"]`)).toBeVisible({ timeout: 15_000 });
  expect((await progress(page))[side].unlocked).toEqual([unlock]);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  const saved = (await progress(page))[side].stars;
  for (const n of [1, 2, 3]) await expect(page.locator(`[data-stone="${l}1-${n}"]`)).toHaveAttribute('data-stars', String(saved[`${l}1-${n}`]));
  await expect(page.locator(`[data-stone="${l}1-4"]`)).toHaveAttribute('data-state', 'next');
  // The map shows it: the gift is gone from level 3, and level 4's card deals the new unit.
  await expect(page.locator(`[data-stone="${l}1-3"] [data-unlock]`)).toHaveCount(0);
  await press(page.locator(`[data-stone="${l}1-4"]`));
  await expect(page.locator(`[data-screen="level-card"] [data-dealt] [data-picture="${unlock}"]`)).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));
}

test('a brand-new player walks p1-1 → p1-3 by the glove and sees the Potato Mine unlock; the map shows it', async ({ page }) => {
  test.setTimeout(240_000);
  carried.delete(test.info().project.name);
  await resume(page);
  expect(await progress(page)).toMatchObject({ coins: 0, plants: { stars: {}, unlocked: [] } });
  await walk(page, 'plants', 'potatoMine');
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('the same player walks z1-1 → z1-3 by the glove and sees the Desert Zombie unlock', async ({ page }) => {
  test.setTimeout(240_000);
  await resume(page);
  await walk(page, 'zombies', 'desertZombie');
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('a conveyor level by taps and by drag; a breakthrough lost on the clock pays 5 and keeps the stars', async ({ page }) => {
  test.setTimeout(240_000);
  await resume(page);
  // p1-4 won (forced) to open the conveyor level p1-5.
  await toMap(page, 'plants');
  await startFromMap(page, 'p1-4');
  await win(page, 'p1-4', 'zombies');
  await press(page.locator('[data-action="next-level"][data-next="p1-5"]'));
  await waitLive(page);
  await expect(page.locator('[data-hud="belt"]')).toBeVisible();
  await expect(page.locator('[data-hud="tray"]')).toHaveCount(0);
  const plantKey = (lane: number, col: number): Promise<string | null> => page.evaluate(([ln, c]) => (window.__lvt as any).session.controller.match.state.units
    .find((u: any) => u.faction === 'plants' && u.lane === ln && Math.floor(u.x) === c)?.key ?? null, [lane, col] as const);
  // By taps, as the belt's lesson shows: the glove on the first belt card (the match held), then on its tile.
  const first = page.locator('[data-belt][data-slot="0"]');
  await expect(first).toBeVisible();
  const glove = page.locator('[data-tutorial] .tut-hand');
  await expect(glove).toHaveAttribute('data-glove-step', 'p1-5.belt');
  await expect(glove).toHaveAttribute('data-glove', 'card');
  await expect(glove).toHaveAttribute('data-holding', 'true');
  const tapped = await first.getAttribute('data-card');
  await press(first);
  await expect(glove).toHaveAttribute('data-glove-step', 'p1-5.belt-tile');
  await expect(glove).toHaveAttribute('data-glove', 'tile');
  await expect(glove).toHaveAttribute('data-glove-x', /\d+/);
  const aim = { x: Number(await glove.getAttribute('data-glove-x')), y: Number(await glove.getAttribute('data-glove-y')) };
  const tile = await tilePoint(page, 2, 1);
  expect(Math.abs(aim.x - tile.x) + Math.abs(aim.y - tile.y)).toBeLessThan(3);
  await tapAt(page, aim);
  await expect.poll(() => plantKey(2, 1)).toBe(tapped);
  await expect(page.locator('[data-tutorial]')).toHaveCount(0);
  // By drag: the next belt card (the belt brings one) pulled onto another tile.
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    return page.locator('[data-belt][data-slot="0"]').count();
  }, { timeout: 30_000 }).toBe(1);
  const card = page.locator('[data-belt][data-slot="0"]');
  const dragged = await card.getAttribute('data-card');
  const box = (await card.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = await tilePoint(page, 3, 2);
  if (test.info().project.name === 'ipad') {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y as number, id: 1 }] });
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
      await frames(page, 1);
    }
    await touch('touchEnd');
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
      await frames(page, 1);
    }
    await page.mouse.up();
  }
  await expect.poll(() => plantKey(3, 2)).toBe(dragged);
  // Out by the pause menu's Quit (to the map, nothing paid).
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();

  // z1-3 (a breakthrough, won with 3 stars before) played again and lost on the clock.
  await press(page.locator('[data-tab="zombies"]'));
  await expect.poll(() => page.locator('[data-stone="z1-3"][data-placed]').count()).toBe(1);
  const before = await progress(page);
  await startFromMap(page, 'z1-3');
  await expect(page.locator('[data-hud="clock-goal"]')).toBeVisible();
  const seconds = await page.evaluate(() => Math.ceil((window.__lvt as any).session.controller.match.state.config.goalTicks / 30));
  await page.evaluate((s) => (window.__lvt as any).fastForward(30 * (s + 2)), seconds);
  const result = page.locator('[data-level-result="z1-3"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toHaveAttribute('data-stars', '0');
  await expect(page.locator('[data-screen="result"] .result__word')).toHaveText('DEFEAT');
  await expect(page.locator('[data-coins-earned="5"]')).toBeVisible();
  const after = await progress(page);
  expect(after.coins).toBe(before.coins + 5);
  expect(after.zombies.stars['z1-3']).toBe(before.zombies.stars['z1-3']);
  await expect(page.locator('[data-screen="result"] [data-action="replay"]')).toBeVisible();
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="z1-3"]')).toHaveAttribute('data-stars', String(before.zombies.stars['z1-3']));
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('both boss levels start from the map, show the boss bar, and end with the result and stars', async ({ page }) => {
  test.setTimeout(240_000);
  await resume(page);
  // Levels 4–7 of each side marked won (two stars) to open the bosses (the levels before are played above).
  await page.evaluate(() => (window.__lvt as any).players.update((s: any) => ({
    ...s,
    plants: { ...s.plants, stars: { ...s.plants.stars, 'p1-4': 2, 'p1-5': 2, 'p1-6': 2, 'p1-7': 2 }, unlocked: ['potatoMine', 'kernelPult'] },
    zombies: { ...s.zombies, stars: { ...s.zombies.stars, 'z1-4': 2, 'z1-5': 2, 'z1-6': 2, 'z1-7': 2 }, unlocked: ['desertZombie', 'skeletonArcher'] },
  })));
  for (const [side, id, enemy, boss] of [['plants', 'p1-8', 'zombies', 'brainTitan'], ['zombies', 'z1-8', 'plants', 'elderOak']] as const) {
    await toMap(page, side);
    await expect(page.locator(`[data-stone="${id}"]`)).toHaveAttribute('data-state', 'next');
    await expect(page.locator(`[data-stone="${id}"]`)).toHaveAttribute('data-kind', 'boss');
    const coins = (await progress(page)).coins;
    await startFromMap(page, id);
    await expect.poll(async () => {
      await page.evaluate(() => (window.__lvt as any).fastForward(15));
      return page.locator('[data-hud="boss"]').count();
    }, { timeout: 30_000 }).toBe(1);
    await expect(page.locator(`.hud-boss--${boss}`)).toBeVisible();
    await win(page, id, enemy);
    await expect(page.locator(`[data-level-result="${id}"]`)).toHaveAttribute('data-stars', '3');
    await expect(page.locator('.lresult__stars[data-lit="3"]')).toBeVisible();
    // Level 8 is the last of the Backyard: no next level.
    await expect(page.locator('[data-action="next-level"]')).toHaveCount(0);
    expect((await progress(page)).coins).toBe(coins + 90);
    expect((await progress(page))[side].stars[id]).toBe(3);
    await press(page.locator('[data-screen="result"] [data-action="map"]'));
    await expect(page.locator(`[data-stone="${id}"]`)).toHaveAttribute('data-stars', '3');
    await press(page.locator('[data-screen="map"] [data-action="back"]'));
    await press(page.locator('[data-screen="play"] [data-action="back"]'));
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
  }
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('Free Play reaches wave 3; Quit from pause banks the coins and the best wave', async ({ page }) => {
  test.setTimeout(180_000);
  await resume(page);
  const before = await progress(page);
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="free"]'));
  await press(page.locator('[data-side="plants"]'));
  await waitLive(page);
  await expect(page.locator('[data-hud="free-wave"]')).toHaveAttribute('data-wave', '0');
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(30 * 5));
    return Number(await page.locator('[data-hud="free-wave"]').getAttribute('data-wave'));
  }, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  const wave = Number(await page.locator('[data-hud="free-wave"]').getAttribute('data-wave'));
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner)).toBeNull();
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  const bank = page.locator('[data-bank] [data-bank-coins]');
  await expect(bank).toBeVisible();
  const banked = Number(await bank.getAttribute('data-bank-coins'));
  expect(banked).toBeGreaterThan(0);
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  const result = page.locator('[data-free-result="plants"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toHaveAttribute('data-wave', String(wave));
  await expect(page.locator(`[data-coins-earned="${banked}"]`)).toBeVisible();
  const after = await progress(page);
  expect(after.coins).toBe(before.coins + banked);
  expect(after.bestWave).toBe(wave);
  await press(page.locator('[data-screen="result"] [data-action="menu"]'));
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('after all of it a reload shows the same stars, coins, unlocks and best wave', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page);
  const kept = await progress(page);
  expect(kept.bestWave).toBeGreaterThanOrEqual(3);
  expect(kept.plants.unlocked).toEqual(['potatoMine', 'kernelPult']);
  expect(kept.zombies.unlocked).toEqual(['desertZombie', 'skeletonArcher']);
  expect(Object.keys(kept.plants.stars).sort()).toEqual(['p1-1', 'p1-2', 'p1-3', 'p1-4', 'p1-5', 'p1-6', 'p1-7', 'p1-8']);
  expect(Object.keys(kept.zombies.stars).sort()).toEqual(['z1-1', 'z1-2', 'z1-3', 'z1-4', 'z1-5', 'z1-6', 'z1-7', 'z1-8']);
  expect(kept.plants.stars['p1-8']).toBe(3);
  expect(kept.zombies.stars['z1-8']).toBe(3);
  // The page put away and opened again (a plain reload, no storage carried by the test).
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  expect(await progress(page)).toEqual(kept);
  for (const side of ['plants', 'zombies'] as const) {
    await toMap(page, side);
    for (const [id, n] of Object.entries(kept[side].stars)) {
      await expect(page.locator(`[data-stone="${id}"]`)).toHaveAttribute('data-stars', String(n));
    }
    await press(page.locator('[data-screen="map"] [data-action="back"]'));
    await press(page.locator('[data-screen="play"] [data-action="back"]'));
  }
  expect(await glContexts(page)).toBe(1);
});
