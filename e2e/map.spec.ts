import { mkdirSync } from 'node:fs';
import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { frames, glContexts, logIn, openTitle } from './helpers';

// Worlds machinery Task 7: one island per world in each side's order, arrow pictures between
// them, locked islands that refuse; the level card's Adventure difficulty apart from Quick
// Battle's; the twist picture on the level card (on stand-in worlds, through `__lvt.previewWorlds`).

/** A touch tap on the iPad project, a mouse click on the desktop. */
async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

/** Home → Play → Adventure → a side → the map, by taps only. */
async function toMap(page: Page, side: 'plants' | 'zombies' = 'plants'): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
}

const lawnShown = (page: Page): Promise<boolean> => page.evaluate(() => (window.__lvt as any).stage.lawn.group.visible as boolean);
const meshNamed = (page: Page, name: string): Promise<boolean> =>
  page.evaluate((n) => (window.__lvt as any).stage.scene.getObjectByName(n) !== undefined, name);

/** Every stone placed over its 3D stone and inside the window. */
async function stonesOnScreen(page: Page, n: number): Promise<void> {
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(n);
  const vp = page.viewportSize()!;
  for (const b of await page.locator('[data-stone]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
  }
}

/** The arrows and the padlock: at least 44 × 44 and inside the window, at 1024 × 650 and the project's size. */
async function bigEnough(page: Page): Promise<string[]> {
  const own = page.viewportSize()!;
  const out: string[] = [];
  for (const size of [{ width: 1024, height: 650 }, own]) {
    await page.setViewportSize(size);
    await frames(page, 3);
    out.push(...await page.evaluate(([w, h]) => [...document.querySelectorAll<HTMLElement>('[data-action^="world-"], [data-action="island-locked"]')]
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 44 || r.height < 44 || r.left < 0 || r.top < 0 || r.right > w! || r.bottom > h!)
      .map(({ b, r }) => `${b.dataset.action} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`), [size.width, size.height]));
  }
  return out;
}

test('arrows walk each side\'s islands in its own order; a locked island is grey, has no stones and refuses a tap', async ({ page }) => {
  test.setTimeout(120_000);
  await openTitle(page);
  await logIn(page);
  await toMap(page, 'plants');
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-arena', 'backyard');
  await expect(map).toHaveAttribute('data-world', '1');
  await stonesOnScreen(page, 8);
  expect(await lawnShown(page)).toBe(true); // the open Backyard is the stage's own lawn
  await expect(page.locator('[data-action="world-prev"]')).toHaveCount(0);
  await expect(page.locator('[data-action="world-next"]')).toHaveAttribute('data-locked', '');
  expect(await bigEnough(page)).toEqual([]);

  // On to the Meadow: locked (no levels yet), grey, its own island, a padlock that refuses.
  await press(page.locator('[data-action="world-next"]'));
  await expect(map).toHaveAttribute('data-arena', 'meadow');
  await expect(map).toHaveAttribute('data-locked', '');
  await expect(page.locator('[data-stone]')).toHaveCount(0);
  await expect(page.locator('[data-marker]')).toHaveCount(0);
  expect(await lawnShown(page)).toBe(false);
  expect(await meshNamed(page, 'map-island')).toBe(true);
  expect(await bigEnough(page)).toEqual([]);
  await press(page.locator('[data-action="island-locked"]'));
  await expect(page.locator('[data-action="island-locked"]')).toHaveClass(/is-deny-a/);
  await expect(page.locator('[data-screen="level-card"]')).toHaveCount(0);
  await expect(map).toHaveAttribute('data-arena', 'meadow');

  // All the way on and back: desert, tundra, citadel, then home to the Backyard.
  for (const arena of ['desert', 'tundra', 'citadel']) {
    await press(page.locator('[data-action="world-next"]'));
    await expect(map).toHaveAttribute('data-arena', arena);
  }
  await expect(page.locator('[data-action="world-next"]')).toHaveCount(0);
  for (let i = 0; i < 4; i++) await press(page.locator('[data-action="world-prev"]'));
  await expect(map).toHaveAttribute('data-arena', 'backyard');
  await stonesOnScreen(page, 8);
  expect(await lawnShown(page)).toBe(true);
  expect(await meshNamed(page, 'map-island')).toBe(false);

  // Toby's zombies start on the Citadel and walk the worlds in reverse.
  await press(page.locator('[data-tab="zombies"]'));
  await expect(map).toHaveAttribute('data-arena', 'citadel');
  await stonesOnScreen(page, 8);
  expect(await lawnShown(page)).toBe(false);
  await press(page.locator('[data-action="world-next"]'));
  await expect(map).toHaveAttribute('data-arena', 'tundra');
  await expect(map).toHaveAttribute('data-locked', '');

  // Leaving the map shows the stage lawn again; one WebGL context all along.
  await press(page.locator('[data-action="back"]'));
  await expect(page.locator('[data-screen="play"]')).toBeVisible();
  expect(await lawnShown(page)).toBe(true);
  expect(await glContexts(page)).toBe(1);
});

