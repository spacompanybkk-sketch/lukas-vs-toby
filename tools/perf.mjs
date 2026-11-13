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
// render submit, measured by wrapping requestAnimationFrame);
// Phase 3 adds four scenes of the real game page set up through the debug hooks (GAME_SETUPS):
//   titan, oak-30, free-w20, map   the Titan mid-fight, the Oak mid-barrage with 30 zombies, Free
//                                  Play survive at wave 20, and the Adventure map the renderer's draw call alone;
// a draw call bounded by gl.finish() (CPU + GPU for one frame, from 120 extra frames); the final
// render scale; and the draw calls and triangles per frame. It also times the card portraits'
// warm-up (all twenty drawn on the title) at both scale factors. Writes artifacts/perf.json.
//
// The budget (unthrottled frame interval, novsync): DPR 1 <= 10 ms, DPR 2 <= 16.6 ms, on the
// MacBook Air M3. It says nothing about an iPad: that is unmeasured (see the README's `?fps`).
//
//   --modes=novsync[,vsync,novsync-cpu4x]   only these modes (default: all three)
//   --scenes=mix-150[,p1-60,p1-150,titan,oak-30,free-w20,map]   only these scenes (default: all)
//   --no-portraits                          skip the portrait warm-up timing
//   --reuse-build                           serve dist/ as it is (default: build first)
//   --adaptive                              let the render scale adapt as in the game (default:
//                                           held at 1, the resolution the budget is set for)
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
  // Phase 3 (Adventure): the real game page, set up through the debug hooks (see GAME_SETUPS).
  { name: 'titan', query: '', setup: 'titan' },
  { name: 'oak-30', query: '', setup: 'oak' },
  { name: 'free-w20', query: '', setup: 'free20' },
  { name: 'map', query: '', setup: 'map' },
];

/**
 * The Adventure scenes, run in the page after it loads (as a test would, through `window.__lvt`):
 * - titan     p1-8 mid-fight: a full garden (lanes 0–4, columns 0–5), the Brain Titan on the lawn
 *             with a scripted wave walking, both bases and the boss kept whole while it is measured;
 * - oak       z1-8 mid-barrage: 30 zombies on the lawn, the Elder Oak lobbing acorns;
 * - free20    Free Play survive at wave 20: a full garden against the twentieth wave;
 * - map       the Adventure map of the plants, half-way done.
 * Every tutorial is marked done first, so no glove holds the match.
 */
