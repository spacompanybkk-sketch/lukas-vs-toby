import { defineConfig } from '@playwright/test';

// Browser proof: builds the game and serves its own copy on 5314 (never the dev server on 5303),
// then plays it in Chromium with the real GPU (software GL if the probe in e2e/global-setup.ts
// finds no WebGL2). Two projects: a desktop with a mouse, and an iPad with touch. A WebKit
// project can be added later with the same specs.
const PORT = 5314;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'artifacts/e2e',
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: 'ipad',
      use: {
        browserName: 'chromium', viewport: { width: 1024, height: 768 },
        hasTouch: true, isMobile: false, deviceScaleFactor: 2,
      },
    },
  ],
});
