import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { forceResult, frames, glContexts, logIn, openTitle, tilePoint, waitLive } from './helpers';

// Step 3 (the Desert Canyon): world 3 end to end on both sides, one save per side carried through
// the file's tests (in order, on both projects), as `meadow.spec` and `tundra.spec` do.
//   - the gate: the islands open after p2-8 / z2-8 and not before;
//   - Lukas (plants): p3-1's rocks pan ends on a tap, a tap on a rock buzzes and places nothing,
//     p3-3 reveals the Torchwood, p3-4 teaches it by the glove, p3-6 reveals the Cherry Bomber,
//     p3-7's glove for it appears only when the clump arrives; a reload mid-world keeps it all;
//     p3-8 brings the Sand Pharaoh (entrance, bar, slam, summons, sand swirl at half health,
//     phase 2's sandstorm and mummies, defeat);
//   - Toby (zombies): z3-1's pan (the Brain Eater goes first) ends on a tap, z3-3 reveals the
//     Necromancer, z3-4 teaches it, z3-6 the Trident Zombie, z3-7 teaches it; z3-8 brings the
//     Cactus King (needles, Kernel-pult summons, spine plates, the boulder rockfall, defeat);
//   - ten level <-> map round trips a side on one WebGL context with a flat geometry count;
//   - a five-year-old's walk through z3-1..z3-3 and the Cactus King by taps only (`walk`).
// Fast-forward and the debug hooks behind `?debug` move matches on; every address carries
// `cloud=fake` (helpers). No console or page error anywhere (the fixture).
//
// Screenshots, only when asked (iPad project): LVT_DESERT_SHOTS=<folder> npx playwright test
// e2e/desert.spec.ts --project ipad -g shots (the maps and levels at three sizes); the two boss
// tests also write their moments there when it is set.

test.describe.configure({ mode: 'serial' });

type Side = 'plants' | 'zombies';
const carried = new Map<string, Record<string, string>>();
const dir = process.env.LVT_DESERT_SHOTS;

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

const letter = (side: Side): string => (side === 'plants' ? 'p' : 'z');
const key = (side: Side): string => `${test.info().project.name}:${side}`;

async function open(page: Page): Promise<void> {
  await openTitle(page);
  const has = await page.evaluate(() => ((window.__lvt as any).levels as { id: string }[]).some((l) => l.id === 'p3-1'));
  test.skip(!has, 'this build has no Desert Canyon levels yet');
}

/** The title, with the storage the previous test left for this side (if any), and Lukas logged in on Home. */
async function resume(page: Page, side: Side): Promise<void> {
  const saved = carried.get(key(side));
  await open(page);
  if (saved !== undefined) {
    await page.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, saved);
    await openTitle(page);
  }
  await logIn(page);
}

/** Flushes the save to the (fake) cloud and keeps the page's storage for the next test of this side. */
async function keep(page: Page, side: Side): Promise<void> {
  await page.evaluate(() => (window.__lvt as any).players.flush());
  carried.set(key(side), await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out[k] = localStorage.getItem(k)!;
    }
    return out;
  }));
}

interface Progress { coins: number; teached: string[]; plants: { stars: Record<string, number>; unlocked: string[] }; zombies: { stars: Record<string, number>; unlocked: string[] } }
const progress = (page: Page): Promise<Progress> => page.evaluate(() => {
  const s = (window.__lvt as any).players.player.value;
  return JSON.parse(JSON.stringify({ coins: s.coins, teached: s.teached, plants: s.plants, zombies: s.zombies }));
});

/** A player who has won worlds 1 and 2 on `side` by playing: their lessons and unlocks, nothing of world 3. */
async function graduate(page: Page, side: Side, wonTwo = 8): Promise<void> {
  await page.evaluate(([s, l, won]) => {
    const lvt = window.__lvt as any;
    const ids = (lvt.levels as { world: number; teaches: { id: string }[] | null }[])
      .filter((d) => d.world <= 2).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    const stars: Record<string, number> = {};
    for (let n = 1; n <= 8; n++) stars[`${l}1-${n}`] = 2;
    for (let n = 1; n <= (won as number); n++) stars[`${l}2-${n}`] = 2;
    const unlocked = s === 'plants' ? ['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker'] : ['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie'];
    lvt.players.update((p: any) => ({ ...p, teached: ids, [s as string]: { ...p[s as string], stars, unlocked } }));
  }, [side, letter(side), wonTwo] as const);
}

async function toMap(page: Page, side: Side, world = 3): Promise<void> {
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  // The map opens on the world of the next level: with the Desert won that is the Tundra / Meadow now, one arrow back.
  if (world === 3 && await page.locator('[data-screen="map"]').getAttribute('data-world') === '4') {
    await press(page.locator('[data-action="world-prev"]'));
  }
  await expect(page.locator('[data-screen="map"]')).toHaveAttribute('data-world', String(world));
  if (world === 3) await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
}

/** With the Desert won the map opens on the next world (the Tundra / the Meadow): one arrow back to the Desert's stones. */
async function backToDesert(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
  if (await page.locator('[data-screen="map"]').getAttribute('data-world') === '4') await press(page.locator('[data-action="world-prev"]'));
  await expect(page.locator('[data-screen="map"]')).toHaveAttribute('data-world', '3');
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
const rocksOf = (page: Page, id: string): Promise<number[]> => page.evaluate(
  (lv) => [...(((window.__lvt as any).levels as { id: string; twist?: { rocks?: number[] } }[]).find((l) => l.id === lv)!.twist?.rocks ?? [])].sort((a, b) => a - b), id);
const denied = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.hud.denied.value as number);

interface Seen { key: string; faction: string; lane: number; x: number; id: number }
const units = (page: Page): Promise<Seen[]> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
  .map((u: any) => ({ key: u.key, faction: u.faction, lane: u.lane, x: u.x, id: u.id })));
const plantOn = async (page: Page, lane: number, col: number): Promise<Seen | undefined> =>
  (await units(page)).find((u) => u.faction === 'plants' && u.lane === lane && Math.floor(u.x) === col);

