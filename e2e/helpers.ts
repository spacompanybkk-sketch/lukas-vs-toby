import type { Browser, Page } from '@playwright/test';
import { expect, watchPage } from './fixtures';
import type { Problems } from './fixtures';

/** A player's place on the players' screen: `p01` (Lukas) … `p30`. */
export type Slot = `p${string}`;
export type Side = 'plants' | 'zombies';
export type Skill = 'easy' | 'medium' | 'hard';

/** What a test reads of the running match. */
export interface Snapshot {
  tick: number;
  live: boolean;
  paused: boolean;
  energy: number;
  winner: string | null;
  units: { id: number; key: string; faction: string; lane: number; x: number; level: number; spent: number }[];
}

/** Opens the title and waits for the first picture and the card portraits. */
export async function openTitle(page: Page): Promise<void> {
  await page.goto('/?debug&cloud=fake'); // the hooks on window.__lvt are there only with ?debug in a build
  await page.evaluate(() => window.__lvt.ready);
  await page.evaluate(() => window.__lvt.portraits);
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
}

/** Taps a number on the open number pad. */
export async function typePin(page: Page, pin: string): Promise<void> {
  for (const d of pin) await page.locator(`[data-key="${d}"]`).click();
}

/**
 * Title → PLAY → the players' pictures → Lukas → his number (chosen twice the first time on this
 * fresh browser, typed once after that) → Home. Only taps, on the fake cloud.
 */
export async function logIn(page: Page, pin = '123', slot: Slot = 'p01'): Promise<void> {
  await page.locator('[data-action="play"]').click();
  await page.locator(`[data-player="${slot}"]`).click();
  const choosing = page.locator('[data-pin-step="1"]');
  const pad = page.locator('[data-screen="pinpad"]');
  await expect(choosing.or(pad)).toBeVisible();
  await typePin(page, pin);
  if (await page.locator('[data-pin-step]').count() > 0) {
    await expect(page.locator('[data-pin-step="2"]')).toBeVisible();
    await typePin(page, pin);
  }
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
}

/**
 * From the title (logging in as Lukas) or from Home: Play → Quick Battle → pick a side and difficulty → START.
 * Does not wait for the fight to begin.
 */
export async function pickAndStart(page: Page, side: Side, skill: Skill = 'medium'): Promise<void> {
  if (await page.locator('[data-screen="title"]').isVisible()) await logIn(page);
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-play="quick"]').click();
  await page.locator('[data-screen="sidepick"]').waitFor();
  await page.locator(`[data-side="${side}"]`).click();
  await page.locator(`[data-skill="${skill}"]`).click();
  await page.locator('[data-action="start"]').click();
}

/** Frames the stage has drawn so far (0 without one). */
const drawn = (page: Page): Promise<number> => page.evaluate(() => ((window.__lvt as any).stage?.frames as number | undefined) ?? 0);

/**
 * Waits until the READY… and FIGHT! banners are gone and the simulation is running. The opening
 * camera move and the banners run on real frames: if they never finish, the error says whether
 * the page drew at all in that time (a starved page: the machine or its GPU was too busy) or drew
 * and still did not begin (a bug).
 */
export async function waitLive(page: Page): Promise<void> {
  const before = await drawn(page);
  try {
    await page.waitForFunction(() => {
      const lvt = window.__lvt as { session?: { live?: boolean } | null };
      return lvt.session?.live === true;
    }, undefined, { timeout: 30_000 });
  } catch (e) {
    const after = await drawn(page);
    throw new Error(
      after - before < 30
        ? `the battle did not begin: the page drew only ${after - before} frames in 30 s (starved by a busy machine)`
        : `the battle did not begin although the page drew ${after - before} frames: ${String(e)}`,
    );
  }
  await expect(page.locator('[data-banner]')).toHaveCount(0);
}

/**
 * Decides the match at once through the debug hooks: `loser`'s base is knocked down and the
 * match steps once, so the result does not wait on the live loop's next step.
 */
export async function forceResult(page: Page, loser: Side): Promise<void> {
  await page.evaluate((l) => {
    const lvt = window.__lvt as any;
    lvt.damageBase(l, 99999);
    lvt.fastForward(1);
  }, loser);
  expect(await page.evaluate(() => (window.__lvt as any).session.controller.hud.result.value !== null)).toBe(true);
}

