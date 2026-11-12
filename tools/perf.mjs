// Frame-rate measurement: `node tools/perf.mjs` (or `npm run perf`).
//
// Builds the game (skip with --reuse-build), serves the production build (`dist/`) on port 5315
// (or LVT_PERF_PORT) and opens three stress scenes in a headed Chromium at 1440x900 with the real
// GPU, at device scale factor 1 and 2:
//   p1-60, p1-150  the phase-1 crowd (`?scene=stress&units=60`, `150`): the first three cards a side
//   mix-150        the mixed roster (`?scene=stress&mix&units=150`, see src/scenes/stressMix.ts):
//                  all 21 unit kinds at mixed levels, 40+ projectiles of all ten kinds (lobbed and
//                  burning ones among them), 6 puddles, statuses (haste too) on a third, two rocks,
//                  and a spell show and a hero show firing all through the measurement
// in up to three modes:
//   vsync          as a player gets it: the frame interval is pinned to the display's 16.7 ms
//   novsync        --disable-gpu-vsync --disable-frame-rate-limit: the interval is the real cost of a frame
//   novsync-cpu4x  the same with the CPU slowed 4x (CDP Emulation.setCPUThrottlingRate), a rough tablet proxy
// Each run waits 3 s, then records 600 animation-frame intervals, and reports their median,
// 95th percentile and worst; the whole frame callback's time on the CPU (simulation + view +
// render submit, measured by wrapping requestAnimationFrame); the renderer's draw call alone;
// a draw call bounded by gl.finish() (CPU + GPU for one frame, from 120 extra frames); the final
// render scale; and the draw calls and triangles per frame. It also times the card portraits'
// warm-up (all twenty drawn on the title) at both scale factors. Writes artifacts/perf.json.
//
// The budget (unthrottled frame interval, novsync): DPR 1 <= 10 ms, DPR 2 <= 16.6 ms, on the
// MacBook Air M3. It says nothing about an iPad: that is unmeasured (see the README's `?fps`).
//
//   --modes=novsync[,vsync,novsync-cpu4x]   only these modes (default: all three)
//   --scenes=mix-150[,p1-60,p1-150]         only these scenes (default: all three)
//   --no-portraits                          skip the portrait warm-up timing
//   --reuse-build                           serve dist/ as it is (default: build first)
// It reports; it never fails the build. It warns loudly if the GPU is software or the window is
// hidden or unfocused, because then the numbers mean nothing.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism, loadavg } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = Number(process.env.LVT_PERF_PORT) || 5315;
const ORIGIN = `http://localhost:${PORT}`;
const SCENES = [
  { name: 'p1-60', query: 'scene=stress&units=60' },
  { name: 'p1-150', query: 'scene=stress&units=150' },
  { name: 'mix-150', query: 'scene=stress&mix&units=150' },
];
const BUDGET_MS = { 1: 10, 2: 16.6 };
const PORTRAIT_RUNS = 2;
const args = process.argv.slice(2);
const listArg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1].split(',');
const IPAD_NOTE = 'iPad speed is UNPROVEN: nothing here ran on an iPad. These numbers are a MacBook Air M3 in Chromium. '
  + 'Measure on the kids\' iPad in Safari with ?fps (see the README).';
