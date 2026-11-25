import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { forceResult, frames, glContexts, logIn, openTitle, tilePoint, waitLive } from './helpers';

// Step 4, Task 9 (the Frozen Tundra, the plants' side): world 4 end to end for Lukas, one save carried
// through the file's tests (in order, on both projects), as `desert.spec` does for world 3. (`tundra.spec`
// is world 2 of the zombies: this file is the plants' fourth world.)
//   - the gate: the Tundra island opens after p3-8 and not before;
//   - p4-1's ice pan (the shiny lanes pulse, a ghost zombie slides one) ends on a tap and the level plays
//     to a result by taps; p4-2; p4-3 reveals the Pumpkin Squash; HELP on p4-1's card plays the pan again;
//   - p4-4 teaches the Squash by the glove: the card first, and its tile only when a foe arrives in front of it;
//     p4-5..p4-7; a reload mid-world keeps it all;
//   - p4-8 brings the Yeti (entrance, bar, summons, club slam, the snow fort at two thirds and at a third,
//     the avalanche on one lane then on two, Skeleton Warriors in phase 3, defeat);
//   - ten level <-> map round trips on one WebGL context with a flat geometry count.
// Fast-forward and the debug hooks behind `?debug` move matches on; every address carries `cloud=fake`
// (helpers). No console or page error anywhere (the fixture).
//
// Screenshots, only when asked (iPad project): LVT_W4_SHOTS=<folder> npx playwright test
// e2e/tundra-plants.spec.ts --project ipad -g shots (the map and levels at three sizes); the boss test also
// writes its moments there when it is set.

test.describe.configure({ mode: 'serial' });

const carried = new Map<string, Record<string, string>>();
const dir = process.env.LVT_W4_SHOTS;
const SIDE = 'plants' as const;

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
  const has = await page.evaluate(() => ((window.__lvt as any).levels as { id: string }[]).some((l) => l.id === 'p4-1'));
  expect(has, 'p4-1 is missing from ALL: the Frozen Tundra levels for the plants are gone from this build').toBe(true);
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

interface Progress { coins: number; teached: string[]; plants: { stars: Record<string, number>; unlocked: string[] } }
const progress = (page: Page): Promise<Progress> => page.evaluate(() => {
  const s = (window.__lvt as any).players.player.value;
  return JSON.parse(JSON.stringify({ coins: s.coins, teached: s.teached, plants: s.plants }));
});

/** A player who has won worlds 1 and 2 and `wonThree` levels of world 3 as the plants: their lessons and unlocks, nothing of world 4. */
async function graduate(page: Page, wonThree = 8): Promise<void> {
  await page.evaluate((won) => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { world: number; teaches: { id: string }[] | null }[])
      .filter((d) => d.world <= 3).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    const stars: Record<string, number> = {};
    for (let w = 1; w <= 3; w++) for (let n = 1; n <= (w === 3 ? won : 8); n++) stars[`p${w}-${n}`] = 2;
    const unlocked = ['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber'];
    lvt.players.update((p: any) => ({ ...p, teached: ids, plants: { ...p.plants, stars, unlocked } }));
  }, wonThree);
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

/** The lanes level `id` ices, from the level itself. */
const iceOf = (page: Page, id: string): Promise<number[]> => page.evaluate(
  (lv) => [...(((window.__lvt as any).levels as { id: string; twist?: { iceLanes?: number[] } }[]).find((l) => l.id === lv)!.twist?.iceLanes ?? [])].sort(), id);

interface Seen { key: string; faction: string; lane: number; x: number; id: number }
const units = (page: Page): Promise<Seen[]> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
  .map((u: any) => ({ key: u.key, faction: u.faction, lane: u.lane, x: u.x, id: u.id })));
const plantOn = async (page: Page, lane: number, col: number): Promise<Seen | undefined> =>
  (await units(page)).find((u) => u.faction === 'plants' && u.lane === lane && Math.floor(u.x) === col);

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

/** Wins the running level (a little play, then the enemy base falls); stars, 30 coins a star. */
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

// ---- the gate ---------------------------------------------------------------------------------

