import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import type { Page } from './fixtures';
import { frames, glContexts, logIn, openTitle, tilePoint, waitLive } from './helpers';

// Worlds machinery Task 9: each lawn twist in a level played by taps. Fog is the real Moonlit
// Meadow (p2-*, reach 7, 7, 6, 6, 5, 5, 5, 5) and ice the real Frozen Tundra (z2-1: lane 2 iced,
// Peashooters on (1,3), (3,3) and (2,4), no computer). The other worlds have no levels yet, so the
// stand-in worlds on the debug hook (`__lvt.previewWorlds`, copies of world 1 with their arena's
// twist; it never copies over a world with real levels) are opened from the map by taps:
//   plants world 3 = Desert, rocks [13, 21] (lane × 8 + col) · world 5 = Citadel, lava [13, 24]
//   (lane × 10 + col).
// The copies are of p1-1 (Peashooters only, Brain Eaters down lane 2 from 20 s). Energy and the
// card's recharge are topped up by the test so that each placement is one tap on the card and one
// on the tile.

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

async function tapAt(page: Page, at: { x: number; y: number }): Promise<void> {
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/**
 * Lukas, with every level before world `world`'s level `n` won and every lesson learnt, the stand-in
 * worlds on the map (only where a world has no real levels); the side's map (it opens on the next
 * level's world), that level started by taps. World 2 is real on both sides (the Moonlit Meadow,
 * the Frozen Tundra), with the cards a player who got there by playing holds (the Mango-pult after
 * p2-3, the Avocado Bunker after p2-6; Hot Topic after z2-3, the Cowboy Zombie after z2-6). With `lessons`, the world-2 lessons are not yet learnt (the stand-ins carry theirs)
 * and every card is unlocked.
 */
async function playStandIn(page: Page, side: 'plants' | 'zombies', world: 2 | 3 | 4 | 5, lessons = false, n = 1): Promise<void> {
  await openTitle(page);
  await logIn(page);
  await page.evaluate(([s, w, withLessons, upTo]) => {
    const lvt = window.__lvt as any;
    lvt.previewWorlds(true, [2, 3, 4, 5], withLessons);
    const l = s === 'plants' ? 'p' : 'z';
    // Every level before world `w`'s level `upTo` won: the map opens on world w.
    const stars: Record<string, number> = {};
    for (let k = 1; k < w; k++) for (let m = 1; m <= 8; m++) stars[`${l}${k}-${m}`] = 2;
    for (let m = 1; m < upTo; m++) stars[`${l}${w}-${m}`] = 2;
    const ids = (lvt.levels as { teaches: { id: string }[] | null }[]).flatMap((d) => (d.teaches ?? []).map((t) => t.id))
      .filter((id) => !withLessons || !/^[pz]2-/.test(id));
    const second = w >= 2;
    const earned = s === 'plants'
      ? ['potatoMine', 'kernelPult', ...(second && (w > 2 || upTo > 3) ? ['mangoPult'] : []), ...(second && (w > 2 || upTo > 6) ? ['avocadoBunker'] : [])]
      : ['desertZombie', 'skeletonArcher', ...(second && (w > 2 || upTo > 3) ? ['hotTopic'] : []), ...(second && (w > 2 || upTo > 6) ? ['cowboyZombie'] : [])];
    const unlocked = withLessons
      ? (s === 'plants' ? ['potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker'] : ['desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie'])
      : earned;
    lvt.players.update((p: any) => ({ ...p, teached: ids, [s]: { ...p[s], stars, unlocked } }));
  }, [side, world, lessons, n] as const);
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  const map = page.locator('[data-screen="map"]');
  await expect(map).toHaveAttribute('data-world', String(world));
  const id = `${side === 'plants' ? 'p' : 'z'}${world}-${n}`;
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

test('fog (the real p2-2, a battle, reach 7): a Peashooter at the back fades its peas (a puff each) and leaves the base alone; one at the front hurts the base', async ({ page }) => {
  test.setTimeout(120_000);
  // p2-2, not p2-1: p2-1 is a survive level, whose zombie base cannot fall (or be hurt).
  await playStandIn(page, 'plants', 2, false, 2);
  await expect.poll(() => lawnWorld(page)).toBe('meadow');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.fog)).toBe(7);
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
  // Ten seconds of peas down an empty lane 0: every one fades seven tiles out, short of the base.
  await page.evaluate(() => (window.__lvt as any).fastForward(300));
  const back = await read();
  expect(back.faded).toBeGreaterThanOrEqual(3);
  expect(back.puffs).toBe(back.faded);
  expect(back.base).toBe(start.base);
  // A Peashooter on column 3 of lane 4: the base is inside its seven tiles. The computer is kept
  // without energy from here, so no zombie of his stands in the way or eats it.
  const starve = (): Promise<void> => page.evaluate(() => { (window.__lvt as any).session.controller.match.state.players.zombies.energy = 0; });
  await starve();
  await place(page, 'peashooter', 4, 3);
  await expect.poll(async () => (await plantOn(page, 4, 3))?.key).toBe('peashooter');
  await expect.poll(async () => {
    await starve();
    // A zombie already on its way may eat it: then it is planted again.
    if ((await plantOn(page, 4, 3)) === undefined) await place(page, 'peashooter', 4, 3);
    await page.evaluate(() => (window.__lvt as any).fastForward(60));
    return (await read()).base;
  }, { timeout: 45_000 }).toBeLessThan(back.base);
  expect(await glContexts(page)).toBe(1);
});

