import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { boxHitsPolygon, frames, lawnCorners, startBattle, tilePoint } from './helpers';
import type { Side } from './helpers';

// Hero powers and spells in the real game (wiring B): the hero fired by tap after the first
// charge, an aimed and an un-aimed spell cast by tap, the Rock Wall standing, bitten and
// crumbling, and every bottom-bar button tappable with no overlap at the iPad window. A tap is a
// finger on the ipad project and the mouse on the desktop one. No console error anywhere.

/** A tap where the project has touch, a click where it has a mouse. */
async function press(page: Page, target: Locator | { x: number; y: number }, force = false): Promise<void> {
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if ('x' in target) {
    if (touch) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
  } else if (touch) await target.tap({ force });
  else await target.click({ force });
}

/** Starts recording the match's events (type, side, spell, unit) as the session steps; `recorded` reads them. */
function record(page: Page): Promise<void> {
  return page.evaluate(() => {
    const c = (window.__lvt as any).session.controller;
    const step = c.step.bind(c);
    c.__events = [];
    c.step = () => {
      const events = step();
      for (const e of events) c.__events.push({ type: e.type, faction: e.faction, spell: e.spell, key: e.key, unitId: e.unitId, cause: e.cause });
      return events;
    };
  });
}
type Recorded = { type: string; faction?: string; spell?: string; key?: string; unitId?: number; cause?: string };
const recorded = (page: Page): Promise<Recorded[]> => page.evaluate(() => [...((window.__lvt as any).session.controller.__events ?? [])]);

/** Deals the player these two spells, both a tick from ready, and steps until they are. */
async function deal(page: Page, spells: [string, string]): Promise<void> {
  await page.evaluate((keys) => {
    const lvt = window.__lvt as any;
    const c = lvt.session.controller;
    c.match.state.players[c.playerFaction].spells = keys.map((key: string) => ({ key, timer: 1 }));
    lvt.fastForward(2);
  }, spells);
  for (const key of spells) await expect(page.locator(`[data-spell="${key}"]`), key).toHaveClass(/is-ready/);
}

for (const side of ['plants', 'zombies'] as Side[]) {
  test(`as ${side}: the hero fires down a lane by tap once charged, with its banner`, async ({ page }) => {
    await startBattle(page, side);
    await record(page);
    const hero = page.locator('[data-hero]');
    await expect(hero).toHaveClass(/is-charging/);
    // Too soon: refused, and it says so with a shake. (A charging button is aria-disabled, which
    // Playwright would wait out: the tap is forced, as a child's finger does not wait.)
    await press(page, hero, true);
    await expect(hero).toHaveClass(/is-denied/);
    await expect(hero).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => (window.__lvt as any).fastForward(46 * 30));
    await expect(hero).toHaveClass(/is-ready/);
    await press(page, hero);
    await expect(hero).toHaveAttribute('aria-pressed', 'true');
    await press(page, await tilePoint(page, 3, 5));
    // The banner, caught while it shows, sits wholly above the lawn's far edge: never over lanes 0-4.
    const banner = await page.waitForFunction(() => {
      const el = document.querySelector('[data-banner="hero"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom };
    }, undefined, { polling: 'raf' });
    const shown = (await banner.jsonValue()) as { bottom: number };
    const lawn = await lawnCorners(page);
    expect(shown.bottom).toBeLessThanOrEqual(Math.min(lawn[0]!.y, lawn[1]!.y) + 0.5);
    await expect.poll(async () => (await recorded(page)).some((e) => e.type === 'heroUsed' && e.faction === side)).toBe(true);
    // The boy's banner was put up (it shows for 0.6 s: the signal is checked, not a race with the clock).
    expect(await page.evaluate(() => (window.__lvt as any).session.heroBanner.value?.side)).toBe(side);
    await expect(hero).toHaveAttribute('aria-pressed', 'false');
    await expect(hero).toHaveClass(/is-charging/);
    await frames(page, 60); // the show plays out on screen
    await expect(page.locator('[data-banner="hero"]')).toHaveCount(0);
  });

  test(`as ${side}: an aimed spell is cast where tapped, an un-aimed one on its button`, async ({ page }) => {
    await startBattle(page, side);
    await record(page);
    const [aimed, unaimed] = side === 'plants' ? ['thunderbolt', 'sunShower'] : ['meteor', 'brainFeast'];
    await deal(page, [aimed, unaimed]);
    const button = page.locator(`[data-spell="${aimed}"]`);
    await press(page, button);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await press(page, await tilePoint(page, 1, 6));
    await expect.poll(async () => (await recorded(page)).some((e) => e.type === 'spellCast' && e.spell === aimed)).toBe(true);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toHaveClass(/is-charging/);

    const before = await page.evaluate(() => {
      const c = (window.__lvt as any).session.controller;
      return c.match.state.players[c.playerFaction].energy as number;
    });
    await press(page, page.locator(`[data-spell="${unaimed}"]`));
    await expect.poll(async () => (await recorded(page)).some((e) => e.type === 'spellCast' && e.spell === unaimed)).toBe(true);
    const after = await page.evaluate(() => {
      const c = (window.__lvt as any).session.controller;
      return c.match.state.players[c.playerFaction].energy as number;
    });
    expect(after).toBeGreaterThanOrEqual(before + 100);
    await frames(page, 60);
  });
}