test('the gate: the Tundra is shut behind p3-7 (no stones, a tap refused) and opens with p3-8', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await logIn(page);
  // One level short: the map opens on world 3; the arrow leads to a grey island with no stones.
  await graduate(page, 7);
  await toMap(page, 3);
  await expect(page.locator('[data-stone="p3-8"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-action="world-next"]')).toHaveAttribute('data-locked', '');
  await press(page.locator('[data-action="world-next"]'));
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-world', '4');
  await expect(map).toHaveAttribute('data-locked', '');
  await expect(page.locator('[data-stone]')).toHaveCount(0);
  await press(page.locator('[data-action="island-locked"]'));
  await expect(page.locator('[data-action="island-locked"]')).toHaveClass(/is-deny-a/);
  await expect(page.locator('[data-screen="level-card"]')).toHaveCount(0);
  // Home, and the last level won: the map opens on the Tundra, p4-1 waiting, the Yeti on the last stone.
  await press(page.locator('[data-screen="map"] [data-action="back"]'));
  await press(page.locator('[data-screen="play"] [data-action="back"]'));
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await graduate(page, 8);
  await toMap(page, 4);
  await expect(map).toHaveAttribute('data-arena', 'tundra');
  await expect(map).not.toHaveAttribute('data-locked', '');
  await expect(page.locator('[data-stone="p4-1"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="p4-8"]')).toHaveAttribute('data-kind', 'boss');
  // What the Tundra brings: the Pumpkin Squash on p4-3.
  await expect(page.locator('[data-stone="p4-3"] [data-unlock="pumpkinSquash"]')).toHaveCount(1);
  expect(await glContexts(page)).toBe(1);
});

// ---- Lukas ------------------------------------------------------------------------------------

test('Lukas: p4-1 holds on the ice pan, a tap ends it, the level plays to a result by taps; p4-2; p4-3 reveals the Pumpkin Squash', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await logIn(page);
  await graduate(page);
  await toMap(page);
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-arena', 'tundra');
  await expect(page.locator('[data-stone="p4-1"]')).toHaveAttribute('data-state', 'next');
  // p4-1's card: the ice picture beside the number.
  await press(page.locator('[data-stone="p4-1"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="p4-1"] [data-twist="ice"]')).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await level(page)).toBe('p4-1');
  // The pan holds the match until a tap: the cards dimmed, Pause above the catcher, nothing planted.
  const catcher = page.locator('[data-twist="ice"]');
  await expect(catcher).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null)).toBe('ice');
  await expect(page.locator('[data-screen="battle"]')).toHaveClass(/is-twist/);
  await expect.poll(() => page.locator('.battle__bottom').evaluate((el) => getComputedStyle(el).filter)).toContain('brightness');
  const held = await tick(page);
  expect(held).toBeLessThanOrEqual(2);
  await tundraLook(page, 'p4-1');
  // The pan's pictures: every icy lane pulsing, a ghost sliding one of them, on the level's own lanes.
  const show = await page.evaluate(() => {
    const s = (window.__lvt as any).session.twistShow;
    let pulses = 0;
    let ghosts = 0;
    s.group.traverse((o: any) => { if (o.name === 'ice-pulse') pulses += 1; if (o.name.startsWith('ghost-') && o.name !== 'ghost-pea') ghosts += 1; });
    return { pulses, ghosts, slider: s.slider.lane as number };
  });
  const lanes = await iceOf(page, 'p4-1');
  expect(show.pulses).toBe(lanes.length);
  expect(show.ghosts).toBeGreaterThanOrEqual(1);
  expect(lanes).toContain(show.slider);
  await snap(page, 'p4-1-pan');
  // Pause works over the pan, and the pan is still there after Resume.
  await press(page.locator('[data-hud="pause"]'));
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await expect(catcher).toHaveCount(0);
  await press(page.locator('[data-screen="pause"] [data-action="resume"]'));
  await expect(catcher).toBeVisible();
  // Nobody taps: after 3 s the glove taps the lawn; the match is still held.
  await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
  expect(await tick(page)).toBe(held);
  // A tap anywhere (the sky) ends it and plants nothing.
  const size = page.viewportSize()!;
  await tapAt(page, { x: Math.round(size.width / 2), y: Math.round(size.height * 0.2) });
  await expect(catcher).toHaveCount(0);
  await expect(page.locator('[data-screen="battle"]')).not.toHaveClass(/is-twist/);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow ?? null)).toBeNull();
  await expect.poll(() => tick(page)).toBeGreaterThan(held + 10);
  expect((await progress(page)).teached).toContain('p4-1.ice');
  expect(await denied(page)).toBe(0);
  expect((await units(page)).filter((u) => u.faction === 'plants')).toHaveLength(0);
  // By taps: a Peashooter on the icy lane, and the level plays to its result.
  await place(page, 'peashooter', lanes[0]!, 3);
  await expect.poll(async () => (await plantOn(page, lanes[0]!, 3))?.key).toBe('peashooter');
  await win(page, 'p4-1');
  await next(page, 'p4-2');
  await tundraLook(page, 'p4-2');
  await expect(page.locator('[data-twist]')).toHaveCount(0); // the pan is taught once
  await win(page, 'p4-2');
  await next(page, 'p4-3');
  await tundraLook(page, 'p4-3');
  await win(page, 'p4-3');
  // The Pumpkin Squash on the result's turntable; kept.
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="pumpkinSquash"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).plants.unlocked).toEqual(['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash']);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(map).toHaveAttribute('data-world', '4');
  await expect(page.locator('[data-stone="p4-3"] [data-unlock]')).toHaveCount(0);
  await expect(page.locator('[data-stone="p4-4"]')).toHaveAttribute('data-state', 'next');
  await press(page.locator('[data-stone="p4-4"]'));
  await expect(page.locator('[data-screen="level-card"] [data-dealt] [data-picture="pumpkinSquash"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('HELP on p4-1\'s card plays the ice pan again', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page);
  await toMap(page);
  await press(page.locator('[data-stone="p4-1"]'));
  await press(page.locator('[data-screen="level-card"] [data-action="replay-tutorial"]'));
  await waitLive(page);
  await expect(page.locator('[data-twist="ice"]')).toBeVisible();
  await press(page.locator('[data-twist="ice"]'));
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  expect((await progress(page)).teached.filter((t) => t === 'p4-1.ice')).toHaveLength(1);
  expect(await glContexts(page)).toBe(1);
});

