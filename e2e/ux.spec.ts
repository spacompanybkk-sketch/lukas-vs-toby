import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { frames, logIn, openTitle, pickAndStart, waitLive } from './helpers';

// The UX fixes for a child who cannot read, on the iPad: where a picked card may go (A), the
// conveyor's lesson (C), the hero button only from the level that teaches it (F). With
// LVT_UX_SHOTS set to a folder, the iPad project also leaves a picture of each fix there.

const SHOTS = process.env.LVT_UX_SHOTS;
const IPAD = { width: 1024, height: 704 } as const;

async function press(target: Locator): Promise<void> {
  if (test.info().project.name === 'ipad') await target.tap();
  else await target.click();
}

/** A picture of the page into LVT_UX_SHOTS (iPad project only). */
async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined || test.info().project.name !== 'ipad') return;
  await frames(page, 3);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Lukas, logged in, every level of both sides open; the tutorials done except the `teach` ones. */
async function setUp(page: Page, teach: string[] = []): Promise<void> {
  await page.setViewportSize(IPAD);
  await openTitle(page);
  await logIn(page);
  await page.evaluate((keep) => {
    const lvt = window.__lvt as any;
    const all = (lvt.levels as { id: string; teaches: { id: string }[] | null }[]);
    const stars = (l: string) => Object.fromEntries(all.filter((d) => d.id.startsWith(l)).map((d) => [d.id, 2]));
    lvt.players.update((s: any) => ({
      ...s,
      plants: { stars: stars('p'), unlocked: ['potatoMine', 'kernelPult'] },
      zombies: { stars: stars('z'), unlocked: ['desertZombie', 'skeletonArcher'] },
      teached: all.flatMap((d) => (d.teaches ?? []).map((t) => t.id)).filter((id) => !keep.includes(id)),
    }));
  }, teach);
}

async function level(page: Page, id: string): Promise<void> {
  const side = id.startsWith('p') ? 'plants' : 'zombies';
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator(`[data-side="${side}"]`));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await press(page.locator(`[data-stone="${id}"]`));
  await press(page.locator('[data-action="start-level"]'));
  await waitLive(page);
}

async function quit(page: Page): Promise<void> {
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await press(page.locator('[data-screen="map"] [data-action="back"]'));
  await press(page.locator('[data-screen="play"] [data-action="back"]'));
}

/** Picks `card` from the tray by a tap (unless it is already picked: a tap on the picked card puts it down). */
async function pick(page: Page, card: string): Promise<void> {
  const picked = await page.evaluate(() => (window.__lvt as any).session.controller.hud.selected.value as string | null);
  if (picked !== card) await press(page.locator(`[data-hud="tray"] [data-card="${card}"]`));
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session.controller.hud.selected.value)).toBe(card);
}

/** The tiles lit for the picked card ("lane,col"), and whether the lawn shows the marks. */
function marks(page: Page): Promise<{ lit: string[]; shown: boolean }> {
  return page.evaluate(() => {
    const lvt = window.__lvt as any;
    const mask: Uint8Array = lvt.session.controller.placeable;
    const lit: string[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) lit.push(`${Math.floor(i / 10)},${i % 10}`);
    return { lit, shown: lvt.stage.lawn.group.getObjectByName('place-marks').visible === true };
  });
}

test('A: a picked card lights every tile it may go on, in a level and in a Quick Battle (zombies: the lanes\' spawn end)', async ({ page }) => {
  test.setTimeout(150_000);
  await setUp(page);
  await level(page, 'p1-4');
  await page.evaluate(() => { (window.__lvt as any).session.controller.match.state.players.plants.energy = 500; });
  await pick(page, 'peashooter');
  await expect.poll(async () => (await marks(page)).lit.length).toBe(40);
  expect((await marks(page)).shown).toBe(true);
  expect((await marks(page)).lit.every((t) => Number(t.split(',')[1]) < 8)).toBe(true);
  await shot(page, 'A-plants-level-marks');
  // The shovel picks no card: nothing lit.
  await press(page.locator('[data-shovel]'));
  await expect.poll(async () => (await marks(page)).shown).toBe(false);
  await quit(page);
  await pickAndStart(page, 'zombies', 'easy');
  await waitLive(page);
  await page.evaluate(() => { (window.__lvt as any).session.controller.match.state.players.zombies.energy = 500; });
  await pick(page, 'brainEater');
  await expect.poll(async () => (await marks(page)).lit).toEqual(['0,9', '1,9', '2,9', '3,9', '4,9']);
  expect((await marks(page)).shown).toBe(true);
  await shot(page, 'A-zombies-quick-marks');
});

