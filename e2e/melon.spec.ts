import { expect, test } from './fixtures';
import { frames, glContexts } from './helpers';

// Step 2 (Tundra): the Frost Melon's demo (`?scene=boss-demo&boss=frostMelon`, the Tundra's ice and
// snow) from its entrance through its barrage of frozen melons, its summon, its ice plates, its
// freeze (two lanes blinking blue, its crown lit) and phase 2 to its defeat, on one WebGL context,
// with no console error (the fixture checks that).

interface Seen {
  barrage: boolean; frozenMelons: boolean; acorns: boolean; summon: boolean; shield: boolean; plates: boolean;
  freeze: boolean; lanes: number; crown: boolean; stunned: boolean; phase2: boolean; frost: boolean; defeated: boolean;
}

for (const table of ['demo', 'shipped'] as const) test(`the Frost Melon demo (${table} numbers) plays from entrance to defeat on one WebGL context`, async ({ page }) => {
  test.setTimeout(180_000);
  // `&t=0`: the scene's own clock holds, so every step (and its events) is the test's.
  await page.goto(`/?scene=boss-demo&boss=frostMelon&seed=1&t=0&table=${table}&debug&cloud=fake`);
  await page.evaluate(() => window.__lvt.ready);
  const contexts = await glContexts(page);
  // It stands on the Tundra: ice in lanes 0, 1, 3 and 4, its own lane plain.
  expect(await page.evaluate(() => (window as any).__lvt.battle.match.state.config.lawn.ice.lanes)).toEqual([0, 1, 3, 4]);
  const seen: Seen = {
    barrage: false, frozenMelons: false, acorns: false, summon: false, shield: false, plates: false,
    freeze: false, lanes: 0, crown: false, stunned: false, phase2: false, frost: false, defeated: false,
  };
  let defeatedAt = -1;
  for (let second = 0; second < 80 && !seen.defeated; second++) {
    const now = await page.evaluate(() => {
      const b = (window as any).__lvt.battle;
      const out = {
        barrage: false, frozenMelons: false, acorns: false, summon: false, shield: false, plates: false,
        freeze: false, lanes: 0, crown: false, stunned: false, phase2: false, frost: false, defeated: false,
      };
      const drawn = (o: any): boolean => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      for (let i = 0; i < 30; i++) {
        b.advance(1 / 30);
        const s = b.match.state;
        const boss = s.units.find((u: { key: string }) => u.key === 'frostMelon');
        const fx = b.view.bossFx;
        for (const e of b.events) {
          if (e.type === 'bossPattern' && e.kind === 'barrage') out.barrage = true;
          if (e.type === 'bossPattern' && e.kind === 'summon') out.summon = true;
          if (e.type === 'bossPattern' && e.kind === 'shield') out.shield = true;
          if (e.type === 'bossStrike' && e.windup) {
            out.freeze = fx.striking;
            out.lanes = new Set(e.tiles.map((t: { lane: number }) => t.lane)).size;
          }
          if (e.type === 'bossDefeated') out.defeated = true;
        }
        if (fx.barkShut) out.plates = true;
        if (boss && boss.phase >= 1) out.phase2 = true;
        if (s.units.some((u: { faction: string; stun: number }) => u.faction === 'zombies' && u.stun > 0)) out.stunned = true;
        b.view.scene.traverse((o: any) => {
          if (o.name === 'projectile-frozen-melon' && o.parent) out.frozenMelons = true;
          if (o.name === 'projectile-acorn' && o.parent) out.acorns = true;
        });
        const model = boss ? b.view.unit(boss.id)?.model.root : null;
        if (model) {
          const crown = model.getObjectByName('crownGlow');
          if (fx.striking && crown && drawn(crown)) out.crown = true;
          const frost = model.getObjectByName('frostSpikes');
          if (frost && drawn(frost)) out.frost = true;
        }
      }
      return out;
    });
    for (const k of Object.keys(now) as (keyof Seen)[]) {
      if (k === 'lanes') seen.lanes = Math.max(seen.lanes, now.lanes);
      else (seen[k] as boolean) = (seen[k] as boolean) || (now[k] as boolean);
    }
    if (seen.defeated && defeatedAt < 0) defeatedAt = second;
    await frames(page, 2);
    if (second >= 2 && !seen.defeated) {
      await expect(page.locator('[data-hud="boss"].hud-boss--frostMelon')).toBeVisible();
      await expect(page.locator('[data-hud="boss"] .hud-boss__face')).toBeVisible();
    }
  }
  expect(seen).toEqual({
    barrage: true, frozenMelons: true, acorns: false, summon: true, shield: true, plates: true,
    freeze: true, lanes: 2, crown: true, stunned: true, phase2: true, frost: true, defeated: true,
  });
  expect(await glContexts(page)).toBe(contexts);
  const winner = await page.evaluate(() => (window as any).__lvt.battle.match.state.winner);
  expect(winner).toBe('zombies');
  // After its fall nothing of its warnings is left on the lawn.
  await page.evaluate(() => (window as any).__lvt.battle.advance(3));
  await frames(page, 4);
  const left = await page.evaluate(() => {
    const b = (window as any).__lvt.battle;
    let n = 0;
    const drawn = (o: any): boolean => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    b.view.scene.traverse((o: any) => { if ((o.name === 'boss-strike-tile' || o.name === 'boss-strike-fill' || o.name === 'boss-acorn-mark') && drawn(o)) n += 1; });
    return n;
  });
  expect(left).toBe(0);
});

// The entrance card (the bigger face beside the bar for its first 1.5 s) is the Melon's own. The
// scene's clock is held (`&t=0`) and the card kept up by the debug hook, so nothing here races a timer.
test('the Frost Melon comes on with its own entrance card and bar', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=boss-demo&boss=frostMelon&seed=1&t=0&debug&cloud=fake');
  await page.evaluate(() => window.__lvt.ready);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    lvt.holdBossIntro = true;
    lvt.battle.advance(0.5);
  });
  await expect(page.locator('[data-hud="boss-intro"].hud-boss-intro--frostMelon')).toBeVisible();
  expect(await page.evaluate(() => (window.__lvt as any).battle.view.bossFx.entering)).toBe(true);
  const bar = page.locator('[data-hud="boss"].hud-boss--frostMelon');
  await expect(bar).toBeVisible();
  // Its face is drawn from its own row: the melon's green, the snow cap's white and the crown's ice are in it.
  const fills = await bar.locator('.hud-boss__face-art rect').evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
  expect(fills).toEqual(expect.arrayContaining(['#3FA34D', '#F4FBFF', '#7FD3F5']));
  // A tap on the card skips the entrance.
  await page.locator('[data-hud="boss-intro"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-hud="boss-intro"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__lvt as any).battle.view.bossFx.entering)).toBe(false);
});