/** From a fresh page to a live battle. */
export async function startBattle(page: Page, side: Side, skill: Skill = 'medium'): Promise<void> {
  await openTitle(page);
  await pickAndStart(page, side, skill);
  await waitLive(page);
}

export function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = (window.__lvt as any).session;
    const state = s.controller.match.state;
    return {
      tick: state.tick as number,
      live: s.live as boolean,
      paused: s.controller.hud.paused.value as boolean,
      energy: state.players[s.controller.playerFaction].energy as number,
      winner: state.winner as string | null,
      units: state.units.map((u: any) => ({
        id: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level, spent: u.spent,
      })),
    };
  });
}

/** Client position of a tile's middle. */
export function tilePoint(page: Page, lane: number, col: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([l, c]) => {
    const at = (window.__lvt as any).tileToClient(l, c);
    if (!at) throw new Error('no battle');
    return at as { x: number; y: number };
  }, [lane, col] as const);
}

/** A mouse click on the middle of a tile. */
export async function clickTile(page: Page, lane: number, col: number): Promise<void> {
  const at = await tilePoint(page, lane, col);
  await page.mouse.click(at.x, at.y);
}

/** The card's price, read from the card itself ("Sunflower, 50"). */
export async function cardPrice(page: Page, key: string): Promise<number> {
  const label = (await page.locator(`[data-card="${key}"]`).getAttribute('aria-label')) ?? '';
  const price = Number(label.split(',').pop());
  expect(Number.isFinite(price), `price in "${label}"`).toBe(true);
  return price;
}

/** Plants of the player's side standing on the tile. */
export function plantAt(snap: Snapshot, lane: number, col: number): Snapshot['units'][number] | undefined {
  return snap.units.find((u) => u.faction === 'plants' && u.lane === lane && Math.floor(u.x) === col);
}

/** How many WebGL contexts the page has created so far (see the init script in fixtures.ts). */
export function glContexts(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __glContexts: number }).__glContexts);
}

