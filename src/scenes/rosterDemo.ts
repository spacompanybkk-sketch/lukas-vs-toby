import { installDebug, markReady } from '../app/debug';
import { GameLoop, STEPS_PER_SECOND } from '../game/GameLoop';
import { BattleView } from '../render/battle/BattleView';
import type { Feel } from '../render/battle/types';
import { Effects } from '../render/fx/Effects';
import { Particles } from '../render/fx/Particles';
import { Renderer, type Quality } from '../render/Renderer';
import { disposeModels } from '../render/voxel/build';
import { seededRandom } from '../render/world/boxes';
import { Lawn } from '../render/world/Lawn';
import { Sky } from '../render/world/Sky';
import type { Command, SimEvent } from '../sim/types';
import { rosterMatch, stepRoster } from './rosterScript';

// The whole roster at work (wiring A): a scripted match in which every unit and every ability
// shows within a minute (see `rosterScript.ts`), through the battle view on the real lawn, with
// no HUD and with sound left out. For judging the new units by eye and for the screenshot tool.
//
//   ?scene=roster-demo            the script plays live, then the match plays on
//   &seed=<n>                     the match's seed (default 7): only chance shots (butter) differ
//   &t=<seconds>                  fast-forwards to that time and freezes there
//   &focus=<lane>,<x>[,<half>]    closes the camera in on a spot (half: half-width, default 1.6)
//   &quality=low|medium|high
//
// `window.__lvt.battle` holds `{ match, view }`, plus `advance(seconds)` (moves a frozen match
// on), `focus(lane, x, half?)`, `redraw()` and `events` (the last step's events).

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
const WARM_UP_FRAMES = 6;
const STEP_SECONDS = 1 / STEPS_PER_SECOND;
/** Frames drawn per step while fast-forwarding, and after it to let animations settle. */
const FRAMES_PER_STEP = 2;
const SETTLE_FRAMES = 6;

function number(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export async function mount(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<() => void> {
  const asked = params.get('quality') as Quality | null;
  const renderer = new Renderer(canvas, asked && QUALITIES.includes(asked) ? asked : 'high');
  const lawn = new Lawn();
  const sky = new Sky();
  renderer.scene.add(sky.group, lawn.group);
  await document.fonts?.load("22px 'Lilita One'").catch(() => undefined);

  const particles = new Particles();
  const fx = new Effects(particles, seededRandom(2026));
  renderer.scene.add(particles.object, fx.group);

  const seed = Math.trunc(number(params, 'seed', 7));
  const match = rosterMatch(seed);
  const view = new BattleView(renderer.scene, renderer.camera, lawn, fx, 'plants'); // every model, the Bone Minion's too

  // Feel: shake and punch go to the camera; hit-stop and slow motion to the loop's clock.
  let hitStopLeft = 0;
  let slowMoLeft = 0;
  const frozenAt = params.has('t') ? Math.max(0, number(params, 't', 0)) : null;
  view.onFeel = (f: Feel) => {
    if (frozenAt !== null) return; // a still has no clock to shake or bend
    if (f.shake) renderer.rig.shake(f.shake, 0.35);
    if (f.punch) renderer.rig.punch(f.punch, f.punchSeconds ?? 0.25, f.focusZ);
    if (f.hitStop) hitStopLeft = Math.max(hitStopLeft, f.hitStop);
    if (f.slowMo) slowMoLeft = Math.max(slowMoLeft, f.slowMo);
  };

  const commands: Command[] = [];
  let celebrated = false;
  let lastEvents: readonly SimEvent[] = [];
  const step = (): void => {
    if (match.state.winner !== null) return;
    lastEvents = stepRoster(match, commands);
    view.applyEvents(lastEvents, match.state);
    if (match.state.winner !== null && !celebrated) {
      celebrated = true;
      void view.celebrate(match.state.winner);
    }
  };

  let time = 0;
  const draw = (alpha: number, dt: number): void => {
    time += dt;
    view.frame(match.state, alpha, dt, time);
    fx.update(dt, renderer.camera);
    lawn.update(time);
    sky.update(time);
  };

  /** Plays `seconds` of the match without drawing to the screen, every step's events to the view. */
  const advance = (seconds: number): void => {
    const steps = Math.round(seconds * STEPS_PER_SECOND);
    for (let i = 0; i < steps; i++) {
      step();
      for (let f = 0; f < FRAMES_PER_STEP; f++) draw((f + 1) / (FRAMES_PER_STEP + 1), STEP_SECONDS / FRAMES_PER_STEP);
    }
  };

  const focus = (lane: number, x: number, half = 1.6): void => {
    renderer.rig.frameSubject({ x: [x - half, x + half], y: [0, 1.4], z: [lane - 0.4, lane + 1.4] }, { side: 0.05, top: 0.06, bottom: 0.08 });
  };

  if (frozenAt !== null) {
    advance(frozenAt);
    for (let f = 0; f < SETTLE_FRAMES; f++) draw(0.5, 1 / 60);
  }
  const focused = (params.get('focus') ?? '').split(',').map(Number);
  if (focused.length >= 2 && focused.every(Number.isFinite)) focus(focused[0] as number, focused[1] as number, focused[2]);

  const lvt = installDebug();
  lvt.renderer = renderer;
  lvt.lawn = lawn;
  /** Draws the frozen picture again without moving time, after a tool has changed something. */
  const redraw = (): void => draw(0.5, 0);
  const debug = { match, view, advance, focus, redraw, get events() { return lastEvents; } };
  lvt.battle = debug;

  let frames = 0;
  const loop = new GameLoop({
    step() {
      if (frozenAt === null) step();
    },
    frame(alpha, realDt, gameDt) {
      if (frozenAt === null) {
        // Hit-stop holds the world for real time; slow motion runs it at a third.
        if (hitStopLeft > 0) hitStopLeft = Math.max(0, hitStopLeft - realDt);
        else if (slowMoLeft > 0) slowMoLeft = Math.max(0, slowMoLeft - realDt);
        loop.timeScale = hitStopLeft > 0 ? 0 : slowMoLeft > 0 ? 0.33 : 1;
        draw(alpha, gameDt);
      }
      renderer.render(frozenAt === null ? realDt : 0);
      if (++frames === WARM_UP_FRAMES) markReady();
    },
  });
  const onResize = (): void => renderer.resize();
  window.addEventListener('resize', onResize);
  loop.start();

  return () => {
    loop.stop();
    window.removeEventListener('resize', onResize);
    view.dispose();
    renderer.scene.remove(particles.object, fx.group, sky.group, lawn.group);
    particles.dispose();
    fx.dispose();
    disposeModels();
    lawn.dispose();
    sky.dispose();
    renderer.dispose();
    if (lvt.renderer === renderer) delete lvt.renderer;
    if (lvt.lawn === lawn) delete lvt.lawn;
    if (lvt.battle === debug) delete lvt.battle;
  };
}
