import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { forceResult, frames, glContexts, logIn, openTitle, tilePoint, waitLive } from './helpers';

// Step 2 Task 9 (plants only): the Moonlit Meadow end to end, one save carried through the file's
// tests (in order, on both projects), as `backyard.spec` does for world 1. A player who has won
// the Backyard finds the map open on the Meadow; p2-1 starts with the fog pan, which a tap ends;
// the Meadow's look, mist, fireflies and music; the next-level button walks on; p2-3 reveals the
// Mango-pult and p2-6 the Avocado Bunker; p2-4 and p2-7 teach the new card by the glove; a reload
// mid-world keeps everything; p2-8 brings the Moon Howler (entrance card, boss bar with its face,
// slam, pups, the moon dome at half health that bounces peas and not pults, phase 2's blinding howl,
// defeat); ten level ↔ map round trips on one WebGL context. Fast-forward and the debug hooks behind
// `?debug` move the matches on; every address carries `cloud=fake` (helpers). No console or page
// error anywhere (the fixture).

test.describe.configure({ mode: 'serial' });

const carried = new Map<string, Record<string, string>>();

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

async function tapAt(page: Page, at: { x: number; y: number }): Promise<void> {
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/** The title, with the storage the previous test left (if any), and Lukas logged in on Home. */
async function resume(page: Page): Promise<void> {
  const saved = carried.get(test.info().project.name);
  await openTitle(page);
  if (saved !== undefined) {
    await page.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, saved);
    await openTitle(page);
  }
  await logIn(page);
}

/** Flushes the save to the (fake) cloud and keeps the page's storage for the next test. */
async function keep(page: Page): Promise<void> {
  await page.evaluate(() => (window.__lvt as any).players.flush());
  carried.set(test.info().project.name, await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out[k] = localStorage.getItem(k)!;
    }
    return out;
  }));
}

interface Progress { coins: number; teached: string[]; plants: { stars: Record<string, number>; unlocked: string[] } }
const progress = (page: Page): Promise<Progress> => page.evaluate(() => {
  const s = (window.__lvt as any).players.player.value;
  return JSON.parse(JSON.stringify({ coins: s.coins, teached: s.teached, plants: s.plants }));
});

async function toMap(page: Page): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator('[data-side="plants"]'));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
}

async function startFromMap(page: Page, id: string): Promise<void> {
  await press(page.locator(`[data-stone="${id}"]`));
  await expect(page.locator(`[data-screen="level-card"][data-level="${id}"]`)).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await page.evaluate(() => (window.__lvt as any).screen.options.level)).toBe(id);
}

const level = (page: Page): Promise<string> => page.evaluate(() => (window.__lvt as any).screen.options.level as string);
const fog = (page: Page): Promise<number | null> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.fog);
const inScene = (page: Page, name: string): Promise<boolean> =>
  page.evaluate((n) => (window.__lvt as any).stage.scene.getObjectByName(n) !== undefined, name);

/** The Meadow's dressing on the stage: its look, its lawn's reach, the mist sheet, fireflies and its music. */
async function meadowLook(page: Page, reach: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('meadow');
  expect(await page.evaluate(() => (window.__lvt as any).stage.lawn.lawnConfig.fog)).toBe(reach);
  expect(await fog(page)).toBe(reach);
  expect(await inScene(page, 'mist')).toBe(true);
  expect(await inScene(page, 'weather-fireflies')).toBe(true);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).audio.musicTheme)).toBe('meadow');
}

/**
 * Follows the level's card-then-tile glove by taps only (where the glove stands while it holds
 * still), with energy and the card's recharge topped up, until both steps are remembered.
 */
