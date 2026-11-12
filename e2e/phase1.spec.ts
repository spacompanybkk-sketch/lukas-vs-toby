import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { ZOMBIE_SPAWN_X } from '../src/sim/types';
import {
  analyse, around, cardPrice, clickTile, frames, glContexts, openTitle, pickAndStart, plantAt, shootCanvas, snapshot, startBattle,
  tilePoint, waitCardReady, waitLive,
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
  // Something is drawn: the canvas is not one flat colour (a blank or black canvas would be).
  const { stddev, colors } = await analyse(page, [await shootCanvas(page)], []);
  expect(stddev, 'brightness spread of the title picture').toBeGreaterThan(15);
  expect(colors, 'distinct colours in the title picture').toBeGreaterThan(100);
});

test('the lawn is drawn where the hooks say: grass green, graveyard purple, a placed plant shows', async ({ page }) => {
  await startBattle(page, 'plants');
  await page.mouse.move(5, 5); // no hover ghost on the lawn
  await frames(page, 5);
  const grass = await tilePoint(page, 2, 3);
  const control = await tilePoint(page, 4, 5);
  const grave = await tilePoint(page, 2, 8);
  const before = await shootCanvas(page);
  const picture = await analyse(page, [before], [around(grass, 10), around(grave, 10)]);
  expect(picture.stddev, 'brightness spread of the battle picture').toBeGreaterThan(15);
  expect(picture.colors, 'distinct colours in the battle picture').toBeGreaterThan(100);
  const [g, v] = picture.means as [{ r: number; g: number; b: number }, { r: number; g: number; b: number }];
  expect(g.g, 'grass green over red').toBeGreaterThan(g.r + 40);
  expect(g.g, 'grass green over blue').toBeGreaterThan(g.b + 80);
  expect(v.b, 'graveyard blue over green').toBeGreaterThan(v.g + 30);
  expect(v.b, 'graveyard blue over red').toBeGreaterThan(v.r + 15);

  await place(page, 'peashooter', 2, 3);
  await page.mouse.move(5, 5);
  await frames(page, 20);
  const after = await shootCanvas(page);
  // The unit stands above its tile's centre: look at a patch there, against a tile nothing happened on.
  const changed = await analyse(page, [after, before], [around(grass, 50, -25), around(control, 50, -25)]);
  expect(changed.diffs[0], 'pixels around the new Peashooter changed').toBeGreaterThan(5);
  expect(changed.diffs[0]).toBeGreaterThan((changed.diffs[1] as number) * 3);
});

test('plays as Lukas: a Sunflower and a Peashooter go where they were clicked, and cost their price', async ({ page }) => {
  await startBattle(page, 'plants');
  const before = await snapshot(page);
  const prices = { sunflower: await cardPrice(page, 'sunflower'), peashooter: await cardPrice(page, 'peashooter') };
  const { trickle, sunSeconds } = await page.evaluate(() => {
    const m = (window.__lvt as any).session.controller.match;
    // The trickle as this difficulty pays it to the player.
    return {
      trickle: (m.balance.trickle.plants * m.state.config.incomeMultiplier.plants) as number,
      sunSeconds: m.balance.units.sunflower.sun.interval as number,
    };
  });
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
  // The Sunflower pays out only once its interval has passed; the test is over long before.
  const seconds = (after.tick - before.tick) / 30;
  expect(seconds, 'the Sunflower has not paid out yet').toBeLessThan(sunSeconds);
  const total = prices.sunflower + prices.peashooter;
  expect(after.energy, 'at most the prices were taken').toBeGreaterThanOrEqual(before.energy - total);
  expect(after.energy, 'at least the prices were taken, less the trickle').toBeLessThanOrEqual(before.energy - total + Math.ceil(trickle * seconds) + 1);
});

