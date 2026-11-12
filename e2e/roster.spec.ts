import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { frames, snapshot, startBattle, tilePoint } from './helpers';
import type { Side } from './helpers';

// The full roster in the real game (wiring A): ten cards a side, every plant placed and every
// zombie sent by tap (a finger on the ipad project, the mouse on the desktop one), and whole
// matches against a computer holding all ten of its cards, with no console error anywhere.

const PLANTS = [
  'peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult',
  'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash',
];
const ZOMBIES = [
  'brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher',
  'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie', 'brainRot',
];

/** A tap where the project has touch, a click where it has a mouse. */
async function press(page: Page, target: Locator | { x: number; y: number }): Promise<void> {
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if ('x' in target) {
    if (touch) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
  } else if (touch) await target.tap();
  else await target.click();
}

/** Selects a card by tap; a card already selected (the first, at the start) is left so, as a second tap would drop it. */
async function pick(page: Page, key: string): Promise<void> {
  const card = page.locator(`[data-card="${key}"]`);
  if ((await card.getAttribute('aria-pressed')) !== 'true') await press(page, card);
  await expect(card, key).toHaveAttribute('aria-pressed', 'true');
}

/** Plenty of energy and every card recharged for the player, so a test can play card after card. */
function refill(page: Page): Promise<void> {
  return page.evaluate(() => {
    const c = (window.__lvt as any).session.controller;
    const me = c.match.state.players[c.playerFaction];
    me.energy = 99_999;
    me.recharge = {};
  });
}

/** Starts recording the keys of the player's units as they spawn; `spawnedKeys` reads them. */
function recordSpawns(page: Page): Promise<void> {
  return page.evaluate(() => {
    const c = (window.__lvt as any).session.controller;
    const step = c.step.bind(c);
    c.__spawned = [];
    c.step = () => {
      const events = step();
      for (const e of events) if (e.type === 'unitSpawned' && e.faction === c.playerFaction) c.__spawned.push(e.key);
      return events;
    };
  });
}
const spawnedKeys = (page: Page): Promise<string[]> => page.evaluate(() => [...((window.__lvt as any).session.controller.__spawned ?? [])]);

for (const side of ['plants', 'zombies'] as const) {
  test(`as ${side}: all ten cards show in the tray, each with its hotkey`, async ({ page }) => {
    await startBattle(page, side);
    const keys = side === 'plants' ? PLANTS : ZOMBIES;
    const cards = page.locator('[data-card]');
    await expect(cards).toHaveCount(10);
    for (const [i, key] of keys.entries()) {
      const card = page.locator(`[data-card="${key}"]`);
      await expect(card, key).toBeVisible();
      await expect(card.locator('.card__hotkey'), key).toHaveText(i === 9 ? '0' : String(i + 1));
      const box = (await card.boundingBox())!;
      expect(box.width, key).toBeGreaterThanOrEqual(44);
      expect(box.height, key).toBeGreaterThanOrEqual(44);
    }
  });
}

test('places one of each plant by tap', async ({ page }) => {
  await startBattle(page, 'plants');
  await recordSpawns(page);
  for (const [i, key] of PLANTS.entries()) {
    await refill(page);
    await pick(page, key);
    await press(page, await tilePoint(page, i % 5, 1 + Math.floor(i / 5) * 2));
    await expect.poll(async () => (await spawnedKeys(page)).includes(key), { message: key }).toBe(true);
  }
  expect((await spawnedKeys(page)).sort()).toEqual([...PLANTS].sort());
  // Let the mine, the cherry and the rest play out on screen for a moment: no error may come of it.
  await page.evaluate(() => (window.__lvt as any).fastForward(60));
  await frames(page, 30);
});

test('sends one of each zombie by tap', async ({ page }) => {
  await startBattle(page, 'zombies');
  await recordSpawns(page);
  for (const [i, key] of ZOMBIES.entries()) {
    await refill(page);
    await pick(page, key);
    await press(page, await tilePoint(page, i % 5, 8));
    await expect.poll(async () => (await spawnedKeys(page)).includes(key), { message: key }).toBe(true);
  }
  expect((await spawnedKeys(page)).sort()).toEqual([...ZOMBIES].sort());
  await page.evaluate(() => (window.__lvt as any).fastForward(60));
  await frames(page, 30);
});

for (const side of ['plants', 'zombies'] as Side[]) {
  test(`plays a whole match as ${side} with the full roster to a result, drawn as it goes`, async ({ page }) => {
    test.setTimeout(120_000);
    await startBattle(page, side, 'medium');
    const keys = side === 'plants' ? PLANTS : ZOMBIES;
    // Every 10 s of match time the player plays its next card, then a few frames are drawn, so
    // every unit and every ability of both sides passes through the view and the sound.
    for (let round = 0; round < 48; round++) {
      const over = await page.evaluate(([cards, r]) => {
        const lvt = window.__lvt as any;
        const c = lvt.session.controller;
        if (c.hud.result.value !== null) return true;
        const me = c.match.state.players[c.playerFaction];
        me.energy = Math.max(me.energy, 400);
        c.select(cards[r % cards.length]);
        c.click({ lane: r % 5, col: c.playerFaction === 'plants' ? (r * 3) % 8 : 9 }, null);
        lvt.fastForward(300);
        return c.hud.result.value !== null;
      }, [keys, round] as const);
      await frames(page, 4);
      if (over) break;
    }
    if ((await snapshot(page)).winner === null) await page.evaluate(() => (window.__lvt as any).fastForward(14_400));
    const panel = page.locator('[data-screen="result"]');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('h2')).toHaveText(/VICTORY!|DEFEAT|DRAW/);
    expect((await snapshot(page)).winner).not.toBeNull();
  });
}