/** Resolves after `n` animation frames: time that is counted in what the game draws, not in a sleep. */
export function frames(page: Page, n: number): Promise<void> {
  return page.evaluate(
    (count) => new Promise<void>((resolve) => {
      let left = count;
      const tick = (): void => { if (--left <= 0) resolve(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

/** Runs the match on with no drawing (a test hook) until a card has recharged. */
export async function waitCardReady(page: Page, key: string): Promise<void> {
  await expect.poll(async () => {
    await page.evaluate(() => (window.__lvt as any).fastForward(15));
    return page.locator(`[data-card="${key}"]`).evaluate((el) => !el.classList.contains('is-recharging') && !el.classList.contains('is-disabled'));
  }, { timeout: 30_000, intervals: [50] }).toBe(true);
}

/** A picture of the 3D canvas alone: the HTML layer is hidden for the shot. PNG as base64, in CSS pixels. */
export async function shootCanvas(page: Page): Promise<string> {
  await page.evaluate(() => { (document.getElementById('ui') as HTMLElement).style.visibility = 'hidden'; });
  try {
    await frames(page, 2);
    return (await page.screenshot({ scale: 'css' })).toString('base64');
  } finally {
    await page.evaluate(() => { (document.getElementById('ui') as HTMLElement).style.visibility = ''; });
  }
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface Rgb { r: number; g: number; b: number }

/**
 * Reads pictures from `shootCanvas`: for the first picture its overall spread (standard deviation
 * of brightness and how many 4-bit colours it holds), the mean colour of each rectangle, and for
 * each rectangle the mean absolute difference between the first and the second picture.
 */
export function analyse(page: Page, images: string[], rects: Rect[]): Promise<{
  stddev: number; colors: number; means: Rgb[]; diffs: number[];
}> {
  return page.evaluate(async ([pics, boxes]) => {
    const load = async (b64: string): Promise<ImageData> => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d') as OffscreenCanvasRenderingContext2D;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [a, b] = await Promise.all(pics.map(load)) as [ImageData, ImageData | undefined];
    const seen = new Set<number>();
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let i = 0; i < a.data.length; i += 16) {
      const r = a.data[i] as number, g = a.data[i + 1] as number, bl = a.data[i + 2] as number;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      sum += lum; sumSq += lum * lum; n += 1;
      seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (bl >> 4));
    }
    const mean = sum / n;
    const means = boxes.map((box) => {
      let r = 0, g = 0, bl = 0, count = 0;
      for (let y = Math.round(box.y); y < Math.round(box.y + box.h); y++) {
        for (let x = Math.round(box.x); x < Math.round(box.x + box.w); x++) {
          const k = (y * a.width + x) * 4;
          r += a.data[k] as number; g += a.data[k + 1] as number; bl += a.data[k + 2] as number; count += 1;
        }
      }
      return { r: r / count, g: g / count, b: bl / count };
    });
    const diffs = boxes.map((box) => {
      if (!b) return 0;
      let d = 0, count = 0;
      for (let y = Math.round(box.y); y < Math.round(box.y + box.h); y++) {
        for (let x = Math.round(box.x); x < Math.round(box.x + box.w); x++) {
          const k = (y * a.width + x) * 4;
          d += Math.abs((a.data[k] as number) - (b.data[k] as number)) + Math.abs((a.data[k + 1] as number) - (b.data[k + 1] as number))
            + Math.abs((a.data[k + 2] as number) - (b.data[k + 2] as number));
          count += 3;
        }
      }
      return d / count;
    });
    return { stddev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), colors: seen.size, means, diffs };
  }, [images, rects] as const);
}

/** A square of `size` CSS pixels centred on a point. */
export const around = (at: { x: number; y: number }, size = 12, dy = 0): Rect => ({ x: at.x - size / 2, y: at.y + dy - size / 2, w: size, h: size });

/**
 * Client position of a point `frac` of the way up a unit's drawn model (0 its feet, 1 its top),
 * as drawn: it waits two frames first, so a fast-forward has reached the picture.
 */
export async function unitPoint(page: Page, id: number, frac: number): Promise<{ x: number; y: number }> {
  await frames(page, 2);
  return page.evaluate(([unitId, f]) => {
    const lvt = window.__lvt as any;
    const view = lvt.session.view.unit(unitId);
    if (!view) throw new Error(`no view for unit ${unitId}`);
    view.wrapper.updateMatrixWorld(true);
    const p = view.wrapper.position.clone();
    p.y += view.height * f;
    p.project(lvt.stage.camera);
    const r = (lvt.stage.canvas as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (0.5 - p.y * 0.5) * r.height };
  }, [id, frac] as const);
}

/** Starts recording the match's `unitMerged` events; `mergedEvents` reads them. */
export function recordMerges(page: Page): Promise<void> {
  return page.evaluate(() => {
    const c = (window.__lvt as any).session.controller;
    const step = c.step.bind(c);
    c.__merged = [];
    c.step = () => {
      const events = step();
      for (const e of events) if (e.type === 'unitMerged') c.__merged.push({ unitId: e.unitId, level: e.level });
      return events;
    };
  });
}

export function mergedEvents(page: Page): Promise<{ unitId: number; level: number }[]> {
  return page.evaluate(() => [...((window.__lvt as any).session.controller.__merged ?? [])]);
}

/** How many level-up markers the battle shows. */
export function mergeMarkers(page: Page): Promise<number> {
  return page.evaluate(() => (window.__lvt as any).session.view.mergeMarkers as number);
}

/** The refused-action counter (the tray shakes on each change). */
export function deniedCount(page: Page): Promise<number> {
  return page.evaluate(() => (window.__lvt as any).session.controller.hud.denied.value as number);
}

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

/** Whether a box and a convex polygon share any area (separating axis test). */
export function boxHitsPolygon(b: Box, poly: Point[]): boolean {
  const rect: Point[] = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  const axes: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] as Point;
    axes.push({ x: -(q.y - p.y), y: q.x - p.x });
  });
  for (const ax of axes) {
    const proj = (pts: Point[]): [number, number] => {
      const v = pts.map((p) => p.x * ax.x + p.y * ax.y);
      return [Math.min(...v), Math.max(...v)];
    };
    const [a0, a1] = proj(rect);
    const [b0, b1] = proj(poly);
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}

/** Client corners of the live battle's lanes 0–4 (back-left, back-right, front-right, front-left). */
export function lawnCorners(page: Page): Promise<Point[]> {
  return page.evaluate(() => {
    const corners = (window.__lvt as any).lawnCorners();
    if (!corners) throw new Error('no battle');
    return corners as { x: number; y: number }[];
  });
}

/** A name must be visible, on one line, and fully inside its tile. */
export async function nameFitsTile(page: Page, tile: string, name: string, word: string): Promise<void> {
  const label = page.locator(`${tile} ${name}`);
  await expect(label).toBeVisible();
  await expect(label).toHaveText(new RegExp(`^${word}$`, 'i'));
  const r = await page.evaluate(([t, n]) => {
    const a = document.querySelector(t!)!.getBoundingClientRect();
    const el = document.querySelector(`${t} ${n}`)! as HTMLElement;
    const b = el.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return { l: b.left - a.left, r: a.right - b.right, t: b.top - a.top, b: a.bottom - b.bottom, h: b.height, lh, over: el.scrollWidth - el.clientWidth };
  }, [tile, name]);
  expect(r.l).toBeGreaterThanOrEqual(4);
  expect(r.r).toBeGreaterThanOrEqual(4);
  expect(r.t).toBeGreaterThanOrEqual(0);
  expect(r.b).toBeGreaterThanOrEqual(4);
  expect(r.h).toBeLessThanOrEqual(r.lh * 1.5); // one line
  expect(r.over).toBeLessThanOrEqual(0);
}

/** A plant of `key` put on (lane, col) through the controller (debug hooks): paid for and recharged first. */
export async function plantVia(page: Page, key: string, lane: number, col: number): Promise<void> {
  await page.evaluate(([k, l, c]) => {
    const lvt = window.__lvt as any;
    const ctl = lvt.session.controller;
    const me = ctl.match.state.players.plants;
    me.energy = Math.max(me.energy, 9999);
    me.recharge = {};
    ctl.select(k);
    ctl.click({ lane: l, col: c }, null);
    lvt.fastForward(1);
  }, [key, lane, col] as const);
  await expect.poll(async () => plantAt(await snapshot(page), lane, col)?.key ?? null).toBe(key);
}

// ---- two devices: Versus over the local fake database (tools/fake-rtdb-server.ts) ----

/** Where the stand-in database server listens (the same variable moves it in playwright.config.ts). */
export const FAKEDB_URL = `http://localhost:${Number(process.env.LVT_FAKEDB_PORT) || 5316}`;

/** Every extra page opened by `openVersusPage`, with what went wrong on it. */
const watched = new Map<Page, Problems>();

/**
 * A second (or first) device: its own browser context (own storage, own connection), the iPad's
 * size and touch, low graphics, sound off, on `/?debug&cloud=fake&fakedb=…&vsquick` (every Versus
 * timeout a thirtieth). `build` puts the page on another build id, `testBaseHp` makes the bases
 * that tough (a short match). Waits for the title.
 */
export async function openVersusPage(browser: Browser, opts: { build?: string; testBaseHp?: number } = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try { localStorage.setItem('lvt2_settings', JSON.stringify({ music: 0, sfx: 0, muted: true, quality: 'low' })); } catch { /* none */ }
  });
  // A different build id makes the update notice reload the page once for a newer build (sessionStorage flag,
  // see staleBuild.ts). The flag is set up front so the notice stays on screen for the test to see.
  if (opts.build !== undefined) {
    await context.addInitScript(() => {
      try { sessionStorage.setItem('lvt2_stale_reload', '1'); } catch { /* none */ }
    });
  }
  const page = await context.newPage();
  watched.set(page, await watchPage(page));
  const query = ['debug', 'cloud=fake', `fakedb=${FAKEDB_URL}`, 'vsquick'];
  if (opts.testBaseHp !== undefined) query.push(`vstest=${opts.testBaseHp}`);
  if (opts.build !== undefined) query.push(`vsbuild=${opts.build}`);
  await page.goto(`/?${query.join('&')}`);
  await page.evaluate(() => window.__lvt.ready);
  await page.evaluate(() => window.__lvt.portraits);
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  return page;
}

