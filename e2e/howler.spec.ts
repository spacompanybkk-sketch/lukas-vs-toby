import { expect, test } from './fixtures';
import { frames, glContexts } from './helpers';

// Step 2 Task 2: the Moon Howler's demo (`?scene=boss-demo&boss=moonHowler`, the Meadow's fog and
// fireflies) from its entrance through its slam, its summon, its moon dome, its howl and phase 2
// to its defeat, on one WebGL context, with no console error (the fixture checks that).

interface Seen { slam: boolean; summon: boolean; shield: boolean; howl: boolean; phase2: boolean; defeated: boolean; contexts: number }

test('the Moon Howler demo plays from entrance to defeat on one WebGL context', async ({ page }) => {
  test.setTimeout(180_000);
  // `&t=0`: the scene's own clock holds, so every step (and its events) is the test's.
  await page.goto('/?scene=boss-demo&boss=moonHowler&seed=1&t=0&debug&cloud=fake');
  await page.evaluate(() => window.__lvt.ready);
  const contexts = await glContexts(page);
  const seen: Seen = { slam: false, summon: false, shield: false, howl: false, phase2: false, defeated: false, contexts };
  for (let second = 0; second < 70 && !seen.defeated; second++) {
    const now = await page.evaluate(() => {
      const b = (window as any).__lvt.battle;
      const out = { slam: false, summon: false, shield: false, howl: false, phase2: false, defeated: false };
      for (let i = 0; i < 30; i++) {
        b.advance(1 / 30);
        for (const e of b.events) {
          if (e.type === 'bossPattern' && e.kind === 'slam') out.slam = true;
          if (e.type === 'bossPattern' && e.kind === 'summon') out.summon = true;
          if (e.type === 'bossPattern' && e.kind === 'shield') out.shield = true;
          if (e.type === 'bossStrike' && e.windup) out.howl = b.view.bossFx.striking;
          if (e.type === 'bossDefeated') out.defeated = true;
        }
        const s = b.match.state;
        const boss = s.units.find((u: { key: string }) => u.key === 'moonHowler');
        if (boss && boss.phase >= 1) out.phase2 = true;
      }
      return out;
    });
    for (const k of Object.keys(now) as (keyof typeof now)[]) seen[k] = seen[k] || now[k];
    await frames(page, 2);
    if (second >= 2 && !seen.defeated) await expect(page.locator('[data-hud="boss"]')).toBeVisible();
  }
  expect(seen).toEqual({ slam: true, summon: true, shield: true, howl: true, phase2: true, defeated: true, contexts });
  expect(await glContexts(page)).toBe(contexts);
  const winner = await page.evaluate(() => (window as any).__lvt.battle.match.state.winner);
  expect(winner).toBe('plants');
});
