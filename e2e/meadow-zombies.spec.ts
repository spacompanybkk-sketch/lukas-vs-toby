import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { forceResult, frames, glContexts, logIn, openTitle, tilePoint, waitLive } from './helpers';

// Step 4, Task 9 (the Moonlit Meadow, the zombies' side): world 4 end to end for Toby, one save carried
// through the file's tests (in order, on both projects), as `desert.spec` does for world 3. (`meadow.spec`
// is world 2 of the plants: this file is the zombies' fourth world.)
//   - the gate: the Meadow island opens after z3-8 and not before;
//   - z4-1's fog pan (the Peashooter's pea puffs out in the mist, a ghost Brain Eater walks in first) ends on
//     a tap and the level plays to a result by taps; z4-2; z4-3 reveals Brain Rot; HELP on z4-1's card;
//   - z4-4 teaches Brain Rot by the glove (card, then the lane); z4-5..z4-7; a reload mid-world keeps it all;
//   - z4-8 brings the Glowcap (entrance, bar, spore bombs, Peashooter summons, the cap shells at half health,
//     the spore cloud on four zombie tiles, Avocado Bunkers, defeat);
//   - ten level <-> map round trips on one WebGL context with a flat geometry count;
//   - a five-year-old's walk through z4-1..z4-3 and the Glowcap by taps only (`walk`).
// Fast-forward and the debug hooks behind `?debug` move matches on; every address carries `cloud=fake`
// (helpers). No console or page error anywhere (the fixture).
//
// Screenshots, only when asked (iPad project): LVT_W4_SHOTS=<folder> npx playwright test
// e2e/meadow-zombies.spec.ts --project ipad -g shots (the map and levels at three sizes); the boss test also
// writes its moments there when it is set. The walk: LVT_W4_WALK=1|late (late: z4-3 and the Glowcap only).

test.describe.configure({ mode: 'serial' });

const carried = new Map<string, Record<string, string>>();
const dir = process.env.LVT_W4_SHOTS;
const SIDE = 'zombies' as const;
const UNLOCKED = ['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie'];

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

async function tapAt(page: Page, at: { x: number; y: number }): Promise<void> {
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/** A picture of the page for review, when asked (the iPad project only; no-op otherwise). */
async function snap(page: Page, name: string): Promise<void> {
  if (dir === undefined || test.info().project.name !== 'ipad') return;
  await page.screenshot({ path: `${dir}/${name}.png` });
}

const key = (): string => test.info().project.name;

async function open(page: Page): Promise<void> {
  await openTitle(page);
  const has = await page.evaluate(() => ((window.__lvt as any).levels as { id: string }[]).some((l) => l.id === 'z4-1'));
  test.skip(!has, 'this build has no Moonlit Meadow levels for the zombies yet');
}

/** The title, with the storage the previous test left (if any), and Lukas logged in on Home. */
async function resume(page: Page): Promise<void> {
  const saved = carried.get(key());
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
  carried.set(key(), await page.evaluate(() => {
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

/** A player who has won worlds 1 and 2 and `wonThree` levels of world 3 as the zombies: their lessons and unlocks, nothing of world 4. */
async function graduate(page: Page, wonThree = 8): Promise<void> {
  await page.evaluate(([won, unlocked]) => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { world: number; teaches: { id: string }[] | null }[])
      .filter((d) => d.world <= 3).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    const stars: Record<string, number> = {};
    for (let w = 1; w <= 3; w++) for (let n = 1; n <= (w === 3 ? (won as number) : 8); n++) stars[`z${w}-${n}`] = 2;
    lvt.players.update((p: any) => ({ ...p, teached: ids, zombies: { ...p.zombies, stars, unlocked } }));
  }, [wonThree, UNLOCKED] as const);
}

async function toMap(page: Page, world = 4): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${SIDE}"]`));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  await expect(page.locator('[data-screen="map"]')).toHaveAttribute('data-world', String(world));
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
const tick = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number);
const inScene = (page: Page, name: string): Promise<boolean> =>
  page.evaluate((n) => (window.__lvt as any).stage.scene.getObjectByName(n) !== undefined, name);
const denied = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.hud.denied.value as number);
const fog = (page: Page): Promise<number | null> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.fog);
/** The reach of level `id`'s fog, from the level itself. */
const reachOf = (page: Page, id: string): Promise<number> => page.evaluate(
  (lv) => ((window.__lvt as any).levels as { id: string; twist?: { fog?: number } }[]).find((l) => l.id === lv)!.twist!.fog as number, id);

