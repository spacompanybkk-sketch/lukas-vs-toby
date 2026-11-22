import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { boxHitsPolygon, frames, lawnCorners, logIn, openTitle, tilePoint, waitLive } from './helpers';
import type { Box } from './helpers';

// The 2X button (src/app/speed.ts, src/ui/hud/SpeedButton.tsx): beside Pause in every
// single-player battle; a tap lights it and the battle runs at double game time (the sim clock
// counts twice as fast per real second); remembered into the next battle; gone (and 1x) while a
// lesson waits for the player: the fog pan on p2-1 and the first tutorial's glove.
// SPEED_SHOTS=<dir> saves the HUD with the button off and on at the three iPad sizes.

const SIZES = [{ width: 1024, height: 650 }, { width: 1024, height: 704 }, { width: 1180, height: 746 }] as const;

interface Named extends Box { name: string }

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

async function tapAt(page: Page, at: { x: number; y: number }): Promise<void> {
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/** Lukas, logged in, every level open and every lesson done but `teach`. */
async function setUp(page: Page, teach: string[] = []): Promise<void> {
  await openTitle(page);
  await logIn(page);
  await page.evaluate((keep) => {
    const lvt = window.__lvt as any;
    const all = (lvt.levels as { id: string; teaches: { id: string }[] | null }[]);
    const stars = (l: string) => Object.fromEntries(all.filter((d) => d.id.startsWith(l)).map((d) => [d.id, 2]));
    lvt.players.update((s: any) => ({
      ...s,
      plants: { stars: stars('p'), unlocked: ['potatoMine', 'kernelPult'] },
      zombies: { stars: stars('z'), unlocked: ['desertZombie', 'skeletonArcher'] },
      teached: all.flatMap((d) => (d.teaches ?? []).map((t) => t.id)).filter((id) => !keep.includes(id)),
    }));
  }, teach);
}

/** Home → Adventure → the level's world on the map → its card → Play, until the battle is live. */
async function level(page: Page, id: string): Promise<void> {
  const side = id.startsWith('p') ? 'plants' : 'zombies';
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  for (let i = 0; i < 4; i++) {
    const world = Number(await page.locator('[data-screen="map"]').getAttribute('data-world'));
    if (world === Number(id[1])) break;
    await press(page.locator(world > Number(id[1]) ? '[data-action="world-prev"]' : '[data-action="world-next"]'));
  }
  await press(page.locator(`[data-stone="${id}"]`));
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
}

/** Pause → Quit (twice: armed) → the map → Home. */
async function quitToHome(page: Page): Promise<void> {
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="map"] [data-action="back"]'));
  await press(page.locator('[data-screen="play"] [data-action="back"]'));
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
}

/** Sim ticks per real second over `ms` of the page's own clock. */
const tickRate = (page: Page, ms = 2000): Promise<number> => page.evaluate((wait) => new Promise<number>((done) => {
  const state = () => (window.__lvt as any).session.controller.match.state;
  const t0 = performance.now();
  const k0 = state().tick as number;
  setTimeout(() => done(((state().tick as number) - k0) / ((performance.now() - t0) / 1000)), wait);
}), ms);

const timeScale = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).stage.timeScale as number);

