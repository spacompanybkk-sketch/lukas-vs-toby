import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/** Where the launch arguments that gave WebGL2 are kept for the workers (see fixtures.ts). */
export const GL_ARGS_FILE = 'artifacts/e2e-gl-args.json';

const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** The same choice tools/shots.mjs makes: the real GPU, else software GL, whichever gives WebGL2. */
export default async function globalSetup(): Promise<void> {
  for (const [label, args] of [['metal', GPU_ARGS], ['swiftshader (fallback)', SOFTWARE_ARGS]] as const) {
    const browser = await chromium.launch({ args: [...args] });
    try {
      const page = await browser.newPage();
      const renderer = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return null;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'webgl2';
      });
      if (renderer) {
        console.log(`e2e WebGL2 [${label}]: ${renderer}`);
        mkdirSync('artifacts', { recursive: true });
        writeFileSync(GL_ARGS_FILE, JSON.stringify([...args]));
        return;
      }
    } finally {
      await browser.close();
    }
  }
  throw new Error('No WebGL2 available with GPU or software flags');
}