const GAME_SETUPS = {
  async login(page) {
    await page.click('[data-action="play"]');
    await page.click('[data-player="p01"]');
    for (let i = 0; i < 2; i++) {
      for (const d of '123') await page.click(`[data-key="${d}"]`);
      if ((await page.locator('[data-pin-step]').count()) === 0) break;
    }
    await page.waitForSelector('[data-screen="home"]');
    await page.evaluate(() => {
      const lvt = window.__lvt;
      const all = lvt.levels;
      const stars = (l) => Object.fromEntries(all.filter((d) => d.id.startsWith(l)).map((d) => [d.id, 2]));
      lvt.players.update((s) => ({
        ...s,
        plants: { stars: stars('p'), unlocked: ['potatoMine', 'kernelPult'] },
        zombies: { stars: stars('z'), unlocked: ['desertZombie', 'skeletonArcher'] },
        teached: all.flatMap((d) => (d.teaches ?? []).map((t) => t.id)),
      }));
    });
  },
  async level(page, side, id) {
    await page.click('[data-home="play"]');
    await page.click('[data-play="adventure"]');
    await page.click(`[data-side="${side}"]`);
    await page.click(`[data-stone="${id}"]`);
    await page.click('[data-action="start-level"]');
    await page.waitForFunction(() => window.__lvt.session?.live === true, null, { timeout: 60_000 });
    await page.waitForSelector('[data-banner]', { state: 'detached', timeout: 30_000 });
  },
  /** Plants on lanes 0–4, columns 0–5 (Sunflowers at the back, then the level's shooters and walls). */
  async garden(page) {
    await page.evaluate(() => {
      const lvt = window.__lvt;
      const c = lvt.session.controller;
      const s = c.match.state;
      const kinds = ['sunflower', 'peashooter', 'peashooter', 'kernelPult', 'peashooter', 'walnutBomb'];
      for (let col = 0; col < 6; col++) {
        for (let lane = 0; lane < 5; lane++) {
          s.players.plants.energy = 1000;
          const card = s.config.cards.plants.includes(kinds[col]) ? kinds[col] : 'peashooter';
          for (let t = 0; t < 400 && (s.players.plants.recharge[card] ?? 0) > 0; t++) { lvt.fastForward(1); lvt.keepAlive(); }
          c.select(card);
          c.click({ lane, col }, null);
          lvt.fastForward(1);
          lvt.keepAlive();
        }
      }
      c.select(null);
    });
  },
  /** Keeps both bases (and a boss) whole while the scene is measured, so it never ends. */
  async hold(page) {
    await page.evaluate(() => {
      setInterval(() => {
        const s = window.__lvt.session?.controller.match.state;
        if (!s) return;
        s.baseHp.plants = s.baseMaxHp.plants;
        s.baseHp.zombies = s.baseMaxHp.zombies;
        // Nobody dies while it is measured: the crowd stays the crowd (the boss at 60%, under its shield marks).
        for (const u of s.units) u.hp = Math.max(u.hp, u.maxHp * (s.config.boss && u.key === s.config.boss.key ? 0.6 : 1));
      }, 200);
      window.__lvt.keepAlive = () => {
        const s = window.__lvt.session.controller.match.state;
        s.baseHp.plants = s.baseMaxHp.plants;
        s.baseHp.zombies = s.baseMaxHp.zombies;
        for (const u of s.units) u.hp = Math.max(u.hp, u.maxHp * 0.6);
      };
    });
  },
  async titan(page) {
    await this.login(page);
    await this.level(page, 'plants', 'p1-8');
    await this.hold(page);
    await this.garden(page);
    await page.evaluate(() => {
      const lvt = window.__lvt;
      const s = lvt.session.controller.match.state;
      // On until the Titan stands on the lawn with a wave walking beside him.
      for (let t = 0; t < 30 * 90; t += 5) {
        lvt.fastForward(5);
        lvt.keepAlive();
        const titan = s.units.some((u) => u.key === 'brainTitan');
        const walkers = s.units.filter((u) => u.faction === 'zombies' && u.key !== 'brainTitan').length;
        if (titan && walkers >= 3) break;
      }
    });
    return page.evaluate(() => {
      const s = window.__lvt.session.controller.match.state;
      return { units: s.units.length, titan: s.units.some((u) => u.key === 'brainTitan'), plants: s.units.filter((u) => u.faction === 'plants').length, zombies: s.units.filter((u) => u.faction === 'zombies').length };
    });
  },
  async oak(page) {
    await this.login(page);
    await this.level(page, 'zombies', 'z1-8');
    await this.hold(page);
    await page.evaluate(() => {
      const lvt = window.__lvt;
      const c = lvt.session.controller;
      const s = c.match.state;
      const cards = s.config.cards.zombies;
      for (let i = 0; s.units.filter((u) => u.faction === 'zombies').length < 30 && i < 400; i++) {
        s.players.zombies.energy = 1000;
        const card = cards[i % cards.length];
        for (let t = 0; t < 400 && (s.players.zombies.recharge[card] ?? 0) > 0; t++) { lvt.fastForward(1); lvt.keepAlive(); }
        c.select(card);
        c.click({ lane: i % 5, col: 9 }, null);
        lvt.fastForward(2);
        lvt.keepAlive();
      }
      c.select(null);
      // On to the Oak's barrage: acorns in the air.
      for (let t = 0; t < 30 * 40; t++) {
        lvt.fastForward(1);
        lvt.keepAlive();
        if (s.projectiles.some((p) => p.kind === 'acorn')) break;
      }
    });
    return page.evaluate(() => {
      const s = window.__lvt.session.controller.match.state;
      return { units: s.units.length, zombies: s.units.filter((u) => u.faction === 'zombies').length, acorns: s.projectiles.filter((p) => p.kind === 'acorn').length, projectiles: s.projectiles.length };
    });
  },
  async free20(page) {
    await this.login(page);
    await page.click('[data-home="play"]');
    await page.click('[data-play="free"]');
    await page.click('[data-side="plants"]');
    await page.waitForFunction(() => window.__lvt.session?.live === true, null, { timeout: 60_000 });
    await page.waitForSelector('[data-banner="ready"], [data-banner="fight"]', { state: 'detached', timeout: 30_000 });
    await this.hold(page);
    await this.garden(page);
    await page.evaluate(() => {
      const lvt = window.__lvt;
      const s = lvt.session.controller.match.state;
      // Straight to the twentieth wave (the debug hook way the shots use), then let it walk on.
      s.wave = 19;
      s.waveTimer = 1;
      for (let t = 0; t < 30 * 12; t++) { lvt.keepAlive(); lvt.fastForward(1); }
    });
    return page.evaluate(() => {
      const s = window.__lvt.session.controller.match.state;
      return { wave: s.wave, units: s.units.length, plants: s.units.filter((u) => u.faction === 'plants').length, zombies: s.units.filter((u) => u.faction === 'zombies').length, incoming: s.incoming.length };
    });
  },
  async map(page) {
    await this.login(page);
    await page.click('[data-home="play"]');
    await page.click('[data-play="adventure"]');
    await page.click('[data-side="plants"]');
    await page.waitForFunction(() => window.__lvt.map?.isOpen === true);
    return { map: 'plants' };
  },
};
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
function measure(page, warmUpMs, intervals, finishFrames, pinScale) {
  return page.evaluate(async ([warm, count, finishCount, pin]) => {
    const lvt = window.__lvt;
    await lvt.ready;
    if (pin) {
      // The budget is for full resolution: hold the adaptive render scale at 1 (otherwise a slow
      // start drops it to 0.6 and the frame looks cheaper than it is at full size).
      lvt.renderer.pinRenderScale(1);
    }
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
    const contents = lvt.stress?.contents ? lvt.stress.contents() : null;
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
      unitsAlive: lvt.stress?.count ?? lvt.session?.controller.match.state.units.length ?? null,
      contents,
      windowVisible: visible,
    };
  }, [warmUpMs, intervals, finishFrames, pinScale]);
}