interface Seen { key: string; faction: string; lane: number; x: number; id: number }
const units = (page: Page): Promise<Seen[]> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
  .map((u: any) => ({ key: u.key, faction: u.faction, lane: u.lane, x: u.x, id: u.id })));

/** The Meadow's dressing on the stage: its look, the level's own reach, the mist sheet, fireflies and its music. */
async function meadowLook(page: Page, id: string): Promise<void> {
  const reach = await reachOf(page, id);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('meadow');
  expect(await page.evaluate(() => (window.__lvt as any).stage.lawn.lawnConfig.fog)).toBe(reach);
  expect(await fog(page)).toBe(reach);
  expect(await inScene(page, 'mist')).toBe(true);
  expect(await inScene(page, 'weather-fireflies')).toBe(true);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).audio.musicTheme)).toBe('meadow');
}

/** Tops up the player's energy and `card`'s recharge, then picks it from the tray by a tap. */
async function pick(page: Page, card: string): Promise<void> {
  await page.evaluate((c) => {
    const ctl = (window.__lvt as any).session.controller;
    const me = ctl.match.state.players[ctl.playerFaction];
    me.energy = Math.max(me.energy, 500);
    me.recharge[c] = 0;
  }, card);
  await frames(page, 2);
  const picked = await page.evaluate(() => (window.__lvt as any).session.controller.hud.selected.value as string | null);
  if (picked !== card) await press(page.locator(`[data-hud="tray"] [data-card="${card}"]`));
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session.controller.hud.selected.value)).toBe(card);
}

/** Picks `card` and taps the middle of tile (lane, col). */
async function place(page: Page, card: string, lane: number, col: number): Promise<void> {
  await pick(page, card);
  await tapAt(page, await tilePoint(page, lane, col));
  await frames(page, 2);
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
      const me = (window.__lvt as any).session.controller.match.state.players.zombies;
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

// ---- the gate ---------------------------------------------------------------------------------

test('the gate: the Meadow is shut behind z3-7 (no stones, a tap refused) and opens with z3-8', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await logIn(page);
  // One level short: the map opens on world 3; the arrow leads to a grey island with no stones.
  await graduate(page, 7);
  await toMap(page, 3);
  await expect(page.locator('[data-stone="z3-8"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-action="world-next"]')).toHaveAttribute('data-locked', '');
  await press(page.locator('[data-action="world-next"]'));
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-world', '4');
  await expect(map).toHaveAttribute('data-locked', '');
  await expect(page.locator('[data-stone]')).toHaveCount(0);
  await press(page.locator('[data-action="island-locked"]'));
  await expect(page.locator('[data-action="island-locked"]')).toHaveClass(/is-deny-a/);
  await expect(page.locator('[data-screen="level-card"]')).toHaveCount(0);
  // Home, and the last level won: the map opens on the Meadow, z4-1 waiting, the Glowcap on the last stone.
  await press(page.locator('[data-screen="map"] [data-action="back"]'));
  await press(page.locator('[data-screen="play"] [data-action="back"]'));
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await graduate(page, 8);
  await toMap(page, 4);
  await expect(map).toHaveAttribute('data-arena', 'meadow');
  await expect(map).not.toHaveAttribute('data-locked', '');
  await expect(page.locator('[data-stone="z4-1"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="z4-8"]')).toHaveAttribute('data-kind', 'boss');
  // What the Meadow brings: Brain Rot on z4-3.
  await expect(page.locator('[data-stone="z4-3"] [data-unlock="brainRot"]')).toHaveCount(1);
  expect(await glContexts(page)).toBe(1);
});

// ---- Toby -------------------------------------------------------------------------------------

