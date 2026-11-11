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
    // Three.js alone is ~500 kB minified; warn if the one game bundle grows well past that.
    chunkSizeWarningLimit: 700,
  },
});
