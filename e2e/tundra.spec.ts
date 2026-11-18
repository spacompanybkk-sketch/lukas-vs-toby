import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { forceResult, frames, glContexts, logIn, openTitle, waitLive } from './helpers';

// Step 2 (Tundra): the Frozen Tundra end to end, one save carried through the file's tests (in
// order, on both projects), as `meadow.spec` does for the plants. A zombie player who has won the
// Backyard finds the map open on the Tundra; z2-1 starts with the ice pan, which a tap ends; the
// Tundra's look, icy lanes, snow and music; the next-level button walks on; z2-3 reveals the Hot
// Topic and z2-6 the Cowboy Zombie; z2-4 and z2-7 teach the new card by the glove; a reload
// mid-world keeps everything; z2-8 brings the Frost Melon (entrance card, boss bar with its face,
// a barrage of frozen melons, its summons, the ice plates at half health, phase 2's freeze of two
// lanes, defeat); ten level ↔ map round trips on one WebGL context. Fast-forward and the debug
// hooks behind `?debug` move the matches on; every address carries `cloud=fake` (helpers). No
// console or page error anywhere (the fixture).
//
// The levels themselves (`z2-1` … `z2-8`) come from the level files; which lanes each ices is read
// from the level, not written here. A build without them skips every test below.

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

/** The title; skips the test when this build has no Tundra levels yet. */
async function open(page: Page): Promise<void> {
  await openTitle(page);
  const has = await page.evaluate(() => ((window.__lvt as any).levels as { id: string }[]).some((l) => l.id === 'z2-1'));
  test.skip(!has, 'the Tundra\'s levels (z2-*) are not in this build');
}

/** The title, with the storage the previous test left (if any), and Lukas logged in on Home. */
async function resume(page: Page): Promise<void> {
  const saved = carried.get(test.info().project.name);
  await open(page);
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

interface Progress { coins: number; teached: string[]; zombies: { stars: Record<string, number>; unlocked: string[] } }
const progress = (page: Page): Promise<Progress> => page.evaluate(() => {
  const s = (window.__lvt as any).players.player.value;
  return JSON.parse(JSON.stringify({ coins: s.coins, teached: s.teached, zombies: s.zombies }));
});

async function toMap(page: Page): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator('[data-side="zombies"]'));
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
const inScene = (page: Page, name: string): Promise<boolean> =>
  page.evaluate((n) => (window.__lvt as any).stage.scene.getObjectByName(n) !== undefined, name);
/** The lanes level `id` ices, from the level itself. */
const iceOf = (page: Page, id: string): Promise<number[]> => page.evaluate(
  (lv) => [...(((window.__lvt as any).levels as { id: string; twist?: { iceLanes?: number[] } }[]).find((l) => l.id === lv)!.twist?.iceLanes ?? [])].sort(), id);

/** The Tundra's dressing on the stage: its look, the level's own icy lanes, the ice tiles, snow and its music. */
async function tundraLook(page: Page, id: string): Promise<void> {
  const lanes = await iceOf(page, id);
  expect(lanes.length, `${id} ices a lane`).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('tundra');
  expect(await page.evaluate(() => [...(window.__lvt as any).stage.lawn.lawnConfig.ice.lanes].sort())).toEqual(lanes);
  expect(await page.evaluate(() => [...(window.__lvt as any).session.controller.match.state.config.lawn.ice.lanes].sort())).toEqual(lanes);
  expect(await inScene(page, 'ice')).toBe(true);
  expect(await inScene(page, 'weather-snow')).toBe(true);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).audio.musicTheme)).toBe('tundra');
}

/**
 * Follows the level's card-then-lane glove by taps only (where the glove stands while it holds
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
      const me = c.match.state.players.zombies;
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

/** Wins the running level (a little play, then the plant base falls); stars, 30 coins a star. */
async function win(page: Page, id: string): Promise<number> {
  const before = (await progress(page)).coins;
  await page.evaluate(() => (window.__lvt as any).fastForward(150));
  await forceResult(page, 'plants');
  const result = page.locator(`[data-level-result="${id}"]`);
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars, `${id} stars`).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(before + 30 * stars);
  expect((await progress(page)).zombies.stars[id]).toBe(stars);
  return stars;
}

/** From the result, the next level by its picture button. */
async function next(page: Page, id: string): Promise<void> {
  await press(page.locator(`[data-action="next-level"][data-next="${id}"]`));
  await waitLive(page);
  expect(await level(page)).toBe(id);
}