test('ice (the real z2-1, lane 2 iced): a Brain Eater sent down the icy lane overtakes one sent a moment earlier down a plain lane', async ({ page }) => {
  test.setTimeout(120_000);
  await playStandIn(page, 'zombies', 2);
  await expect.poll(() => lawnWorld(page)).toBe('tundra');
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.ice.lanes)).toEqual([2]);
  // The plain lane first, then the icy one, each by a tap on its spawn tile. Plain lane 0 is the
  // back one (and no Peashooter guards it): its zombie stands well behind lane 2's tile, so the
  // second tap is not taken for a tap on the first zombie (which would merge it).
  await place(page, 'brainEater', 0, 9);
  await expect.poll(async () => (await units(page)).filter((u) => u.faction === 'zombies' && u.key === 'brainEater').length).toBe(1);
  await place(page, 'brainEater', 2, 9);
  await expect.poll(async () => (await units(page)).filter((u) => u.faction === 'zombies' && u.key === 'brainEater').length).toBe(2);
  const walkers = async (): Promise<{ plain: Seen; icy: Seen }> => {
    const zs = (await units(page)).filter((u) => u.faction === 'zombies' && u.key === 'brainEater');
    return { plain: zs.find((u) => u.lane === 0)!, icy: zs.find((u) => u.lane === 2)! };
  };
  const at = await walkers();
  expect(at.icy.id).toBeGreaterThan(at.plain.id); // the icy one really was sent second
  expect(at.icy.x).toBeGreaterThanOrEqual(at.plain.x);
  // On to column 7 (both still walking: lane 2's Peashooter stands on column 4 and its peas do not
  // fell a Brain Eater in three tiles): the icy one gets there first.
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

// ---- Step 2, Task 3: the twist lessons (the real Meadow and the real Tundra) --

const tick = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).session.controller.match.state.tick as number);
const showing = (page: Page): Promise<string | null> => page.evaluate(() => (window.__lvt as any).session?.twistShow?.kind ?? null);