/** Opens the title and times the twenty card portraits (lvt.portraitMs: total; portraitPaintMs: drawing alone). */
async function portraitWarmUp() {
  const out = [];
  browser = await chromium.launch({ headless: false, args: GPU_ARGS, handleSIGINT: false, handleSIGTERM: false });
  for (const deviceScaleFactor of SCALE_FACTORS) {
    for (let run = 0; run < PORTRAIT_RUNS; run++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/?debug&cloud=fake`);
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
        await page.goto(`${ORIGIN}/?debug&cloud=fake${scene.query ? `&${scene.query}` : ''}`);
        let setup = null;
        if (scene.setup) {
          await page.evaluate(() => window.__lvt.ready);
          setup = await GAME_SETUPS[scene.setup](page);
          console.log(`${scene.name} set up: ${JSON.stringify(setup)}`);
        }
        const stats = await measure(page, WARM_UP_MS, INTERVALS, FINISH_FRAMES, !args.includes('--adaptive'));
        stats.contents = stats.contents ?? setup;
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
  // The verdict: the unthrottled frame cost against the budget. It is only a verdict when the
  // run can be trusted: the machine was not busy, and the frame was drawn at full resolution
  // (the scale pinned at 1, unless --adaptive); otherwise the line says UNRELIABLE and why.
  const verdict = [];
  const pinned = !args.includes('--adaptive');
  const novsync = modes.find((m) => m.mode === 'novsync');
  if (novsync === undefined) console.log('BUDGET not judged: the budget is measured in the novsync mode, which was not among --modes');
  for (const row of novsync?.results ?? []) {
    const budget = BUDGET_MS[row.deviceScaleFactor];
    const ok = row.medianMs <= budget;
    const doubts = [];
    if (row.warnings.some((w) => w.startsWith('MACHINE BUSY'))) doubts.push('machine busy');
    if (row.warnings.some((w) => w.startsWith('SOFTWARE RENDERER'))) doubts.push('software renderer');
    if (pinned && row.renderScale !== 1) doubts.push(`render scale ${row.renderScale.toFixed(2)}, not 1`);
    const reliable = doubts.length === 0;
    verdict.push({ scene: row.scene, deviceScaleFactor: row.deviceScaleFactor, medianMs: row.medianMs, budget, ok: reliable ? ok : null, doubts });
    const word = !reliable ? 'UNRELIABLE' : ok ? 'OK' : 'MISS';
    console.log(`BUDGET ${word.padEnd(10)} ${row.scene.padEnd(7)} dpr ${row.deviceScaleFactor}: ${row.medianMs.toFixed(1)} ms (budget ${budget} ms)`
      + (reliable ? '' : `  (${doubts.join('; ')})`)
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
