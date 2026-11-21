import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import type { LaunchOptions, Page } from '@playwright/test';
import { GL_ARGS_FILE } from './global-setup';

/** What went wrong on a page: console errors, uncaught exceptions, and WebGL context warnings. */
export interface Problems { errors: string[]; contextWarnings: string[] }

function glArgs(): string[] {
  try {
    return JSON.parse(readFileSync(GL_ARGS_FILE, 'utf8')) as string[];
  } catch {
    return [];
  }
}

/**
 * Starts recording what goes wrong on a page (console errors, uncaught exceptions, WebGL context
 * warnings, a navigation without cloud=fake) and counting its WebGL contexts. Call it before the
 * first navigation. Every test page gets it from the fixture; an extra page (a second player's
 * device) calls it itself and checks the result with `expectClean`.
 */
export async function watchPage(page: Page): Promise<Problems> {
  const problems: Problems = { errors: [], contextWarnings: [] };
  // Counts the WebGL contexts the page creates (one per canvas and kind), so a leaked one shows.
  await page.addInitScript(() => {
    const made = new WeakSet<object>();
    const w = window as unknown as { __glContexts: number };
    w.__glContexts = 0;
    for (const proto of [HTMLCanvasElement.prototype, OffscreenCanvas.prototype] as { getContext: (...a: unknown[]) => unknown }[]) {
      const original = proto.getContext;
      proto.getContext = function (this: object, kind: unknown, ...rest: unknown[]) {
        const context = original.call(this, kind, ...rest);
        if (context && /webgl/.test(String(kind)) && !made.has(context as object)) {
          made.add(context as object);
          w.__glContexts += 1;
        }
        return context;
      } as never;
    }
  });
  page.on('pageerror', (e) => problems.errors.push(`pageerror: ${e.message}`));
  // Every page a test opens is on the fake cloud: a URL without cloud=fake fails the test.
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = new URL(frame.url());
    if (url.protocol.startsWith('http') && url.searchParams.get('cloud') !== 'fake') {
      problems.errors.push(`navigation without cloud=fake: ${frame.url()}`);
    }
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.errors.push(`console.error: ${m.text()}`);
    if ((m.type() === 'warning' || m.type() === 'error') && /too many (active )?webgl contexts|context lost|oldest context/i.test(m.text())) {
      problems.contextWarnings.push(m.text());
    }
  });
  return problems;
}

/** The test fails if the page had console errors, page errors or WebGL context warnings. */
export function expectClean(problems: Problems): void {
  expect(problems.errors, 'console and page errors').toEqual([]);
  expect(problems.contextWarnings, 'WebGL context warnings').toEqual([]);
}

/**
 * Every test gets a page that records console errors and page errors, and the test fails at the
 * end if there was any. The browser starts with the GL arguments the global setup found working.
 */
export const test = base.extend<{ problems: Problems }, { launchOptions: LaunchOptions }>({
  launchOptions: [
    async ({ launchOptions }: { launchOptions: LaunchOptions }, use: (options: LaunchOptions) => Promise<void>) => {
      await use({ ...launchOptions, args: [...(launchOptions.args ?? []), ...glArgs()] });
    },
    { scope: 'worker' },
  ],
  problems: [
    async ({ page }, use) => {
      const problems = await watchPage(page);
      await use(problems);
      expectClean(problems);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