/** The Desert's dressing on the stage: its look, the level's own rocks, the rock tiles, dust and its music. */
async function desertLook(page: Page, id: string): Promise<void> {
  const rocks = await rocksOf(page, id);
  expect(rocks.length, `${id} has rocks`).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('desert');
  expect(await page.evaluate(() => [...(window.__lvt as any).stage.lawn.lawnConfig.rocks].sort((a: number, b: number) => a - b))).toEqual(rocks);
  expect(await page.evaluate(() => [...(window.__lvt as any).session.controller.match.state.config.lawn.rocks].sort((a: number, b: number) => a - b))).toEqual(rocks);
  expect(await inScene(page, 'weather-dust')).toBe(true);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).audio.musicTheme)).toBe('desert');
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
 * Follows the level's card-then-tile glove by taps only (where the glove stands while it holds
 * still), with energy and the card's recharge topped up, until both steps are remembered.
 */
async function followGlove(page: Page, side: Side, id: string): Promise<string[]> {
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
    await page.evaluate((f) => {
      const me = (window.__lvt as any).session.controller.match.state.players[f];
      me.energy = Math.max(me.energy, 500);
      me.recharge = {};
    }, side);
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

/** Wins the running level (a little play, then the enemy base falls); stars, 30 coins a star. */
async function win(page: Page, side: Side, id: string): Promise<number> {
  const before = (await progress(page)).coins;
  await page.evaluate(() => (window.__lvt as any).fastForward(150));
  await forceResult(page, side === 'plants' ? 'zombies' : 'plants');
  const result = page.locator(`[data-level-result="${id}"]`);
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars, `${id} stars`).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(before + 30 * stars);
  expect((await progress(page))[side].stars[id]).toBe(stars);
  return stars;
}

/** From the result, the next level by its picture button. */
async function next(page: Page, id: string): Promise<void> {
  await press(page.locator(`[data-action="next-level"][data-next="${id}"]`));
  await waitLive(page);
  expect(await level(page)).toBe(id);
}

// ---- the gate ---------------------------------------------------------------------------------

test('the gate: world 3 is shut behind p2-7 / z2-7 (no stones, a tap refused) and opens with p2-8 / z2-8, on both sides', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await logIn(page);
  for (const side of ['plants', 'zombies'] as const) {
    const home = side === 'plants' ? 'p' : 'z';
    // One level short: the map opens on world 2; the arrow leads to a grey island with no stones.
    await graduate(page, side, 7);
    await toMap(page, side, 2);
    await expect(page.locator(`[data-stone="${home}2-8"]`)).toHaveAttribute('data-state', 'next');
    await expect(page.locator('[data-action="world-next"]')).toHaveAttribute('data-locked', '');
    await press(page.locator('[data-action="world-next"]'));
    const map = page.locator('[data-screen="map"]');
    await expect(map).toHaveAttribute('data-world', '3');
    await expect(map).toHaveAttribute('data-locked', '');
    await expect(page.locator('[data-stone]')).toHaveCount(0);
    await press(page.locator('[data-action="island-locked"]'));
    await expect(page.locator('[data-action="island-locked"]')).toHaveClass(/is-deny-a/);
    await expect(page.locator('[data-screen="level-card"]')).toHaveCount(0);
    // Home, and the last level won: the map opens on the Desert, p3-1 / z3-1 waiting.
    await press(page.locator('[data-screen="map"] [data-action="back"]'));
    await press(page.locator('[data-screen="play"] [data-action="back"]'));
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await graduate(page, side, 8);
    await toMap(page, side, 3);
    await expect(map).toHaveAttribute('data-arena', 'desert');
    await expect(map).not.toHaveAttribute('data-locked', '');
    await expect(page.locator(`[data-stone="${home}3-1"]`)).toHaveAttribute('data-state', 'next');
    await expect(page.locator(`[data-stone="${home}3-8"]`)).toHaveAttribute('data-kind', 'boss');
    await press(page.locator('[data-screen="map"] [data-action="back"]'));
    await press(page.locator('[data-screen="play"] [data-action="back"]'));
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
  }
  expect(await glContexts(page)).toBe(1);
});

// ---- Lukas, the plants ------------------------------------------------------------------------