test('a Backyard graduate: the zombie map opens on the Tundra; z2-1 shows the ice on its card, starts with the ice pan a tap ends, then plays in the Tundra\'s look; z2-2; z2-3 reveals the Hot Topic', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await logIn(page);
  // Toby has won all of world 1 by playing: its unlocks and its lessons, nothing of world 2.
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { world: number; side: string; teaches: { id: string }[] | null }[])
      .filter((d) => d.world === 1).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    lvt.players.update((s: any) => ({
      ...s, teached: ids,
      zombies: { ...s.zombies, stars: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`z1-${i + 1}`, 2])), unlocked: ['desertZombie', 'skeletonArcher'] },
    }));
  });
  await toMap(page);
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-world', '2');
  await expect(map).toHaveAttribute('data-arena', 'tundra');
  await expect(page.locator('[data-stone="z2-1"]')).toHaveAttribute('data-state', 'next');
  // What the Tundra brings: the gifts on z2-3 and z2-6.
  await expect(page.locator('[data-stone="z2-3"] [data-unlock="hotTopic"]')).toHaveCount(1);
  await expect(page.locator('[data-stone="z2-6"] [data-unlock="cowboyZombie"]')).toHaveCount(1);
  // z2-1's card: the ice picture beside the number.
  await press(page.locator('[data-stone="z2-1"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="z2-1"] [data-twist="ice"]')).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await level(page)).toBe('z2-1');
  // The ice pan holds the match until a tap: the cards dimmed, Pause above the catcher, no zombie sent.
  const catcher = page.locator('[data-twist="ice"]');
  await expect(catcher).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null)).toBe('ice');
  await expect(page.locator('[data-screen="battle"]')).toHaveClass(/is-twist/);
  await expect.poll(() => page.locator('.battle__bottom').evaluate((el) => getComputedStyle(el).filter)).toContain('brightness');
  const held = await page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number);
  expect(held).toBeLessThanOrEqual(2);
  await tundraLook(page, 'z2-1');
  // The pan's pictures: every icy lane pulsing, a ghost sliding one of them, on the level's own lanes.
  const show = await page.evaluate(() => {
    const s = (window.__lvt as any).session.twistShow;
    let pulses = 0;
    let ghosts = 0;
    s.group.traverse((o: any) => { if (o.name === 'ice-pulse') pulses += 1; if (o.name === 'ghost-brainEater') ghosts += 1; });
    return { pulses, ghosts, slider: s.slider.lane as number };
  });
  const lanes = await iceOf(page, 'z2-1');
  expect(show.pulses).toBe(lanes.length);
  expect(show.ghosts).toBeGreaterThanOrEqual(1);
  expect(lanes).toContain(show.slider);
  // Pause works over the pan, and the pan is still there after Resume.
  await press(page.locator('[data-hud="pause"]'));
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await expect(catcher).toHaveCount(0);
  await press(page.locator('[data-screen="pause"] [data-action="resume"]'));
  await expect(catcher).toBeVisible();
  // Nobody taps: after 3 s the glove taps the lawn; the match is still held.
  await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number)).toBe(held);
  // A tap anywhere (the sky) ends it and sends nothing.
  const size = page.viewportSize()!;
  await tapAt(page, { x: Math.round(size.width / 2), y: Math.round(size.height * 0.2) });
  await expect(catcher).toHaveCount(0);
  await expect(page.locator('[data-screen="battle"]')).not.toHaveClass(/is-twist/);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow ?? null)).toBeNull();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number)).toBeGreaterThan(held + 10);
  expect((await progress(page)).teached).toContain('z2-1.ice');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .filter((u: { faction: string }) => u.faction === 'zombies').length)).toBe(0);
  await win(page, 'z2-1');
  await next(page, 'z2-2');
  await tundraLook(page, 'z2-2');
  await expect(page.locator('[data-twist]')).toHaveCount(0); // the pan is taught once
  await win(page, 'z2-2');
  await next(page, 'z2-3');
  await tundraLook(page, 'z2-3');
  await win(page, 'z2-3');
  // The Hot Topic on the result's turntable; kept.
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="hotTopic"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).zombies.unlocked).toEqual(['desertZombie', 'skeletonArcher', 'hotTopic']);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(map).toHaveAttribute('data-world', '2');
  await expect(page.locator('[data-stone="z2-3"] [data-unlock]')).toHaveCount(0);
  await expect(page.locator('[data-stone="z2-4"]')).toHaveAttribute('data-state', 'next');
  await press(page.locator('[data-stone="z2-4"]'));
  await expect(page.locator('[data-screen="level-card"] [data-dealt] [data-picture="hotTopic"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('HELP on z2-1\'s card plays the ice pan again', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page);
  await toMap(page);
  await press(page.locator('[data-stone="z2-1"]'));
  await press(page.locator('[data-screen="level-card"] [data-action="replay-tutorial"]'));
  await waitLive(page);
  await expect(page.locator('[data-twist="ice"]')).toBeVisible();
  await press(page.locator('[data-twist="ice"]'));
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  expect((await progress(page)).teached.filter((t) => t === 'z2-1.ice')).toHaveLength(1);
  expect(await glContexts(page)).toBe(1);
});

