import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { frames, glContexts, logIn, openTitle, tilePoint, waitLive } from './helpers';

// Worlds machinery Task 9: each lawn twist in a level played by taps. The real levels of worlds
// 2–5 do not exist yet, so the stand-in worlds on the debug hook (`__lvt.previewWorlds`, copies of
// world 1 with their arena's twist) are opened from the map by taps:
//   plants world 2 = Meadow, fog · world 3 = Desert, rocks [13, 21] (lane × 8 + col) ·
//   world 5 = Citadel, lava [13, 24] (lane × 10 + col); zombies world 2 = Tundra, ice lanes 1 and 3.
// The copies are of p1-1 (Peashooters only, Brain Eaters down lane 2 from 20 s) and z1-1 (Brain
// Eaters against Peashooters on (1,2) and (3,2)). Energy and the card's recharge are topped up
// by the test so that each placement is one tap on the card and one on the tile.

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

async function tapAt(page: Page, at: { x: number; y: number }): Promise<void> {
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/**
 * Lukas, with every world-1 level won and every lesson learnt, the stand-in worlds 2–5 on the map;
 * the side's map (it opens on the next level's world), arrows back to `world`, its level 1 started.
 */
async function playStandIn(page: Page, side: 'plants' | 'zombies', world: 2 | 3 | 4 | 5): Promise<void> {
  await openTitle(page);
  await logIn(page);
  await page.evaluate(([s, w]) => {
    const lvt = window.__lvt as any;
    lvt.previewWorlds(true, [2, 3, 4, 5]);
    const l = s === 'plants' ? 'p' : 'z';
    // Every level before world `w`'s first won: the map opens on world w.
    const stars: Record<string, number> = {};
    for (let k = 1; k < w; k++) for (let n = 1; n <= 8; n++) stars[`${l}${k}-${n}`] = 2;
    const ids = (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((d) => (d.teaches ?? []).map((t) => t.id));
    lvt.players.update((p: any) => ({ ...p, teached: ids, [s]: { ...p[s], stars } }));
  }, [side, world] as const);
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-world', String(world));
  const id = `${side === 'plants' ? 'p' : 'z'}${world}-1`;
  await expect.poll(() => page.locator(`[data-stone="${id}"][data-placed]`).count()).toBe(1);
  await press(page.locator(`[data-stone="${id}"]`));
  await expect(page.locator(`[data-screen="level-card"][data-level="${id}"]`)).toBeVisible();
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
  expect(await page.evaluate(() => (window.__lvt as any).screen.options.level)).toBe(id);
}

/** Tops up energy and `card`'s recharge, then picks it from the tray by a tap. */
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

interface Seen { key: string; faction: string; lane: number; x: number; hp: number; burn: number; id: number }
const units = (page: Page): Promise<Seen[]> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
  .map((u: any) => ({ key: u.key, faction: u.faction, lane: u.lane, x: u.x, hp: u.hp, burn: u.burn, id: u.id })));
const plantOn = async (page: Page, lane: number, col: number): Promise<Seen | undefined> =>
  (await units(page)).find((u) => u.faction === 'plants' && u.lane === lane && Math.floor(u.x) === col);
const lawnWorld = (page: Page): Promise<string> => page.evaluate(() => (window.__lvt as any).stage.lawn.world as string);
/** The tiles lit for the picked card, as `lane * 10 + col`. */
const lit = (page: Page): Promise<number[]> => page.evaluate(() => {
  const mask: Uint8Array = (window.__lvt as any).session.controller.placeable;
  return [...mask.keys()].filter((i) => mask[i] === 1);
});

test('rocks: a rock tile is not lit for a picked card and refuses a plant tapped onto it; the tile beside it takes one', async ({ page }) => {
  test.setTimeout(120_000);
  await playStandIn(page, 'plants', 3);
  await expect.poll(() => lawnWorld(page)).toBe('desert');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.rocks)).toEqual([13, 21]);
  await pick(page, 'peashooter');
  // Rocks 13 and 21 are (1,5) and (2,5): unlit; the plant columns around them are lit.
  await expect.poll(async () => (await lit(page)).length).toBe(38);
  const shown = await lit(page);
  expect(shown).not.toContain(15);
  expect(shown).not.toContain(25);
  expect(shown).toContain(14);
  expect(shown).toContain(16);
  const denied = (): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.hud.denied.value as number);
  const before = await denied();
  await tapAt(page, await tilePoint(page, 1, 5));
  await frames(page, 3);
  expect(await plantOn(page, 1, 5)).toBeUndefined();
  await expect.poll(denied).toBe(before + 1);
  await place(page, 'peashooter', 1, 4);
  await expect.poll(async () => (await plantOn(page, 1, 4))?.key).toBe('peashooter');
  expect(await glContexts(page)).toBe(1);
});

