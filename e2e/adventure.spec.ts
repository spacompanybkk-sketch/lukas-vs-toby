import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { boxHitsPolygon, deniedCount, forceResult, frames, glContexts, lawnCorners, logIn, openTitle, tilePoint, waitLive } from './helpers';

// Phase 3 Task 4: the way into Adventure: the Play menu, the map on the shared stage, the level card.

/** A touch tap on the iPad project, a mouse click on the desktop. */
async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

/** Home → Play → Adventure → a side → the map, by taps only. */
async function toMap(page: Page, side: 'plants' | 'zombies' = 'plants'): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await expect(page.locator('[data-screen="play"]')).toBeVisible();
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
}

/**
 * The visible tap targets in `scope` smaller than 44 × 44 CSS pixels, at the smallest window the
 * game is made for (1024 × 650: an iPad with Safari's bars) and at the project's own size.
 */
async function smallTargets(page: Page, scope: string): Promise<string[]> {
  const own = page.viewportSize()!;
  const out: string[] = [];
  for (const size of [{ width: 1024, height: 650 }, own]) {
    await page.setViewportSize(size);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // Pop-in animations (which scale things down for a moment) finished; endless ones only grow things.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
    out.push(...await targetsBelow44(page, scope));
  }
  return out;
}

async function targetsBelow44(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(`${sel} button`)]
    .filter((b) => b.offsetParent !== null)
    .map((b) => ({ b, r: b.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ b, r }) => `${b.dataset.stone ?? b.dataset.skill ?? b.dataset.action ?? b.dataset.tab ?? b.className} ${Math.round(r.width)}x${Math.round(r.height)}`), scope);
}

test('from Home to the map, open p1-1, see its card and start it: a battle with the level\'s cards', async ({ page }) => {
  test.setTimeout(120_000);
  await openTitle(page);
  await logIn(page);
  await toMap(page);
  await expect(page.locator('[data-stone]')).toHaveCount(8);
  await expect(page.locator('[data-stone="p1-1"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="p1-2"]')).toHaveAttribute('data-state', 'closed');
  await expect(page.locator('[data-marker="p1-1"]')).toBeVisible();
  // Each stone sits where the 3D map projects it, on screen.
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  const vp = page.viewportSize()!;
  for (const box of await page.locator('[data-stone]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  }
  expect(await smallTargets(page, '[data-screen="map"]')).toEqual([]);

  // A closed stone: a padlock card that points to the next level.
  await press(page.locator('[data-stone="p1-4"]'));
  await expect(page.locator('[data-screen="level-card"][data-locked]')).toBeVisible();
  await press(page.locator('[data-action="go-next"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="p1-1"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));

  await press(page.locator('[data-stone="p1-1"]'));
  const card = page.locator('[data-screen="level-card"][data-level="p1-1"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-dealt] [data-picture="peashooter"]')).toBeVisible();
  await expect(card.locator('[data-star]')).toHaveCount(3);
  expect(await smallTargets(page, '[data-screen="level-card"]')).toEqual([]);
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  const options = await page.evaluate(() => (window.__lvt as any).screen.options);
  expect(options).toMatchObject({ playerFaction: 'plants', level: 'p1-1', cards: ['peashooter'] });
  await expect(page.locator('[data-card]')).toHaveCount(1);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('map') === undefined)).toBe(true);
});

test('the map opens and closes ten times on one WebGL context, leaving nothing behind; it follows a resize', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  await page.locator('[data-home="play"]').click();
  await expect(page.locator('[data-screen="play"]')).toBeVisible();
  const contexts = await glContexts(page);
  const sceneSize = (): Promise<number> => page.evaluate(() => {
    const lvt = window.__lvt as any;
    // The scene's own furniture, without the demo battle's units (which come and go as it plays).
    return lvt.stage.scene.children.filter((c: any) => ['lawn', 'sky', 'map'].includes(c.name) || c.isLight || c.type === 'Points').length;
  });
  const before = await sceneSize();
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-play="adventure"]').click();
    await page.locator(`[data-side="${i % 2 === 0 ? 'plants' : 'zombies'}"]`).click();
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map.isOpen)).toBe(true);
    await page.locator('[data-action="back"]').click();
    await expect(page.locator('[data-screen="play"]')).toBeVisible();
  }
  expect(await glContexts(page)).toBe(contexts);
  expect(await page.evaluate(() => (window.__lvt as any).stage.director === (window.__lvt as any).demo)).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('map') === undefined)).toBe(true);
  expect(await sceneSize()).toBe(before);

  // The stones follow the 3D map when the window changes size.
  await page.locator('[data-play="adventure"]').click();
  await page.locator('[data-side="plants"]').click();
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  const placed = (): Promise<boolean> => page.evaluate(() => {
    const l = (window.__lvt as any).map.layout();
    const el = document.querySelector<HTMLElement>('[data-stone="p1-8"]')!;
    // Placed by one transform: translate3d(x px, y px, 0).
    const [x, y] = (el.style.transform.match(/-?[\d.]+(?=px)/g) ?? []).map(Number);
    return Math.abs(x! - l.stones['p1-8'].x) <= 1 && Math.abs(y! - l.stones['p1-8'].y) <= 1;
  });
  const at = await page.locator('[data-stone="p1-8"]').evaluate((e) => e.style.transform);
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: Math.round(vp.width * 0.8), height: vp.height });
  await expect.poll(() => page.locator('[data-stone="p1-8"]').evaluate((e) => e.style.transform)).not.toBe(at);
  await expect.poll(placed).toBe(true);
  await page.setViewportSize(vp);
  await expect.poll(placed).toBe(true);
  expect(await glContexts(page)).toBe(contexts);
});