test('Lukas: p3-1 holds on the rocks pan, a tap ends it; a tap on a rock buzzes and places nothing; p3-2; p3-3 reveals the Torchwood', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await logIn(page);
  await graduate(page, 'plants');
  await toMap(page, 'plants');
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-arena', 'desert');
  await expect(page.locator('[data-stone="p3-1"]')).toHaveAttribute('data-state', 'next');
  // What the Desert brings: the gifts on p3-3 and p3-6.
  await expect(page.locator('[data-stone="p3-3"] [data-unlock="torchwood"]')).toHaveCount(1);
  await expect(page.locator('[data-stone="p3-6"] [data-unlock="cherryBomber"]')).toHaveCount(1);
  // p3-1's card: the rocks picture beside the number.
  await press(page.locator('[data-stone="p3-1"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="p3-1"] [data-twist="rocks"]')).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await level(page)).toBe('p3-1');
  // The pan holds the match until a tap: the cards dimmed, Pause above the catcher, nothing planted.
  const catcher = page.locator('[data-twist="rocks"]');
  await expect(catcher).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null)).toBe('rocks');
  await expect(page.locator('[data-screen="battle"]')).toHaveClass(/is-twist/);
  await expect.poll(() => page.locator('.battle__bottom').evaluate((el) => getComputedStyle(el).filter)).toContain('brightness');
  const held = await tick(page);
  expect(held).toBeLessThanOrEqual(2);
  await desertLook(page, 'p3-1');
  await snap(page, 'p3-1-pan-start');
  // The camera moves along the boulders; a ghost Peashooter is refused on one.
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.stop ?? -1), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session.twistShow.group.getObjectByName('rock-refused')?.visible === true),
    { intervals: [16], timeout: 15_000 }).toBe(true);
  await snap(page, 'p3-1-pan-refused');
  // Pause works over the pan, and the pan is still there after Resume.
  await press(page.locator('[data-hud="pause"]'));
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await expect(catcher).toHaveCount(0);
  await press(page.locator('[data-screen="pause"] [data-action="resume"]'));
  await expect(catcher).toBeVisible();
  // Nobody taps: after 3 s the glove taps the lawn; the match is still held.
  await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
  expect(await tick(page)).toBe(held);
  // A tap ends it, and a tap on a rock does so too without a buzz or a plant.
  await tapAt(page, await tilePoint(page, 1, 4));
  await expect(catcher).toHaveCount(0);
  await expect(page.locator('[data-screen="battle"]')).not.toHaveClass(/is-twist/);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow ?? null)).toBeNull();
  await expect.poll(() => tick(page)).toBeGreaterThan(held + 10);
  expect(await denied(page)).toBe(0);
  expect((await units(page)).filter((u) => u.faction === 'plants')).toHaveLength(0);
  expect((await progress(page)).teached).toContain('p3-1.rocks');
  // The lawn again: a tap on a rock buzzes and places nothing; the tile beside it takes a plant.
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.rig.focusing as boolean), { timeout: 10_000 }).toBe(false);
  await pick(page, 'peashooter');
  const lit = await page.evaluate(() => {
    const mask: Uint8Array = (window.__lvt as any).session.controller.placeable;
    return [...mask.keys()].filter((i) => mask[i] === 1);
  });
  const rocks = await rocksOf(page, 'p3-1');
  for (const r of rocks) expect(lit, `rock ${r} is not lit`).not.toContain(Math.floor(r / 8) * 10 + (r % 8)); // rocks are lane*8+col, the mask lane*10+col
  expect(lit).toContain(16);
  await snap(page, 'p3-1-rock-unlit');
  const before = await denied(page);
  await tapAt(page, await tilePoint(page, 2, 5));
  await frames(page, 3);
  await expect.poll(() => denied(page)).toBe(before + 1);
  expect(await plantOn(page, 2, 5)).toBeUndefined();
  await tapAt(page, await tilePoint(page, 2, 4));
  await expect.poll(async () => (await plantOn(page, 2, 4))?.key).toBe('peashooter');
  // The zombies come past the rock: nothing stops them (the level plays by taps to a result).
  await win(page, 'plants', 'p3-1');
  await next(page, 'p3-2');
  await desertLook(page, 'p3-2');
  await expect(page.locator('[data-twist]')).toHaveCount(0); // the pan is taught once
  await win(page, 'plants', 'p3-2');
  await next(page, 'p3-3');
  await desertLook(page, 'p3-3');
  await win(page, 'plants', 'p3-3');
  // The Torchwood on the result's turntable; kept.
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="torchwood"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).plants.unlocked).toEqual(['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood']);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(map).toHaveAttribute('data-world', '3');
  await expect(page.locator('[data-stone="p3-3"] [data-unlock]')).toHaveCount(0);
  await expect(page.locator('[data-stone="p3-4"]')).toHaveAttribute('data-state', 'next');
  await press(page.locator('[data-stone="p3-4"]'));
  await expect(page.locator('[data-screen="level-card"] [data-dealt] [data-picture="torchwood"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));
  expect(await glContexts(page)).toBe(1);
  await keep(page, 'plants');
});

test('HELP on p3-1\'s card plays the rocks pan again', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page, 'plants');
  await toMap(page, 'plants');
  await press(page.locator('[data-stone="p3-1"]'));
  await press(page.locator('[data-screen="level-card"] [data-action="replay-tutorial"]'));
  await waitLive(page);
  await expect(page.locator('[data-twist="rocks"]')).toBeVisible();
  await press(page.locator('[data-twist="rocks"]'));
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  expect((await progress(page)).teached.filter((t) => t === 'p3-1.rocks')).toHaveLength(1);
  expect(await glContexts(page)).toBe(1);
});

test('Lukas: p3-4 teaches the Torchwood by the glove (card, then tile); p3-5; p3-6 reveals the Cherry Bomber; p3-7\'s glove for it comes only when the clump arrives', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page, 'plants');
  await toMap(page, 'plants');
  await startFromMap(page, 'p3-4');
  await desertLook(page, 'p3-4');
  expect(await followGlove(page, 'plants', 'p3-4')).toEqual(['p3-4.torch-card', 'p3-4.torch-tile']);
  expect(await plantOn(page, 2, 2).then((u) => u?.key)).toBe('torchwood');
  await win(page, 'plants', 'p3-4');
  await next(page, 'p3-5');
  await desertLook(page, 'p3-5');
  await win(page, 'plants', 'p3-5');
  await next(page, 'p3-6');
  await desertLook(page, 'p3-6');
  await win(page, 'plants', 'p3-6');
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="cherryBomber"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).plants.unlocked).toEqual(['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber']);
  await next(page, 'p3-7');
  await desertLook(page, 'p3-7');
  // The card is pointed at first; the match runs.
  const glove = page.locator('[data-tutorial] [data-glove]');
  await page.evaluate(() => { (window.__lvt as any).session.controller.match.state.players.plants.energy = 500; });
  await expect(glove).toHaveAttribute('data-glove-step', 'p3-7.cherry-card');
  await press(page.locator('[data-hud="tray"] [data-card="cherryBomber"]'));
  // The tile step waits: no glove, nothing held, no clump in front of the tile yet.
  await frames(page, 10);
  await expect(glove).toHaveCount(0);
  const near = (): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .filter((u: any) => u.faction === 'zombies' && u.lane === 2 && u.x - 4.5 >= 0 && u.x - 4.5 <= 2).length);
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
  expect(armed, 'the glove came with the clump').toBe(true);
  await expect(glove).toHaveAttribute('data-glove-step', 'p3-7.cherry-tile');
  expect(await near(), 'a foe is in front of the tile when the glove shows').toBeGreaterThan(0);
  const held = await tick(page);
  await frames(page, 20);
  expect(await tick(page)).toBe(held);
  await snap(page, 'p3-7-cherry-glove-with-clump');
  await tapAt(page, await tilePoint(page, 2, 4));
  await expect.poll(async () => (await plantOn(page, 2, 4))?.key).toBe('cherryBomber');
  await expect(page.locator('[data-tutorial]')).toHaveCount(0);
  expect((await progress(page)).teached).toEqual(expect.arrayContaining(['p3-7.cherry-card', 'p3-7.cherry-tile']));
  await win(page, 'plants', 'p3-7');
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await backToDesert(page);
  await expect(page.locator('[data-stone="p3-8"]')).toHaveAttribute('data-state', 'next');
  expect(await glContexts(page)).toBe(1);
  await keep(page, 'plants');
});

