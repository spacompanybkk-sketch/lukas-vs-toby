import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { forceResult, frames, glContexts, logIn, openTitle, waitLive } from './helpers';

// Worlds machinery Task 9 (Review Focus 3): zombie level z1-1 is played on the Citadel look to
// the Citadel theme, a Quick Battle on the Backyard to the Backyard theme; ten round trips
// between the two keep one WebGL context and the GPU's geometry count flat.

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

const look = (page: Page): Promise<{ world: string; theme: string | null; rocks: number; lava: number }> => page.evaluate(() => {
  const lvt = window.__lvt as any;
  const lawn = lvt.stage.lawn;
  return { world: lawn.world, theme: lvt.audio.musicTheme, rocks: lawn.lawnConfig.rocks.length, lava: lawn.lawnConfig.lava === null ? 0 : 1 };
});
const geometries = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).renderer.webgl.info.memory.geometries as number);

test('z1-1 on the Citadel look and theme ↔ a Backyard Quick Battle, ten round trips: one WebGL context, geometry count flat', async ({ page }) => {
  test.setTimeout(300_000);
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((l) => (l.teaches ?? []).map((t) => t.id));
    lvt.players.update((s: any) => ({ ...s, teached: ids }));
  });
  // Counted on the zombies' map each round (the Citadel island, no units): after a Quick Battle
  // and a z1-1 in every round but the first.
  const counts: number[] = [];
  for (let round = 0; round < 10; round++) {
    // z1-1 from the zombies' map.
    await press(page.locator('[data-home="play"]'));
    await press(page.locator('[data-play="adventure"]'));
    await press(page.locator('[data-side="zombies"]'));
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    await expect.poll(() => look(page).then((l) => l.world)).toBe('citadel');
    await frames(page, 3);
    counts.push(await geometries(page));
    await press(page.locator('[data-stone="z1-1"]'));
    await press(page.locator('[data-action="start-level"]'));
    await waitLive(page);
    await frames(page, 2);
    // The Citadel with its lava off (z1-1 has no twist), and the Citadel's own tune.
    expect(await look(page), `round ${round + 1}: z1-1`).toEqual({ world: 'citadel', theme: 'citadel', rocks: 0, lava: 0 });
    await forceResult(page, 'plants');
    await expect(page.locator('[data-level-result="z1-1"]')).toBeVisible({ timeout: 30_000 });
    await press(page.locator('[data-screen="result"] [data-action="map"]'));
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    await press(page.locator('[data-screen="map"] [data-action="back"]'));
    await press(page.locator('[data-screen="play"] [data-action="back"]'));
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    // A Quick Battle: the Backyard, its tune.
    await press(page.locator('[data-home="play"]'));
    await press(page.locator('[data-play="quick"]'));
    await expect(page.locator('[data-screen="sidepick"]')).toBeVisible();
    await press(page.locator('[data-side="plants"]'));
    await press(page.locator('[data-action="start"]'));
    await waitLive(page);
    await frames(page, 2);
    expect(await look(page), `round ${round + 1}: Quick Battle`).toEqual({ world: 'backyard', theme: 'backyard', rocks: 0, lava: 0 });
    await press(page.locator('[data-hud="pause"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await expect.poll(() => look(page).then((l) => l.world)).toBe('backyard');
    expect(await glContexts(page), `round ${round + 1}`).toBe(1);
  }
  // From the third round on (caches warm), the same number of geometries on the GPU every time.
  for (const n of counts.slice(2)) expect(n, `geometries on the map: ${counts.join(', ')}`).toBe(counts[2]);
});
