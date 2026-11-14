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

// Screenshots for review, only when asked: LVT_WORLD_SHOTS=<folder> npx playwright test e2e/worlds.spec.ts --project ipad -g shots
// Every look with its twist, in a real level (the stand-in worlds), a picked card's marks, at the three iPad sizes.
test('shots', async ({ page }) => {
  const dir = process.env.LVT_WORLD_SHOTS;
  test.skip(dir === undefined || test.info().project.name !== 'ipad', 'screenshots only on request, on the iPad project');
  test.setTimeout(280_000);
  await openTitle(page);
  await logIn(page);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    lvt.previewWorlds(true, [2, 3, 4, 5]);
    const stars: Record<string, number> = {};
    for (let k = 1; k <= 4; k++) for (let n = 1; n <= 8; n++) { stars[`p${k}-${n}`] = 2; stars[`z${k}-${n}`] = 2; }
    const ids = (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    lvt.players.update((p: any) => ({
      ...p, teached: ids,
      plants: { ...p.plants, stars: Object.fromEntries(Object.entries(stars).filter(([k]) => k.startsWith('p'))) },
      zombies: { ...p.zombies, stars: Object.fromEntries(Object.entries(stars).filter(([k]) => k.startsWith('z'))) },
    }));
  });
  const levels: [string, string][] = [
    ['backyard', 'p1-1'], ['meadow-fog', 'p2-1'], ['desert-rocks', 'p3-1'], ['tundra-ice', 'p4-1'], ['citadel-lava', 'p5-1'], ['citadel-z1', 'z1-1'],
  ];
  for (const [name, id] of levels) {
    await page.evaluate((lv) => {
      const lvt = window.__lvt as any;
      const side = lv.startsWith('p') ? 'plants' : 'zombies';
      lvt.go({ name: 'map', side, world: Number(lv[1]), card: lv });
    }, id);
    await page.locator('[data-action="start-level"]').click();
    await waitLive(page);
    // A busy moment: a few plants (or zombies) down, the waves on their way.
    await page.evaluate(() => {
      const lvt = window.__lvt as any;
      const c = lvt.session.controller;
      const me = c.match.state.players[c.playerFaction];
      me.energy = 2000;
      // The player's side gets a few units straight through the match (pictures only).
      const plants = c.playerFaction === 'plants';
      const spots = plants ? [[0, 0], [1, 3], [2, 1], [3, 2], [4, 6]] : [[0, 9], [2, 9], [4, 9]];
      for (const [lane, col] of spots) {
        c.match.state.players[c.playerFaction].recharge = {};
        c.match.step([{ type: 'place', faction: c.playerFaction, unit: plants ? 'peashooter' : 'brainEater', lane, col }]);
      }
      lvt.fastForward(30 * 25);
    });
    for (const size of [{ width: 1024, height: 650 }, { width: 1024, height: 704 }, { width: 1180, height: 746 }]) {
      await page.setViewportSize(size);
      await frames(page, 20);
      await page.screenshot({ path: `${dir}/${size.width}x${size.height}-${name}.png` });
    }
    await page.setViewportSize({ width: 1024, height: 704 });
    await press(page.locator('[data-hud="pause"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await expect(page.locator('[data-screen="map"]')).toBeVisible();
  }
  await page.evaluate(() => (window.__lvt as any).previewWorlds(false));
});