test('fog pan: p2-1 holds with the cards dimmed and Pause usable; the glove taps the lawn after 3 s; a tap ends it, the level plays; HELP shows it again', async ({ page }) => {
  test.setTimeout(150_000);
  await playStandIn(page, 'plants', 2, true);
  await expect.poll(() => lawnWorld(page)).toBe('meadow');
  const catcher = page.locator('[data-twist="fog"]');
  await expect(catcher).toBeVisible();
  // The cards are dimmed under the catcher; Pause is above it.
  const bottomFilter = () => page.locator('.battle__bottom').evaluate((el) => getComputedStyle(el).filter);
  await expect.poll(bottomFilter).toContain('brightness');
  await expect.poll(() => showing(page)).toBe('fog');
  const held = await tick(page);
  expect(held).toBeLessThanOrEqual(2);
  // Pause works over the pan, and the pan is still there after Resume.
  await press(page.locator('[data-hud="pause"]'));
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await expect(catcher).toHaveCount(0);
  await press(page.locator('[data-screen="pause"] [data-action="resume"]'));
  await expect(catcher).toBeVisible();
  // Nobody taps: after 3 s the glove taps the middle of the lawn.
  await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
  expect(await tick(page)).toBe(held);
  // A tap on the lawn ends it and plants nothing.
  await tapAt(page, await tilePoint(page, 1, 6));
  await expect(catcher).toHaveCount(0);
  await expect.poll(() => showing(page)).toBeNull();
  await expect.poll(bottomFilter).toBe('none');
  await expect.poll(() => tick(page)).toBeGreaterThan(held + 10);
  expect((await units(page)).filter((u) => u.faction === 'plants')).toHaveLength(0);
  expect(await page.evaluate(() => (window.__lvt as any).players.player.value.teached as string[])).toContain('p2-1.fog');
  // The level plays on by taps.
  await place(page, 'peashooter', 2, 1);
  await expect.poll(async () => (await plantOn(page, 2, 1))?.key).toBe('peashooter');
  // Quit to the map; HELP on p2-1's card shows the pan again.
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await expect.poll(() => page.locator('[data-stone="p2-1"][data-placed]').count()).toBe(1);
  await press(page.locator('[data-stone="p2-1"]'));
  await press(page.locator('[data-screen="level-card"] [data-action="replay-tutorial"]'));
  await waitLive(page);
  await expect(page.locator('[data-twist="fog"]')).toBeVisible();
  await press(page.locator('[data-twist="fog"]'));
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  expect(await glContexts(page)).toBe(1);
});

test('ice pan: the real z2-1 holds and pans; a tap anywhere (the sky) ends it and the level plays', async ({ page }) => {
  test.setTimeout(120_000);
  await playStandIn(page, 'zombies', 2, true);
  await expect.poll(() => lawnWorld(page)).toBe('tundra');
  await expect(page.locator('[data-twist="ice"]')).toBeVisible();
  await expect.poll(() => showing(page)).toBe('ice');
  const held = await tick(page);
  const size = page.viewportSize()!;
  await tapAt(page, { x: size.width / 2, y: Math.round(size.height * 0.2) });
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  await expect.poll(() => tick(page)).toBeGreaterThan(held + 10);
  await place(page, 'brainEater', 1, 9);
  await expect.poll(async () => (await units(page)).filter((u) => u.faction === 'zombies').length).toBe(1);
  expect(await glContexts(page)).toBe(1);
});

test('fog pan: a real pointer dragged from the cards across the lawn does nothing; the next plain tap ends the pan', async ({ page }) => {
  test.setTimeout(120_000);
  await playStandIn(page, 'plants', 2, true);
  await expect(page.locator('[data-twist="fog"]')).toBeVisible();
  const held = await tick(page);
  const card = await page.locator('[data-hud="tray"] [data-card="peashooter"]').boundingBox();
  const to = await tilePoint(page, 2, 3);
  // Press on the (dimmed) card, slide to a lawn tile, let go: the catcher is over both.
  await page.mouse.move(card!.x + card!.width / 2, card!.y + card!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(card!.x + (to.x - card!.x) * i / 8, card!.y + (to.y - card!.y) * i / 8);
  await page.mouse.up();
  await frames(page, 10);
  await expect(page.locator('[data-twist="fog"]')).toBeVisible();
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.tutorial.current?.id)).toBe('p2-1.fog');
  expect(await tick(page)).toBe(held);
  expect(await units(page)).toHaveLength(0);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.hud.denied.value)).toBe(0);
  await tapAt(page, to);
  await expect(page.locator('[data-twist]')).toHaveCount(0);
  await expect.poll(() => tick(page)).toBeGreaterThan(held + 5);
  expect(await units(page)).toHaveLength(0);
});