test('Lukas: p4-4 teaches the Pumpkin Squash by the glove (card; the tile only when a foe arrives); p4-5..p4-7', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page);
  await toMap(page);
  await startFromMap(page, 'p4-4');
  await tundraLook(page, 'p4-4');
  const glove = page.locator('[data-tutorial] [data-glove]');
  // The card is pointed at first; the match runs.
  await page.evaluate(() => { (window.__lvt as any).session.controller.match.state.players.plants.energy = 500; });
  await expect(glove).toHaveAttribute('data-glove-step', 'p4-4.squash-card');
  await snap(page, 'p4-4-squash-card-glove');
  await press(page.locator('[data-hud="tray"] [data-card="pumpkinSquash"]'));
  // The tile step waits: no glove, nothing held, no foe in front of the tile yet.
  await frames(page, 10);
  await expect(glove).toHaveCount(0);
  const near = (): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .filter((u: any) => u.faction === 'zombies' && u.lane === 1 && u.x >= 3.5 && u.x <= 5.5).length);
  expect(await near()).toBe(0);
  const waited = await tick(page);
  await frames(page, 30);
  expect(await tick(page)).toBeGreaterThan(waited);
  let armed = false;
  for (let i = 0; i < 400 && !armed; i++) {
    await page.evaluate(() => {
      const ctl = (window.__lvt as any).session.controller;
      ctl.match.state.baseHp.plants = ctl.match.state.baseMaxHp.plants;
      ctl.match.state.players.plants.energy = 500;
      (window.__lvt as any).fastForward(30);
    });
    armed = (await glove.count()) > 0;
  }
  expect(armed, 'the glove came with the foe').toBe(true);
  await expect(glove).toHaveAttribute('data-glove-step', 'p4-4.squash-tile');
  expect(await near(), 'a foe stands in front of the tile when the glove shows').toBeGreaterThan(0);
  const held = await tick(page);
  await frames(page, 20);
  expect(await tick(page)).toBe(held);
  await snap(page, 'p4-4-squash-tile-glove-with-foe');
  await tapAt(page, await tilePoint(page, 1, 3));
  await expect.poll(async () => (await progress(page)).teached).toEqual(expect.arrayContaining(['p4-4.squash-card', 'p4-4.squash-tile']));
  await expect(page.locator('[data-tutorial]')).toHaveCount(0);
  await win(page, 'p4-4');
  await next(page, 'p4-5');
  await tundraLook(page, 'p4-5');
  await win(page, 'p4-5');
  await next(page, 'p4-6');
  await tundraLook(page, 'p4-6');
  await win(page, 'p4-6');
  await next(page, 'p4-7');
  await tundraLook(page, 'p4-7');
  await win(page, 'p4-7');
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="p4-8"]')).toHaveAttribute('data-state', 'next');
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

