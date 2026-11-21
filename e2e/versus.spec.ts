import { mkdirSync } from 'node:fs';
import { expect, expectClean, test } from './fixtures';
import type { Page } from './fixtures';
import {
  acceptInvite, clickTile, closeVersusPage, commonHashes, deniedCount, frames, tilePoint, fakePeek, fakeReset, glContexts, invite, logIn, mySide, openVersusPage,
  placeUnit, recordHashes, startVersus, trayKeys, unitCount, versusProblems, versusTick, waitLive,
} from './helpers';

// Two-device Versus in a real browser: two pages (two browser contexts, so two devices) over one
// local stand-in for the Realtime Database (tools/fake-rtdb-server.ts on its own port; the same
// rules as the live ones). Lukas (p01, plants) on page A, Toby (p02, zombies) on page B. Every
// Versus timeout is a thirtieth (`vsquick`). iPad project only: touch, one Chromium, low graphics.
// `LVT_SHOTS=1` also writes the screenshot tour, artifacts/shots/versus-*.png at 1024x768.

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.LVT_SHOTS === '1';

/** One of the tour's pictures (only with LVT_SHOTS=1). */
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync('artifacts/shots', { recursive: true });
  await page.screenshot({ path: `artifacts/shots/versus-${name}.png`, scale: 'css' });
}

let opened: Page[] = [];
async function device(browser: Parameters<typeof openVersusPage>[0], opts?: Parameters<typeof openVersusPage>[1]): Promise<Page> {
  const page = await openVersusPage(browser, opts);
  opened.push(page);
  return page;
}

test.beforeEach(async ({ browserName: _b }, info) => {
  test.skip(info.project.name !== 'ipad', 'Versus is proven on the iPad project only');
  opened = [];
  await fakeReset();
});

test.afterEach(async () => {
  // No console errors and one WebGL context per page, on every page the test opened.
  const checks: Promise<void>[] = [];
  for (const page of opened) {
    if (page.isClosed()) continue;
    expect(await glContexts(page), 'WebGL contexts on a page').toBeLessThanOrEqual(2);
  }
  for (const page of opened) checks.push(Promise.resolve().then(() => expectClean(versusProblems(page))));
  await Promise.all(checks);
  await Promise.all(opened.map(closeVersusPage));
});

/** The element is at least `px` CSS pixels wide and high. */
async function atLeast(page: Page, selector: string, px: number): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  expect(box.width, `${selector} width`).toBeGreaterThanOrEqual(px - 0.5);
  expect(box.height, `${selector} height`).toBeGreaterThanOrEqual(px - 0.5);
}

/** The cheapest card in this boy's tray that he can pay for now. */
async function cheapest(page: Page): Promise<string> {
  const cards = await page.locator('[data-hud="tray"] [data-card]:not(.is-disabled):not(.is-recharging)').evaluateAll(
    (els) => els.map((e) => ({ key: (e as HTMLElement).dataset.card as string, price: Number((e.getAttribute('aria-label') ?? '').split(',').pop()) })),
  );
  expect(cards.length, 'a card he can use').toBeGreaterThan(0);
  return cards.sort((a, b) => a.price - b.price)[0]!.key;
}

/** Each boy puts a unit down by real taps; both pages show both units. */
async function bothPlace(a: Page, b: Page): Promise<void> {
  await placeUnit(a, await cheapest(a), 1, 1);
  await placeUnit(b, await cheapest(b), 3, 9);
  await expect.poll(async () => Math.min(await unitCount(a), await unitCount(b)), { timeout: 2000, intervals: [50] }).toBeGreaterThanOrEqual(2);
}