test('a reload mid-world keeps the Desert for Lukas: the map opens on it, the same stars, unlocks and lessons, p3-8 next', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page, 'plants');
  const before = await progress(page);
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  const after = await progress(page);
  expect(after).toEqual(before);
  for (let n = 1; n <= 7; n++) expect(after.plants.stars[`p3-${n}`]).toBeGreaterThanOrEqual(1);
  expect(after.plants.unlocked).toEqual(['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber']);
  expect(after.teached).toEqual(expect.arrayContaining(['p3-1.rocks', 'p3-4.torch-card', 'p3-4.torch-tile', 'p3-7.cherry-card', 'p3-7.cherry-tile']));
  await toMap(page, 'plants');
  for (let n = 1; n <= 7; n++) await expect(page.locator(`[data-stone="p3-${n}"]`)).toHaveAttribute('data-stars', String(after.plants.stars[`p3-${n}`]));
  await expect(page.locator('[data-stone="p3-8"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="p3-8"]')).toHaveAttribute('data-kind', 'boss');
  await keep(page, 'plants');
});

interface Pharaoh {
  slam: boolean; slamShown: boolean; summon: boolean; shield: boolean; sand: boolean; strike: boolean; strikeShown: boolean;
  dither: boolean; phase2: boolean; eyes: boolean; mummies: number; blinded: number; boulders: boolean; needles: boolean; defeated: boolean;
}

test('p3-8: the Sand Pharaoh - entrance card, boss bar with its face, staff slam, Desert Zombies, the sand swirl at half health, phase 2\'s sandstorm and mummies, defeat; stars and coins', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page, 'plants');
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
  await toMap(page, 'plants');
  await startFromMap(page, 'p3-8');
  await desertLook(page, 'p3-8');
  // The entrance card (held by the hook) with the Pharaoh's face, then the bar with its face.
  const intro = page.locator('[data-hud="boss-intro"].hud-boss-intro--sandPharaoh');
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(5));
    return intro.count();
  }, { timeout: 30_000 }).toBe(1);
  await expect(intro).toBeVisible();
  await snap(page, 'pharaoh-entrance-card');
  await press(intro);
  await expect(intro).toHaveCount(0);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = false; });
  const bar = page.locator('[data-hud="boss"].hud-boss--sandPharaoh');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.hud-boss__face')).toBeVisible();
  // Watch the match: every step's events, and what the views show.
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const c = lvt.session.controller;
    const f = {
      slam: false, slamShown: false, summon: false, shield: false, sand: false, strike: false, strikeShown: false,
      dither: false, phase2: false, eyes: false, mummies: 0, blinded: 0, boulders: false, needles: false, defeated: false,
    };
    lvt.__fight = f;
    const drawn = (o: any): boolean => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const step = c.match.step.bind(c.match);
    c.match.step = (commands: unknown) => {
      const events = step(commands);
      const s = c.match.state;
      const boss = s.units.find((u: any) => u.key === 'sandPharaoh');
      const fx = lvt.session.view.bossFx;
      for (const e of events) {
        if (e.type === 'bossPattern' && e.kind === 'slam') f.slam = true;
        if (e.type === 'bossPattern' && e.kind === 'summon') f.summon = true;
        if (e.type === 'bossPattern' && e.kind === 'shield') f.shield = true;
        if (e.type === 'bossStrike' && e.windup) f.strike = true;
        if (e.type === 'bossDefeated') f.defeated = true;
      }
      if (fx.windingUp) f.slamShown = true;
      if (fx.striking) f.strikeShown = true;
      if (boss && boss.phase >= 1) f.phase2 = true;
      let wraps = 0;
      lvt.stage.scene.traverse((o: any) => {
        if (!o.parent) return;
        if (o.name === 'boss-sand-layer' && drawn(o)) f.sand = true;
        if (o.name === 'boss-strike-fill' && drawn(o)) f.dither = true;
        if (o.name === 'boss-boulder' && drawn(o)) f.boulders = true;
        if (o.name === 'projectile-needle') f.needles = true;
        if (o.name === 'boss-mummy-wrap' && drawn(o)) wraps += 1;
      });
      f.mummies = Math.max(f.mummies, wraps);
      const model = boss ? lvt.session.view.unit(boss.id)?.model.root : null;
      const glow = model?.getObjectByName('glowEyes');
      if (glow && drawn(glow)) f.eyes = true;
      f.blinded = Math.max(f.blinded, s.units.filter((u: any) => u.faction === 'plants' && u.blind > 0).length);
      return events;
    };
  });
  const fight = (): Promise<Pharaoh> => page.evaluate(() => ({ ...(window.__lvt as any).__fight }));
  // A garden on every lane (the sandstorm picks any three plants): Peashooters, pults behind them,
  // walls in front, none on a rock tile (energy topped up; placed straight into the match).
  const garden = (): Promise<void> => page.evaluate(() => {
    const c = (window.__lvt as any).session.controller;
    const rocks = new Set<number>(c.match.state.config.lawn.rocks);
    if (c.match.state.winner !== null) return;
    const put = (unit: string, lane: number, col: number): void => {
      if (rocks.has(lane * 8 + col)) return;
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
  await garden();
  // Phase 1: the staff slam and a summon of Desert Zombies.
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(20));
    await frames(page, 1);
    const f = await fight();
    if (f.slamShown) await snap(page, 'pharaoh-slam-windup');
    return f.slam && f.slamShown && f.summon;
  }, { timeout: 90_000 }).toBe(true);
  // To half health: the sand swirl goes up (sand layers, never the glass dome).
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'sandPharaoh');
    boss.hp = Math.ceil(boss.maxHp * 0.505);
  });
  await expect.poll(async () => {
    await garden();
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    await frames(page, 1);
    const f = await fight();
    return f.shield && f.sand;
  }, { timeout: 60_000 }).toBe(true);
  await expect(bar).toHaveClass(/is-shielded/);
  expect(await page.evaluate(() => (window.__lvt as any).stage.scene.getObjectByName('boss-shield-dome')?.visible ?? false)).toBe(false);
  await snap(page, 'pharaoh-sand-swirl');
  // Phase 2: its eyes glow, the sandstorm warns three plants (a dither, never a rock), mummies walk and plants are blinded.
  await expect.poll(async () => {
    await garden();
    await page.evaluate(() => {
      const lvt = window.__lvt as any;
      const boss = lvt.session.controller.match.state.units.find((u: any) => u.key === 'sandPharaoh');
      if (boss) boss.hp = Math.max(boss.hp, Math.ceil(boss.maxHp / 3));
      lvt.fastForward(10);
    });
    await frames(page, 1);
    const f = await fight();
    if (f.strikeShown && f.dither) await snap(page, 'pharaoh-sandstorm-warning');
    return f.phase2 && f.eyes && f.strike && f.strikeShown && f.dither && f.mummies > 0 && f.blinded > 0;
  }, { timeout: 150_000 }).toBe(true);
  const f2 = await fight();
  expect(f2.boulders, 'the Pharaoh drops no boulders').toBe(false);
  expect(f2.needles, 'the Pharaoh throws no needles').toBe(false);
  await snap(page, 'pharaoh-phase2');
  // Down to its last bit of health; the garden finishes it.
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'sandPharaoh');
    if (boss) { boss.hp = Math.min(boss.hp, 30); boss.shieldLeft = 0; }
  });
  const coins = (await progress(page)).coins;
  // (No garden here: a place command stepped straight into the match could be the step that ends it,
  // and the controller, which publishes the result, would never see the end.)
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(10));
    return (await fight()).defeated;
  }, { timeout: 90_000 }).toBe(true);
  await snap(page, 'pharaoh-defeat');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner)).toBe('plants');
  const result = page.locator('[data-level-result="p3-8"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(coins + 30 * stars);
  // The Desert is no longer the last world (the Tundra follows): the next-level button leads on to p4-1.
  await expect(page.locator('[data-action="next-level"]')).toHaveCount(1);
  await expect(page.locator('[data-action="next-level"]')).toHaveAttribute('data-next', 'p4-1');
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await backToDesert(page);
  await expect(page.locator('[data-stone="p3-8"]')).toHaveAttribute('data-stars', String(stars));
  await expect(page.locator('[data-stone][data-state="done"]')).toHaveCount(8);
  expect(await glContexts(page)).toBe(1);
  await keep(page, 'plants');
});