test('Toby: z4-1 holds on the fog pan (the Brain Eater walks in first), a tap ends it, the level plays by taps; z4-2; z4-3 reveals Brain Rot', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await logIn(page);
  await graduate(page);
  await toMap(page);
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-arena', 'meadow');
  await expect(page.locator('[data-stone="z4-1"]')).toHaveAttribute('data-state', 'next');
  await press(page.locator('[data-stone="z4-1"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="z4-1"] [data-twist="fog"]')).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await level(page)).toBe('z4-1');
  const catcher = page.locator('[data-twist="fog"]');
  await expect(catcher).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null)).toBe('fog');
  expect(await page.evaluate(() => (window.__lvt as any).session.twistShow.zombieFirst)).toBe(true);
  await expect(page.locator('[data-screen="battle"]')).toHaveClass(/is-twist/);
  await expect.poll(() => page.locator('.battle__bottom').evaluate((el) => getComputedStyle(el).filter)).toContain('brightness');
  const held = await tick(page);
  expect(held).toBeLessThanOrEqual(2);
  await meadowLook(page, 'z4-1');
  // The pan's pictures: the ghost Peashooter, its pea, the ghost Brain Eater, the puff in the mist.
  const show = await page.evaluate(() => {
    const names: string[] = [];
    (window.__lvt as any).session.twistShow.group.traverse((o: any) => { if (o.name !== '') names.push(o.name as string); });
    return names;
  });
  expect(show).toEqual(expect.arrayContaining(['ghost-peashooter', 'ghost-pea', 'ghost-brainEater', 'fog-puff']));
  await snap(page, 'z4-1-pan');
  // Pause works over the pan, and the pan is still there after Resume.
  await press(page.locator('[data-hud="pause"]'));
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await expect(catcher).toHaveCount(0);
  await press(page.locator('[data-screen="pause"] [data-action="resume"]'));
  await expect(catcher).toBeVisible();
  // Nobody taps: after 3 s the glove taps the lawn; the match is still held.
  await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
  expect(await tick(page)).toBe(held);
  // A tap anywhere (the sky) ends it and sends nothing.
  const size = page.viewportSize()!;
  await tapAt(page, { x: Math.round(size.width / 2), y: Math.round(size.height * 0.2) });
  await expect(catcher).toHaveCount(0);
  await expect(page.locator('[data-screen="battle"]')).not.toHaveClass(/is-twist/);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow ?? null)).toBeNull();
  await expect.poll(() => tick(page)).toBeGreaterThan(held + 10);
  expect((await progress(page)).teached).toContain('z4-1.fog');
  expect(await denied(page)).toBe(0);
  expect((await units(page)).filter((u) => u.faction === 'zombies')).toHaveLength(0);
  // By taps: a Brain Eater down a lane, and the level plays to its result.
  await place(page, 'brainEater', 1, 9);
  await expect.poll(async () => (await units(page)).filter((u) => u.faction === 'zombies').length).toBe(1);
  await win(page, 'z4-1');
  await next(page, 'z4-2');
  await meadowLook(page, 'z4-2');
  await expect(page.locator('[data-twist]')).toHaveCount(0); // the pan is taught once
  await win(page, 'z4-2');
  await next(page, 'z4-3');
  await meadowLook(page, 'z4-3');
  await win(page, 'z4-3');
  // Brain Rot on the result's turntable; kept.
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="brainRot"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).zombies.unlocked).toEqual([...UNLOCKED, 'brainRot']);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(map).toHaveAttribute('data-world', '4');
  await expect(page.locator('[data-stone="z4-3"] [data-unlock]')).toHaveCount(0);
  await expect(page.locator('[data-stone="z4-4"]')).toHaveAttribute('data-state', 'next');
  await press(page.locator('[data-stone="z4-4"]'));
  await expect(page.locator('[data-screen="level-card"] [data-dealt] [data-picture="brainRot"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('HELP on z4-1\'s card plays the fog pan again', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page);
  await toMap(page);
  await press(page.locator('[data-stone="z4-1"]'));
  await press(page.locator('[data-screen="level-card"] [data-action="replay-tutorial"]'));
  await waitLive(page);
  await expect(page.locator('[data-twist="fog"]')).toBeVisible();
  await press(page.locator('[data-twist="fog"]'));
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  expect((await progress(page)).teached.filter((t) => t === 'z4-1.fog')).toHaveLength(1);
  expect(await glContexts(page)).toBe(1);
});

