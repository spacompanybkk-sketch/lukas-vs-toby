import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
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

export default defineConfig({
  plugins: [preact(), projectRoot()],
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