test('invite, accept, both place a unit, the hashes agree', async ({ browser }) => {
  const a = await device(browser);
  const b = await device(browser);
  await logIn(a, '123', 'p01');
  await logIn(b, '123', 'p02');

  // B opens "who is here" and sees Lukas (his device is on Home).
  await b.locator('[data-home="play"]').click();
  await b.locator('[data-play="versus"]').click();
  await expect(b.locator('[data-face="p01"]')).toBeVisible();
  await b.waitForTimeout(500); // the pop-in
  await atLeast(b, '[data-face="p01"] [data-face-pic]', 120); // faces on "who is here": 120 px
  await b.locator('[data-face="p01"]').click();
  await expect(b.locator('[data-invite-card][data-state="draft"]')).toBeVisible();
  await b.waitForTimeout(500);
  for (const action of ['send', 'swap', 'head-minus', 'head-plus', 'close']) await atLeast(b, `[data-invite-card] [data-action="${action}"]`, 64);
  await b.locator('[data-invite-card] [data-action="send"]').click();
  await expect(b.locator('[data-invite-card][data-state="waiting"]')).toBeVisible();

  // A's panel comes down over Home; A accepts.
  await expect(a.locator('[data-screen="home"]')).toBeVisible();
  await expect(a.locator('[data-invite-panel] [data-from] [data-face-of="p02"]')).toBeVisible();
  await a.waitForTimeout(500); // the slide-in
  for (const action of ['accept', 'decline']) await atLeast(a, `[data-invite-panel] [data-action="${action}"]`, 96);
  await acceptInvite(a);
  await Promise.all([waitLive(a), waitLive(b)]);
  expect(await mySide(a)).toBe('plants');
  expect(await mySide(b)).toBe('zombies');

  await Promise.all([recordHashes(a), recordHashes(b)]);
  await bothPlace(a, b);
  await a.waitForTimeout(1500);
  const agree = await commonHashes(a, b);
  expect(agree.common, 'ticks both pages hashed').toBeGreaterThan(20);
  expect(agree.differing, 'ticks where the hashes differ').toEqual([]);
  expect(await a.evaluate(() => (window.__lvt as any).versus.hash())).not.toBe(-1);
});

test('pause from B shows B on A; A resumes; both run', async ({ browser }) => {
  const a = await device(browser);
  const b = await device(browser);
  await startVersus(a, b);
  await Promise.all([recordHashes(a), recordHashes(b)]);

  await b.locator('[data-hud="pause"]').click();
  await expect(a.locator('[data-screen="vs-paused"] [data-face-of="p02"]')).toBeVisible();
  const frozen = await versusTick(a);
  await a.waitForTimeout(600);
  expect(await versusTick(a), 'no ticks while paused').toBeLessThanOrEqual(frozen + 1);

  await a.locator('[data-screen="vs-paused"] [data-action="resume"]').click();
  await expect(a.locator('[data-screen="vs-paused"]')).toHaveCount(0);
  await expect.poll(() => versusTick(a), { timeout: 5000 }).toBeGreaterThan(frozen + 15);
  await expect.poll(() => versusTick(b), { timeout: 5000 }).toBeGreaterThan(frozen + 15);
  await expect(b.locator('[data-screen="pause"], [data-action="resume"]')).toHaveCount(0);
  const agree = await commonHashes(a, b);
  expect(agree.differing).toEqual([]);
});

test('B offline for 5 s: A shows the sleeping face; back online, play goes on, hashes equal', async ({ browser }) => {
  const a = await device(browser);
  const b = await device(browser);
  await startVersus(a, b);
  await Promise.all([recordHashes(a), recordHashes(b)]);

  await b.context().setOffline(true);
  await expect(a.locator('[data-stall-veil] [data-face-of="p02"]')).toBeVisible();
  await a.waitForTimeout(5000);
  const stopped = await versusTick(a);
  await b.context().setOffline(false);
  // The browser itself logs each request it could not make while the cut was on: that is the cut, not a fault.
  const cut = versusProblems(b);
  cut.errors = cut.errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED/.test(e));
  await expect(a.locator('[data-stall-veil]')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => versusTick(a), { timeout: 10_000 }).toBeGreaterThan(stopped + 30);
  await expect.poll(() => versusTick(b), { timeout: 10_000 }).toBeGreaterThan(stopped + 30);
  await a.waitForTimeout(1500);
  const agree = await commonHashes(a, b);
  expect(agree.common).toBeGreaterThan(20);
  expect(agree.differing).toEqual([]);
});