/** What went wrong on a page opened by `openVersusPage` (console errors, WebGL warnings). */
export function versusProblems(page: Page): Problems {
  const p = watched.get(page);
  if (p === undefined) throw new Error('not a page from openVersusPage');
  return p;
}

/** Closes the context of a page from `openVersusPage` (and forgets it). */
export async function closeVersusPage(page: Page): Promise<void> {
  watched.delete(page);
  await page.context().close().catch(() => {});
}

/** The stored value at a path under the test root (`v2test/…`), rules aside. */
export async function fakePeek(path: string): Promise<unknown> {
  const r = await fetch(`${FAKEDB_URL}/__peek?path=${encodeURIComponent(path)}`);
  return r.json();
}

/** Empties the fake database (both pages' next log-in starts from nothing). */
export async function fakeReset(): Promise<void> {
  await fetch(`${FAKEDB_URL}/__reset`, { method: 'POST' });
}

/** Taps Play, then the Versus tile: "who is here". */
export async function openWhoIsHere(page: Page): Promise<void> {
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-play="versus"]').click();
  await expect(page.locator('[data-screen="whoishere"]')).toBeVisible();
}

/** From Home: who is here → the other boy's face → the big swords. */
export async function invite(page: Page, to: Slot): Promise<void> {
  await openWhoIsHere(page);
  await page.locator(`[data-face="${to}"]`).click();
  await page.locator('[data-invite-card] [data-action="send"]').click();
}