test('z2-4 teaches the Hot Topic by the glove (card, then lane); z2-5; z2-6 reveals the Cowboy Zombie; z2-7 teaches it', async ({ page }) => {
  test.setTimeout(240_000);
  await resume(page);
  await toMap(page);
  await startFromMap(page, 'z2-4');
  await tundraLook(page, 'z2-4');
  expect(await followGlove(page, 'z2-4')).toEqual(['z2-4.hot-card', 'z2-4.hot-lane']);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .some((u: { key: string; lane: number }) => u.key === 'hotTopic' && u.lane === 0))).toBe(true);
  await win(page, 'z2-4');
  await next(page, 'z2-5');
  await tundraLook(page, 'z2-5');
  await win(page, 'z2-5');
  await next(page, 'z2-6');
  await tundraLook(page, 'z2-6');
  await win(page, 'z2-6');
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="cowboyZombie"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).zombies.unlocked).toEqual(['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie']);
  await next(page, 'z2-7');
  await tundraLook(page, 'z2-7');
  expect(await followGlove(page, 'z2-7')).toEqual(['z2-7.cowboy-card', 'z2-7.cowboy-lane']);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .some((u: { key: string; lane: number }) => u.key === 'cowboyZombie' && u.lane === 2))).toBe(true);
  await win(page, 'z2-7');
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="z2-8"]')).toHaveAttribute('data-state', 'next');
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('a reload mid-world keeps the Tundra: the map opens on it, the same stars, unlocks and lessons, z2-8 next', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page);
  const before = await progress(page);
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  const after = await progress(page);
  expect(after).toEqual(before);
  for (let n = 1; n <= 7; n++) expect(after.zombies.stars[`z2-${n}`]).toBeGreaterThanOrEqual(1);
  expect(after.zombies.unlocked).toEqual(['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie']);
  expect(after.teached).toEqual(expect.arrayContaining(['z2-1.ice', 'z2-4.hot-card', 'z2-4.hot-lane', 'z2-7.cowboy-card', 'z2-7.cowboy-lane']));
  await toMap(page);
  await expect(page.locator('[data-screen="map"]')).toHaveAttribute('data-world', '2');
  for (let n = 1; n <= 7; n++) await expect(page.locator(`[data-stone="z2-${n}"]`)).toHaveAttribute('data-stars', String(after.zombies.stars[`z2-${n}`]));
  await expect(page.locator('[data-stone="z2-8"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="z2-8"]')).toHaveAttribute('data-kind', 'boss');
  await keep(page);
});

interface Fight {
  barrage: boolean; frozenMelons: boolean; acorns: boolean; marks: boolean; summon: boolean; shield: boolean; plates: boolean;
  phase2: boolean; frost: boolean; freeze: boolean; freezeShown: boolean; crown: boolean; lanes: number;
  stunned: number; defeated: boolean;
}

/** Zombies down every lane (energy topped up, straight into the match as the screenshot tools do), so the Melon always has someone to throw at, freeze and be bitten by. */
const sendWave = (page: Page): Promise<void> => page.evaluate(() => {
  const c = (window.__lvt as any).session.controller;
  if (c.match.state.winner !== null) return;
  for (const lane of [0, 1, 2, 3, 4]) {
    for (const unit of ['skeletonWarrior', 'brainEater']) {
      c.match.state.players.zombies.energy = 5000;
      c.match.state.players.zombies.recharge = {};
      c.match.step([{ type: 'place', faction: 'zombies', unit, lane, col: 9 }]);
    }
  }
});