// ---- Toby, the zombies ------------------------------------------------------------------------

test('Toby: z3-1 holds on the rocks pan (the Brain Eater goes first), a tap ends it, the level plays by taps; z3-2; z3-3 reveals the Necromancer', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await logIn(page);
  await graduate(page, 'zombies');
  await toMap(page, 'zombies');
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-arena', 'desert');
  await expect(page.locator('[data-stone="z3-1"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="z3-3"] [data-unlock="necromancer"]')).toHaveCount(1);
  await expect(page.locator('[data-stone="z3-6"] [data-unlock="tridentZombie"]')).toHaveCount(1);
  await press(page.locator('[data-stone="z3-1"]'));
  await expect(page.locator('[data-screen="level-card"][data-level="z3-1"] [data-twist="rocks"]')).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await level(page)).toBe('z3-1');
  const catcher = page.locator('[data-twist="rocks"]');
  await expect(catcher).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null)).toBe('rocks');
  expect(await page.evaluate(() => (window.__lvt as any).session.twistShow.zombieFirst)).toBe(true);
  await expect(page.locator('[data-screen="battle"]')).toHaveClass(/is-twist/);
  const held = await tick(page);
  expect(held).toBeLessThanOrEqual(2);
  await desertLook(page, 'z3-1');
  await snap(page, 'z3-1-pan-start');
  await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
  expect(await tick(page)).toBe(held);
  // A tap anywhere (the sky) ends it and sends nothing.
  const size = page.viewportSize()!;
  await tapAt(page, { x: Math.round(size.width / 2), y: Math.round(size.height * 0.2) });
  await expect(catcher).toHaveCount(0);
  await expect(page.locator('[data-screen="battle"]')).not.toHaveClass(/is-twist/);
  await expect.poll(() => tick(page)).toBeGreaterThan(held + 10);
  expect((await progress(page)).teached).toContain('z3-1.rocks');
  expect((await units(page)).filter((u) => u.faction === 'zombies')).toHaveLength(0);
  // By taps: a Brain Eater down the thin rocky lane 0.
  await place(page, 'brainEater', 0, 9);
  await expect.poll(async () => (await units(page)).filter((u) => u.faction === 'zombies').length).toBe(1);
  await win(page, 'zombies', 'z3-1');
  await next(page, 'z3-2');
  await desertLook(page, 'z3-2');
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  await win(page, 'zombies', 'z3-2');
  await next(page, 'z3-3');
  await desertLook(page, 'z3-3');
  await win(page, 'zombies', 'z3-3');
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="necromancer"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).zombies.unlocked).toEqual(['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie', 'necromancer']);
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await expect(map).toHaveAttribute('data-world', '3');
  await expect(page.locator('[data-stone="z3-3"] [data-unlock]')).toHaveCount(0);
  await expect(page.locator('[data-stone="z3-4"]')).toHaveAttribute('data-state', 'next');
  await press(page.locator('[data-stone="z3-4"]'));
  await expect(page.locator('[data-screen="level-card"] [data-dealt] [data-picture="necromancer"]')).toBeVisible();
  await press(page.locator('[data-action="close-card"]'));
  expect(await glContexts(page)).toBe(1);
  await keep(page, 'zombies');
});

