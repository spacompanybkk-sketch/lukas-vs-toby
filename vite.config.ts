import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

/** Lets tools/shots.mjs confirm that the server on the dev port serves this checkout. */
function projectRoot(): Plugin {
  return {
    name: 'lvt-project-root',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lvt/root', (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Content-Type', 'text/plain');
        res.end(server.config.root);
      });
    },
  };
}

/**
 * Writes `dist/cloud-mode.txt` (`live` or `fake`: what the build's VITE_CLOUD resolves to with a
 * plain address) and prints `CLOUD MODE: <mode>` as the build's last line, so a fake build can
 * never be deployed unnoticed. `npm run check:live` reads the file.
 */
function cloudModeStamp(): Plugin {
  let config: ResolvedConfig;
  let mode = 'fake';
  return {
    name: 'lvt-cloud-mode',
    apply: 'build',
    configResolved(c) {
      config = c;
      mode = c.env.VITE_CLOUD === 'live' ? 'live' : 'fake';
    },
    writeBundle() {
      writeFileSync(join(config.root, config.build.outDir, 'cloud-mode.txt'), `${mode}\n`);
    },
    closeBundle() {
      // After Vite's own summary, so it is the last thing the build prints.
      setTimeout(() => console.log(`CLOUD MODE: ${mode}`), 0);
    },
  };
}

export default defineConfig({
  plugins: [preact(), projectRoot(), cloudModeStamp()],
  test: {
    // The browser tests in e2e/ belong to Playwright, which Vitest would otherwise try to run too.
    // The long balance bands (tests/ai/long) run only with `npm run test:balance`.
    exclude: [...configDefaults.exclude, 'e2e/**', ...(process.env.LVT_BALANCE ? [] : ['tests/ai/long/**'])],
    // An 8 GB machine running a browser, the dev server and the suite can be slow: a long
    // timeout and a few workers keep load from showing up as false failures.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 4,
  },
  build: {
    target: 'es2022',
    // Three.js alone is ~540 kB minified, so it gets a chunk of its own, as do the
    // post-processing libraries (~300 kB). Warn if any one chunk grows well past Three.js.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'post', test: /node_modules[\\/](postprocessing|n8ao)[\\/]/ },
          ],
        },
      },
    },
  },
});
