import type { Page } from '@playwright/test';
import { expect } from './fixtures';

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
  await page.goto('/');
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
export async function logIn(page: Page, pin = '123'): Promise<void> {
  await page.locator('[data-action="play"]').click();
  await page.locator('[data-player="p01"]').click();
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
 * From the title (logging in as Lukas) or from Home: Play → pick a side and difficulty → START.
 * Does not wait for the fight to begin.
 */
export async function pickAndStart(page: Page, side: Side, skill: Skill = 'medium'): Promise<void> {
  if (await page.locator('[data-screen="title"]').isVisible()) await logIn(page);
  await page.locator('[data-home="play"]').click();
  await page.locator('[data-screen="sidepick"]').waitFor();
  await page.locator(`[data-side="${side}"]`).click();
  await page.locator(`[data-skill="${skill}"]`).click();
  await page.locator('[data-action="start"]').click();
}

/** Waits until the READY… and FIGHT! banners are gone and the simulation is running. */
export async function waitLive(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const lvt = window.__lvt as { session?: { live?: boolean } | null };
    return lvt.session?.live === true;
  }, undefined, { timeout: 30_000 });
  await expect(page.locator('[data-banner]')).toHaveCount(0);
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