test('Toby: z4-4 teaches Brain Rot by the glove (card, then lane); z4-5..z4-7', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page);
  await toMap(page);
  await startFromMap(page, 'z4-4');
  await meadowLook(page, 'z4-4');
  expect(await followGlove(page, 'z4-4')).toEqual(['z4-4.rot-card', 'z4-4.rot-lane']);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .some((u: { key: string; lane: number }) => u.key === 'brainRot' && u.lane === 2))).toBe(true);
  await win(page, 'z4-4');
  await next(page, 'z4-5');
  await meadowLook(page, 'z4-5');
  await win(page, 'z4-5');
  await next(page, 'z4-6');
  await meadowLook(page, 'z4-6');
  await win(page, 'z4-6');
  await next(page, 'z4-7');
  await meadowLook(page, 'z4-7');
  await win(page, 'z4-7');
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="z4-8"]')).toHaveAttribute('data-state', 'next');
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('a reload mid-world keeps the Meadow for Toby: the map opens on it, the same stars, unlocks and lessons, z4-8 next', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page);
  const before = await progress(page);
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  const after = await progress(page);
  expect(after).toEqual(before);
  for (let n = 1; n <= 7; n++) expect(after.zombies.stars[`z4-${n}`]).toBeGreaterThanOrEqual(1);
  expect(after.zombies.unlocked).toEqual([...UNLOCKED, 'brainRot']);
  expect(after.teached).toEqual(expect.arrayContaining(['z4-1.fog', 'z4-4.rot-card', 'z4-4.rot-lane']));
  await toMap(page);
  for (let n = 1; n <= 7; n++) await expect(page.locator(`[data-stone="z4-${n}"]`)).toHaveAttribute('data-stars', String(after.zombies.stars[`z4-${n}`]));
  await expect(page.locator('[data-stone="z4-8"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="z4-8"]')).toHaveAttribute('data-kind', 'boss');
  await keep(page);
});

interface Fight {
  barrage: boolean; bombs: boolean; marks: boolean; acorns: boolean; needles: boolean; frozen: boolean; summon: boolean; shield: boolean; plates: boolean;
  phase2: boolean; strike: boolean; strikeShown: boolean; tiles: number; dither: boolean; spots: boolean; poisoned: number; boulders: boolean;
  peashooters: boolean; avocados: boolean; defeated: boolean;
}

/** Zombies down every lane, never more than a child's crowd at once. */
const sendWave = (page: Page): Promise<void> => page.evaluate(() => {
  const c = (window.__lvt as any).session.controller;
  if (c.match.state.winner !== null) return;
  if (c.match.state.units.filter((u: any) => u.faction === 'zombies').length >= 30) return;
  for (const lane of [0, 1, 2, 3, 4]) {
    for (const unit of ['skeletonWarrior', 'brainEater']) {
      c.match.state.players.zombies.energy = 5000;
      c.match.state.players.zombies.recharge = {};
      c.match.step([{ type: 'place', faction: 'zombies', unit, lane, col: 9 }]);
    }
  }
});

