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

/** Title → PLAY → pick a side and difficulty → START. Does not wait for the fight to begin. */
export async function pickAndStart(page: Page, side: Side, skill: Skill = 'medium'): Promise<void> {
  await page.locator('[data-action="play"]').click();
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