test('a guest reaches Quick Battle only; the map side tabs switch between Lukas\'s and Toby\'s paths', async ({ page }) => {
  await openTitle(page);
  await page.evaluate(() => (window.__lvt as any).go({ name: 'play' }));
  await expect(page.locator('[data-play="adventure"][data-locked]')).toBeVisible();
  await page.locator('[data-play="adventure"]').click();
  await expect(page.locator('[data-screen="play"]')).toBeVisible();
  await page.locator('[data-play="quick"]').click();
  await expect(page.locator('[data-screen="sidepick"]')).toBeVisible();
  await page.locator('[data-action="back"]').click();
  await page.locator('[data-action="back"]').click();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();

  await logIn(page);
  await toMap(page, 'plants');
  await page.locator('[data-tab="zombies"]').click();
  await expect(page.locator('[data-stone="z1-1"]')).toHaveAttribute('data-state', 'next');
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('map-stone-z1-1') !== undefined)).toBe(true);
});

// Phase 3 Task 5: playing a level. The result reaches the save exactly once, also across a reload.

const coins = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).players.player.value.coins as number);
const pending = (page: Page): Promise<string | null> => page.evaluate(() => localStorage.getItem('lvt2f_pending_p01'));

/** Marks every tutorial step done for the logged-in player, so a level starts with no glove. */
async function skipTutorials(page: Page): Promise<void> {
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((l) => (l.teaches ?? []).map((t) => t.id));
    lvt.players.update((s: any) => ({ ...s, teached: ids }));
  });
}

/** From the map, open `id`'s card and start it; waits for the fight. */
async function startFromMap(page: Page, id: string): Promise<void> {
  await press(page.locator(`[data-stone="${id}"]`));
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
}

/** Wins the running level: a little play by fast-forward, then the enemy base falls. */
async function winLevel(page: Page, enemy: 'plants' | 'zombies' = 'zombies'): Promise<void> {
  await page.evaluate(() => (window.__lvt as any).fastForward(300));
  await forceResult(page, enemy);
  await expect(page.locator('[data-level-result]')).toBeVisible({ timeout: 30_000 });
}