test('a reload mid-world keeps the Tundra for Lukas: the map opens on it, the same stars, unlocks and lessons, p4-8 next', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page);
  const before = await progress(page);
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  const after = await progress(page);
  expect(after).toEqual(before);
  for (let n = 1; n <= 7; n++) expect(after.plants.stars[`p4-${n}`]).toBeGreaterThanOrEqual(1);
  expect(after.plants.unlocked).toEqual(['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash']);
  expect(after.teached).toEqual(expect.arrayContaining(['p4-1.ice', 'p4-4.squash-card', 'p4-4.squash-tile']));
  await toMap(page);
  for (let n = 1; n <= 7; n++) await expect(page.locator(`[data-stone="p4-${n}"]`)).toHaveAttribute('data-stars', String(after.plants.stars[`p4-${n}`]));
  await expect(page.locator('[data-stone="p4-8"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="p4-8"]')).toHaveAttribute('data-kind', 'boss');
  await keep(page);
});

interface Fight {
  slam: boolean; slamShown: boolean; summon: boolean; shields: number; forts: number; strike: boolean; strikeShown: boolean; strikeLanes: number[];
  phase2: boolean; phase3: boolean; skeletons: boolean; pups: boolean; breath: boolean; stunned: number; needles: boolean; frozen: boolean;
  boulders: boolean; spores: boolean; defeated: boolean;
}