test('HELP on z3-1\'s card plays the rocks pan again', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page, 'zombies');
  await toMap(page, 'zombies');
  await press(page.locator('[data-stone="z3-1"]'));
  await press(page.locator('[data-screen="level-card"] [data-action="replay-tutorial"]'));
  await waitLive(page);
  await expect(page.locator('[data-twist="rocks"]')).toBeVisible();
  await press(page.locator('[data-twist="rocks"]'));
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  expect((await progress(page)).teached.filter((t) => t === 'z3-1.rocks')).toHaveLength(1);
  expect(await glContexts(page)).toBe(1);
});

test('Toby: z3-4 teaches the Necromancer by the glove (card, then lane); z3-5; z3-6 reveals the Trident Zombie; z3-7 teaches it', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page, 'zombies');
  await toMap(page, 'zombies');
  await startFromMap(page, 'z3-4');
  await desertLook(page, 'z3-4');
  expect(await followGlove(page, 'zombies', 'z3-4')).toEqual(['z3-4.necro-card', 'z3-4.necro-lane']);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .some((u: { key: string; lane: number }) => u.key === 'necromancer' && u.lane === 2))).toBe(true);
  await win(page, 'zombies', 'z3-4');
  await next(page, 'z3-5');
  await desertLook(page, 'z3-5');
  await win(page, 'zombies', 'z3-5');
  await next(page, 'z3-6');
  await desertLook(page, 'z3-6');
  await win(page, 'zombies', 'z3-6');
  await expect(page.locator('[data-screen="result"][data-step="unlock"] [data-unlock="tridentZombie"]')).toBeVisible({ timeout: 15_000 });
  expect((await progress(page)).zombies.unlocked).toEqual(['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie']);
  await next(page, 'z3-7');
  await desertLook(page, 'z3-7');
  expect(await followGlove(page, 'zombies', 'z3-7')).toEqual(['z3-7.trident-card', 'z3-7.trident-lane']);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .some((u: { key: string; lane: number }) => u.key === 'tridentZombie' && u.lane === 1))).toBe(true);
  await win(page, 'zombies', 'z3-7');
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await backToDesert(page);
  await expect(page.locator('[data-stone="z3-8"]')).toHaveAttribute('data-state', 'next');
  expect(await glContexts(page)).toBe(1);
  await keep(page, 'zombies');
});

test('a reload mid-world keeps the Desert for Toby: the map opens on it, the same stars, unlocks and lessons, z3-8 next', async ({ page }) => {
  test.setTimeout(120_000);
  await resume(page, 'zombies');
  const before = await progress(page);
  await page.reload();
  await page.evaluate(() => window.__lvt.ready);
  await logIn(page);
  const after = await progress(page);
  expect(after).toEqual(before);
  for (let n = 1; n <= 7; n++) expect(after.zombies.stars[`z3-${n}`]).toBeGreaterThanOrEqual(1);
  expect(after.zombies.unlocked).toEqual(['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie']);
  expect(after.teached).toEqual(expect.arrayContaining(['z3-1.rocks', 'z3-4.necro-card', 'z3-4.necro-lane', 'z3-7.trident-card', 'z3-7.trident-lane']));
  await toMap(page, 'zombies');
  for (let n = 1; n <= 7; n++) await expect(page.locator(`[data-stone="z3-${n}"]`)).toHaveAttribute('data-stars', String(after.zombies.stars[`z3-${n}`]));
  await expect(page.locator('[data-stone="z3-8"]')).toHaveAttribute('data-state', 'next');
  await expect(page.locator('[data-stone="z3-8"]')).toHaveAttribute('data-kind', 'boss');
  await keep(page, 'zombies');
});

interface Cactus {
  barrage: boolean; needles: boolean; acorns: boolean; frozen: boolean; marks: boolean; summon: boolean; shield: boolean; plates: boolean;
  phase2: boolean; strike: boolean; strikeShown: boolean; boulders: boolean; rings: boolean; tiles: number;
  defeated: boolean;
}

/** Zombies down every lane, never more than a child's crowd at once (see tundra.spec). */
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