test('z2-8: the Frost Melon - entrance card, boss bar with its face, a barrage of frozen melons, its summons, the ice plates at half health, phase 2\'s freeze of two lanes, defeat; stars and coins', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
  await toMap(page);
  await startFromMap(page, 'z2-8');
  await tundraLook(page, 'z2-8');
  // The entrance card (held by the hook) with the Melon's face, then the bar with its face.
  const intro = page.locator('[data-hud="boss-intro"].hud-boss-intro--frostMelon');
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(5));
    return intro.count();
  }, { timeout: 30_000 }).toBe(1);
  await expect(intro).toBeVisible();
  await press(intro);
  await expect(intro).toHaveCount(0);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = false; });
  const bar = page.locator('[data-hud="boss"].hud-boss--frostMelon');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.hud-boss__face')).toBeVisible();
  // It stands on a plain lane of its own, the ice either side.
  const stand = await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    return { lane: s.config.boss.lane as number, ice: [...s.config.lawn.ice.lanes] as number[], key: s.config.boss.key as string };
  });
  expect(stand.key).toBe('frostMelon');
  expect(stand.ice).not.toContain(stand.lane);
  // Watch the match: every step's events, and what the views show.
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const c = lvt.session.controller;
    const f = {
      barrage: false, frozenMelons: false, acorns: false, marks: false, summon: false, shield: false, plates: false,
      phase2: false, frost: false, freeze: false, freezeShown: false, crown: false, lanes: 0,
      stunned: 0, defeated: false,
    };
    lvt.__fight = f;
    const drawn = (o: any): boolean => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const step = c.step.bind(c);
    c.step = () => {
      const events = step();
      const s = c.match.state;
      const boss = s.units.find((u: any) => u.key === 'frostMelon');
      const fx = lvt.session.view.bossFx;
      for (const e of events) {
        if (e.type === 'bossPattern' && e.kind === 'barrage') f.barrage = true;
        if (e.type === 'bossPattern' && e.kind === 'summon') f.summon = true;
        if (e.type === 'bossPattern' && e.kind === 'shield') f.shield = true;
        if (e.type === 'bossStrike' && e.windup) {
          f.freeze = true;
          const lanes = new Set<number>(e.tiles.map((t: { lane: number }) => t.lane));
          f.lanes = Math.max(f.lanes, lanes.size);
        }
        if (e.type === 'bossDefeated') f.defeated = true;
      }
      if (fx.barkShut) f.plates = true;
      if (fx.striking) f.freezeShown = true;
      if (boss && boss.phase >= 1) f.phase2 = true;
      lvt.stage.scene.traverse((o: any) => {
        if (!o.parent) return;
        if (o.name === 'projectile-frozen-melon') f.frozenMelons = true;
        if (o.name === 'projectile-acorn') f.acorns = true;
        if (o.name === 'boss-acorn-mark' && drawn(o)) f.marks = true;
      });
      const model = boss ? lvt.session.view.unit(boss.id)?.model.root : null;
      if (model) {
        const crown = model.getObjectByName('crownGlow');
        if (fx.striking && crown && drawn(crown)) f.crown = true;
        const frost = model.getObjectByName('frostSpikes');
        if (frost && drawn(frost)) f.frost = true;
      }
      f.stunned = Math.max(f.stunned, s.units.filter((u: any) => u.faction === 'zombies' && u.stun > 0).length);
      return events;
    };
  });
  const fight = (): Promise<Fight> => page.evaluate(() => ({ ...(window.__lvt as any).__fight }));
  // Phase 1: a barrage (frozen melons, each with its landing ring, never an acorn) and a summon.
  await expect.poll(async () => {
    await sendWave(page);
    await page.evaluate(() => (window.__lvt as any).fastForward(30));
    await frames(page, 1);
    const f = await fight();
    return f.barrage && f.frozenMelons && f.marks && f.summon;
  }, { timeout: 90_000 }).toBe(true);
  expect((await fight()).acorns).toBe(false);
  // To half health: the ice plates clap shut (plates, never the Titan's dome).
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'frostMelon');
    boss.hp = Math.ceil(boss.maxHp * 0.505);
  });
  await expect.poll(async () => {
    await sendWave(page);
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    await frames(page, 1);
    const f = await fight();
    return f.shield && f.plates;
  }, { timeout: 90_000 }).toBe(true);
  await expect(bar).toHaveClass(/is-shielded/);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('boss-shield-dome')?.visible ?? false)).toBe(false);
  // Phase 2: frosted over, it freezes two lanes (they blink blue, its crown lit), and the zombies there stand frozen.
  await expect.poll(async () => {
    await sendWave(page);
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    return f.phase2 && f.frost && f.freeze && f.freezeShown && f.crown && f.stunned > 0;
  }, { timeout: 120_000 }).toBe(true);
  expect((await fight()).lanes).toBe(2);
  // Down to its last bit of health; the zombies finish it.
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'frostMelon');
    if (boss) { boss.hp = Math.min(boss.hp, 30); boss.shieldLeft = 0; }
  });
  const coins = (await progress(page)).coins;
  await expect.poll(async () => {
    await sendWave(page);
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    return (await fight()).defeated;
  }, { timeout: 120_000 }).toBe(true);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner)).toBe('zombies');
  const result = page.locator('[data-level-result="z2-8"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(coins + 30 * stars);
  // The Tundra's last level: the zombies' world 3 has no levels yet, so no next level.
  await expect(page.locator('[data-action="next-level"]')).toHaveCount(0);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="z2-8"]')).toHaveAttribute('data-stars', String(stars));
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('ten Tundra level ↔ map round trips: one WebGL context, the GPU\'s geometry count flat', async ({ page }) => {
  test.setTimeout(240_000);
  await resume(page);
  const geometries = (): Promise<number> => page.evaluate(() => (window.__lvt as any).renderer.webgl.info.memory.geometries as number);
  const counts: number[] = [];
  await toMap(page);
  for (let round = 0; round < 10; round++) {
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('tundra');
    await frames(page, 3);
    counts.push(await geometries());
    const id = round % 2 === 0 ? 'z2-5' : 'z2-2';
    await startFromMap(page, id);
    expect(await page.evaluate(() => [...(window.__lvt as any).session.controller.match.state.config.lawn.ice.lanes].sort())).toEqual(await iceOf(page, id));
    await page.evaluate(() => (window.__lvt as any).fastForward(60));
    await forceResult(page, 'plants');
    await expect(page.locator(`[data-level-result="${id}"]`)).toBeVisible({ timeout: 30_000 });
    await press(page.locator('[data-screen="result"] [data-action="map"]'));
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    expect(await glContexts(page), `round ${round + 1}`).toBe(1);
  }
  // From the third look on (caches warm), the same number of geometries on the GPU every time.
  for (const n of counts.slice(2)) expect(n).toBe(counts[2]);
});

