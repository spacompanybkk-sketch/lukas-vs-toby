import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    target: 'es2022',
    // Three.js alone is over 500 kB minified; one game bundle is expected.
    chunkSizeWarningLimit: 1500,
  },
});