test('z4-8: the Glowcap - entrance card, boss bar with its face, spore bombs, Peashooter summons, the cap shells at half health, the spore cloud on four tiles, Avocado Bunkers, defeat; stars and coins', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
  await toMap(page);
  await startFromMap(page, 'z4-8');
  await meadowLook(page, 'z4-8');
  const intro = page.locator('[data-hud="boss-intro"].hud-boss-intro--glowcap');
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(5));
    return intro.count();
  }, { timeout: 30_000 }).toBe(1);
  await expect(intro).toBeVisible();
  await snap(page, 'glowcap-entrance-card');
  await press(intro);
  await expect(intro).toHaveCount(0);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = false; });
  const bar = page.locator('[data-hud="boss"].hud-boss--glowcap');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.hud-boss__face')).toBeVisible();
  // It guards the plant base on the middle lane, in the fog.
  const stand = await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    return { lane: s.config.boss.lane as number, key: s.config.boss.key as string, fog: s.config.lawn.fog as number };
  });
  expect(stand.key).toBe('glowcap');
  expect(stand.lane).toBe(2);
  expect(stand.fog).toBe(5);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const c = lvt.session.controller;
    const f = {
      barrage: false, bombs: false, marks: false, acorns: false, needles: false, frozen: false, summon: false, shield: false, plates: false,
      phase2: false, strike: false, strikeShown: false, tiles: 0, dither: false, spots: false, poisoned: 0, boulders: false,
      peashooters: false, avocados: false, defeated: false,
    };
    lvt.__fight = f;
    const drawn = (o: any): boolean => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const step = c.match.step.bind(c.match);
    c.match.step = (commands: unknown) => {
      const events = step(commands);
      const s = c.match.state;
      const boss = s.units.find((u: any) => u.key === 'glowcap');
      const fx = lvt.session.view.bossFx;
      for (const e of events) {
        if (e.type === 'bossPattern' && e.kind === 'barrage') f.barrage = true;
        if (e.type === 'bossPattern' && e.kind === 'summon') f.summon = true;
        if (e.type === 'bossPattern' && e.kind === 'shield') f.shield = true;
        if (e.type === 'bossStrike' && e.windup) { f.strike = true; f.tiles = Math.max(f.tiles, e.tiles.length); }
        if (e.type === 'bossDefeated') f.defeated = true;
      }
      if (fx.barkShut) f.plates = true;
      if (fx.striking) f.strikeShown = true;
      if (boss && boss.phase >= 1) f.phase2 = true;
      if (s.units.some((u: any) => u.key === 'peashooter' && u.faction === 'plants' && u.id > boss.id)) f.peashooters = true;
      if (s.units.some((u: any) => u.key === 'avocadoBunker' && u.faction === 'plants')) f.avocados = true;
      lvt.stage.scene.traverse((o: any) => {
        if (!o.parent) return;
        if (o.name === 'projectile-spore-bomb') f.bombs = true;
        if (o.name === 'projectile-acorn') f.acorns = true;
        if (o.name === 'projectile-needle') f.needles = true;
        if (o.name === 'projectile-frozen-melon') f.frozen = true;
        if (o.name === 'boss-acorn-mark' && drawn(o)) f.marks = true;
        if (o.name === 'boss-boulder' && drawn(o)) f.boulders = true;
        if (o.name === 'boss-strike-fill' && drawn(o)) f.dither = true;
      });
      const model = boss ? lvt.session.view.unit(boss.id)?.model.root : null;
      const lit = model?.getObjectByName('spotsLit');
      if (lit && drawn(lit)) f.spots = true;
      f.poisoned = Math.max(f.poisoned, s.units.filter((u: any) => u.faction === 'zombies' && u.poison > 0).length);
      return events;
    };
  });
  const fight = (): Promise<Fight> => page.evaluate(() => ({ ...(window.__lvt as any).__fight }));
  const hold = (frac: number): Promise<void> => page.evaluate((fr) => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'glowcap');
    if (boss) boss.hp = Math.max(boss.hp, Math.ceil(boss.maxHp * fr));
  }, frac);
  // Phase 1: a barrage of spore bombs (never an acorn, a needle or a frozen melon) and Peashooter summons.
  await expect.poll(async () => {
    await sendWave(page);
    await hold(0.52);
    await page.evaluate(() => (window.__lvt as any).fastForward(30));
    await frames(page, 1);
    const f = await fight();
    if (f.bombs) await snap(page, 'glowcap-spore-bombs');
    return f.barrage && f.bombs && f.summon;
  }, { timeout: 90_000 }).toBe(true);
  const early = await fight();
  expect(early.acorns).toBe(false);
  expect(early.needles).toBe(false);
  expect(early.frozen).toBe(false);
  // Half health: the cap shells clap shut (plates, never a dome).
  await page.evaluate(() => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'glowcap');
    boss.hp = Math.ceil(boss.maxHp * 0.495);
  });
  await expect.poll(async () => {
    await sendWave(page);
    await hold(0.1);
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    await frames(page, 1);
    const f = await fight();
    return f.shield && f.plates;
  }, { timeout: 90_000 }).toBe(true);
  await expect(bar).toHaveClass(/is-shielded/);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('boss-shield-dome')?.visible ?? false)).toBe(false);
  await snap(page, 'glowcap-cap-shells');
  // Phase 2: the spore cloud over four warned zombie tiles (a dither, the spots lit), then poison.
  await expect.poll(async () => {
    await sendWave(page);
    await hold(0.1);
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    if (f.strikeShown && f.dither) await snap(page, 'glowcap-spore-cloud-warning');
    return f.phase2 && f.strike && f.strikeShown && f.dither && f.spots && f.poisoned > 0;
  }, { timeout: 150_000 }).toBe(true);
  const late = await fight();
  expect(late.tiles).toBe(4);
  expect(late.boulders, 'the Glowcap drops no boulders').toBe(false);
  expect(late.needles).toBe(false);
  expect(late.frozen).toBe(false);
  await snap(page, 'glowcap-phase2');
  // Avocado Bunkers come in phase 2.
  await expect.poll(async () => {
    await sendWave(page);
    await hold(0.1);
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    return (await fight()).avocados;
  }, { timeout: 90_000 }).toBe(true);
  // Down to its last bit of health; the zombies finish it.
  await page.evaluate(() => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'glowcap');
    if (boss) { boss.hp = Math.min(boss.hp, 30); boss.shieldLeft = 0; }
  });
  const coins = (await progress(page)).coins;
  await expect.poll(async () => {
    await sendWave(page);
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    return (await fight()).defeated;
  }, { timeout: 120_000 }).toBe(true);
  await snap(page, 'glowcap-defeat');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner)).toBe('zombies');
  const result = page.locator('[data-level-result="z4-8"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(coins + 30 * stars);
  await expect(page.locator('[data-action="next-level"]')).toHaveCount(0);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="z4-8"]')).toHaveAttribute('data-stars', String(stars));
  await expect(page.locator('[data-stone][data-state="done"]')).toHaveCount(8);
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