test('win p1-1: three stars and 90 coins, the map shows them and p1-2 open; a reload keeps them', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  await skipTutorials(page);
  const before = await coins(page);
  await toMap(page);
  await startFromMap(page, 'p1-1');
  await winLevel(page);
  await expect(page.locator('.lresult__stars[data-lit="3"]')).toBeVisible();
  await expect(page.locator('[data-coins-earned="90"]')).toBeVisible();
  expect(await coins(page)).toBe(before + 90);
  expect(await pending(page)).toBeNull();
  await expect(page.locator('[data-action="next-level"][data-next="p1-2"]')).toBeVisible();
  expect(await smallTargets(page, '[data-screen="result"]')).toEqual([]);

  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect(page.locator('[data-stone="p1-1"]')).toHaveAttribute('data-stars', '3');
  await expect(page.locator('[data-stone="p1-2"]')).toHaveAttribute('data-state', 'next');

  await openTitle(page); // a reload
  await logIn(page);
  expect(await coins(page)).toBe(before + 90);
  await toMap(page);
  await expect(page.locator('[data-stone="p1-1"]')).toHaveAttribute('data-stars', '3');
  await expect(page.locator('[data-stone="p1-2"]')).toHaveAttribute('data-state', 'next');
});

test('a reload on the result screen neither loses nor doubles the reward; a result left pending is applied at log-in', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  await skipTutorials(page);
  const before = await coins(page);
  await toMap(page);
  await startFromMap(page, 'p1-1');
  await winLevel(page);
  const battleId = await page.evaluate(() => (window.__lvt as any).players.player.value.lastBattle as string);
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  expect(await coins(page)).toBe(before + 90);

  // The page went away between keeping a result and saving it: it is applied at the next log-in, once.
  await page.evaluate((id) => localStorage.setItem('lvt2f_pending_p01', JSON.stringify(
    { battleId: `${id}x`, levelId: 'p1-2', side: 'plants', stars: 2, won: true })), battleId);
  // The old record again too (already applied): nothing more.
  await openTitle(page);
  await logIn(page);
  await expect.poll(() => coins(page)).toBe(before + 90 + 60);
  expect(await pending(page)).toBeNull();
  await page.evaluate((id) => localStorage.setItem('lvt2f_pending_p01', JSON.stringify(
    { battleId: id, levelId: 'p1-1', side: 'plants', stars: 3, won: true })), `${battleId}x`);
  await openTitle(page);
  await logIn(page);
  await expect.poll(() => pending(page)).toBeNull();
  expect(await coins(page)).toBe(before + 150);
  await toMap(page);
  await expect(page.locator('[data-stone="p1-2"]')).toHaveAttribute('data-stars', '2');
});

test('a conveyor level: the belt replaces the tray, a belt card goes on a tile for nothing; Quit from pause goes to the map and pays nothing', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => (window.__lvt as any).players.update((s: any) => ({
    ...s, plants: { stars: { 'p1-1': 3, 'p1-2': 3, 'p1-3': 3, 'p1-4': 3 }, unlocked: ['potatoMine'] },
  })));
  const before = await coins(page);
  await toMap(page);
  await startFromMap(page, 'p1-5');
  await expect(page.locator('[data-hud="tray"]')).toHaveCount(0);
  await expect(page.locator('[data-hud="belt"]')).toBeVisible();
  await expect(page.locator('[data-hud="clock-goal"]')).toBeVisible();
  const card = page.locator('[data-belt][data-slot="0"]');
  await expect(card).toBeVisible();
  const key = await card.getAttribute('data-card');
  await press(card);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  // The belt's lesson: the glove then points at lane 2, column 1 (taps elsewhere wait).
  await expect(page.locator('[data-tutorial] .tut-hand')).toHaveAttribute('data-glove-step', 'p1-5.belt-tile');
  const at = await tilePoint(page, 2, 1);
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .filter((u: any) => u.faction === 'plants' && u.lane === 2 && Math.floor(u.x) === 1).map((u: any) => u.key))).toEqual([key]);

  // The belt keeps clear of lanes 0–4 at the smallest iPad window.
  await page.setViewportSize({ width: 1024, height: 650 });
  await frames(page, 5);
  const lawn = await lawnCorners(page);
  const belt = await page.locator('[data-hud="belt"]').evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  expect(boxHitsPolygon(belt, lawn)).toBe(false);
  expect(await targetsBelow44(page, '[data-hud="belt"]')).toEqual([]);

  await press(page.locator('[data-hud="pause"]'));
  await expect(page.locator('[data-screen="pause"] [data-action="map"]')).toHaveCount(0);
  // Quit leads to the map, and shows the map's picture (path and flag), not the house.
  await expect(page.locator('[data-screen="pause"] [data-action="quit"] [data-quit-to="map"]')).toBeVisible();
  await expect(page.locator('[data-screen="pause"] [data-action="quit"] .ico--home')).toHaveCount(0);
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  expect(await coins(page)).toBe(before);
  expect(await pending(page)).toBeNull();
});


