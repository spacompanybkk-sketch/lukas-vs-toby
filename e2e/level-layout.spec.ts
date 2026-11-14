import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { boxHitsPolygon, frames, lawnCorners, logIn, openTitle, tilePoint, waitLive } from './helpers';
import type { Box } from './helpers';

// Phase 3 Task 9: the level HUD at the iPad sizes (Safari with its bars: 1024x650, 1024x704,
// 1180x746), in real levels: the clock bar, the wave bar, the boss bar and Free Play's counter
// overlap neither each other, the top bar (energy, clock, pause, base bars) nor lanes 0–4; the
// belt and the tray keep off the lanes; the boss's entrance card keeps off the lanes; the
// tutorial glove's target is on screen and at least 44 pt.

const SIZES = [{ width: 1024, height: 650 }, { width: 1024, height: 704 }, { width: 1180, height: 746 }] as const;

interface Named extends Box { name: string }

/** Lukas, logged in, every level of both sides open and every tutorial done unless `teach` is given. */
async function setUp(page: Page, teach: string[] = []): Promise<void> {
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
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-play="adventure"]').click();
  await page.locator(`[data-side="${side}"]`).click();
  await expect(page.locator('[data-screen="map"]')).toBeVisible();
  await page.locator(`[data-stone="${id}"]`).click();
  await page.locator('[data-action="start-level"]').click();
  await waitLive(page);
}

async function freePlay(page: Page, side: 'plants' | 'zombies'): Promise<void> {
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-play="free"]').click();
  await page.locator(`[data-side="${side}"]`).click();
  await waitLive(page);
}

/** The visible boxes of the top bar's parts and the level's bars. */
function hudBoxes(page: Page): Promise<Named[]> {
  return page.evaluate(() => {
    const sel = '[data-hud="energy"], [data-hud="topbar"], [data-hud="free-top"], [data-hud="pause"], [data-hud^="base-"], '
      + '[data-hud="clock-goal"], [data-hud="wave-bar"], [data-hud="boss"]';
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .map(({ el, r }) => ({ name: el.dataset.hud!, x: r.x, y: r.y, w: r.width, h: r.height }));
  });
}