// ---- ten round trips --------------------------------------------------------------------------

test('ten Meadow level <-> map round trips (zombies): one WebGL context, the GPU\'s geometry count flat', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page);
  const geometries = (): Promise<number> => page.evaluate(() => (window.__lvt as any).renderer.webgl.info.memory.geometries as number);
  const counts: number[] = [];
  await toMap(page);
  for (let round = 0; round < 10; round++) {
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('meadow');
    await frames(page, 3);
    counts.push(await geometries());
    // Two levels with scripted waves and no computer: what stands on the lawn after a minute is the same every visit.
    const id = round % 2 === 0 ? 'z4-5' : 'z4-3';
    await startFromMap(page, id);
    expect(await fog(page)).toBe(await reachOf(page, id));
    await page.evaluate(() => (window.__lvt as any).fastForward(60));
    await forceResult(page, 'plants');
    await expect(page.locator(`[data-level-result="${id}"]`)).toBeVisible({ timeout: 30_000 });
    await press(page.locator('[data-screen="result"] [data-action="map"]'));
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    expect(await glContexts(page), `round ${round + 1}`).toBe(1);
  }
  for (const n of counts.slice(2)) expect(n, `geometries on the map: ${counts.join(', ')}`).toBe(counts[2]);
  test.info().annotations.push({ type: 'geometries', description: counts.join(', ') });
});