async function followGlove(page: Page, id: string): Promise<string[]> {
  const ids = await page.evaluate((lv) => ((window.__lvt as any).levels as { id: string; teaches: { id: string }[] | null }[])
    .find((l) => l.id === lv)!.teaches!.map((t) => t.id), id);
  const vp = page.viewportSize()!;
  const seen: string[] = [];
  for (let i = 0; i < 200; i++) {
    const done = await page.evaluate((want) => {
      const t: string[] = (window.__lvt as any).players.player.value.teached ?? [];
      return want.every((x) => t.includes(x));
    }, ids);
    if (done) break;
    await page.evaluate(() => {
      const c = (window.__lvt as any).session.controller;
      const me = c.match.state.players.plants;
      me.energy = Math.max(me.energy, 500);
      me.recharge = {};
    });
    const hand = page.locator('[data-tutorial] [data-glove][data-holding="true"][data-glove-x]');
    if (await hand.count() > 0) {
      await frames(page, 3);
      const g = await hand.evaluate((e: HTMLElement) => ({ step: e.dataset.gloveStep!, x: Number(e.dataset.gloveX), y: Number(e.dataset.gloveY) }))
        .catch(() => null);
      if (g === null) continue;
      expect(g.x, `${g.step} on screen`).toBeGreaterThan(0);
      expect(g.x).toBeLessThan(vp.width);
      expect(g.y, `${g.step} on screen`).toBeGreaterThan(0);
      expect(g.y).toBeLessThan(vp.height);
      if (seen.at(-1) !== g.step) seen.push(g.step);
      await tapAt(page, g);
      await frames(page, 3);
    } else {
      await page.evaluate(() => (window.__lvt as any).fastForward(15));
      await frames(page, 2);
    }
  }
  expect((await progress(page)).teached).toEqual(expect.arrayContaining(ids));
  return seen;
}

/** Wins the running level (a little play, then the zombie base falls); stars, 30 coins a star. */
async function win(page: Page, id: string): Promise<number> {
  const before = (await progress(page)).coins;
  await page.evaluate(() => (window.__lvt as any).fastForward(150));
  await forceResult(page, 'zombies');
  const result = page.locator(`[data-level-result="${id}"]`);
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars, `${id} stars`).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(before + 30 * stars);
  expect((await progress(page)).plants.stars[id]).toBe(stars);
  return stars;
}

/** From the result, the next level by its picture button. */
async function next(page: Page, id: string): Promise<void> {
  await press(page.locator(`[data-action="next-level"][data-next="${id}"]`));
  await waitLive(page);
  expect(await level(page)).toBe(id);
}

const REACH: Record<string, number> = { 'p2-1': 7, 'p2-2': 7, 'p2-3': 6, 'p2-4': 6, 'p2-5': 5, 'p2-6': 5, 'p2-7': 5, 'p2-8': 5 };