/** Toby sends a zombie now and then until the plants' base falls and the result shows on both. */
async function zombiesAttack(b: Page, both: Page[]): Promise<void> {
  await expect.poll(async () => {
    for (const p of both) if (await p.locator('[data-versus-result]').count() > 0) return true;
    try {
      const key = await cheapest(b);
      await placeUnit(b, key, 2, 9);
    } catch {
      // nothing affordable yet
    }
    return false;
  }, { timeout: 100_000, intervals: [1500] }).toBe(true);
  for (const p of both) await expect(p.locator('[data-versus-result]')).toBeVisible({ timeout: 15_000 });
}

const wins = async (slot: string): Promise<number> => ((await fakePeek(`v2test/board/${slot}`)) as { versusWins?: number } | null)?.versusWins ?? 0;

test('vstest=40: the match ends, one winner on both, credited once; rematch swaps sides', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await device(browser, { testBaseHp: 40 });
  const b = await device(browser, { testBaseHp: 40 });
  await startVersus(a, b);
  expect(await wins('p01')).toBe(0);
  expect(await wins('p02')).toBe(0);
  const lukasTray = await trayKeys(a);
  const tobyTray = await trayKeys(b);

  await zombiesAttack(b, [a, b]);
  const winnerOn = (p: Page) => p.locator('[data-versus-result] [data-winner] [data-face-of]').getAttribute('data-face-of');
  expect(await winnerOn(a)).toBe('p02');
  expect(await winnerOn(b)).toBe('p02');
  await a.waitForTimeout(2500); // any second credit would have landed by now
  expect(await wins('p02')).toBe(1);
  expect(await wins('p01')).toBe(0);

  // Rematch on both: the sides swap, so each boy's tray is the other side's cards.
  await a.locator('[data-versus-result] [data-action="rematch"]').click();
  await expect(b.locator('[data-versus-result][data-rematch="theirs"]')).toBeVisible();
  await b.locator('[data-versus-result] [data-action="rematch"]').click();
  await Promise.all([waitLive(a), waitLive(b)]);
  expect(await mySide(a)).toBe('zombies');
  expect(await mySide(b)).toBe('plants');
  expect(await trayKeys(a)).toEqual(tobyTray);
  expect(await trayKeys(b)).toEqual(lukasTray);
});

test("B's page closed: A shows the face, then the white flag; the flag goes home with no credit", async ({ browser }) => {
  const a = await device(browser);
  const b = await device(browser);
  await startVersus(a, b);

  await closeVersusPage(b);
  opened = opened.filter((p) => p !== b);
  await expect(a.locator('[data-stall-veil][data-stall="face"] [data-face-of="p02"]')).toBeVisible();
  await expect(a.locator('[data-stall-veil][data-stall="flag"] [data-action="flag"]')).toBeVisible({ timeout: 15_000 });
  await a.locator('[data-action="flag"]').click();
  // Nobody won: a notice with one home button, and no credit for anyone.
  await expect(a.locator('[data-screen="vs-notice"]')).toBeVisible({ timeout: 15_000 });
  await a.locator('[data-screen="vs-notice"] [data-action="home"]').click();
  await expect(a.locator('[data-screen="home"], [data-screen="title"]').first()).toBeVisible();
  expect(await wins('p01')).toBe(0);
  expect(await wins('p02')).toBe(0);
});

test('different builds: both devices show the update picture', async ({ browser }) => {
  const a = await device(browser, { build: 'aaaaaaa' });
  const b = await device(browser, { build: 'bbbbbbb' });
  await logIn(a, '123', 'p01');
  await logIn(b, '123', 'p02');
  await invite(a, 'p02');
  await acceptInvite(b);
  await expect(a.locator('[data-notice="update"]')).toBeVisible({ timeout: 20_000 });
  await expect(b.locator('[data-notice="update"]')).toBeVisible({ timeout: 20_000 });
  await shot(a, 'update');
  // One home button, and it goes home.
  await a.locator('[data-notice="update"] [data-action="home"]').click();
  await expect(a.locator('[data-notice]')).toHaveCount(0);
});