// ---- a five-year-old's walk, by taps only -----------------------------------------------------
// Toby cannot read: every move is a tap on a card picture and a tap on a lane. This plays z4-1..z4-3
// and the Glowcap in real time (no fast-forward, no cheating energy): each second it taps the next
// card it can afford and then a lane the way a small child does (jumpy, favouring none), and records what
// it saw. The findings go to the console and, with LVT_W4_SHOTS, the pictures to that folder. A signal,
// not a balance gate. Run on request: LVT_W4_WALK=1 npx playwright test e2e/meadow-zombies.spec.ts
// --project ipad -g walk (LVT_W4_WALK=late: only z4-3 and the Glowcap).
test('walk: a five-year-old by taps only through z4-1, z4-2, z4-3 and the Glowcap', async ({ page }) => {
  test.skip(process.env.LVT_W4_WALK === undefined || test.info().project.name !== 'ipad', 'on request, on the iPad project');
  test.setTimeout(2_400_000);
  await open(page);
  await logIn(page);
  await graduate(page);
  await toMap(page);
  page.setDefaultTimeout(4000); // a tap that cannot land is a finding, not a hang
  const log: string[] = [];
  const say = (m: string): void => { log.push(m); console.log(`[walk] ${m}`); };
  const vp = page.viewportSize()!;
  let taps = 0;
  /** Plays the running level by taps until its result (or `limit` s), real time. Returns what it saw. */
  const play = async (id: string, limit: number): Promise<{ won: boolean; denied: number; placed: number; secs: number }> => {
    const t0 = Date.now();
    let placed = 0;
    let lane = 0;
    const d0 = await denied(page);
    const order = ['brainEater', 'skeletonWarrior', 'desertZombie', 'veryFastWalker', 'cowboyZombie', 'hotTopic', 'skeletonArcher', 'necromancer', 'tridentZombie', 'brainRot'];
    let stuck = 0;
    const refusals: string[] = [];
    while ((Date.now() - t0) / 1000 < limit) {
      if (await page.locator(`[data-level-result="${id}"]`).count() > 0) break;
      try {
        // Any glove/pan on screen: follow the hand with a tap, as a child would.
        const hand = page.locator('[data-tutorial] [data-glove][data-glove-x]');
        if (await hand.count() > 0) {
          const g = await hand.evaluate((e: HTMLElement) => ({ x: Number(e.dataset.gloveX), y: Number(e.dataset.gloveY) })).catch(() => null);
          if (g !== null) { await tapAt(page, g); taps += 1; await frames(page, 4); continue; }
        }
        if (await page.locator('[data-twist]').count() > 0) { await press(page.locator('[data-twist]')); taps += 1; continue; }
        const options = await page.evaluate((o) => {
          const c = (window.__lvt as any).session.controller;
          const me = c.match.state.players.zombies;
          const have = new Set<string>(c.match.state.config.cards.zombies);
          return o.filter((k) => have.has(k) && (me.recharge[k] ?? 0) <= 0).map((k) => k);
        }, order).catch(() => [] as string[]);
        let sent = false;
        for (const card of options) {
          const el = page.locator(`[data-hud="tray"] [data-card="${card}"]`);
          const label = (await el.getAttribute('aria-label').catch(() => '')) ?? '';
          const price = Number(label.split(',').pop());
          const energy = await page.evaluate(() => (window.__lvt as any).session.controller.match.state.players.zombies.energy as number);
          if (!(price <= energy)) continue;
          const dBefore = await denied(page);
          await press(el); taps += 1;
          await tapAt(page, await tilePoint(page, lane % 5, 9)); taps += 1;
          await frames(page, 2);
          if (await denied(page) > dBefore && refusals.length < 6) {
            refusals.push(await page.evaluate(([c, l]) => {
              const me = (window.__lvt as any).session.controller.match.state.players.zombies;
              return `${c} lane ${l}: energy ${Math.round(me.energy)}, recharge ${JSON.stringify(me.recharge)}, selected ${(window.__lvt as any).session.controller.hud.selected.value}`;
            }, [card, lane % 5] as const));
          }
          lane += 2 + (taps % 3); // a child's lane: jumpy, not systematic
          placed += 1; sent = true;
          break;
        }
        if (!sent) await page.waitForTimeout(500);
        else await page.waitForTimeout(250);
      } catch (e) {
        stuck += 1;
        if (stuck <= 3) say(`${id}: a tap could not land (${String(e).split('\n')[0]!.slice(0, 160)})`);
        await page.waitForTimeout(500);
      }
    }
    for (const r of refusals) say(`${id}: refused tap after ${r}`);
    if (stuck > 0) say(`${id}: ${stuck} taps could not land in all`);
    const won = await page.locator(`[data-level-result="${id}"]`).count() > 0;
    return { won, denied: (await denied(page).catch(() => d0)) - d0, placed, secs: Math.round((Date.now() - t0) / 1000) };
  };
  /** Plays `id` by taps; on a defeat taps the replay picture and tries again, up to three times (as a child would). */
  const tryUntilWon = async (id: string, limit: number): Promise<void> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await play(id, limit);
      say(`${id} try ${attempt}: ${r.won ? 'reached a result' : 'NO RESULT'} in ${r.secs} s of play, ${r.placed} zombies sent by taps, ${r.denied} refused taps`);
      await snap(page, `walk-${id}-end-${attempt}`);
      if (!r.won) return;
      const stars = await page.locator(`[data-level-result="${id}"]`).getAttribute('data-stars');
      const winner = await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner as string | null);
      say(`${id} try ${attempt}: winner ${winner}, ${stars} stars; picture buttons on the result: next ${await page.locator('[data-action="next-level"]').count()}, replay ${await page.locator('[data-screen="result"] [data-action="replay"]').count()}, map ${await page.locator('[data-screen="result"] [data-action="map"]').count()}`);
      if (Number(stars) >= 1) return;
      await press(page.locator('[data-screen="result"] [data-action="replay"]'));
      await waitLive(page);
    }
  };
  const late = process.env.LVT_W4_WALK === 'late';
  if (late) {
    await page.evaluate(() => (window.__lvt as any).players.update((p: any) => ({ ...p, zombies: { ...p.zombies, stars: { ...p.zombies.stars, 'z4-1': 2, 'z4-2': 2 } }, teached: [...p.teached, 'z4-1.fog'] })));
    await page.evaluate(() => (window.__lvt as any).go({ name: 'map', side: 'zombies', world: 4 }));
    await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  }
  for (const id of late ? ['z4-3'] : ['z4-1', 'z4-2', 'z4-3']) {
    if (id === 'z4-1' || late) await startFromMap(page, id);
    say(`${id}: ${id === 'z4-1' || late ? 'started from the map by two taps (stone, START)' : 'started by the result\'s next-level picture button'}`);
    await snap(page, `walk-${id}-start`);
    await tryUntilWon(id, 420);
    if (await page.locator(`[data-level-result="${id}"]`).count() === 0) break;
    if (id === 'z4-3') {
      await press(page.locator('[data-screen="result"] [data-action="map"]'));
      break;
    }
    const nextId = id === 'z4-1' ? 'z4-2' : 'z4-3';
    if (await page.locator('[data-action="next-level"]').count() > 0) await next(page, nextId);
    else { // lost three times: the map picture, then the next stone (the walk goes on; this is a finding)
      say(`${id}: not won in three tries; on to ${nextId} by the map`);
      await press(page.locator('[data-screen="result"] [data-action="map"]'));
      await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
      await page.evaluate(([i]) => (window.__lvt as any).players.update((p: any) => ({ ...p, zombies: { ...p.zombies, stars: { ...p.zombies.stars, [i as string]: 1 } } })), [id] as const);
      await page.evaluate(() => (window.__lvt as any).go({ name: 'map', side: 'zombies', world: 4 }));
      await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
      await startFromMap(page, nextId);
    }
  }
  // The Glowcap: the rest of the walk goes straight to its level (z4-4..z4-7 are covered above).
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const stars = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`z4-${i + 1}`, 2]));
    lvt.players.update((p: any) => ({ ...p, zombies: { ...p.zombies, stars: { ...p.zombies.stars, ...stars }, unlocked: [...new Set([...p.zombies.unlocked, 'brainRot'])] },
      teached: [...new Set([...p.teached, 'z4-1.fog', 'z4-4.rot-card', 'z4-4.rot-lane'])] }));
  });
  await page.evaluate(() => (window.__lvt as any).go({ name: 'map', side: 'zombies', world: 4 }));
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  await startFromMap(page, 'z4-8');
  say('z4-8: the Glowcap; entrance card shows on its own (no tap needed to read it)');
  await snap(page, 'walk-z4-8-start');
  await tryUntilWon('z4-8', 600);
  say(`viewport ${vp.width}x${vp.height}; total taps ${taps}`);
  test.info().annotations.push({ type: 'walk', description: log.join(' | ') });
});

