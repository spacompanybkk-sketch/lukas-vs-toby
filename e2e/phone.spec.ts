import { expect, test } from './fixtures';
import { openTitle } from './helpers';

// A phone gets only the notice: decided by the device screen, before the game mounts.
// Chromium emulation: `screen` sets screen.width/height, hasTouch gives maxTouchPoints.

const LINE = 'THIS GAME IS FOR iPAD AND COMPUTERS';

for (const [w, h] of [[390, 844], [320, 568], [667, 375]] as const) {
  test(`a ${w}x${h} phone shows only the notice, no canvas, no database request`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'one run is enough');
    const context = await browser.newContext({
      viewport: { width: w, height: h }, screen: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const hosts: string[] = [];
    const errors: string[] = [];
    page.on('request', (r) => { if (/^https?:/.test(r.url())) hosts.push(new URL(r.url()).host); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      (window as unknown as { __gl: number }).__gl = 0;
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...a: Parameters<typeof original>) {
        (window as unknown as { __gl: number }).__gl += 1;
        return original.apply(this, a);
      } as never;
    });
    await page.goto('/?cloud=fake');
    const notice = page.locator('[data-screen="phone"]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(LINE);
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('button, a, [data-screen="title"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __gl: number }).__gl)).toBe(0);
    const fit = await page.evaluate(() => {
      const b = (document.querySelector('.phone__panel') as HTMLElement).getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, bt: b.bottom, w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
    });
    expect(fit.l).toBeGreaterThanOrEqual(0);
    expect(fit.t).toBeGreaterThanOrEqual(0);
    expect(fit.r).toBeLessThanOrEqual(fit.w);
    expect(fit.bt).toBeLessThanOrEqual(fit.h);
    expect(fit.sw).toBeLessThanOrEqual(fit.w);
    expect(fit.sh).toBeLessThanOrEqual(fit.h);
    // Only the page's own host was asked for anything: no Firebase, no Google.
    expect([...new Set(hosts)]).toEqual(['localhost:' + new URL(page.url()).port]);
    expect(errors).toEqual([]);
    if (process.env.LVT_PHONE_SHOTS) await page.screenshot({ path: `${process.env.LVT_PHONE_SHOTS}/phone-${w}x${h}.png` });
    await context.close();
  });
}

test('?debug lets a phone through to the game', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('/?debug&cloud=fake');
  await expect(page.locator('[data-screen="phone"]')).toHaveCount(0);
  await page.evaluate(() => window.__lvt.ready);
  await context.close();
});

test('a small window on a big screen still gets the game', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 }); // window only; the screen stays desktop-sized
  await openTitle(page);
  await expect(page.locator('[data-screen="phone"]')).toHaveCount(0);
});