test('fog: a Peashooter at the back fades its peas (a puff each) and leaves the base alone; one at the front hurts the base', async ({ page }) => {
  test.setTimeout(120_000);
  await playStandIn(page, 'plants', 2);
  await expect.poll(() => lawnWorld(page)).toBe('meadow');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.fog)).toBe(5);
  // Every faded shot (the sim's event) and every puff the battle view makes for one.
  await page.evaluate(() => {
    const lvt = window.__lvt as any;
    const c = lvt.session.controller;
    const step = c.step.bind(c);
    c.__faded = 0;
    c.step = () => {
      const events = step();
      for (const e of events) if (e.type === 'projectileFaded') c.__faded += 1;
      return events;
    };
    const fx = lvt.session.view.fx;
    const puff = fx.puff.bind(fx);
    lvt.session.view.__puffs = 0;
    fx.puff = (...a: unknown[]) => { lvt.session.view.__puffs += 1; return puff(...a); };
  });
  const read = (): Promise<{ faded: number; puffs: number; base: number }> => page.evaluate(() => {
    const s = (window.__lvt as any).session;
    return { faded: s.controller.__faded, puffs: s.view.__puffs, base: s.controller.match.state.baseHp.zombies };
  });
  await place(page, 'peashooter', 0, 0);
  await expect.poll(async () => (await plantOn(page, 0, 0))?.key).toBe('peashooter');
  const start = await read();
  // Ten seconds of peas down an empty lane 0: every one fades five tiles out.
  await page.evaluate(() => (window.__lvt as any).fastForward(300));
  const back = await read();
  expect(back.faded).toBeGreaterThanOrEqual(3);
  expect(back.puffs).toBe(back.faded);
  expect(back.base).toBe(start.base);
  // A Peashooter on column 6 of lane 4: the base is inside its five tiles.
  await place(page, 'peashooter', 4, 6);
  await expect.poll(async () => (await plantOn(page, 4, 6))?.key).toBe('peashooter');
  await page.evaluate(() => (window.__lvt as any).fastForward(300));
  expect((await read()).base).toBeLessThan(start.base);
  expect(await glContexts(page)).toBe(1);
});

test('ice: a Brain Eater sent down an icy lane overtakes one sent a moment earlier down a plain lane', async ({ page }) => {
  test.setTimeout(120_000);
  await playStandIn(page, 'zombies', 2);
  await expect.poll(() => lawnWorld(page)).toBe('tundra');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.ice.lanes)).toEqual([1, 3]);
  // The plain lane first, then the icy one, each by a tap on its spawn tile. Plain lane 0 is the
  // back one: its zombie stands behind lane 1's tile, so the second tap is not taken for a tap on
  // the first zombie (which would merge it).
  await place(page, 'brainEater', 0, 9);
  await expect.poll(async () => (await units(page)).filter((u) => u.faction === 'zombies' && u.key === 'brainEater').length).toBe(1);
  await place(page, 'brainEater', 1, 9);
  await expect.poll(async () => (await units(page)).filter((u) => u.faction === 'zombies' && u.key === 'brainEater').length).toBe(2);
  const walkers = async (): Promise<{ plain: Seen; icy: Seen }> => {
    const zs = (await units(page)).filter((u) => u.faction === 'zombies' && u.key === 'brainEater');
    return { plain: zs.find((u) => u.lane === 0)!, icy: zs.find((u) => u.lane === 1)! };
  };
  const at = await walkers();
  expect(at.icy.id).toBeGreaterThan(at.plain.id); // the icy one really was sent second
  expect(at.icy.x).toBeGreaterThanOrEqual(at.plain.x);
  // On to column 7 (both still walking: the Peashooters stand on column 2): the icy one gets there first.
  let first: 'plain' | 'icy' | null = null;
  for (let i = 0; i < 200 && first === null; i++) {
    await page.evaluate(() => (window.__lvt as any).fastForward(3));
    const w = await walkers();
    if (w.icy.x < 7) first = 'icy';
    else if (w.plain.x < 7) first = 'plain';
  }
  expect(first).toBe('icy');
  expect(await glContexts(page)).toBe(1);
});

test('lava: a Peashooter tapped onto a lava tile is planted and burns; a Brain Eater walking over lava burns', async ({ page }) => {
  test.setTimeout(120_000);
  await playStandIn(page, 'plants', 5);
  await expect.poll(() => lawnWorld(page)).toBe('citadel');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.lava.tiles)).toEqual([13, 24]);
  // Lava 13 is (1,3): the sim allows planting there.
  await place(page, 'peashooter', 1, 3);
  await expect.poll(async () => (await plantOn(page, 1, 3))?.key).toBe('peashooter');
  const planted = (await plantOn(page, 1, 3))!;
  await page.evaluate(() => (window.__lvt as any).fastForward(30));
  const burnt = (await units(page)).find((u) => u.id === planted.id)!;
  expect(burnt.burn).toBeGreaterThan(0);
  expect(burnt.hp).toBeLessThan(planted.hp);
  // Lava 24 is (2,4), on lane 2 where the Brain Eaters come: one standing on it burns.
  let burning: Seen | undefined;
  for (let i = 0; i < 200 && burning === undefined; i++) {
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    burning = (await units(page)).find((u) => u.faction === 'zombies' && u.lane === 2 && Math.floor(u.x) === 4 && u.burn > 0);
  }
  expect(burning, 'a Brain Eater burning on (2,4)').toBeDefined();
  expect(await glContexts(page)).toBe(1);
});