// ---- screenshots, on request ------------------------------------------------------------------

test('shots', async ({ page }) => {
  test.skip(dir === undefined || test.info().project.name !== 'ipad', 'screenshots only on request, on the iPad project');
  test.setTimeout(600_000);
  const sizes = [{ width: 1024, height: 650 }, { width: 1024, height: 704 }, { width: 1180, height: 746 }];
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
  const go = (screen: unknown): Promise<void> => page.evaluate((s) => (window.__lvt as any).go(s), screen);
  const quit = async (): Promise<void> => {
    await press(page.locator('[data-hud="pause"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
    await expect(page.locator('[data-screen="map"]')).toBeVisible();
  };
  await graduate(page);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const stars = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`z4-${i + 1}`, 2]));
    lvt.players.update((p: any) => ({ ...p, zombies: { ...p.zombies, stars: { ...p.zombies.stars, ...stars }, unlocked: [...p.zombies.unlocked, 'brainRot'] }, teached: (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((d) => (d.teaches ?? []).map((t) => t.id)) }));
  });
  await go({ name: 'play' });
  await go({ name: 'map', side: SIDE, world: 4 });
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  await frames(page, 20);
  await shoot('map-zombies-world4');
  await go({ name: 'map', side: SIDE, world: 4, card: 'z4-1' });
  await frames(page, 10);
  await shoot('card-z4-1-fog');
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const id = `z4-${n}`;
    await go({ name: 'map', side: SIDE, world: 4, card: id });
    await page.locator('[data-action="start-level"]').click();
    await waitLive(page);
    await page.evaluate(() => {
      const lvt = window.__lvt as any;
      const c = lvt.session.controller;
      const dealt: string[] = c.match.state.config.cards.zombies;
      for (const lane of [0, 1, 2, 3, 4]) {
        c.match.state.players.zombies.energy = 5000;
        c.match.state.players.zombies.recharge = {};
        c.match.step([{ type: 'place', faction: 'zombies', unit: dealt[lane % dealt.length]!, lane, col: 9 }]);
      }
      lvt.fastForward(30 * 6);
    });
    await shoot(`level-${id}`);
    await quit();
  }
});