const SCALE_FACTORS = [1, 2];
const MODES = [
  { name: 'vsync', args: [], throttle: 1 },
  { name: 'novsync', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'], throttle: 1 },
  { name: 'novsync-cpu4x', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'], throttle: 4 },
];
const FINISH_FRAMES = 120;
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
  if (!args.includes('--reuse-build') || !existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.log('Building: vite build');
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

/** Times every animation-frame callback of the page itself (the game loop's), from before it runs. */
const WRAP_RAF = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frameCpu = null;
  window.requestAnimationFrame = (cb) => {
    if (cb.__perf) return raf(cb);
    return raf((t) => {
      const t0 = performance.now();
      try {
        cb(t);
      } finally {
        if (window.__frameCpu) window.__frameCpu.push(performance.now() - t0);
      }
    });
  };
};

/** Records frame intervals in the page; resolves with the stats. */
function measure(page, warmUpMs, intervals, finishFrames) {
  return page.evaluate(async ([warm, count, finishCount]) => {
    const lvt = window.__lvt;
    await lvt.ready;
    await new Promise((resolve) => setTimeout(resolve, warm));
    const gl = lvt.renderer.webgl;
    const visible = document.visibilityState === 'visible' && document.hasFocus();
    const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    const high = (list, p) => [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))];

    gl.info.autoReset = false; // the composer renders several passes a frame: count them all
    gl.info.reset();
    // How long the CPU spends in the renderer's draw call each frame (the GPU's own time is not
    // visible from here).
    const cpu = [];
    const draw = lvt.renderer.render.bind(lvt.renderer);
    lvt.renderer.render = (dt) => {
      const t0 = performance.now();
      draw(dt);
      cpu.push(performance.now() - t0);
    };
    window.__frameCpu = [];
    const times = [];
    let last = performance.now();
    const began = last;
    await new Promise((resolve) => {
      const tick = (now) => {
        times.push(now - last);
        last = now;
        // At most 10 s, so a slow machine cannot hold the browser lock for long.
        if (times.length < count && now - began < 10_000) requestAnimationFrame(tick);
        else resolve();
      };
      tick.__perf = true;
      requestAnimationFrame(tick);
    });
    const frameCpu = window.__frameCpu;
    window.__frameCpu = null;
    const contents = lvt.stress.contents ? lvt.stress.contents() : null;
    const info = gl.info.render;
    const calls = Math.round(info.calls / times.length);
    const triangles = Math.round(info.triangles / times.length);
    gl.info.autoReset = true;

    // The same draw call followed by gl.finish(): CPU and GPU time for one frame.
    const context = gl.getContext();
    const bounded = [];
    lvt.renderer.render = (dt) => {
      const t0 = performance.now();
      draw(dt);
      context.finish();
      bounded.push(performance.now() - t0);
    };
    await new Promise((resolve) => {
      const until = performance.now() + 5000;
      const tick = () => (bounded.length < finishCount && performance.now() < until ? requestAnimationFrame(tick) : resolve());
      tick.__perf = true;
      requestAnimationFrame(tick);
    });
    lvt.renderer.render = draw;

    return {
      frames: times.length,
      medianMs: median(times),
      p95Ms: high(times, 0.95),
      worstMs: high(times, 1),
      frameCallbackMedianMs: median(frameCpu),
      frameCallbackP95Ms: high(frameCpu, 0.95),
      drawCpuMedianMs: median(cpu),
      drawFinishedMedianMs: median(bounded),
      drawFinishedP95Ms: high(bounded, 0.95),
      renderScale: lvt.renderer.stats.scale,
      drawCallsPerFrame: calls,
      trianglesPerFrame: triangles,
      unitsAlive: lvt.stress.count,
      contents,
      windowVisible: visible,
    };
  }, [warmUpMs, intervals, finishFrames]);
}

