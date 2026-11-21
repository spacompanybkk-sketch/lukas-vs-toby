import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { logIn, openTitle, waitLive } from './helpers';

// A base the level makes safe (#1): in the plant survive and conveyor levels the zombie base
// cannot fall (the goal is the clock), so its bar is a padlock on stone instead of a full health
// bar; every other base keeps the ordinary health bar. Found by data-safe, never by text.
// SAFE_SHOTS=<dir> saves the top of the screen with the locked bar.

/** Lukas, logged in, every level of both sides open and every lesson done. */
async function setUp(page: Page): Promise<void> {
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const all = (lvt.levels as { id: string; teaches: { id: string }[] | null }[]);
    const stars = (l: string) => Object.fromEntries(all.filter((d) => d.id.startsWith(l)).map((d) => [d.id, 2]));
    lvt.players.update((s: any) => ({
      ...s,
      plants: { stars: stars('p'), unlocked: ['potatoMine', 'kernelPult'] },
      zombies: { stars: stars('z'), unlocked: ['desertZombie', 'skeletonArcher'] },
      teached: all.flatMap((d) => (d.teaches ?? []).map((t) => t.id)),
    }));
  });
}

async function level(page: Page, id: string): Promise<void> {
  const side = id.startsWith('p') ? 'plants' : 'zombies';
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-play="adventure"]').click();
  await page.locator(`[data-side="${side}"]`).click();
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  for (let i = 0; i < 4 && await page.locator('[data-screen="map"]').getAttribute('data-world') !== id[1]; i++) await page.locator('[data-action="world-prev"]').click();
  await page.locator(`[data-stone="${id}"]`).click();
  await page.locator('[data-action="start-level"]').click();
  await waitLive(page);
}

async function quitToHome(page: Page): Promise<void> {
  await page.locator('[data-hud="pause"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-screen="map"] [data-action="back"]').click();
  await page.locator('[data-screen="play"] [data-action="back"]').click();
}

test('p1-3: the zombie base is locked (padlock, no health); the plant base is a normal bar. p1-1: both normal', async ({ page }) => {
  test.setTimeout(120_000);
  await setUp(page);

  await level(page, 'p1-3');
  const zombies = page.locator('[data-hud="base-zombies"]');
  const plants = page.locator('[data-hud="base-plants"]');
  await expect(zombies).toHaveAttribute('data-safe', '');
  await expect(zombies.locator('.hud-base__bar--safe svg path').first()).toBeVisible();
  await expect(zombies.locator('.hud-base__fill')).toHaveCount(0);
  await expect(plants).not.toHaveAttribute('data-safe', /.*/);
  await expect(plants.locator('.hud-base__fill')).toHaveCount(1);
  const shots = process.env.SAFE_SHOTS;
  if (shots !== undefined) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${test.info().project.name}-p1-3.png`) });
  }
  await quitToHome(page);

  await level(page, 'p1-1');
  for (const side of ['plants', 'zombies']) {
    const base = page.locator(`[data-hud="base-${side}"]`);
    await expect(base).not.toHaveAttribute('data-safe', /.*/);
    await expect(base.locator('.hud-base__fill')).toHaveCount(1);
    await expect(base.locator('.hud-base__bar--safe')).toHaveCount(0);
  }
});