test('z3-8: the Cactus King - entrance card, boss bar with its face, needles, Kernel-pult summons, the spine plates at half health, phase 2\'s boulder rockfall, Walnuts, defeat; stars and coins', async ({ page }) => {
  test.setTimeout(300_000);
  await resume(page, 'zombies');
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
  await toMap(page, 'zombies');
  await startFromMap(page, 'z3-8');
  await desertLook(page, 'z3-8');
  const intro = page.locator('[data-hud="boss-intro"].hud-boss-intro--cactusKing');
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(5));
    return intro.count();
  }, { timeout: 30_000 }).toBe(1);
  await expect(intro).toBeVisible();
  await snap(page, 'cactus-entrance-card');
  await press(intro);
  await expect(intro).toHaveCount(0);
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = false; });
  const bar = page.locator('[data-hud="boss"].hud-boss--cactusKing');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.hud-boss__face')).toBeVisible();
  // It guards the plant base on the middle lane; no rock under its column.
  const stand = await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    return { lane: s.config.boss.lane as number, key: s.config.boss.key as string, rocks: [...s.config.lawn.rocks] as number[] };
  });
  expect(stand.key).toBe('cactusKing');
  expect(stand.rocks.filter((r) => r % 8 === 0)).toEqual([]);
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const c = lvt.session.controller;
    const f = {
      barrage: false, needles: false, acorns: false, frozen: false, marks: false, summon: false, shield: false, plates: false,
      phase2: false, strike: false, strikeShown: false, boulders: false, rings: false, tiles: 0,
      defeated: false,
    };
    lvt.__fight = f;
    const drawn = (o: any): boolean => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const step = c.match.step.bind(c.match);
    c.match.step = (commands: unknown) => {
      const events = step(commands);
      const s = c.match.state;
      const boss = s.units.find((u: any) => u.key === 'cactusKing');
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
      lvt.stage.scene.traverse((o: any) => {
        if (!o.parent) return;
        if (o.name === 'projectile-needle') f.needles = true;
        if (o.name === 'projectile-acorn') f.acorns = true;
        if (o.name === 'projectile-frozen-melon') f.frozen = true;
        if (o.name === 'boss-acorn-mark' && drawn(o)) f.marks = true;
        if (o.name === 'boss-boulder' && drawn(o)) f.boulders = true;
        if (o.name === 'boss-boulder-ring' && drawn(o)) f.rings = true;
      });
      return events;
    };
  });
  const fight = (): Promise<Cactus> => page.evaluate(() => ({ ...(window.__lvt as any).__fight }));
  // Phase 1: a barrage of needles (each with its landing ring, never an acorn or a frozen melon) and Kernel-pult summons.
  await expect.poll(async () => {
    await sendWave(page);
    await page.evaluate(() => (window.__lvt as any).fastForward(30));
    await frames(page, 1);
    const f = await fight();
    if (f.needles && f.marks) await snap(page, 'cactus-needles');
    return f.barrage && f.needles && f.marks && f.summon;
  }, { timeout: 90_000 }).toBe(true);
  expect((await fight()).acorns).toBe(false);
  expect((await fight()).frozen).toBe(false);
  // To half health: the spine plates clap shut (plates, never a dome).
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'cactusKing');
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
  await snap(page, 'cactus-spine-plates');
  // Phase 2: boulders over three warned zombie tiles, in orange rings, then the blow.
  await expect.poll(async () => {
    await sendWave(page);
    await page.evaluate(() => {
      const lvt = window.__lvt as any;
      const boss = lvt.session.controller.match.state.units.find((u: any) => u.key === 'cactusKing');
      if (boss) boss.hp = Math.max(boss.hp, Math.ceil(boss.maxHp / 3));
      lvt.fastForward(10);
    });
    await frames(page, 1);
    const f = await fight();
    if (f.strikeShown && f.boulders && f.rings) await snap(page, 'cactus-rockfall-warning');
    return f.phase2 && f.strike && f.strikeShown && f.boulders && f.rings;
  }, { timeout: 150_000 }).toBe(true);
  expect((await fight()).tiles).toBe(3);
  await snap(page, 'cactus-phase2');
  // Down to its last bit of health; the zombies finish it.
  await page.evaluate(() => {
    const s = (window.__lvt as any).session.controller.match.state;
    const boss = s.units.find((u: any) => u.key === 'cactusKing');
    if (boss) { boss.hp = Math.min(boss.hp, 30); boss.shieldLeft = 0; }
  });
  const coins = (await progress(page)).coins;
  await expect.poll(async () => {
    await sendWave(page);
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    return (await fight()).defeated;
  }, { timeout: 120_000 }).toBe(true);
  await snap(page, 'cactus-defeat');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.winner)).toBe('zombies');
  const result = page.locator('[data-level-result="z3-8"]');
  await expect(result).toBeVisible({ timeout: 30_000 });
  const stars = Number(await result.getAttribute('data-stars'));
  expect(stars).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`.lresult__stars[data-lit="${stars}"]`)).toBeVisible();
  await expect(page.locator(`[data-coins-earned="${30 * stars}"]`)).toBeVisible();
  expect((await progress(page)).coins).toBe(coins + 30 * stars);
  // The Meadow follows the Desert for Toby: the next-level button leads on to z4-1.
  await expect(page.locator('[data-action="next-level"]')).toHaveCount(1);
  await expect(page.locator('[data-action="next-level"]')).toHaveAttribute('data-next', 'z4-1');
  await press(page.locator('[data-screen="result"] [data-action="map"]'));
  await backToDesert(page);
  await expect(page.locator('[data-stone="z3-8"]')).toHaveAttribute('data-stars', String(stars));
  await expect(page.locator('[data-stone][data-state="done"]')).toHaveCount(8);
  expect(await glContexts(page)).toBe(1);
  await keep(page, 'zombies');
});

// ---- ten round trips a side -------------------------------------------------------------------

for (const [side, ids] of [['plants', ['p3-5', 'p3-3']], ['zombies', ['z3-5', 'z3-3']]] as const) {
  test(`ten Desert level <-> map round trips (${side}): one WebGL context, the GPU's geometry count flat`, async ({ page }) => {
    test.setTimeout(300_000);
    await resume(page, side);
    const geometries = (): Promise<number> => page.evaluate(() => (window.__lvt as any).renderer.webgl.info.memory.geometries as number);
    const counts: number[] = [];
    await toMap(page, side);
    for (let round = 0; round < 10; round++) {
      await backToDesert(page); // the map opens on the next world after a result
      await expect.poll(() => page.evaluate(() => (window.__lvt as any).stage.lawn.world)).toBe('desert');
      await frames(page, 3);
      counts.push(await geometries());
      // Two scripted levels with no computer: what stands on the lawn after a minute is the same every visit.
      const id = ids[round % 2]!;
      await startFromMap(page, id);
      expect(await page.evaluate(() => [...(window.__lvt as any).session.controller.match.state.config.lawn.rocks].sort((a: number, b: number) => a - b))).toEqual(await rocksOf(page, id));
      await page.evaluate(() => (window.__lvt as any).fastForward(60));
      await forceResult(page, side === 'plants' ? 'zombies' : 'plants');
      await expect(page.locator(`[data-level-result="${id}"]`)).toBeVisible({ timeout: 30_000 });
      await press(page.locator('[data-screen="result"] [data-action="map"]'));
      await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
      expect(await glContexts(page), `round ${round + 1}`).toBe(1);
    }
    for (const n of counts.slice(2)) expect(n, `geometries on the map: ${counts.join(', ')}`).toBe(counts[2]);
  });
}

