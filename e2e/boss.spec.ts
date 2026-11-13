import { expect, test } from './fixtures';
import { frames } from './helpers';

// Phase 3 Task 3: each boss's demo level plays 30 seconds on the real lawn (desktop and iPad),
// with the boss bar on screen the whole time and no console error.

for (const boss of ['brainTitan', 'elderOak'] as const) {
  test(`the ${boss} demo plays 30 s with its boss bar showing and no error`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/?scene=boss-demo&boss=${boss}&seed=1&debug`);
    await page.evaluate(() => window.__lvt.ready);
    for (let second = 0; second < 30; second++) {
      await page.evaluate(() => (window.__lvt as any).battle.advance(1));
      await frames(page, 2);
      if (second >= 2) await expect(page.locator('[data-hud="boss"]')).toBeVisible();
    }
    const state = await page.evaluate(() => {
      const s = (window.__lvt as any).battle.match.state;
      return { tick: s.tick as number, boss: (s.units as { key: string }[]).some((u) => u.key === s.config.boss.key) };
    });
    expect(state.tick).toBeGreaterThanOrEqual(30 * 30);
    expect(state.boss).toBe(true);
    await expect(page.locator('.hud-boss__notch').first()).toBeVisible();
  });
}
