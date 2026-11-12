import { expect, test } from './fixtures';
import { frames, glContexts, startBattle } from './helpers';
import type { Side } from './helpers';

// Task 9's proof, on the production build the e2e serves:
// - the test hooks (`window.__lvt`) exist only with ?debug;
// - a whole match as each side, driven by fast-forward and drawn as it goes, ends on the result
//   screen with no console or page error (who wins is the balance's business, mid-retune, so it is
//   not asserted);
// - the roster demo plays its whole minute with no error and one WebGL context.
// The fixture fails any test that logged a console error, a page error or a WebGL context warning.

test('a production build has no window.__lvt unless the address asks with ?debug', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  await frames(page, 3);
  expect(await page.evaluate(() => typeof (window as { __lvt?: unknown }).__lvt)).toBe('undefined');

  await page.goto('/?scene=stress&units=20');
  await frames(page, 10);
  expect(await page.evaluate(() => typeof (window as { __lvt?: unknown }).__lvt)).toBe('undefined');

  await page.goto('/?debug');
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
  await page.goto('/?scene=roster-demo&debug');
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