// ---- a five-year-old's walk, by taps only -----------------------------------------------------
// Toby cannot read: every move is a tap on a card picture and a tap on a lane. This plays z3-1..z3-3
// and the Cactus King in real time (no fast-forward, no cheating energy): each second it taps the
// next card it can afford and then a lane the way a small child does (the lane nearest its hand,
// favouring none), and records what it saw. The findings go to the console and, with
// LVT_DESERT_SHOTS, the pictures to that folder. Run on request: LVT_DESERT_WALK=1 npx playwright
// test e2e/desert.spec.ts --project ipad -g walk
test('walk: a five-year-old by taps only through z3-1, z3-2, z3-3 and the Cactus King', async ({ page }) => {
  test.skip(process.env.LVT_DESERT_WALK === undefined || test.info().project.name !== 'ipad', 'on request, on the iPad project');
  test.setTimeout(1_800_000);
  await open(page);
  await logIn(page);
  await graduate(page, 'zombies');
  await toMap(page, 'zombies');
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
    const order = ['brainEater', 'skeletonWarrior', 'desertZombie', 'veryFastWalker', 'cowboyZombie', 'hotTopic', 'skeletonArcher', 'necromancer', 'tridentZombie'];
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
        // A tap on the card already in hand keeps it in hand (zombie side), so this re-tap never costs a send; any refusal counted below is a real one.
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
      say(`${id} try ${attempt}: ${stars} stars; picture buttons on the result: next ${await page.locator('[data-action="next-level"]').count()}, replay ${await page.locator('[data-screen="result"] [data-action="replay"]').count()}, map ${await page.locator('[data-screen="result"] [data-action="map"]').count()}`);
      if (Number(stars) >= 1) return;
      await press(page.locator('[data-screen="result"] [data-action="replay"]'));
      await waitLive(page);
    }
  };
  // LVT_DESERT_WALK=late: only z3-3 and the Cactus King (z3-1 and z3-2 won already, for a short second run).
  const late = process.env.LVT_DESERT_WALK === 'late';
  if (late) {
    await page.evaluate(() => (window.__lvt as any).players.update((p: any) => ({ ...p, zombies: { ...p.zombies, stars: { ...p.zombies.stars, 'z3-1': 2, 'z3-2': 2 } } })));
    await page.evaluate(() => (window.__lvt as any).go({ name: 'map', side: 'zombies', world: 3 }));
    await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  }
  for (const id of late ? ['z3-3'] : ['z3-1', 'z3-2', 'z3-3']) {
    if (id === 'z3-1' || late) await startFromMap(page, id);
    say(`${id}: ${id === 'z3-1' || late ? 'started from the map by two taps (stone, START)' : 'started by the result\'s next-level picture button'}`);
    await snap(page, `walk-${id}-start`);
    await tryUntilWon(id, 420);
    if (await page.locator(`[data-level-result="${id}"]`).count() === 0) break;
    if (id === 'z3-3') {
      await press(page.locator('[data-screen="result"] [data-action="map"]'));
      break;
    }
    const nextId = id === 'z3-1' ? 'z3-2' : 'z3-3';
    if (await page.locator('[data-action="next-level"]').count() > 0) await next(page, nextId);
    else { // lost three times: the map picture, then the next stone (the walk goes on; this is a finding)
      say(`${id}: not won in three tries; on to ${nextId} by the map`);
      await press(page.locator('[data-screen="result"] [data-action="map"]'));
      await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
      await page.evaluate(([i]) => (window.__lvt as any).players.update((p: any) => ({ ...p, zombies: { ...p.zombies, stars: { ...p.zombies.stars, [i as string]: 1 } } })), [id] as const);
      await page.evaluate(() => (window.__lvt as any).go({ name: 'map', side: 'zombies', world: 3 }));
      await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
      await startFromMap(page, nextId);
    }
  }
  // The Cactus King: the rest of the walk goes straight to its level (z3-4..z3-7 are covered above).
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const stars = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`z3-${i + 1}`, 2]));
    lvt.players.update((p: any) => ({ ...p, zombies: { ...p.zombies, stars: { ...p.zombies.stars, ...stars }, unlocked: [...p.zombies.unlocked, 'necromancer', 'tridentZombie'] },
      teached: [...p.teached, 'z3-4.necro-card', 'z3-4.necro-lane', 'z3-7.trident-card', 'z3-7.trident-lane'] }));
  });
  await page.evaluate(() => (window.__lvt as any).go({ name: 'map', side: 'zombies', world: 3 }));
  await expect.poll(() => page.locator('[data-stone][data-placed]').count()).toBe(8);
  await startFromMap(page, 'z3-8');
  say('z3-8: the Cactus King; entrance card shows on its own (no tap needed to read it)');
  await snap(page, 'walk-z3-8-start');
  await tryUntilWon('z3-8', 600);
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
  for (const side of ['plants', 'zombies'] as const) {
    const l = letter(side);
    await graduate(page, side);
    await page.evaluate((side) => {
      const lvt = window.__lvt as any;
      const stars = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`${side === 'plants' ? 'p' : 'z'}3-${i + 1}`, 2]));
      lvt.players.update((p: any) => ({ ...p, [side]: { ...p[side], stars: { ...p[side].stars, ...stars }, unlocked: side === 'plants' ? [...p.plants.unlocked, 'torchwood', 'cherryBomber'] : [...p.zombies.unlocked, 'necromancer', 'tridentZombie'] }, teached: (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((d) => (d.teaches ?? []).map((t) => t.id)) }));
    }, side);
    await go({ name: 'play' });
    await go({ name: 'map', side, world: 3 });
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).map?.isOpen)).toBe(true);
    await frames(page, 20);
    await shoot(`map-${side}-world3`);
    await go({ name: 'map', side, world: 3, card: `${l}3-1` });
    await frames(page, 10);
    await shoot(`card-${l}3-1-rocks`);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const id = `${l}3-${n}`;
      await go({ name: 'map', side, world: 3, card: id });
      await page.locator('[data-action="start-level"]').click();
      await waitLive(page);
      await page.evaluate((f) => {
        const lvt = window.__lvt as any;
        const c = lvt.session.controller;
        const dealt: string[] = c.match.state.config.cards[f];
        const rocks = new Set<number>(c.match.state.config.lawn.rocks);
        for (const lane of [0, 1, 2, 3, 4]) {
          c.match.state.players[f].energy = 5000;
          c.match.state.players[f].recharge = {};
          const unit = dealt[lane % dealt.length]!;
          const col = f === 'plants' ? (rocks.has(lane * 8 + 3) ? 2 : 3) : 9;
          c.match.step([{ type: 'place', faction: f, unit, lane, col }]);
        }
        lvt.fastForward(30 * 6);
      }, side);
      await shoot(`level-${id}`);
      await quit();
    }
  }
});