test('p4-8: the Yeti - entrance card, boss bar with its face, snow pups, club slam, the snow fort at two thirds and again at a third, the avalanche on one lane and then two, Skeleton Warriors, defeat; stars and coins', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
  await toMap(page);
  await startFromMap(page, 'p4-8');
  await tundraLook(page, 'p4-8');
  // The entrance card (held by the hook) with the Yeti's face, then the bar with its face.
  const intro = page.locator('[data-hud="boss-intro"].hud-boss-intro--yeti');
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(5));
    return intro.count();
  }, { timeout: 30_000 }).toBe(1);
  await expect(intro).toBeVisible();
  await snap(page, 'yeti-entrance-card');
  await press(intro);
  await expect(intro).toHaveCount(0);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = false; });
  const bar = page.locator('[data-hud="boss"].hud-boss--yeti');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.hud-boss__face')).toBeVisible();
  // It walks the iced middle lane.
  const stand = await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    return { lane: s.config.boss.lane as number, key: s.config.boss.key as string, ice: [...s.config.lawn.ice.lanes] as number[] };
  });
  expect(stand.key).toBe('yeti');
  expect(stand.ice).toContain(stand.lane);
  // Watch the match: every step's events, and what the views show.
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const c = lvt.session.controller;
    const f = {
      slam: false, slamShown: false, summon: false, shields: 0, forts: 0, strike: false, strikeShown: false, strikeLanes: [] as number[],
      phase2: false, phase3: false, skeletons: false, pups: false, breath: false, stunned: 0, needles: false, frozen: false,
      boulders: false, spores: false, defeated: false,
    };
    lvt.__fight = f;
    const drawn = (o: any): boolean => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    let up = false;
    const step = c.match.step.bind(c.match);
    c.match.step = (commands: unknown) => {
      const events = step(commands);
      const s = c.match.state;
      const boss = s.units.find((u: any) => u.key === 'yeti');
      const fx = lvt.session.view.bossFx;
      for (const e of events) {
        if (e.type === 'bossPattern' && e.kind === 'slam') f.slam = true;
        if (e.type === 'bossPattern' && e.kind === 'summon') f.summon = true;
        if (e.type === 'bossPattern' && e.kind === 'shield') f.shields += 1;
        if (e.type === 'bossStrike' && e.windup) { f.strike = true; f.strikeLanes.push(new Set(e.tiles.map((t: any) => t.lane)).size); }
        if (e.type === 'bossDefeated') f.defeated = true;
      }
      if (fx.windingUp) f.slamShown = true;
      if (fx.striking) f.strikeShown = true;
      const dome = lvt.stage.scene.getObjectByName('boss-shield-dome');
      const now = fx.shielded && dome !== undefined && drawn(dome);
      if (now && !up) f.forts += 1;
      up = now;
      if (boss && boss.phase >= 1) f.phase2 = true;
      if (boss && boss.phase >= 2) f.phase3 = true;
      if (s.units.some((u: any) => u.key === 'skeletonWarrior' && u.faction === 'zombies')) f.skeletons = true;
      if (s.units.some((u: any) => u.key === 'veryFastWalker' && u.faction === 'zombies')) f.pups = true;
      lvt.stage.scene.traverse((o: any) => {
        if (!o.parent) return;
        if (o.name === 'projectile-needle') f.needles = true;
        if (o.name === 'projectile-frozen-melon') f.frozen = true;
        if (o.name === 'projectile-spore-bomb') f.spores = true;
        if (o.name === 'boss-boulder' && drawn(o)) f.boulders = true;
      });
      const model = boss ? lvt.session.view.unit(boss.id)?.model.root : null;
      const breath = model?.getObjectByName('frostBreath');
      if (breath && drawn(breath)) f.breath = true;
      f.stunned = Math.max(f.stunned, s.units.filter((u: any) => u.faction === 'plants' && u.stun > 0).length);
      return events;
    };
  });
  const fight = (): Promise<Fight> => page.evaluate(() => ({ ...(window.__lvt as any).__fight }));
  // A garden on every lane (the avalanche picks lanes with plants): Peashooters, pults behind them, walls in front.
  const garden = (): Promise<void> => page.evaluate(() => {
    const c = (window.__lvt as any).session.controller;
    if (c.match.state.winner !== null) return;
    const put = (unit: string, lane: number, col: number): void => {
      c.match.state.players.plants.energy = 5000;
      c.match.state.players.plants.recharge = {};
      c.match.step([{ type: 'place', faction: 'plants', unit, lane, col }]);
    };
    for (const lane of [0, 1, 2, 3, 4]) {
      put('peashooter', lane, 3);
      put('peashooter', lane, 4);
      put('kernelPult', lane, 1);
      put('mangoPult', lane, 0);
      put('walnutBomb', lane, 6);
    }
  });
  // The hp is held above the next mark while a phase is looked at, so the garden's fire never rushes the fight past it.
  const hold = (frac: number): Promise<void> => page.evaluate((fr) => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'yeti');
    if (boss) boss.hp = Math.max(boss.hp, Math.ceil(boss.maxHp * fr));
  }, frac);
  await garden();
  // Phase 1: the club slam (its wind-up shown) and snow pups.
  await expect.poll(async () => {
    await hold(0.68);
    await page.evaluate(() => (window.__lvt as any).fastForward(20));
    await frames(page, 1);
    const f = await fight();
    if (f.slamShown) await snap(page, 'yeti-slam-windup');
    return f.slam && f.slamShown && f.summon && f.pups;
  }, { timeout: 90_000 }).toBe(true);
  expect((await fight()).shields).toBe(0);
  // Two thirds: the first snow fort goes up (a dome in snow white, not the Titan's glass), the breath alight.
  await page.evaluate(() => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'yeti');
    boss.hp = Math.ceil(boss.maxHp * 0.655);
  });
  await expect.poll(async () => {
    await garden();
    await hold(0.34);
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    return f.shields >= 1 && f.forts >= 1 && f.breath;
  }, { timeout: 60_000 }).toBe(true);
  await expect(bar).toHaveClass(/is-shielded/);
  await snap(page, 'yeti-snow-fort');
  // Phase 2: the avalanche warns one lane, and the lane's plants are stunned by the blow.
  await expect.poll(async () => {
    await garden();
    await hold(0.34);
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    if (f.strikeShown) await snap(page, 'yeti-avalanche-warning');
    return f.phase2 && f.strike && f.strikeShown && f.stunned > 0;
  }, { timeout: 150_000 }).toBe(true);
  expect((await fight()).strikeLanes[0]).toBe(1);
  await snap(page, 'yeti-phase2');
  // A third: the second fort, then phase 3's avalanche on two lanes and its Skeleton Warriors.
  await page.evaluate(() => {
    const boss = (window.__lvt as any).session.controller.match.state.units.find((u: any) => u.key === 'yeti');
    boss.hp = Math.ceil(boss.maxHp * 0.325);
  });
  await expect.poll(async () => {
    await garden();
    await hold(0.05);
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    return f.shields >= 2 && f.forts >= 2;
  }, { timeout: 60_000 }).toBe(true);
  await snap(page, 'yeti-snow-fort-2');
  await expect.poll(async () => {
    await garden();
    await hold(0.05);
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    if (f.strikeLanes.length >= 2 && f.strikeShown) await snap(page, 'yeti-avalanche-two-lanes');
    return f.phase3 && f.strikeLanes.includes(2) && f.skeletons;
  }, { timeout: 150_000 }).toBe(true);
  const last = await fight();
  expect(last.needles, 'the Yeti throws no needles').toBe(false);
  expect(last.frozen, 'the Yeti throws no frozen melons').toBe(false);
  expect(last.spores, 'the Yeti throws no spore bombs').toBe(false);
  expect(last.boulders, 'the Yeti drops no boulders').toBe(false);
  await snap(page, 'yeti-phase3');
  // Down to its last bit of health; the garden finishes it.
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'yeti');
    if (boss) { boss.hp = Math.min(boss.hp, 30); boss.shieldLeft = 0; }
  });
  const coins = (await progress(page)).coins;
  // (No garden here: a place command stepped straight into the match could be the step that ends it,
  // and the controller, which publishes the result, would never see the end.)
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    return (await fight()).defeated;
  }, { timeout: 90_000 }).toBe(true);
  await snap(page, 'yeti-defeat');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner)).toBe('plants');
  const result = page.locator('[data-level-result="p4-8"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(coins + 30 * stars);
  // The Tundra's last level: no level after it, so no next-level button.
  await expect(page.locator('[data-action="next-level"]')).toHaveCount(0);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(page.locator('[data-stone="p4-8"]')).toHaveAttribute('data-stars', String(stars));
  await expect(page.locator('[data-stone][data-state="done"]')).toHaveCount(8);
  expect(await glContexts(page)).toBe(1);
  await keep(page);
});