test('a Backyard graduate: the map opens on the Meadow; p2-1 shows the fog on its card, starts with the fog pan a tap ends, then plays in the Meadow\'s look; p2-2; p2-3 reveals the Mango-pult', async ({ page }) => {
  test.setTimeout(240_000);
  await openTitle(page);
  await logIn(page);
  // Lukas has won all of world 1 by playing: its unlocks and its lessons, nothing of world 2.
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { world: number; side: string; teaches: { id: string }[] | null }[])
      .filter((d) => d.world === 1).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    lvt.players.update((s: any) => ({
      ...s, teached: ids,
      plants: { ...s.plants, stars: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p1-${i + 1}`, 2])), unlocked: ['potatoMine', 'kernelPult'] },
    }));
  });
  await toMap(page);
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-world', '2');
  await expect(map).toHaveAttribute('data-arena', 'meadow');
  await expect(page.locator('[data-stone="p2-1"]')).toHaveAttribute('data-state', 'next');
  // What the Meadow brings: the gifts on p2-3 and p2-6.
  await expect(page.locator('[data-stone="p2-3"] [data-unlock="mangoPult"]')).toHaveCount(1);
  await expect(page.locator('[data-stone="p2-6"] [data-unlock="avocadoBunker"]')).toHaveCount(1);
  // p2-1's card: the fog picture beside the number.
  await press(page.locator('[data-stone="p2-1"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="p2-1"] [data-twist="fog"]')).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await level(page)).toBe('p2-1');
  // The fog pan holds the match until a tap; the tap plants nothing.
  const catcher = page.locator('[data-twist="fog"]');
  await expect(catcher).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null)).toBe('fog');
  const held = await page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number);
  await meadowLook(page, 7);
  await tapAt(page, await tilePoint(page, 2, 5));
  await expect(catcher).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number)).toBeGreaterThan(held + 10);
  expect((await progress(page)).teached).toContain('p2-1.fog');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .filter((u: { faction: string }) => u.faction === 'plants').length)).toBe(0);
  await win(page, 'p2-1');
  await next(page, 'p2-2');
  await meadowLook(page, REACH['p2-2']!);
  await expect(page.locator('[data-twist]')).toHaveCount(0); // the pan is taught once
  await win(page, 'p2-2');
  await next(page, 'p2-3');
  await meadowLook(page, REACH['p2-3']!);
  await win(page, 'p2-3');
  // The Mango-pult on the result's turntable; kept.
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="mangoPult"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).plants.unlocked).toEqual(['potatoMine', 'kernelPult', 'mangoPult']);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(map).toHaveAttribute('data-world', '2');
  await expect(page.locator('[data-stone="p2-3"] [data-unlock]')).toHaveCount(0);
  await expect(page.locator('[data-stone="p2-4"]')).toHaveAttribute('data-state', 'next');
  await press(page.locator('[data-stone="p2-4"]'));
  await expect(page.locator('[data-screen="level-card"] [data-dealt] [data-picture="mangoPult"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('p2-4 teaches the Mango-pult by the glove (card, then tile); p2-5; p2-6 reveals the Avocado Bunker; p2-7 teaches it', async ({ page }) => {
  test.setTimeout(240_000);
  await resume(page);
  await toMap(page);
  await startFromMap(page, 'p2-4');
  await meadowLook(page, REACH['p2-4']!);
  expect(await followGlove(page, 'p2-4')).toEqual(['p2-4.mango-card', 'p2-4.mango-tile']);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .some((u: { key: string; lane: number; x: number }) => u.key === 'mangoPult' && u.lane === 2 && Math.floor(u.x) === 2))).toBe(true);
  await win(page, 'p2-4');
  await next(page, 'p2-5');
  await meadowLook(page, REACH['p2-5']!);
  await win(page, 'p2-5');
  await next(page, 'p2-6');
  await meadowLook(page, REACH['p2-6']!);
  await win(page, 'p2-6');
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="avocadoBunker"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).plants.unlocked).toEqual(['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker']);
  await next(page, 'p2-7');
  await meadowLook(page, REACH['p2-7']!);
  expect(await followGlove(page, 'p2-7')).toEqual(['p2-7.avocado-card', 'p2-7.avocado-tile']);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .some((u: { key: string; lane: number; x: number }) => u.key === 'avocadoBunker' && u.lane === 2 && Math.floor(u.x) === 4))).toBe(true);
  await win(page, 'p2-7');
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="p2-8"]')).toHaveAttribute('data-state', 'next');
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('a reload mid-world keeps the Meadow: the map opens on it, the same stars, unlocks and lessons, p2-8 next', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page);
  const before = await progress(page);
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  const after = await progress(page);
  expect(after).toEqual(before);
  for (let n = 1; n <= 7; n++) expect(after.plants.stars[`p2-${n}`]).toBeGreaterThanOrEqual(1);
  expect(after.plants.unlocked).toEqual(['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker']);
  expect(after.teached).toEqual(expect.arrayContaining(['p2-1.fog', 'p2-4.mango-card', 'p2-4.mango-tile', 'p2-7.avocado-card', 'p2-7.avocado-tile']));
  await toMap(page);
  await expect(page.locator('[data-screen="map"]')).toHaveAttribute('data-world', '2');
  for (let n = 1; n <= 7; n++) await expect(page.locator(`[data-stone="p2-${n}"]`)).toHaveAttribute('data-stars', String(after.plants.stars[`p2-${n}`]));
  await expect(page.locator('[data-stone="p2-8"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="p2-8"]')).toHaveAttribute('data-kind', 'boss');
  await keep(page);
});

interface Fight {
  slam: boolean; slamShown: boolean; summon: boolean; pups: number; shield: boolean; domeShown: boolean;
  peaBounced: number; pultHurt: number; phase2: boolean; howl: boolean; howlShown: boolean; blinded: number; defeated: boolean;
}

test('p2-8: the Moon Howler - entrance card, boss bar with its face, slam, pups, the moon dome at half health (peas bounce, pults hit), phase 2\'s blinding howl, defeat; stars and coins', async ({ page }) => {
  test.setTimeout(240_000);
  await resume(page);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
  await toMap(page);
  await startFromMap(page, 'p2-8');
  await meadowLook(page, 5);
  // The entrance card (held by the hook) with the Howler's face, then the bar with its face.
  const intro = page.locator('[data-hud="boss-intro"].hud-boss-intro--moonHowler');
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(5));
    return intro.count();
  }, { timeout: 30_000 }).toBe(1);
  await expect(intro).toBeVisible();
  await press(intro);
  await expect(intro).toHaveCount(0);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = false; });
  const bar = page.locator('[data-hud="boss"].hud-boss--moonHowler');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.hud-boss__face')).toBeVisible();
  // Watch the match: every step's events, and what the views show.
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const c = lvt.session.controller;
    const f = { slam: false, slamShown: false, summon: false, pups: 0, shield: false, domeShown: false, peaBounced: 0, pultHurt: 0, phase2: false, howl: false, howlShown: false, blinded: 0, defeated: false };
    lvt.__fight = f;
    const step = c.step.bind(c);
    c.step = () => {
      const events = step();
      const s = c.match.state;
      const boss = s.units.find((u: any) => u.key === 'moonHowler');
      const fx = lvt.session.view.bossFx;
      const shotKind = new Map<number, string>();
      for (const p of s.projectiles) shotKind.set(p.id, p.flight);
      for (const e of events) {
        if (e.type === 'bossPattern' && e.kind === 'slam') { f.slam = true; if (fx.windingUp) f.slamShown = true; }
        if (e.type === 'bossPattern' && e.kind === 'summon') f.summon = true;
        if (e.type === 'bossPattern' && e.kind === 'shield') f.shield = true;
        if (e.type === 'bossStrike' && e.windup) f.howl = true;
        if (e.type === 'bossDefeated') f.defeated = true;
        if (e.type === 'projectileHit' && boss && e.targetId === boss.id && boss.shieldLeft > 0) {
          if (e.blocked) f.peaBounced += 1;
          else f.pultHurt += 1;
        }
      }
      if (fx.windingUp) f.slamShown = true;
      if (fx.shielded) f.domeShown = true;
      if (fx.striking) f.howlShown = true;
      if (boss && boss.phase >= 1) f.phase2 = true;
      let ears = 0;
      lvt.stage.scene.traverse((o: any) => { if (o.name === 'boss-pup-ears' && o.visible && o.parent) ears += 1; });
      f.pups = Math.max(f.pups, ears);
      f.blinded = Math.max(f.blinded, s.units.filter((u: any) => u.faction === 'plants' && u.blind > 0).length);
      return events;
    };
  });
  const fight = (): Promise<Fight> => page.evaluate(() => ({ ...(window.__lvt as any).__fight }));
  // A garden on every lane (the howl may pick any): Peashooters close enough for reach 5, Kernel-
  // and Mango-pults behind them, walls in front (energy topped up; the cards placed straight
  // into the match, as the screenshot tools do).
  await page.evaluate(() => {
    const c = (window.__lvt as any).session.controller;
    const put = (unit: string, lane: number, col: number): void => {
      c.match.state.players.plants.energy = 5000;
      c.match.state.players.plants.recharge = {};
      c.match.step([{ type: 'place', faction: 'plants', unit, lane, col }]);
    };
    for (const lane of [0, 1, 2, 3, 4]) {
      put('peashooter', lane, 3);
      put('peashooter', lane, 4);
      put('kernelPult', lane, 1);
      put('mangoPult', lane, 2);
      put('walnutBomb', lane, 6);
    }
  });
  // Phase 1: a slam and a summon of pups, within ~25 s.
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(30));
    await frames(page, 1);
    const f = await fight();
    return f.slam && f.summon && f.pups > 0;
  }, { timeout: 60_000 }).toBe(true);
  // To half health: the moon dome goes up. Peas bounce off it, pults still hurt it.
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'moonHowler');
    boss.hp = Math.ceil(boss.maxHp * 0.505);
  });
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    return f.shield && f.domeShown;
  }, { timeout: 60_000 }).toBe(true);
  await expect(bar).toHaveClass(/is-shielded/);
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    const f = await fight();
    return f.peaBounced > 0 && f.pultHurt > 0;
  }, { timeout: 60_000 }).toBe(true);
  // Phase 2: the glowing Howler howls (a lane winds up, then its plants go blind).
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    return f.phase2 && f.howl && f.howlShown && f.blinded > 0;
  }, { timeout: 90_000 }).toBe(true);
  // Down to its last bit of health; the garden finishes it.
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'moonHowler');
    if (boss) boss.hp = Math.min(boss.hp, 30);
  });
  const coins = (await progress(page)).coins;
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    return (await fight()).defeated;
  }, { timeout: 60_000 }).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner)).toBe('plants');
  const result = page.locator('[data-level-result="p2-8"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(coins + 30 * stars);
  // The Meadow's last level: the plants' world 3 has no levels yet, so no next level.
  await expect(page.locator('[data-action="next-level"]')).toHaveCount(0);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="p2-8"]')).toHaveAttribute('data-stars', String(stars));
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('ten Meadow level ↔ map round trips: one WebGL context, the GPU\'s geometry count flat', async ({ page }) => {
  test.setTimeout(240_000);
  await resume(page);
  const geometries = (): Promise<number> => page.evaluate(() => (window.__lvt as any).renderer.webgl.info.memory.geometries as number);
  const counts: number[] = [];
  await toMap(page);
  for (let round = 0; round < 10; round++) {
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('meadow');
    await frames(page, 3);
    counts.push(await geometries());
    const id = round % 2 === 0 ? 'p2-5' : 'p2-2';
    await startFromMap(page, id);
    expect(await fog(page)).toBe(REACH[id]);
    await page.evaluate(() => (window.__lvt as any).fastForward(60));
    await forceResult(page, 'zombies');
    await expect(page.locator(`[data-level-result="${id}"]`)).toBeVisible({ timeout: 30_000 });
    await press(page.locator('[data-screen="result"] [data-action="map"]'));
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    expect(await glContexts(page), `round ${round + 1}`).toBe(1);
  }
  // From the third look on (caches warm), the same number of geometries on the GPU every time.
  for (const n of counts.slice(2)) expect(n).toBe(counts[2]);
});

// Screenshots for review, only when asked (iPad project): LVT_MEADOW_SHOTS=<folder> npx playwright
// test e2e/meadow.spec.ts --project ipad -g shots. Every Meadow level a little way in, the fog
// lesson, the Howler's moments and the plant map with world 2 open, at the three iPad sizes.
test('shots', async ({ page }) => {
  const dir = process.env.LVT_MEADOW_SHOTS;
  test.skip(dir === undefined || test.info().project.name !== 'ipad', 'screenshots only on request, on the iPad project');
  test.setTimeout(600_000);
  const sizes = [{ width: 1024, height: 650 }, { width: 1024, height: 704 }, { width: 1180, height: 746 }];
  /** The stage held (no steps, no motion) while the three sizes are taken. */
  const shoot = async (name: string): Promise<void> => {
    await page.evaluate(() => { (window.__lvt as any).stage.paused = true; });
    for (const size of sizes) {
      await page.setViewportSize(size);
      await frames(page, 6);
      await page.screenshot({ path: `${dir}/${size.width}x${size.height}-${name}.png` });
    }
    await page.setViewportSize(sizes[0]!);
    await page.evaluate(() => { (window.__lvt as any).stage.paused = false; });
  };
  await openTitle(page);
  await logIn(page);
  const setSave = (teachMeadow: boolean): Promise<void> => page.evaluate((fresh) => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { world: number; teaches: { id: string }[] | null }[])
      .filter((d) => !fresh || d.world === 1).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    const stars: Record<string, number> = {};
    for (let n = 1; n <= 8; n++) stars[`p1-${n}`] = 3;
    for (let n = 1; n <= 7; n++) stars[`p2-${n}`] = 2;
    lvt.players.update((s: any) => ({
      ...s, teached: ids,
      plants: { ...s.plants, stars: fresh ? Object.fromEntries(Object.entries(stars).filter(([k]) => k.startsWith('p1'))) : stars, unlocked: ['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker'] },
    }));
  }, teachMeadow);
  const go = (screen: unknown): Promise<void> => page.evaluate((s) => (window.__lvt as any).go(s), screen);
  const quit = async (): Promise<void> => {
    await press(page.locator('[data-hud="pause"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await expect(page.locator('[data-screen="map"]')).toBeVisible();
  };
  // The plant map, world 2 open (p1 done, the Meadow fresh), and p2-1's card with the fog.
  await setSave(true);
  await go({ name: 'play' });
  await go({ name: 'map', side: 'plants', world: 2 });
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  await frames(page, 20);
  await shoot('map-plants-world2');
  await go({ name: 'map', side: 'plants', world: 2, card: 'p2-1' });
  await frames(page, 10);
  await shoot('card-p2-1-fog');
  // The fog lesson: mid-flight, then the tap glove.
  await page.locator('[data-action="start-level"]').click();
  await waitLive(page);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null)).toBe('fog');
  await frames(page, 60);
  await shoot('lesson-fog-pan');
  await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
  await shoot('lesson-fog-tap-hint');
  await press(page.locator('[data-twist="fog"]'));
  await quit();
  // Every level a little way in, with a few plants down.
  await setSave(false);
  for (let n = 1; n <= 8; n++) {
    const id = `p2-${n}`;
    if (n === 8) await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
    await go({ name: 'map', side: 'plants', world: 2, card: id });
    await page.locator('[data-action="start-level"]').click();
    await waitLive(page);
    if (n === 8) {
      const intro = page.locator('[data-hud="boss-intro"]');
      await expect.poll(async () => {
        await page.evaluate(() => (window.__lvt as any).fastForward(5));
        return intro.count();
      }, { timeout: 30_000 }).toBe(1);
      await shoot('howler-entrance');
      await press(intro);
      await page.evaluate(() => { (window.__lvt as any).holdBossIntro = false; });
    }
    await page.evaluate((boss) => {
      const lvt = window.__lvt as any;
      const c = lvt.session.controller;
      // The cards the level deals (a card it does not deal is refused by the match).
      const spots: [number, number, string][] = boss
        ? [0, 1, 2, 3, 4].flatMap((lane) => [[lane, 3, 'peashooter'], [lane, 4, 'peashooter'], [lane, 1, 'kernelPult'], [lane, 2, 'mangoPult'], [lane, 6, 'walnutBomb']] as [number, number, string][])
        : [[0, 3, 'peashooter'], [1, 2, 'kernelPult'], [2, 4, 'peashooter'], [3, 1, 'sunflower'], [4, 5, 'walnutBomb']];
      for (const [lane, col, unit] of spots) {
        c.match.state.players.plants.energy = 5000;
        c.match.state.players.plants.recharge = {};
        c.match.step([{ type: 'place', faction: 'plants', unit, lane, col }]);
      }
      lvt.fastForward(boss ? 30 * 5 : 30 * 30);
    }, n === 8);
    await shoot(`level-${id}`);
    if (n < 8) await quit();
  }
  // p2-8: the Howler's moments, as the e2e fight finds them.
  const moment = async (name: string, test: string, ticks = 3, limit = 1500): Promise<void> => {
    const ok = await page.evaluate(([cond, step, max]) => {
      const lvt = window.__lvt as any;
      const fx = lvt.session.view.bossFx;
      const s = () => lvt.session.controller.match.state;
      const check = new Function('fx', 's', `return (${cond});`) as (f: unknown, st: unknown) => boolean;
      for (let i = 0; i < max; i++) {
        if (check(fx, s)) return true;
        lvt.fastForward(step);
      }
      return false;
    }, [test, ticks, limit] as const);
    expect(ok, name).toBe(true);
    await shoot(`howler-${name}`);
  };
  await moment('slam-windup', 'fx.windingUp', 1);
  await moment('pups', "fx.group && s().units.some((u) => u.key === 'veryFastWalker')", 3);
  await page.evaluate(() => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'moonHowler');
    boss.hp = Math.ceil(boss.maxHp * 0.505);
  });
  await moment('dome', 'fx.shielded', 3);
  await moment('howl-windup', 'fx.striking', 1);
  await moment('blind-lane', "s().units.some((u) => u.faction === 'plants' && u.blind > 0)", 1);
  await moment('phase2', 's().units.some((u) => u.key === "moonHowler" && u.phase >= 1) && !fx.striking', 3);
  await page.evaluate(() => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'moonHowler');
    if (boss) boss.hp = 20;
  });
  await moment('defeat', "s().winner !== null || !s().units.some((u) => u.key === 'moonHowler')", 1);
  await page.evaluate(() => (window.__lvt as any).fastForward(20));
  await frames(page, 20);
  await shoot('howler-defeat-after');
});