/** A drag from a card onto a tile with a finger-like pointer: down on the card, move, up on the tile. */
async function dragCard(page: Page, key: string, lane: number, col: number): Promise<void> {
  const card = (await page.locator(`[data-hud="tray"] [data-card="${key}"]`).boundingBox())!;
  const to = await tilePoint(page, lane, col);
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('five-year-old walk-through by taps only, with the screenshot tour', async ({ browser }) => {
  test.setTimeout(240_000);
  const lukas = await device(browser, { testBaseHp: 40 });
  const toby = await device(browser, { testBaseHp: 40 });
  await logIn(lukas, '123', 'p01');
  await logIn(toby, '123', 'p02');

  // Toby finds the swords tile (Play, then the tile with two tablets), then Lukas's face.
  await toby.locator('[data-home="play"]').click();
  await toby.locator('[data-play="versus"]').click();
  await expect(toby.locator('[data-face="p01"]')).toBeVisible();
  await shot(toby, 'here');
  await toby.locator('[data-face="p01"]').click();
  await expect(toby.locator('[data-invite-card][data-state="draft"]')).toBeVisible();
  await shot(toby, 'card');
  // He presses the big swords and waits.
  await toby.locator('[data-invite-card] [data-action="send"]').click();
  await expect(toby.locator('[data-invite-card][data-state="waiting"]')).toBeVisible();
  await expect(toby.locator('[data-dots]')).toBeVisible();
  await shot(toby, 'waiting');
  // Lukas's panel comes down; he says no first: Toby's card shows the cross over his face.
  await expect(lukas.locator('[data-invite-panel]')).toBeVisible();
  await lukas.waitForTimeout(500);
  await shot(lukas, 'panel');
  await lukas.locator('[data-invite-panel] [data-action="decline"]').click();
  await expect(toby.locator('[data-invite-card][data-state="refused"] [data-stamp]')).toBeVisible();
  // Toby tries again, and this time Lukas ticks.
  await expect(toby.locator('[data-screen="whoishere"]')).toBeVisible();
  await expect(toby.locator('[data-invite-card]')).toHaveCount(0, { timeout: 5000 });
  await toby.locator('[data-face="p01"]').click();
  await toby.locator('[data-invite-card] [data-action="send"]').click();
  await expect(lukas.locator('[data-invite-panel]')).toBeVisible();
  await lukas.locator('[data-invite-panel] [data-action="accept"]').click();
  // READY... FIGHT! (a short screen: the picture is taken if it was caught).
  const ready = lukas.locator('[data-screen="vs-ready"]');
  if (await ready.isVisible().catch(() => false)) await shot(lukas, 'ready');
  await Promise.all([waitLive(lukas), waitLive(toby)]);
  await frames(lukas, 20);
  await shot(lukas, 'battle');

  // Lukas drags a plant; Toby drags a zombie. Both see both.
  const plant = await cheapest(lukas);
  const zombie = await cheapest(toby);
  await dragCard(lukas, plant, 1, 1);
  await dragCard(toby, zombie, 3, 9);
  await expect.poll(async () => Math.min(await unitCount(lukas), await unitCount(toby)), { timeout: 2000, intervals: [25] }).toBeGreaterThanOrEqual(2);
  await shot(toby, 'puff');
  // A refusal buzzes: a card that is still recharging, on a tile, moves the refused counter (the tray shakes, "uh-uh").
  const before = await deniedCount(toby);
  await placeUnit(toby, zombie, 1, 9); // the card he just used is still recharging
  await expect.poll(() => deniedCount(toby), { timeout: 3000 }).toBeGreaterThan(before);

  // Toby's iPad sleeps: Lukas sees his face, big, with Zzz.
  await toby.context().setOffline(true);
  await expect(lukas.locator('[data-stall="face"] [data-zzz]')).toBeVisible();
  await lukas.waitForTimeout(400);
  await shot(lukas, 'sleep');
  await toby.context().setOffline(false);
  const cut = versusProblems(toby);
  cut.errors = cut.errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED/.test(e));
  await expect(lukas.locator('[data-stall-veil]')).toHaveCount(0, { timeout: 15_000 });

  // Toby pauses; Lukas sees his face with the pause sign, and resumes for both.
  await toby.locator('[data-hud="pause"]').click();
  await expect(lukas.locator('[data-screen="vs-paused"] [data-pause-sign]')).toBeVisible();
  await lukas.waitForTimeout(400);
  await shot(lukas, 'pause-face');
  await lukas.locator('[data-screen="vs-paused"] [data-action="resume"]').click();
  await expect(lukas.locator('[data-screen="vs-paused"]')).toHaveCount(0);

  // The match runs to its end (zombies keep coming); the winner's face is big on both screens.
  await zombiesAttack(toby, [lukas, toby]);
  await lukas.waitForTimeout(600);
  await shot(lukas, 'result');
  await shot(toby, 'result-winner');
  // Lukas taps the rematch: Toby's iPad shows a tick on his face; Toby taps too; sides swap.
  await lukas.locator('[data-versus-result] [data-action="rematch"]').click();
  await expect(toby.locator('[data-versus-result][data-rematch="theirs"] [data-answer="yes"]').first()).toBeVisible();
  await shot(toby, 'rematch');
  await toby.locator('[data-versus-result] [data-action="rematch"]').click();
  await Promise.all([waitLive(lukas), waitLive(toby)]);
  expect(await mySide(lukas)).toBe('zombies');
  await frames(lukas, 20);
  await shot(lukas, 'swapped');

  // Toby's iPad is shut for good: the face, then the white flag, which ends it and goes home.
  await closeVersusPage(toby);
  opened = opened.filter((p) => p !== toby);
  await expect(lukas.locator('[data-stall="face"]')).toBeVisible();
  await expect(lukas.locator('[data-stall="flag"] [data-action="flag"]')).toBeVisible({ timeout: 15_000 });
  await lukas.waitForTimeout(400);
  await shot(lukas, 'flag');
  await lukas.locator('[data-action="flag"]').click();
  await expect(lukas.locator('[data-screen="vs-notice"]')).toBeVisible({ timeout: 15_000 });
  await shot(lukas, 'gone');
  await lukas.locator('[data-screen="vs-notice"] [data-action="home"]').click();
  await expect(lukas.locator('[data-screen="home"], [data-screen="title"]').first()).toBeVisible();
});