// Phase 3 Task 6: the tutorial, by following the glove with taps only.

const tick = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number);

/** Taps at a client point: a touch tap on the iPad project, a mouse click on the desktop. */
async function tapAt(page: Page, at: { x: number; y: number }): Promise<void> {
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/** The glove's step and the point it taps (read off its data attributes), once it stands still. */
async function glove(page: Page): Promise<{ step: string; kind: string; x: number; y: number }> {
  const hand = page.locator('[data-tutorial] [data-glove]');
  await expect(hand).toHaveAttribute('data-glove-x', /\d/);
  await expect(hand).toHaveAttribute('data-holding', 'true');
  await frames(page, 3);
  return hand.evaluate((e: HTMLElement) => ({
    step: e.dataset.gloveStep!, kind: e.dataset.glove!, x: Number(e.dataset.gloveX), y: Number(e.dataset.gloveY),
  }));
}

/**
 * Follows the glove until it is gone, by taps only, checking at each step that the match is held
 * (the tick does not move) and that a tap somewhere else does nothing (no move, no buzz).
 */
async function followGlove(page: Page, steps: string[], wrong: { x: number; y: number }): Promise<void> {
  for (const id of steps) {
    const g = await glove(page);
    expect(g.step).toBe(id);
    const t = await tick(page);
    await page.waitForTimeout(400);
    expect(await tick(page)).toBe(t);
    const denied = await deniedCount(page);
    await tapAt(page, wrong);
    await frames(page, 3);
    expect(await deniedCount(page)).toBe(denied);
    expect(await tick(page)).toBe(t);
    await expect(page.locator('[data-tutorial] [data-glove]')).toHaveAttribute('data-glove-step', id);
    await tapAt(page, g);
    await expect.poll(async () => page.locator(`[data-tutorial] [data-glove][data-glove-step="${id}"]`).count()).toBe(0);
  }
  await expect(page.locator('[data-tutorial]')).toHaveCount(0);
  await expect.poll(() => tick(page)).toBeGreaterThan(30);
}

test('the tutorial of p1-1 by the glove: card, then tile, by taps; held while it waits; wrong taps do nothing; remembered', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  await toMap(page);
  await startFromMap(page, 'p1-1');
  const wrong = await tilePoint(page, 0, 5);
  await followGlove(page, ['p1-1.card', 'p1-1.tile'], wrong);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .filter((u: any) => u.faction === 'plants').map((u: any) => `${u.key} ${u.lane} ${Math.floor(u.x)}`))).toEqual(['peashooter 2 1']);
  expect(await page.evaluate(() => (window.__lvt as any).players.player.value.teached)).toEqual(['p1-1.card', 'p1-1.tile']);
  // Started again: no glove. The level card's glove button brings it back.
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await startFromMap(page, 'p1-1');
  await frames(page, 5);
  await expect(page.locator('[data-tutorial]')).toHaveCount(0);
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-stone="p1-1"]'));
  await press(page.locator('[data-action="replay-tutorial"]'));
  await waitLive(page);
  expect((await glove(page)).step).toBe('p1-1.card');
});

test('the tutorial of z1-1 by the glove: the Brain Eater, then its lane', async ({ page }) => {
  test.setTimeout(150_000);
  await openTitle(page);
  await logIn(page);
  await toMap(page, 'zombies');
  await startFromMap(page, 'z1-1');
  const wrong = await tilePoint(page, 4, 6);
  await followGlove(page, ['z1-1.card', 'z1-1.lane'], wrong);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .filter((u: any) => u.faction === 'zombies').map((u: any) => `${u.key} ${u.lane}`))).toEqual(['brainEater 2']);
});
