// Screenshot tool: `node tools/shots.mjs <scenario...> [--headed]`.
//
// Opens each scenario in Playwright's bundled Chromium at 1440x900, waits for
// `window.__lvt.ready`, and saves artifacts/shots/<scenario>.png. Exits non-zero on
// any page error or if the 3D canvas came out as one flat colour.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** @type {{ name: string, url: string, steps?: (page: import('playwright').Page) => Promise<void> }[]} */
const SCENARIOS = [
  { name: 'boot', url: '/?scene=boot' },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'artifacts', 'shots');
const PORT = 5273;
const ORIGIN = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1440, height: 900 };
const READY_TIMEOUT_MS = 20_000;
const FLAT_THRESHOLD = 0.999; // share of sampled pixels that is one colour

const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, 'localhost');
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
}

/** Starts `vite` on the dev port unless something already listens there. */
async function ensureDevServer() {
  if (await portOpen()) return null;
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  let exited = false;
  child.once('exit', () => (exited = true));
  for (let i = 0; i < 150; i++) {
    if (exited) throw new Error(`dev server exited early:\n${log}`);
    if (await portOpen()) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill('SIGTERM');
  throw new Error(`dev server did not open port ${PORT}:\n${log}`);
}

/** Returns the WebGL2 renderer string, or null if no WebGL2 context can be created. */
async function probeWebGL2(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
  } finally {
    await page.close();
  }
}

/** Launches Chromium with GPU flags, falling back to software GL if WebGL2 is missing. */
async function launchBrowser(headed) {
  for (const [label, args] of [['metal', GPU_ARGS], ['swiftshader (fallback)', SOFTWARE_ARGS]]) {
    const browser = await chromium.launch({ headless: !headed, args });
    const renderer = await probeWebGL2(browser).catch(() => null);
    if (renderer) {
      console.log(`WebGL2 renderer [${label}]: ${renderer}`);
      return browser;
    }
    console.log(`No WebGL2 with ${label} flags: ${args.join(' ')}`);
    await browser.close();
  }
  throw new Error('No WebGL2 context available with GPU or software flags');
}

/** Share of sampled pixels held by the most common colour in a PNG (1 = flat). */
function dominantShare(page, png) {
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const counts = new Map();
    let sampled = 0;
    for (let i = 0; i < data.length; i += 28) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      sampled++;
    }
    return { share: Math.max(...counts.values()) / sampled, colours: counts.size };
  }, png.toString('base64'));
}

async function shoot(browser, scenario) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  try {
    await page.goto(ORIGIN + scenario.url, { waitUntil: 'load' });
    await Promise.race([
      page.evaluate(() => window.__lvt.ready),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`__lvt.ready not resolved in ${READY_TIMEOUT_MS} ms`)), READY_TIMEOUT_MS),
      ),
    ]);
    await page.evaluate(() => document.fonts.ready);
    await scenario.steps?.(page);

    // Judge the 3D canvas on its own: hide the UI layer so text cannot mask a blank canvas.
    const hideUi = await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
    const { share, colours } = await dominantShare(page, await page.screenshot({ type: 'png' }));
    await hideUi.evaluate((el) => el.remove());
    if (share > FLAT_THRESHOLD) problems.push(`canvas is one flat colour (${(share * 100).toFixed(2)}% of pixels)`);

    await mkdir(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${scenario.name}.png`);
    await writeFile(file, await page.screenshot({ type: 'png' }));
    console.log(
      `[${scenario.name}] ${path.relative(ROOT, file)} (${colours} colours, ${(share * 100).toFixed(1)}% dominant)`,
    );
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  } finally {
    await page.close();
  }
  for (const problem of problems) console.error(`[${scenario.name}] ${problem}`);
  return problems.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes('--headed');
  const names = args.filter((a) => !a.startsWith('--'));
  const chosen = names.length ? names.map((n) => SCENARIOS.find((s) => s.name === n) ?? n) : SCENARIOS;
  const unknown = chosen.filter((s) => typeof s === 'string');
  if (unknown.length) {
    console.error(`Unknown scenario: ${unknown.join(', ')}. Known: ${SCENARIOS.map((s) => s.name).join(', ')}`);
    return 2;
  }

  const server = await ensureDevServer();
  let browser;
  let ok = true;
  try {
    browser = await launchBrowser(headed);
    for (const scenario of chosen) ok = (await shoot(browser, scenario)) && ok;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
  return ok ? 0 : 1;
}

process.exitCode = await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  return 1;
});