/** The visible boxes of the top HUD's parts, the level's bars and the bottom bar's buttons. */
function hudBoxes(page: Page): Promise<Named[]> {
  return page.evaluate(() => {
    const sel = '[data-hud="energy"], [data-hud="topbar"], [data-hud="free-top"], [data-hud="pause"], [data-hud="speed"], [data-hud^="base-"], '
      + '[data-hud="clock-goal"], [data-hud="wave-bar"], [data-hud="boss"], [data-hud="boss-intro"], [data-hud="tray"], [data-hud="belt"], [data-hud="powers"]';
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .map(({ el, r }) => ({ name: el.dataset.hud!, x: r.x, y: r.y, w: r.width, h: r.height }));
  });
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** At each iPad size: the 2X button on screen, at least 64 px to a finger, beside Pause, overlapping nothing and off the lanes. */
async function fits(page: Page, shots: string | undefined, tag: string): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await frames(page, 4);
    const at = `${size.width}x${size.height}`;
    const all = await hudBoxes(page);
    const speed = all.find((b) => b.name === 'speed');
    const pause = all.find((b) => b.name === 'pause');
    expect(speed, `${at}: 2X shown`).toBeDefined();
    expect(pause, `${at}: pause shown`).toBeDefined();
    // Pause's size, and on its left in the same row.
    expect(Math.abs(speed!.w - pause!.w), `${at}: as wide as Pause`).toBeLessThanOrEqual(1);
    expect(Math.abs(speed!.h - pause!.h), `${at}: as tall as Pause`).toBeLessThanOrEqual(1);
    expect(Math.abs(speed!.y - pause!.y), `${at}: in Pause's row`).toBeLessThanOrEqual(1);
    expect(speed!.x + speed!.w, `${at}: left of Pause`).toBeLessThan(pause!.x);
    expect(speed!.x).toBeGreaterThanOrEqual(0);
    expect(speed!.y).toBeGreaterThanOrEqual(0);
    for (const b of all) {
      if (b.name !== 'speed') expect(overlaps(speed!, b), `${at}: 2X overlaps ${b.name}`).toBe(false);
    }
    expect(boxHitsPolygon(speed!, await lawnCorners(page)), `${at}: 2X covers lanes 0–4`).toBe(false);
    // The finger's target: what the page hits 32 px either side of its middle is the button.
    const mid = { x: speed!.x + speed!.w / 2, y: speed!.y + speed!.h / 2 };
    const hits = await page.evaluate((m) => [[-31, 0], [31, 0], [0, 31], [0, -31]].map(([dx, dy]) => {
      const x = Math.min(Math.max(m.x + dx!, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(m.y + dy!, 0), window.innerHeight - 1);
      return document.elementFromPoint(x, y)?.closest('[data-hud="speed"]') !== null;
    }), mid);
    expect(hits, `${at}: 64 px tap target`).toEqual([true, true, true, true]);
    if (shots !== undefined) await page.screenshot({ path: join(shots, `${test.info().project.name}-${tag}-${at}.png`) });
  }
}

test.describe.configure({ mode: 'serial' });

test('in a level: the 2X button beside Pause fits at every size, a tap lights it and the sim clock runs twice as fast; remembered into the next battle', async ({ page }) => {
  test.setTimeout(240_000);
  const shots = process.env.SPEED_SHOTS;
  if (shots !== undefined) mkdirSync(shots, { recursive: true });
  await setUp(page);
  await level(page, 'p1-3');
  const button = page.locator('[data-hud="speed"]');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('2X');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await fits(page, shots, 'off');
  await page.setViewportSize({ width: 1024, height: 704 });
  const slow = await tickRate(page);
  await press(button);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => timeScale(page)).toBe(2);
  const fast = await tickRate(page);
  expect(fast / slow, `ticks a second: ${slow.toFixed(1)} at 1x, ${fast.toFixed(1)} at 2x`).toBeGreaterThan(1.6);
  await fits(page, shots, 'on');
  // Pausing keeps it lit; the pause menu stops the clock as before.
  await press(page.locator('[data-hud="pause"]'));
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  const held = await page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number);
  await frames(page, 20);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number)).toBe(held);
  await press(page.locator('[data-screen="pause"] [data-action="resume"]'));
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // Off again: back to normal speed.
  await press(button);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => timeScale(page)).toBe(1);
  await press(button);
  await quitToHome(page);
  // The next battle (a Quick Battle-like Adventure level) starts lit, at 2x.
  await level(page, 'p1-6');
  await expect(page.locator('[data-hud="speed"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => timeScale(page)).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('lvt2_speed'))).toBe('2');
});

test('a lesson that waits for the player has a greyed 2X button and plays at 1x: the fog pan on p2-1, then 2x after the tap', async ({ page }) => {
  test.setTimeout(180_000);
  await setUp(page, ['p2-1.fog']);
  await page.evaluate(() => localStorage.setItem('lvt2_speed', '2'));
  await level(page, 'p2-1');
  const catcher = page.locator('[data-twist="fog"]');
  await expect(catcher).toBeVisible();
  await expect(page.locator('[data-hud="speed"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-hud="pause"]')).toBeVisible();
  expect(await timeScale(page)).toBe(1);
  await tapAt(page, await tilePoint(page, 2, 5));
  await expect(catcher).toHaveCount(0);
  await expect(page.locator('[data-hud="speed"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => timeScale(page)).toBe(2);
});

test("the first tutorial's glove: a greyed 2X button and 1x while it points", async ({ page }) => {
  test.setTimeout(180_000);
  await setUp(page, ['p1-1.card', 'p1-1.tile']);
  await page.evaluate(() => localStorage.setItem('lvt2_speed', '2'));
  await level(page, 'p1-1');
  await expect(page.locator('[data-tutorial] [data-glove][data-holding="true"]')).toHaveAttribute('data-glove-step', 'p1-1.card');
  await expect(page.locator('[data-hud="speed"]')).toHaveAttribute('aria-disabled', 'true');
  expect(await timeScale(page)).toBe(1);
});