test('C: the conveyor level teaches the belt - the glove on the front belt card, then on its tile', async ({ page }) => {
  test.setTimeout(120_000);
  await setUp(page, ['p1-5.belt', 'p1-5.belt-tile']);
  await level(page, 'p1-5');
  const glove = page.locator('[data-tutorial] .tut-hand');
  await expect(glove).toHaveAttribute('data-glove-step', 'p1-5.belt');
  await expect(glove).toHaveAttribute('data-holding', 'true');
  await expect(glove).toHaveAttribute('data-glove-x', /\d+/);
  await shot(page, 'C-belt-lesson-1-card');
  const card = page.locator('[data-belt][data-slot="0"]');
  const key = await card.getAttribute('data-card');
  await press(card);
  await expect(glove).toHaveAttribute('data-glove-step', 'p1-5.belt-tile');
  await expect(glove).toHaveAttribute('data-glove', 'tile');
  await expect(glove).toHaveAttribute('data-glove-x', /\d+/);
  // Only the lesson's tile is lit while the glove holds.
  await expect.poll(async () => (await marks(page)).lit).toEqual(['2,1']);
  await shot(page, 'C-belt-lesson-2-tile');
  const at = { x: Number(await glove.getAttribute('data-glove-x')), y: Number(await glove.getAttribute('data-glove-y')) };
  if (test.info().project.name === 'ipad') await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => (window.__lvt as any).session.controller.match.state.units
    .filter((u: any) => u.faction === 'plants' && u.lane === 2 && Math.floor(u.x) === 1).map((u: any) => u.key))).toEqual([key]);
  await expect(page.locator('[data-tutorial]')).toHaveCount(0);
});

test('F: no hero button in p1-1 and z1-1; it is there from the level that teaches it', async ({ page }) => {
  test.setTimeout(150_000);
  await setUp(page);
  for (const [id, shown] of [['p1-1', false], ['p1-2', true], ['z1-1', false], ['z1-2', true]] as const) {
    await level(page, id);
    await page.evaluate((side) => { (window.__lvt as any).session.controller.match.state.players[side].heroTimer = 0; }, id.startsWith('p') ? 'plants' : 'zombies');
    await frames(page, 3);
    await expect(page.locator('[data-hero]'), id).toHaveCount(shown ? 1 : 0);
    if (id === 'p1-1') await shot(page, 'F-p1-1-no-hero');
    if (id === 'p1-2') await shot(page, 'F-p1-2-hero');
    await quit(page);
  }
});

test('pictures of the other fixes: one clock (B, E), the map picture on Quit (D), the Free Play picture (G)', async ({ page }) => {
  test.skip(SHOTS === undefined || test.info().project.name !== 'ipad', 'pictures only');
  test.setTimeout(150_000);
  await setUp(page);
  await press(page.locator('[data-home="play"]'));
  await shot(page, 'G-play-menu');
  await press(page.locator('[data-play="free"]'));
  await shot(page, 'G-free-play-side');
  await press(page.locator('[data-action="back"]'));
  await press(page.locator('[data-action="back"]'));
  await level(page, 'p1-3');
  await page.evaluate(() => (window.__lvt as any).fastForward(30 * 20));
  await shot(page, 'B-survive-one-clock');
  await press(page.locator('[data-hud="pause"]'));
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await shot(page, 'D-quit-to-map-armed');
  await press(page.locator('[data-screen="pause"] [data-action="quit"]'));
  await press(page.locator('[data-screen="map"] [data-action="back"]'));
  await press(page.locator('[data-screen="play"] [data-action="back"]'));
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
  await level(page, 'p1-8');
  await page.evaluate(() => (window.__lvt as any).fastForward(30 * 3));
  await shot(page, 'E-boss-no-clock');
});