// ---- ten round trips --------------------------------------------------------------------------

test('ten Tundra level <-> map round trips (plants): one WebGL context, the GPU\'s geometry count flat', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page);
  const geometries = (): Promise<number> => page.evaluate(() => (window.__lvt as any).renderer.webgl.info.memory.geometries as number);
  const counts: number[] = [];
  await toMap(page);
  for (let round = 0; round < 10; round++) {
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('tundra');
    await frames(page, 3);
    counts.push(await geometries());
    // Two scripted levels with no computer: what stands on the lawn after a minute is the same every visit.
    const id = round % 2 === 0 ? 'p4-5' : 'p4-7';
    await startFromMap(page, id);
    expect(await iceOf(page, id)).toEqual(await page.evaluate(() => [...(window.__lvt as any).session.controller.match.state.config.lawn.ice.lanes].sort()));
    await page.evaluate(() => (window.__lvt as any).fastForward(60));
    await forceResult(page, 'zombies');
    await expect(page.locator(`[data-level-result="${id}"]`)).toBeVisible({ timeout: 30_000 });
    await press(page.locator('[data-screen="result"] [data-action="map"]'));
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    expect(await glContexts(page), `round ${round + 1}`).toBe(1);
  }
  for (const n of counts.slice(2)) expect(n, `geometries on the map: ${counts.join(', ')}`).toBe(counts[2]);
  test.info().annotations.push({ type: 'geometries', description: counts.join(', ') });
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
    const stars = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`p4-${i + 1}`, 2]));
    lvt.players.update((p: any) => ({ ...p, plants: { ...p.plants, stars: { ...p.plants.stars, ...stars }, unlocked: [...p.plants.unlocked, 'pumpkinSquash'] }, teached: (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((d) => (d.teaches ?? []).map((t) => t.id)) }));
  });
  await go({ name: 'play' });
  await go({ name: 'map', side: SIDE, world: 4 });
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  await frames(page, 20);
  await shoot('map-plants-world4');
  await go({ name: 'map', side: SIDE, world: 4, card: 'p4-1' });
  await frames(page, 10);
  await shoot('card-p4-1-ice');
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const id = `p4-${n}`;
    await go({ name: 'map', side: SIDE, world: 4, card: id });
    await page.locator('[data-action="start-level"]').click();
    await waitLive(page);
    await page.evaluate(() => {
      const lvt = window.__lvt as any;
      const c = lvt.session.controller;
      const dealt: string[] = c.match.state.config.cards.plants;
      for (const lane of [0, 1, 2, 3, 4]) {
        c.match.state.players.plants.energy = 5000;
        c.match.state.players.plants.recharge = {};
        c.match.step([{ type: 'place', faction: 'plants', unit: dealt[lane % dealt.length]!, lane, col: 3 }]);
      }
      lvt.fastForward(30 * 6);
    });
    await shoot(`level-${id}`);
    await quit();
  }
});