function box(page: Page, selector: string): Promise<Named | null> {
  return page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { name: s, x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, selector);
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** At each size: the named bars present (and the `never` ones not), nothing overlapping, nothing on lanes 0–4, all on screen. */
async function checkSizes(page: Page, must: string[], bottom: string, never: string[] = []): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await frames(page, 4);
    const tag = `${size.width}x${size.height}`;
    const all = await hudBoxes(page);
    for (const name of must) expect(all.map((b) => b.name), `${tag}: ${name} shown`).toContain(name);
    for (const name of never) expect(all.map((b) => b.name), `${tag}: ${name} not shown`).not.toContain(name);
    const lawn = await lawnCorners(page);
    for (const b of all) {
      expect(boxHitsPolygon(b, lawn), `${tag}: ${b.name} covers lanes 0–4`).toBe(false);
      expect(b.x, `${tag}: ${b.name} left`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${tag}: ${b.name} top`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, `${tag}: ${b.name} right`).toBeLessThanOrEqual(size.width);
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i]!, all[j]!), `${tag}: ${all[i]!.name} overlaps ${all[j]!.name}`).toBe(false);
      }
    }
    const low = await box(page, bottom);
    expect(low, `${tag}: ${bottom} shown`).not.toBeNull();
    expect(boxHitsPolygon(low!, lawn), `${tag}: ${bottom} covers lanes 0–4`).toBe(false);
    expect(low!.y + low!.h, `${tag}: ${bottom} bottom`).toBeLessThanOrEqual(size.height + 0.5);
  }
}

test('survive, conveyor and breakthrough levels: the clock bar, the belt and the tray keep their places', async ({ page }) => {
  test.setTimeout(180_000);
  await setUp(page);
  await level(page, 'p1-3');
  // One picture of time: the draining clock bar, and no count-up clock beside it.
  await checkSizes(page, ['clock-goal', 'base-plants'], '[data-hud="tray"]', ['topbar']);
  await page.locator('[data-hud="pause"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-screen="map"] [data-action="back"]').click();
  await page.locator('[data-screen="play"] [data-action="back"]').click();
  await level(page, 'p1-5');
  await checkSizes(page, ['clock-goal'], '[data-hud="belt"]', ['topbar']);
  await page.locator('[data-hud="pause"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-screen="map"] [data-action="back"]').click();
  await page.locator('[data-screen="play"] [data-action="back"]').click();
  await level(page, 'z1-3');
  await page.evaluate(() => (window.__lvt as any).fastForward(30 * 40));
  await checkSizes(page, ['clock-goal', 'base-plants'], '[data-hud="tray"]', ['topbar']);
});

test('both boss levels: the boss bar (and the wave bar) clear of the top bar and the lanes; the entrance card too, and a tap skips it', async ({ page }) => {
  test.setTimeout(180_000);
  await setUp(page);
  // The card's own 1.5 s timer would race the checks: hold it until the tap below.
  await page.evaluate(() => { (window.__lvt as any).holdBossIntro = true; });
  for (const id of ['p1-8', 'z1-8']) {
    await level(page, id);
    // Until the boss is on: its entrance card shows for a moment; measured at each size at once.
    await expect.poll(async () => {
      await page.evaluate(() => (window.__lvt as any).fastForward(5));
      return page.locator('[data-hud="boss-intro"]').count();
    }, { timeout: 30_000, intervals: [0] }).toBe(1);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await frames(page, 1);
      // Its pop-in held at its biggest (15%: scale 1.12) and at rest (25%: scale 1).
      const cards = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-hud="boss-intro"]');
        if (!el) return null;
        const pop = el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'hud-boss-in');
        return [225, 375].map((t) => {
          if (pop) { pop.pause(); pop.currentTime = t; }
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
      });
      expect(cards, `${size.width}x${size.height}: the entrance card is up to measure`).not.toBeNull();
      const lawn = await lawnCorners(page);
      for (const card of cards!) {
        expect(boxHitsPolygon(card, lawn), `${size.width}x${size.height}: the entrance card covers lanes 0–4`).toBe(false);
        expect(card.y, `${size.width}x${size.height}: the entrance card on screen`).toBeGreaterThanOrEqual(0);
      }
      expect(cards![1]!.w, 'entrance card tap target').toBeGreaterThanOrEqual(44);
      expect(cards![1]!.h, 'entrance card tap target').toBeGreaterThanOrEqual(44);
    }
    const intro = page.locator('[data-hud="boss-intro"]');
    if (test.info().project.name === 'ipad') await intro.tap();
    else await intro.click();
    await expect(intro).toHaveCount(0);
    await checkSizes(page, id === 'p1-8' ? ['boss', 'wave-bar', 'topbar'] : ['boss', 'topbar'], '[data-hud="tray"]');
    await page.locator('[data-hud="pause"]').click();
    await page.locator('[data-screen="pause"] [data-action="quit"]').click();
    await page.locator('[data-screen="pause"] [data-action="quit"]').click();
    await page.locator('[data-screen="map"] [data-action="back"]').click();
    await page.locator('[data-screen="play"] [data-action="back"]').click();
  }
});

test('Free Play: the wave counter and the next-wave ring, and breakthrough\'s clock, keep their places', async ({ page }) => {
  test.setTimeout(180_000);
  await setUp(page);
  await freePlay(page, 'plants');
  await page.evaluate(() => (window.__lvt as any).fastForward(30 * 51));
  await checkSizes(page, ['free-top', 'base-plants'], '[data-hud="tray"]');
  await page.locator('[data-hud="pause"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-screen="pause"] [data-action="quit"]').click();
  await page.locator('[data-free-result]').waitFor({ timeout: 30_000 });
  await page.locator('[data-screen="result"] [data-action="menu"]').click();
  await freePlay(page, 'zombies');
  await checkSizes(page, ['free-top', 'base-plants', 'base-zombies'], '[data-hud="tray"]');
});

test('the tutorial glove\'s target is on screen and at least 44 pt at every size (card and tile)', async ({ page }) => {
  test.setTimeout(180_000);
  await setUp(page, ['p1-1.card', 'p1-1.tile']);
  await level(page, 'p1-1');
  const hand = page.locator('[data-tutorial] [data-glove][data-holding="true"][data-glove-x]');
  for (const step of ['p1-1.card', 'p1-1.tile']) {
    await expect(hand).toHaveAttribute('data-glove-step', step);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await frames(page, 6);
      const tag = `${size.width}x${size.height} ${step}`;
      const g = await hand.evaluate((e: HTMLElement) => ({ kind: e.dataset.glove!, x: Number(e.dataset.gloveX), y: Number(e.dataset.gloveY) }));
      expect(g.x, `${tag} on screen`).toBeGreaterThan(0);
      expect(g.x, `${tag} on screen`).toBeLessThan(size.width);
      expect(g.y, `${tag} on screen`).toBeGreaterThan(0);
      expect(g.y, `${tag} on screen`).toBeLessThan(size.height);
      if (g.kind === 'tile') {
        // The tile under the glove: its neighbours' middles are at least 44 px away both ways.
        const t = await page.evaluate(() => (window.__lvt as any).session.controller.tutorial.glove.value.aim);
        const at = await tilePoint(page, t.lane, t.col);
        const right = await tilePoint(page, t.lane, t.col + 1);
        const front = await tilePoint(page, t.lane + 1, t.col);
        const back = await tilePoint(page, t.lane - 1, t.col);
        expect(Math.hypot(at.x - g.x, at.y - g.y), `${tag}: glove on its tile`).toBeLessThan(8);
        expect(right.x - at.x, `${tag}: tile width`).toBeGreaterThanOrEqual(44);
        expect(Math.min(front.y - at.y, at.y - back.y), `${tag}: tile depth`).toBeGreaterThanOrEqual(44);
      } else {
        const b = await page.evaluate(([x, y]) => {
          const el = document.elementFromPoint(x, y)?.closest('button');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, name: (el as HTMLElement).dataset.card ?? el.className };
        }, [g.x, g.y] as const);
        expect(b, `${tag}: a button under the glove`).not.toBeNull();
        expect(b!.w, `${tag}: ${b!.name} width`).toBeGreaterThanOrEqual(44);
        expect(b!.h, `${tag}: ${b!.name} height`).toBeGreaterThanOrEqual(44);
      }
    }
    const g = await hand.evaluate((e: HTMLElement) => ({ x: Number(e.dataset.gloveX), y: Number(e.dataset.gloveY) }));
    if (test.info().project.name === 'ipad') await page.touchscreen.tap(g.x, g.y);
    else await page.mouse.click(g.x, g.y);
    await expect(page.locator(`[data-tutorial] [data-glove][data-glove-step="${step}"]`)).toHaveCount(0);
  }
});