test('H: the level card\'s difficulty is one, two, three skulls; a tap marks the chosen one; none on a conveyor level', async ({ page }) => {
  test.setTimeout(90_000);
  await setUp(page);
  await press(page.locator('[data-home="play"]'));
  await press(page.locator('[data-play="adventure"]'));
  await press(page.locator('[data-side="zombies"]'));
  await press(page.locator('[data-stone="z1-1"]'));
  const skills = page.locator('[data-screen="level-card"] [data-skill]');
  await expect(skills).toHaveCount(3);
  for (const k of ['easy', 'medium', 'hard']) await expect(page.locator(`[data-skill="${k}"] svg.pixel-icon`)).toBeVisible();
  await press(page.locator('[data-skill="hard"]'));
  await expect(page.locator('[data-skill="hard"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lcard__face.is-on')).toHaveCount(1);
  await shot(page, 'H-difficulty-skulls');
  await press(page.locator('[data-action="close-card"]'));
  await press(page.locator('[data-stone="z1-5"]'));
  await expect(page.locator('[data-screen="level-card"]')).toHaveAttribute('data-level', 'z1-5');
  await expect(skills).toHaveCount(0);
});

/** Wins the running level with the player's base left at `kept` of its health (the clock for Breakthrough as it is). */
async function winWith(page: Page, side: 'plants' | 'zombies', kept: number): Promise<void> {
  await page.evaluate(([s, k]) => {
    const lvt = window.__lvt as any;
    const st = lvt.session.controller.match.state;
    st.baseHp[s] = Math.round(st.baseMaxHp[s] * k);
    lvt.damageBase(s === 'plants' ? 'zombies' : 'plants', 999999);
    lvt.fastForward(1);
  }, [side, kept] as const);
  await expect(page.locator('[data-level-result]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-level-result]')).not.toHaveAttribute('data-step', 'stars', { timeout: 10_000 });
}

const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('I: the level result shows why a star was lost - the base bar short of the third star - at every iPad size, clear of the next-level button', async ({ page }) => {
  test.setTimeout(150_000);
  await setUp(page);
  await level(page, 'p1-3');
  await winWith(page, 'plants', 0.62);
  await expect(page.locator('[data-level-result]')).toHaveAttribute('data-stars', '2');
  const meter = page.locator('[data-star-meter]');
  await expect(meter).toHaveAttribute('data-star-meter', 'base');
  await expect(page.locator('[data-star-meter] [data-mark="2"]')).toHaveAttribute('data-reached', '');
  await expect(page.locator('[data-star-meter] [data-mark="3"]')).not.toHaveAttribute('data-reached', '');
  for (const size of [{ width: 1024, height: 650 }, { width: 1024, height: 704 }, { width: 1180, height: 746 }]) {
    await page.setViewportSize(size);
    await frames(page, 4);
    const tag = `${size.width}x${size.height}`;
    const m = (await meter.boundingBox())!;
    const next = (await page.locator('[data-action="next-level"]').boundingBox())!;
    for (const b of [m, next]) {
      expect(b.y, `${tag}: on screen`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `${tag}: on screen`).toBeLessThanOrEqual(size.height);
      expect(b.x + b.width, `${tag}: on screen`).toBeLessThanOrEqual(size.width);
    }
    expect(overlap(m, next), `${tag}: the meter covers the next-level button`).toBe(false);
    expect(next.height, `${tag}: next-level button tap size`).toBeGreaterThanOrEqual(44);
    await shot(page, `I-result-meter-${tag}`);
  }
  await page.setViewportSize(IPAD);
  await press(page.locator('[data-action="map"]'));
  await press(page.locator('[data-screen="map"] [data-action="back"]'));
  await press(page.locator('[data-screen="play"] [data-action="back"]'));
  // Breakthrough has no player base: its own rule, the clock left, drawn with the clock.
  await level(page, 'z1-3');
  await winWith(page, 'zombies', 1);
  await expect(meter).toHaveAttribute('data-star-meter', 'clock');
  await shot(page, 'I-result-meter-breakthrough');
});