/** On the invited device: the panel's tick. */
export async function acceptInvite(page: Page): Promise<void> {
  await page.locator('[data-invite-panel] [data-action="accept"]').click();
}

/** Both devices to the same live Versus battle: Lukas (p01) invites Toby (p02), Toby accepts. */
export async function startVersus(lukas: Page, toby: Page): Promise<void> {
  await logIn(lukas, '123', 'p01');
  await logIn(toby, '123', 'p02');
  await invite(lukas, 'p02');
  await acceptInvite(toby);
  await Promise.all([waitLive(lukas), waitLive(toby)]);
}

/** Records (tick → hash) of the Versus match on this page, on every frame, for `commonHashes`. */
export function recordHashes(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as { __hashes?: Record<number, number>; __lvt: { versus?: { hash(): number; tick(): number } } };
    w.__hashes = {};
    const tick = (): void => {
      const v = w.__lvt.versus;
      if (v !== undefined) {
        const t = v.tick();
        if (t >= 0 && w.__hashes![t] === undefined) w.__hashes![t] = v.hash();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** The ticks both pages have a recorded hash for, and the ones where the hashes differ. */
export async function commonHashes(a: Page, b: Page): Promise<{ common: number; differing: number[] }> {
  const read = (p: Page): Promise<Record<number, number>> => p.evaluate(() => (window as unknown as { __hashes: Record<number, number> }).__hashes);
  const [ha, hb] = await Promise.all([read(a), read(b)]);
  const ticks = Object.keys(ha).filter((t) => hb[Number(t)] !== undefined);
  return { common: ticks.length, differing: ticks.filter((t) => ha[Number(t)] !== hb[Number(t)]).map(Number) };
}

/** The Versus match's tick on this page (-1 before one). */
export const versusTick = (page: Page): Promise<number> => page.evaluate(() => (window.__lvt as any).versus.tick() as number);

/** The keys of the cards in this page's tray, left to right. */
export const trayKeys = (page: Page): Promise<string[]> =>
  page.locator('[data-hud="tray"] [data-card]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card as string));

/** This boy's side in the live match. */
export const mySide = (page: Page): Promise<Side> => page.evaluate(() => (window.__lvt as any).session.controller.playerFaction as Side);

/**
 * Taps a card and then a tile (real taps). A boy's own units go where his side starts: plants on
 * the left, zombies at the right edge.
 */
export async function placeUnit(page: Page, key: string, lane: number, col: number): Promise<void> {
  await page.locator(`[data-hud="tray"] [data-card="${key}"]`).click();
  await clickTile(page, lane, col);
}

/** How many units the match shows on this page. */
export const unitCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window.__lvt as any).session.controller.match.state.units.length as number);