test('the level card\'s difficulty is the Adventure\'s own: changing it leaves Quick Battle\'s alone', async ({ page }) => {
  await openTitle(page);
  await logIn(page);
  const save = (): Promise<{ difficulty: Record<string, string>; adventureDifficulty: Record<string, string> }> =>
    page.evaluate(() => (window.__lvt as any).players.player.value);
  const before = await save();
  expect(before.adventureDifficulty.plants).toBe('medium');
  await toMap(page, 'plants');
  await press(page.locator('[data-stone="p1-1"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="p1-1"]')).toBeVisible();
  await expect(page.locator('[data-skill="medium"]')).toHaveAttribute('aria-pressed', 'true');
  await press(page.locator('[data-skill="hard"]'));
  await expect(page.locator('[data-skill="hard"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await save()).adventureDifficulty.plants).toBe('hard');
  expect((await save()).difficulty).toEqual(before.difficulty);

  // Quick Battle's side pick still shows its own (Medium) for the plants.
  await press(page.locator('[data-action="close-card"]'));
  await press(page.locator('[data-action="back"]'));
  await press(page.locator('[data-play="quick"]'));
  await expect(page.locator('[data-screen="sidepick"]')).toBeVisible();
  await press(page.locator('[data-side="plants"]'));
  await expect(page.locator('[data-screen="sidepick"] [data-skill="medium"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await save()).adventureDifficulty.plants).toBe('hard');
});

test('stand-in world 2: the map opens on it after world 1, in its colours; its level card shows the fog picture', async ({ page }) => {
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    lvt.previewWorlds(true);
    lvt.players.update((s: any) => ({
      ...s, plants: { ...s.plants, stars: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p1-${i + 1}`, 2])) },
    }));
  });
  await toMap(page, 'plants');
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-world', '2');
  await expect(map).toHaveAttribute('data-arena', 'meadow');
  await expect(map).not.toHaveAttribute('data-locked', '');
  await stonesOnScreen(page, 8);
  expect(await lawnShown(page)).toBe(false);
  await press(page.locator('[data-stone="p2-1"]'));
  const card = page.locator('[data-screen="level-card"][data-level="p2-1"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-twist="fog"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));
  await press(page.locator('[data-action="world-prev"]'));
  await expect(map).toHaveAttribute('data-arena', 'backyard');
  await expect(page.locator('[data-stone="p1-8"]')).toHaveAttribute('data-state', 'done');
  await page.evaluate(() => (window.__lvt as any).previewWorlds(false));
});

// Screenshots for review, only when asked: LVT_MAP_SHOTS=<folder> npx playwright test e2e/map.spec.ts --project ipad -g shots
test('shots', async ({ page }) => {
  const dir = process.env.LVT_MAP_SHOTS;
  test.skip(dir === undefined || test.info().project.name !== 'ipad', 'screenshots only on request, on the iPad project');
  test.setTimeout(180_000);
  mkdirSync(dir!, { recursive: true });
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    lvt.previewWorlds(true);
    lvt.players.update((s: any) => ({
      ...s,
      plants: { ...s.plants, stars: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p1-${i + 1}`, 3])) },
      zombies: { ...s.zombies, stars: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`z1-${i + 1}`, 3])) },
    }));
  });
  const go = (screen: unknown): Promise<void> => page.evaluate((s) => (window.__lvt as any).go(s), screen);
  const settle = async (): Promise<void> => {
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    await frames(page, 20);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  };
  for (const size of [{ width: 1024, height: 650 }, { width: 1024, height: 704 }, { width: 1180, height: 746 }]) {
    await page.setViewportSize(size);
    const tag = `${size.width}x${size.height}`;
    const shots: [string, unknown][] = [
      ['plants-first', { name: 'map', side: 'plants', world: 1 }],
      ['plants-world2', { name: 'map', side: 'plants', world: 2 }],
      ['plants-locked', { name: 'map', side: 'plants', world: 4 }],
      ['plants-card-fog', { name: 'map', side: 'plants', world: 2, card: 'p2-1' }],
      ['zombies-first', { name: 'map', side: 'zombies', world: 1 }],
      ['zombies-world2', { name: 'map', side: 'zombies', world: 2 }],
      ['zombies-locked', { name: 'map', side: 'zombies', world: 5 }],
      ['zombies-card-ice', { name: 'map', side: 'zombies', world: 2, card: 'z2-1' }],
    ];
    for (const [name, screen] of shots) {
      await go({ name: 'play' });
      await go(screen);
      await settle();
      await page.screenshot({ path: `${dir}/${tag}-${name}.png` });
    }
  }
  await page.evaluate(() => (window.__lvt as any).previewWorlds(false));
});
