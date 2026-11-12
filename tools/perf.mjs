// Frame-rate measurement: `node tools/perf.mjs` (or `npm run perf`).
//
// Serves the production build (`dist/`, built first if missing) on port 5315, opens the stress
// scene (`?scene=stress&units=60` then `units=150`) in a headed Chromium at 1440x900 with the
// real GPU, once at device scale factor 1 and once at 2, waits 3 s, then records 600
// animation-frame intervals. Prints median, 95th percentile and worst frame, the renderer's
// final render scale and the draw calls per frame, and writes artifacts/perf.json. It reports;
// it never fails the build.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = 5315;
const ORIGIN = `http://localhost:${PORT}`;
const UNIT_COUNTS = [60, 150];
const SCALE_FACTORS = [1, 2];
const WARM_UP_MS = 3000;
const INTERVALS = 600;
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

/** The preview server this tool started: stopped by its own PID, nothing else. */
let server = null;
let browser = null;

async function stopAll() {
  if (browser) await browser.close().catch(() => undefined);
  browser = null;
  if (server && server.exitCode === null) server.kill('SIGTERM');
  server = null;
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void stopAll().then(() => process.exit(1)));
}

async function startServer() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.log('No build found: running vite build');
    const built = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (built.status !== 0) throw new Error('build failed');
  }
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`preview server exited: ${log}`);
    try {
      if ((await fetch(ORIGIN)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server did not start: ${log}`);
}

/** Records frame intervals in the page; resolves with the stats. */
function measure(page, warmUpMs, intervals) {
  return page.evaluate(async ([warm, count]) => {
    const lvt = window.__lvt;
    await lvt.ready;
    await new Promise((resolve) => setTimeout(resolve, warm));
    const gl = lvt.renderer.webgl;
    gl.info.autoReset = false; // the composer renders several passes a frame: count them all
    gl.info.reset();
    // How long the CPU spends in the renderer's draw call each frame (the GPU's own time is not
    // visible from the page; vsync holds the frame interval at 16.7 ms until the work is longer).
    const cpu = [];
    const draw = lvt.renderer.render.bind(lvt.renderer);
    lvt.renderer.render = (dt) => {
      const t0 = performance.now();
      draw(dt);
      cpu.push(performance.now() - t0);
    };
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (times.length < count) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    lvt.renderer.render = draw;
    const info = gl.info.render;
    cpu.sort((a, b) => a - b);
    gl.info.autoReset = true;
    const sorted = [...times].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
      frames: times.length,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      worstMs: sorted[sorted.length - 1],
      cpuRenderMedianMs: cpu[Math.floor(cpu.length / 2)],
      cpuRenderP95Ms: cpu[Math.floor(cpu.length * 0.95)],
      renderScale: lvt.renderer.stats.scale,
      drawCallsPerFrame: Math.round(info.calls / times.length),
      trianglesPerFrame: Math.round(info.triangles / times.length),
      unitsAlive: lvt.stress.count,
    };
  }, [warmUpMs, intervals]);
}

async function main() {
  await startServer();
  browser = await chromium.launch({ headless: false, args: GPU_ARGS, handleSIGINT: false, handleSIGTERM: false });
  const results = [];
  for (const deviceScaleFactor of SCALE_FACTORS) {
    for (const units of UNIT_COUNTS) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`${ORIGIN}/?scene=stress&units=${units}`);
      const stats = await measure(page, WARM_UP_MS, INTERVALS);
      const renderer = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      });
      const row = { units, deviceScaleFactor, renderer, ...stats, errors };
      results.push(row);
      console.log(
        `units ${String(units).padStart(3)}  dpr ${deviceScaleFactor}  median ${row.medianMs.toFixed(1)} ms  p95 ${row.p95Ms.toFixed(1)} ms  `
        + `worst ${row.worstMs.toFixed(1)} ms  cpu in draw ${row.cpuRenderMedianMs.toFixed(1)} ms  render scale ${row.renderScale.toFixed(2)}  draw calls ${row.drawCallsPerFrame}  `
        + `triangles ${row.trianglesPerFrame}${errors.length ? `  ERRORS: ${errors.join(' | ')}` : ''}`,
      );
      await context.close();
    }
  }
  await mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
  await writeFile(path.join(ROOT, 'artifacts', 'perf.json'), `${JSON.stringify({ at: new Date().toISOString(), viewport: '1440x900', results }, null, 2)}\n`);
  console.log('Wrote artifacts/perf.json');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => stopAll());