test('Rock Wall: the rock stands where tapped, a zombie bites it, and it crumbles, with no error', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page, 'plants');
  await record(page);
  await deal(page, ['rockWall', 'sunShower']);
  await press(page, page.locator('[data-spell="rockWall"]'));
  await press(page, await tilePoint(page, 2, 5));
  await expect.poll(async () => (await recorded(page)).some((e) => e.type === 'unitSpawned' && e.key === 'rock')).toBe(true);
  const rockId = (await recorded(page)).find((e) => e.type === 'unitSpawned' && e.key === 'rock')!.unitId!;
  await frames(page, 20);
  expect(await page.evaluate(() => (window.__lvt as any).session.view.spells.rocks)).toBe(1);
  // A Very Fast Walker comes down lane 2 (the computer is made to send it) and bites the rock.
  await page.evaluate(() => {
    const c = (window.__lvt as any).session.controller;
    c.match.state.players.zombies.energy = 9999;
    c.match.state.players.zombies.recharge = {};
    let sent = false;
    c.bot.think = () => {
      if (sent) return [];
      sent = true;
      return [{ type: 'place', faction: 'zombies', unit: 'veryFastWalker', lane: 2, col: 9 }];
    };
  });
  for (let i = 0; i < 30; i++) {
    const events = await recorded(page);
    if (events.some((e) => e.type === 'unitDied' && e.unitId === rockId)) break;
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    await frames(page, 2);
  }
  const events = await recorded(page);
  expect(events.some((e) => e.type === 'unitDamaged' && e.unitId === rockId), 'bitten').toBe(true);
  expect(events.some((e) => e.type === 'unitDied' && e.unitId === rockId), 'gone').toBe(true);
  await frames(page, 30);
  expect(await page.evaluate(() => (window.__lvt as any).session.view.spells.rocks)).toBe(0);
});

for (const side of ['plants', 'zombies'] as Side[]) {
  test(`as ${side} at 1024x704: every card, the shovel, the hero and both spells are tappable and none overlaps`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 704 });
    await startBattle(page, side);
    const buttons = page.locator('[data-card], [data-shovel], [data-hero], [data-spell]');
    const count = await buttons.count();
    expect(count).toBe(side === 'plants' ? 14 : 13);
    const boxes: { name: string; x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < count; i++) {
      const b = buttons.nth(i);
      const box = (await b.boundingBox())!;
      const name = (await b.getAttribute('aria-label')) ?? `#${i}`;
      boxes.push({ name, x: box.x, y: box.y, w: box.width, h: box.height });
      expect(box.width, name).toBeGreaterThanOrEqual(44);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
      expect(box.x, name).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, name).toBeLessThanOrEqual(704);
      // The middle of the button is the button (nothing covers it).
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[data-card], [data-shovel], [data-hero], [data-spell]')?.getAttribute('aria-label') ?? null;
      }, [box.x + box.width / 2, box.y + box.height / 2] as const);
      expect(hit, name).toBe(name);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });
}

for (const [width, height] of [[1024, 704], [1180, 746]] as const) {
  for (const side of ['plants', 'zombies'] as Side[]) {
    test(`as ${side} at ${width}x${height}: the hero and spell buttons leave lanes 0-4 clear`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await startBattle(page, side);
      await frames(page, 5);
      const lawn = await lawnCorners(page);
      const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-hud="powers"], [data-hero], [data-spell]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute('aria-label') ?? el.getAttribute('data-hud') ?? '?', x: r.x, y: r.y, w: r.width, h: r.height };
      }));
      expect(boxes.length).toBe(4); // the block, the hero, two spells
      for (const b of boxes) expect(boxHitsPolygon(b, lawn), `${b.name} covers the lanes`).toBe(false);
    });
  }
}