// The overlays on their own (`?scene=hud-gallery&view=versus`): each shows, and the waiting faces and
// buttons sit above the card tray, which fills the bottom of a battle.
const OVERLAYS: readonly [overlay: string, selector: string][] = [
  ['ready', '[data-screen="vs-ready"] [data-block]'],
  ['hourglass', '[data-stall="hourglass"]'],
  ['face', '[data-stall="face"] [data-zzz]'],
  ['flag', '[data-stall="flag"] [data-action="flag"]'],
  ['paused', '[data-screen="vs-paused"] [data-pause-sign]'],
  ['result', '[data-versus-result] [data-winner]'],
  ['update', '[data-notice="update"]'],
  ['broken', '[data-notice="broken"]'],
  ['shrug', '[data-notice="shrug"]'],
  ['gone', '[data-notice="gone"]'],
];

for (const side of ['plants', 'zombies'] as const) {
  test(`HUD gallery: the Versus overlays (Lukas on ${side})`, async ({ page }) => {
    for (const [overlay, selector] of OVERLAYS) {
      await page.goto(`/?scene=hud-gallery&debug&cloud=fake&view=versus&overlay=${overlay}&side=${side}`);
      await page.waitForFunction(() => (window.__lvt as { hudReady?: Promise<void> }).hudReady?.then(() => true));
      await expect(page.locator(selector).first(), overlay).toBeVisible();
      await page.waitForTimeout(450); // the pop-in
      if (side === 'plants') await shot(page, overlay === 'ready' ? 'ready' : `gallery-${overlay}`);
      if (['face', 'flag', 'paused'].includes(overlay)) {
        const tray = (await page.locator('[data-hud="tray"]').boundingBox())!;
        const parts = await page.locator('.vs-stall [data-face-pic], .vs-stall [data-line], .vs-stall [data-action]').evaluateAll(
          (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { name: (e as HTMLElement).dataset.action ?? (e as HTMLElement).dataset.line ?? 'face', top: r.top, bottom: r.bottom }; }),
        );
        for (const part of parts) {
          expect(part.bottom, `${overlay}: ${part.name} stays above the tray`).toBeLessThanOrEqual(tray.y + 1);
          expect(part.top, `${overlay}: ${part.name} stays below the top bar`).toBeGreaterThanOrEqual(60);
        }
      }
    }
  });
}