test('merges by clicking a tile that already holds the same plant, and pays the card price', async ({ page }) => {
  await startBattle(page, 'plants');
  // A Walnut Bomb pays nothing back, so the energy can be checked closely.
  const price = await cardPrice(page, 'walnutBomb');
  const trickle = await page.evaluate(() => {
    const m = (window.__lvt as any).session.controller.match;
    return (m.balance.trickle.plants * m.state.config.incomeMultiplier.plants) as number; // as this difficulty pays it
  });
  await place(page, 'walnutBomb', 1, 1);
  await waitCardReady(page, 'walnutBomb');
  const before = await snapshot(page);
  await selectCard(page, 'walnutBomb');
  await clickTile(page, 1, 1);
  await expect.poll(async () => plantAt(await snapshot(page), 1, 1)?.level).toBe(2);
  const after = await snapshot(page);
  const plants = (snap: typeof after): number => snap.units.filter((u) => u.faction === 'plants').length;
  expect(plants(after)).toBe(plants(before));
  expect(plantAt(after, 1, 1)?.spent, 'both purchases counted in the unit').toBe(price * 2);
  const seconds = (after.tick - before.tick) / 30;
  expect(after.energy).toBeGreaterThanOrEqual(before.energy - price);
  expect(after.energy).toBeLessThanOrEqual(before.energy - price + Math.ceil(trickle * seconds) + 1);
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

test('wins: VICTORY, then Play again starts a fresh battle on the same side and difficulty', async ({ page }) => {
  await startBattle(page, 'zombies', 'hard');
  await page.evaluate(() => { (window as any).__old = (window.__lvt as any).session; });
  const first = await page.evaluate(() => (window.__lvt as any).screen.options);
  expect(first).toMatchObject({ playerFaction: 'zombies', skill: 'hard' });
  await page.evaluate(() => (window.__lvt as any).damageBase('plants', 99999));
  const panel = page.locator('[data-screen="result"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('h2')).toHaveText('VICTORY!');
  await panel.locator('[data-action="play-again"]').click();
  await expect.poll(() => page.evaluate(() => {
    const s = (window.__lvt as any).session;
    return s !== null && s !== (window as any).__old;
  })).toBe(true);
  await waitLive(page);
  const again = await page.evaluate(() => (window.__lvt as any).screen.options);
  expect(again).toMatchObject({ playerFaction: 'zombies', skill: 'hard' });
  expect(again.seed, 'a new seed').not.toBe(first.seed);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.playerFaction)).toBe('zombies');
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
  // Wait inside the page for the new zombie and read where it is the moment it appears.
  const known = before.units.map((u) => u.id);
  const handle = await page.waitForFunction((ids) => {
    const state = (window.__lvt as any).session.controller.match.state;
    const u = state.units.find((unit: any) => unit.faction === 'zombies' && unit.key === 'brainEater' && !ids.includes(unit.id));
    return u ? { lane: u.lane as number, x: u.x as number } : null;
  }, known, { polling: 'raf' });
  const born = await handle.jsonValue() as { lane: number; x: number };
  expect(born.lane).toBe(3);
  expect(born.x).toBeGreaterThan(ZOMBIE_SPAWN_X - 0.1);
  expect(born.x).toBeLessThanOrEqual(ZOMBIE_SPAWN_X);
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
      expect(b.bottom - b.top, `${b.name} height`).toBeGreaterThan(0);
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
  expect(await glContexts(page), 'WebGL contexts after the first match').toBe(1);
  await page.evaluate(() => { (window as any).__first = { session: (window.__lvt as any).session, stage: (window.__lvt as any).stage }; });
  await page.locator('[data-hud="pause"]').click();
  await page.locator('[data-action="quit"]').click(); // arms Quit (a tick shows)
  await page.locator('[data-action="quit"]').click(); // quits
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
  expect(await glContexts(page), 'WebGL contexts after the second match').toBe(1);
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

for (const [asked, expected] of [[60, 60], [61, 60], [40, 40]] as const) {
  test(`stress scene with units=${asked}: ${expected} units fighting, the clock moving, projectiles flying`, async ({ page }) => {
    await page.goto(`/?scene=stress&units=${asked}`);
    await page.evaluate(() => window.__lvt.ready);
    const seen = await page.evaluate(() => new Promise<{ tick0: number; tick1: number; maxProjectiles: number; counts: number[] }>((resolve) => {
      const stress = (window.__lvt as any).stress;
      const state = stress.match.state;
      const tick0 = state.tick as number;
      let maxProjectiles = 0;
      const counts = new Set<number>();
      const start = performance.now();
      const look = (now: number): void => {
        maxProjectiles = Math.max(maxProjectiles, state.projectiles.length);
        counts.add(stress.count as number);
        if (now - start < 3000) requestAnimationFrame(look);
        else resolve({ tick0, tick1: state.tick as number, maxProjectiles, counts: [...counts] });
      };
      requestAnimationFrame(look);
    }));
    expect(seen.tick1, 'the clock moved').toBeGreaterThan(seen.tick0 + 30);
    expect(seen.maxProjectiles, 'projectiles flew').toBeGreaterThan(0);
    expect(seen.counts, 'the unit count (half per side, rounded down) at every frame').toEqual([expected]);
    const { stddev } = await analyse(page, [await shootCanvas(page)], []);
    expect(stddev).toBeGreaterThan(15);
  });
}