// Screenshots for review, only when asked (iPad project): LVT_TUNDRA_SHOTS=<folder> npx playwright
// test e2e/tundra.spec.ts --project ipad -g shots. Every Tundra level a little way in, the ice
// lesson, the Melon's moments and the zombie map with world 2 open, at the three iPad sizes.
test('shots', async ({ page }) => {
  const dir = process.env.LVT_TUNDRA_SHOTS;
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
  await open(page);
  await logIn(page);
  const setSave = (fresh: boolean): Promise<void> => page.evaluate((onlyWorld1) => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { world: number; teaches: { id: string }[] | null }[])
      .filter((d) => !onlyWorld1 || d.world === 1).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    const stars: Record<string, number> = {};
    for (let n = 1; n <= 8; n++) stars[`z1-${n}`] = 3;
    if (!onlyWorld1) for (let n = 1; n <= 7; n++) stars[`z2-${n}`] = 2;
    lvt.players.update((s: any) => ({
      ...s, teached: ids,
      zombies: { ...s.zombies, stars, unlocked: ['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie'] },
    }));
  }, fresh);
  const go = (screen: unknown): Promise<void> => page.evaluate((s) => (window.__lvt as any).go(s), screen);
  const quit = async (): Promise<void> => {
    await press(page.locator('[data-hud="pause"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await expect(page.locator('[data-screen="map"]')).toBeVisible();
  };
  // The zombie map, world 2 open (z1 done, the Tundra fresh), and z2-1's card with the ice.
  await setSave(true);
  await go({ name: 'play' });
  await go({ name: 'map', side: 'zombies', world: 2 });
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  await frames(page, 20);
  await shoot('map-zombies-world2');
  await go({ name: 'map', side: 'zombies', world: 2, card: 'z2-1' });
  await frames(page, 10);
  await shoot('card-z2-1-ice');
  // The ice lesson: the race under way, the skid at the plants' end, then the tap glove.
  await page.locator('[data-action="start-level"]').click();
  await waitLive(page);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null)).toBe('ice');
  const sliderX = (): Promise<number> => page.evaluate(() => (window.__lvt as any).session.twistShow.slider.object.position.x as number);
  await expect.poll(async () => { const x = await sliderX(); return x < 6.5 && x > 4; }, { intervals: [16], timeout: 15_000 }).toBe(true);
  await shoot('lesson-ice-pan-race');
  await expect.poll(async () => (await sliderX()) < 0.5, { intervals: [16], timeout: 15_000 }).toBe(true);
  await frames(page, 4);
  await shoot('lesson-ice-pan-skid');
  await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
  await shoot('lesson-ice-tap-hint');
  await press(page.locator('[data-twist="ice"]'));
  await quit();
  // Every level a little way in, with a few zombies on their way.
  await setSave(false);
  for (let n = 1; n <= 8; n++) {
    const id = `z2-${n}`;
    if (n === 8) await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
    await go({ name: 'map', side: 'zombies', world: 2, card: id });
    await page.locator('[data-action="start-level"]').click();
    await waitLive(page);
    if (n === 8) {
      const intro = page.locator('[data-hud="boss-intro"]');
      await expect.poll(async () => {
        await page.evaluate(() => (window.__lvt as any).fastForward(5));
        return intro.count();
      }, { timeout: 30_000 }).toBe(1);
      await shoot('melon-entrance');
      await press(intro);
      await page.evaluate(() => { (window.__lvt as any).holdBossIntro = false; });
    }
    await page.evaluate(() => {
      const lvt = window.__lvt as any;
      const c = lvt.session.controller;
      // The cards the level deals (a card it does not deal is refused by the match).
      const dealt: string[] = c.match.state.config.cards.zombies;
      for (const lane of [0, 1, 2, 3, 4]) {
        c.match.state.players.zombies.energy = 5000;
        c.match.state.players.zombies.recharge = {};
        c.match.step([{ type: 'place', faction: 'zombies', unit: dealt[lane % dealt.length], lane, col: 9 }]);
      }
      lvt.fastForward(30 * 6);
    });
    await shoot(`level-${id}`);
    if (n < 8) await quit();
  }
  // z2-8: the Melon's moments, as the e2e fight finds them.
  const moment = async (name: string, cond: string, ticks = 3, limit = 1500): Promise<void> => {
    const ok = await page.evaluate(([test, step, max]) => {
      const lvt = window.__lvt as any;
      const fx = lvt.session.view.bossFx;
      const s = () => lvt.session.controller.match.state;
      const scene = (n: string): boolean => { let on = false; lvt.stage.scene.traverse((o: any) => { if (o.name === n && o.parent && o.visible) on = true; }); return on; };
      const check = new Function('fx', 's', 'scene', `return (${test});`) as (f: unknown, st: unknown, sc: unknown) => boolean;
      for (let i = 0; i < max; i++) {
        if (check(fx, s, scene)) return true;
        if (i % 30 === 0 && s().winner === null) {
          const c = lvt.session.controller;
          for (const lane of [0, 1, 2, 3, 4]) {
            c.match.state.players.zombies.energy = 5000;
            c.match.state.players.zombies.recharge = {};
            c.match.step([{ type: 'place', faction: 'zombies', unit: 'skeletonWarrior', lane, col: 9 }]);
          }
        }
        lvt.fastForward(step);
      }
      return false;
    }, [cond, ticks, limit] as const);
    expect(ok, name).toBe(true);
    await shoot(`melon-${name}`);
  };
  await moment('barrage', "scene('projectile-frozen-melon') && scene('boss-acorn-mark')", 1);
  await moment('summon', "s().units.some((u) => u.faction === 'plants' && u.key === 'peashooter' && u.x >= 1.5)", 3);
  await page.evaluate(() => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'frostMelon');
    boss.hp = Math.ceil(boss.maxHp * 0.505);
  });
  await moment('plates', 'fx.barkShut', 3);
  await moment('freeze-windup', 'fx.striking && scene("boss-strike-fill")', 1);
  await moment('frozen-lanes', "s().units.some((u) => u.faction === 'zombies' && u.stun > 0)", 1);
  await moment('phase2', 's().units.some((u) => u.key === "frostMelon" && u.phase >= 1 && u.shieldLeft <= 0) && !fx.striking', 3);
  await page.evaluate(() => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'frostMelon');
    if (boss) { boss.hp = 20; boss.shieldLeft = 0; }
  });
  await moment('defeat', "s().winner !== null || !s().units.some((u) => u.key === 'frostMelon')", 1);
  await page.evaluate(() => (window.__lvt as any).fastForward(20));
  await frames(page, 20);
  await shoot('melon-defeat-after');
});