for (const [id, n, card, step, lane, col] of [
  ['p2-4', 4, 'mangoPult', 'mango', 2, 2],
  ['p2-7', 7, 'avocadoBunker', 'avocado', 2, 4],
] as const) {
  test(`new card: the real ${id} points at the ${card}, then its tile; tapping both plants it there; remembered`, async ({ page }) => {
    test.setTimeout(120_000);
    await playStandIn(page, 'plants', 2, true, n);
    expect(await page.evaluate(() => (window.__lvt as any).screen.options.level)).toBe(id);
    await page.evaluate(() => { const c = (window.__lvt as any).session.controller; c.match.state.players.plants.energy = 500; });
    const glove = page.locator('[data-tutorial] [data-glove]');
    await expect(glove).toHaveAttribute('data-glove-step', `${id}.${step}-card`);
    await expect(glove).toHaveAttribute('data-glove', 'card');
    await press(page.locator(`[data-hud="tray"] [data-card="${card}"]`));
    await expect(glove).toHaveAttribute('data-glove-step', `${id}.${step}-tile`);
    await expect(glove).toHaveAttribute('data-glove', 'tile');
    await tapAt(page, await tilePoint(page, lane, col));
    await expect.poll(async () => (await plantOn(page, lane, col))?.key).toBe(card);
    await expect(page.locator('[data-tutorial]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window.__lvt as any).players.player.value.teached as string[]))
      .toEqual(expect.arrayContaining([`${id}.${step}-card`, `${id}.${step}-tile`]));
    expect(await glContexts(page)).toBe(1);
  });
}

// Screenshots for the report at the small iPad size (only when LVT_SHOTS_DIR is set; iPad project).
test('shots: the fog pan mid-flight and its puff, the tap hint, the ice pan, a new-card glove', async ({ page }) => {
  const dir = process.env.LVT_SHOTS_DIR;
  test.skip(dir === undefined || test.info().project.name !== 'ipad', 'screenshots only on request');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1024, height: 650 });
  const shot = (name: string) => page.screenshot({ path: `${dir}/${name}.png` });
  const peaState = () => page.evaluate(() => {
    const show = (window.__lvt as any).session?.twistShow;
    let pea: any = null;
    show?.group.traverse((o: any) => { if (o.name === 'ghost-pea') pea = o; });
    return pea === null ? null : { x: pea.position.x as number, visible: pea.visible as boolean, start: show.startX as number, fade: show.fadeX as number };
  });
  for (const reach of [7]) { // the real p2-1; every Meadow level's own reach is a unit test (twistShowSession)
    await playStandIn(page, 'plants', 2, true, 1);
    await expect.poll(() => showing(page)).toBe('fog');
    expect(await page.evaluate(() => (window.__lvt as any).session.controller.match.state.config.lawn.fog)).toBe(reach);
    await frames(page, 40); // the camera has eased in (the hint glove comes at 3 s)
    // Mid-flight: the pea half way to where it vanishes.
    await expect.poll(async () => { const p = await peaState(); return p !== null && p.visible && p.x > p.start + (p.fade - p.start) * 0.45 && p.x < p.start + (p.fade - p.start) * 0.7; }, { intervals: [16], timeout: 15_000 }).toBe(true);
    await shot(`fog${reach}-pan-mid-flight`);
    // The puff: just after the pea vanishes into the mist.
    await expect.poll(async () => (await peaState())?.visible === true, { intervals: [16] }).toBe(true);
    await expect.poll(async () => (await peaState())?.visible === false, { intervals: [16], timeout: 15_000 }).toBe(true);
    await frames(page, 3);
    await shot(`fog${reach}-pan-puff`);
    await expect(page.locator('[data-tutorial] [data-glove="tap"][data-glove-x]')).toHaveCount(1, { timeout: 10_000 });
    await frames(page, 10);
    await shot(`fog${reach}-tap-hint`);
  }
  await playStandIn(page, 'zombies', 2, true);
  await expect.poll(() => showing(page)).toBe('ice');
  await frames(page, 100);
  await shot('ice-pan');
  await playStandIn(page, 'plants', 2, true, 4);
  await page.evaluate(() => { const c = (window.__lvt as any).session.controller; c.match.state.players.plants.energy = 500; });
  await expect(page.locator('[data-tutorial] [data-glove]')).toHaveAttribute('data-glove-step', 'p2-4.mango-card');
  await frames(page, 30);
  await shot('new-card-glove-card');
  await press(page.locator('[data-hud="tray"] [data-card="mangoPult"]'));
  await expect(page.locator('[data-tutorial] [data-glove]')).toHaveAttribute('data-glove-step', 'p2-4.mango-tile');
  await frames(page, 30);
  await shot('new-card-glove-tile');
});