/** Opens the title and times the twenty card portraits (lvt.portraitMs: total; portraitPaintMs: drawing alone). */
async function portraitWarmUp() {
  const out = [];
  browser = await chromium.launch({ headless: false, args: GPU_ARGS, handleSIGINT: false, handleSIGTERM: false });
  for (const deviceScaleFactor of SCALE_FACTORS) {
    for (let run = 0; run < PORTRAIT_RUNS; run++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/?debug`);
      const t = await page.evaluate(async () => {
        const lvt = window.__lvt;
        await lvt.ready;
        await lvt.portraits;
        return { totalMs: lvt.portraitMs, paintMs: lvt.portraitPaintMs };
      });
      out.push({ deviceScaleFactor, run, ...t });
      console.log(`portraits (20)  dpr ${deviceScaleFactor} run ${run + 1}: ${t.totalMs} ms to all twenty, ${t.paintMs} ms of that drawing`);
      await context.close();
    }
  }
  await browser.close();
  browser = null;
  return out;
}

async function main() {
  console.log(`\n!!!!!! ${IPAD_NOTE} !!!!!!\n`);
  await startServer();
  const wantModes = listArg('modes');
  const wantScenes = listArg('scenes');
  const scenes = SCENES.filter((s) => !wantScenes || wantScenes.includes(s.name));
  const portraits = args.includes('--no-portraits') ? [] : await portraitWarmUp();
  const modes = [];
  for (const mode of MODES.filter((m) => !wantModes || wantModes.includes(m.name))) {
    browser = await chromium.launch({ headless: false, args: [...GPU_ARGS, ...mode.args], handleSIGINT: false, handleSIGTERM: false });
    const results = [];
    for (const deviceScaleFactor of SCALE_FACTORS) {
      for (const scene of scenes) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });
        await context.addInitScript(WRAP_RAF);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        if (mode.throttle > 1) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: mode.throttle });
        }
        await page.goto(`${ORIGIN}/?debug&${scene.query}`);
        const stats = await measure(page, WARM_UP_MS, INTERVALS, FINISH_FRAMES);
        const renderer = await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2');
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
        });
        const warnings = [];
        if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) warnings.push(`SOFTWARE RENDERER (${renderer}): these numbers say nothing about a real GPU`);
        const load = loadavg()[0];
        if (load > availableParallelism()) warnings.push(`MACHINE BUSY (load average ${load.toFixed(0)} on ${availableParallelism()} cores): other work is competing for the CPU and GPU, so these times are too high`);
        if (!stats.windowVisible) warnings.push('WINDOW NOT VISIBLE OR NOT FOCUSED: the browser may be throttling frames');
        const row = { mode: mode.name, cpuThrottle: mode.throttle, scene: scene.name, deviceScaleFactor, renderer, loadAverage: load, ...stats, warnings, errors };
        results.push(row);
        for (const w of warnings) console.log(`\n!!!!!! WARNING: ${w} !!!!!!\n`);
        const ms = (v) => v.toFixed(1).padStart(5);
        console.log(
          `${mode.name.padEnd(13)} ${scene.name.padEnd(7)} dpr ${deviceScaleFactor}  interval median ${ms(row.medianMs)} p95 ${ms(row.p95Ms)} worst ${ms(row.worstMs)} ms  `
          + `frame cb ${ms(row.frameCallbackMedianMs)}  draw cpu ${ms(row.drawCpuMedianMs)}  draw+finish ${ms(row.drawFinishedMedianMs)} (p95 ${ms(row.drawFinishedP95Ms)})  `
          + `scale ${row.renderScale.toFixed(2)}  calls ${row.drawCallsPerFrame}  tris ${row.trianglesPerFrame}${errors.length ? `  ERRORS: ${errors.join(' | ')}` : ''}`,
        );
        await context.close();
      }
    }
    modes.push({ mode: mode.name, cpuThrottle: mode.throttle, results });
    await browser.close();
    browser = null;
  }
  await mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
  // The verdict: the unthrottled frame cost against the budget.
  const verdict = [];
  for (const row of modes.find((m) => m.mode === 'novsync')?.results ?? []) {
    const budget = BUDGET_MS[row.deviceScaleFactor];
    const ok = row.medianMs <= budget;
    verdict.push({ scene: row.scene, deviceScaleFactor: row.deviceScaleFactor, medianMs: row.medianMs, budget, ok });
    console.log(`BUDGET ${ok ? 'OK  ' : 'MISS'} ${row.scene.padEnd(7)} dpr ${row.deviceScaleFactor}: ${row.medianMs.toFixed(1)} ms (budget ${budget} ms)`
      + `  calls ${row.drawCallsPerFrame}  tris ${row.trianglesPerFrame}  scale ${row.renderScale.toFixed(2)}`
      + (row.contents ? `  [${Object.entries(row.contents).map(([k, v]) => `${k} ${v}`).join(', ')}]` : ''));
  }
  await writeFile(path.join(ROOT, 'artifacts', 'perf.json'), `${JSON.stringify({
    at: new Date().toISOString(), viewport: '1440x900', ipad: IPAD_NOTE, budgetMs: BUDGET_MS, verdict, portraits, modes,
  }, null, 2)}\n`);
  console.log('Wrote artifacts/perf.json');
  console.log(`\n!!!!!! ${IPAD_NOTE} !!!!!!\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => stopAll());
