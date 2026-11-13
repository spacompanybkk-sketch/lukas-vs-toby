import { expect, test } from './fixtures';
import { frames, glContexts, logIn, startBattle, waitLive } from './helpers';
import type { Side } from './helpers';

// Task 9's proof, on the production build the e2e serves:
// - the test hooks (`window.__lvt`) exist only with ?debug;
// - a whole match as each side, driven by fast-forward and drawn as it goes, ends on the result
//   screen with no console or page error (who wins is the balance's business, mid-retune, so it is
//   not asserted);
// - the roster demo plays its whole minute with no error and one WebGL context.
// The fixture fails any test that logged a console error, a page error or a WebGL context warning.

test('a production build has no window.__lvt unless the address asks with ?debug', async ({ page }) => {
  await page.goto('/?cloud=fake');
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  await frames(page, 3);
  expect(await page.evaluate(() => typeof (window as { __lvt?: unknown }).__lvt)).toBe('undefined');

  await page.goto('/?scene=stress&cloud=fake&units=20');
  await frames(page, 10);
  expect(await page.evaluate(() => typeof (window as { __lvt?: unknown }).__lvt)).toBe('undefined');

  await page.goto('/?debug&cloud=fake');
  await page.evaluate(() => window.__lvt.ready);
  expect(await page.evaluate(() => typeof window.__lvt)).toBe('object');
});

for (const side of ['plants', 'zombies'] as Side[]) {
  test(`a whole match as ${side}, by fast-forward, ends on the result screen with no error`, async ({ page }) => {
    test.setTimeout(120_000);
    await startBattle(page, side, 'medium');
    // Two minutes of match time at a go, a few frames drawn between, until a side has won (or the
    // match is called), for at most twenty minutes of match time.
    for (let round = 0; round < 10; round++) {
      const over = await page.evaluate(() => {
        const lvt = window.__lvt as any;
        lvt.fastForward(3600);
        return lvt.session.controller.hud.result.value !== null;
      });
      await frames(page, 4);
      if (over) break;
    }
    const panel = page.locator('[data-screen="result"]');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('h2')).toHaveText(/VICTORY!|DEFEAT|DRAW/);
    expect(await glContexts(page)).toBe(1);
  });
}

test('the roster demo plays its whole minute with no error and one WebGL context', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?scene=roster-demo&debug&cloud=fake');
  await page.evaluate(() => window.__lvt.ready);
  // Second by second (every step drawn by the demo's own advance), with real frames between.
  for (let second = 0; second < 60; second++) {
    await page.evaluate(() => (window.__lvt as any).battle.advance(1));
    await frames(page, 2);
  }
  const tick = await page.evaluate(() => (window.__lvt as any).battle.match.state.tick as number);
  expect(tick).toBeGreaterThanOrEqual(60 * 30);
  expect(await glContexts(page)).toBe(1);
});

// Phase 3 Task 9: the hooks added for Adventure (fastForward, damageBase, levels, map, players,
// go, the session and its controller) hang off `window.__lvt` and nowhere else: a child playing
// the production build through Adventure and Free Play by taps never has any of them, and the
// plain (fake-cloud) build shows its test-tube badge all the way.

test('without ?debug no test hook appears anywhere, through a level and a Free Play run; the test-tube badge shows', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?cloud=fake');
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  await expect(page.locator('[data-fake-cloud]')).toBeVisible();
  const globals = (): Promise<string[]> => page.evaluate(() => Object.getOwnPropertyNames(window));
  const before = new Set(await globals());
  const hooks = async (where: string): Promise<void> => {
    expect(await page.evaluate(() => typeof (window as { __lvt?: unknown }).__lvt), where).toBe('undefined');
    const added = (await globals()).filter((k) => !before.has(k));
    expect(added.filter((k) => /lvt|debug|force|skip|fast|damage|hook|session|level|player|match/i.test(k)), `${where}: new globals ${added.join(', ')}`).toEqual([]);
  };
  await page.locator('[data-action="play"]').click();
  await expect(page.locator('[data-fake-cloud]')).toBeVisible(); // on the players' pictures too
  await page.locator('[data-action="back"]').first().click();
  await logIn(page);
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-play="adventure"]').click();
  await page.locator('[data-side="plants"]').click();
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await hooks('on the map');
  await page.locator('[data-stone="p1-1"]').click();
  await page.locator('[data-action="start-level"]').click();
  await expect(page.locator('[data-tutorial] [data-glove]')).toHaveAttribute('data-holding', 'true', { timeout: 30_000 });
  await hooks('in a level, with the glove');
  await page.locator('[data-hud="pause"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await page.locator('[data-screen="map"] [data-action="back"]').click();
  await page.locator('[data-play="free"]').click();
  await page.locator('[data-side="zombies"]').click();
  await expect(page.locator('[data-hud="free-top"]')).toBeVisible({ timeout: 30_000 });
  await hooks('in Free Play');
  expect(await glContexts(page)).toBe(1);
});

test('?fps: the corner readout shows in a level, in a boss level and in Free Play', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?fps&debug&cloud=fake');
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const all = lvt.levels as { id: string; teaches: { id: string }[] | null }[];
    lvt.players.update((s: any) => ({
      ...s,
      plants: { stars: Object.fromEntries(all.filter((d) => d.id.startsWith('p')).map((d) => [d.id, 1])), unlocked: ['potatoMine', 'kernelPult'] },
      teached: all.flatMap((d) => (d.teaches ?? []).map((t) => t.id)),
    }));
  });
  const readout = page.locator('[data-hud="fps"]');
  const reads = async (where: string): Promise<void> => {
    await expect(readout, where).toBeVisible();
    await expect.poll(async () => (await readout.textContent()) ?? '', { message: where }).toMatch(/\d/);
  };
  for (const id of ['p1-3', 'p1-8']) {
    await page.locator('[data-home="play"]').click();
    await page.locator('[data-play="adventure"]').click();
    await page.locator('[data-side="plants"]').click();
    await page.locator(`[data-stone="${id}"]`).click();
    await page.locator('[data-action="start-level"]').click();
    await waitLive(page);
    await reads(id);
    await page.locator('[data-hud="pause"]').click();
    await page.locator('[data-screen="pause"] [data-action="quit"]').click();
    await page.locator('[data-screen="pause"] [data-action="quit"]').click();
    await page.locator('[data-screen="map"] [data-action="back"]').click();
    await page.locator('[data-screen="play"] [data-action="back"]').click();
  }
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-play="free"]').click();
  await page.locator('[data-side="plants"]').click();
  await waitLive(page);
  await reads('Free Play');
});
