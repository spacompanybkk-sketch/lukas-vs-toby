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
      const problems: Problems = { errors: [], contextWarnings: [] };
      page.on('pageerror', (e) => problems.errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') problems.errors.push(`console.error: ${m.text()}`);
        if ((m.type() === 'warning' || m.type() === 'error') && /too many (active )?webgl contexts|context lost|oldest context/i.test(m.text())) {
          problems.contextWarnings.push(m.text());
        }
      });
      await use(problems);
      expect(problems.errors, 'console and page errors').toEqual([]);
      expect(problems.contextWarnings, 'WebGL context warnings').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
