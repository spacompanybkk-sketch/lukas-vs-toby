import { signal } from '@preact/signals';
import { render } from 'preact';
import { bossOf } from '../app/BattleController';
import type { BossVM } from '../app/BattleController';
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
import { factionOf } from '../data/units';
import { isBoss } from '../sim/lookup';
import type { BossKey, SimEvent, StatusKind } from '../sim/types';
import { TICKS_PER_SECOND } from '../sim/types';
import { BossBar } from '../ui/hud/BossBar';
import { TopBar } from '../ui/hud/TopBar';
import '../ui/hud/hud.css';
import { STRIKE_DEMOS, bossDemoMatch, strikeDemoBalance } from './bossScript';

// A boss at work (phase 3 Task 3): the demo level of `bossScript.ts` through the battle view on
// the real lawn, with the clock and the boss bar over it (no tray, no sound). For judging the
// bosses by eye and for the screenshot tool.
//
//   ?scene=boss-demo&boss=brainTitan|elderOak   which boss (default the Brain Titan)
//   &strike=stun|blind|burn|none                a test-only Titan that strikes first (tiles at 3–5 s,
//                                               a lane at 9–11 s), leaving that status (bossScript.ts)
//   &seed=<n>                                   the match's seed (default 1)
//   &t=<seconds>                                fast-forwards to that time and freezes there
//   &focus=<lane>,<x>[,<half>]                  closes the camera in on a spot
//   &quality=low|medium|high
//
// `window.__lvt.battle` holds `{ match, view, advance, focus, redraw, events }` as in the roster demo.

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
const WARM_UP_FRAMES = 6;
const STEP_SECONDS = 1 / STEPS_PER_SECOND;
const FRAMES_PER_STEP = 2;
const SETTLE_FRAMES = 6;

function number(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function Hud({ clock, boss, onSkip, intro }: { clock: { value: number }; boss: { value: BossVM | null }; onSkip: () => void; intro: boolean }) {
  return (
    <div data-screen="battle" class="battle">
      <div class="battle__top">
        <div class="battle__left" />
        <TopBar seconds={clock.value} suddenDeath={false} />
        <div class="battle__right" />
      </div>
      <BossBar boss={boss.value} onSkip={onSkip} intro={intro} />
    </div>
  );
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

  const strike = STRIKE_DEMOS.find((s) => s === params.get('strike'));
  const askedBoss = params.get('boss') ?? '';
  const key: BossKey = strike === undefined && isBoss(askedBoss as BossKey) ? (askedBoss as BossKey) : 'brainTitan';
  const seed = Math.trunc(number(params, 'seed', 1));
  const match = strike === undefined ? bossDemoMatch(key, seed) : bossDemoMatch(key, seed, strikeDemoBalance(strike as StatusKind | 'none'));
  const player = factionOf(key) === 'zombies' ? 'plants' : 'zombies';
  const view = new BattleView(renderer.scene, renderer.camera, lawn, fx, player, { balance: match.balance });

  const clock = signal(0);
  const boss = signal<BossVM | null>(null);
  let hitStopLeft = 0;
  let slowMoLeft = 0;
  const frozenAt = params.has('t') ? Math.max(0, number(params, 't', 0)) : null;
  const ui = document.getElementById('ui');
  /** A still taken after the entrance shows no entrance card. */
  const intro = frozenAt === null || frozenAt < 1.5;
  if (ui) render(<Hud clock={clock} boss={boss} onSkip={() => view.bossFx.skipEntrance()} intro={intro} />, ui);
  view.onFeel = (f: Feel) => {
    if (frozenAt !== null) return;
    if (f.shake) renderer.rig.shake(f.shake, 0.35);
    if (f.punch) renderer.rig.punch(f.punch, f.punchSeconds ?? 0.25, f.focusZ);
    if (f.hitStop) hitStopLeft = Math.max(hitStopLeft, f.hitStop);
    if (f.slowMo) slowMoLeft = Math.max(slowMoLeft, f.slowMo);
  };

  let celebrated = false;
  let lastEvents: readonly SimEvent[] = [];
  const step = (): void => {
    if (match.state.winner !== null) return;
    lastEvents = match.step();
    view.applyEvents(lastEvents, match.state);
    clock.value = Math.floor(match.state.tick / TICKS_PER_SECOND);
    const vm = bossOf(match.state, match.balance);
    const old = boss.peek();
    if (vm === null ? old !== null : old === null || old.hp !== vm.hp || old.shield !== vm.shield) boss.value = vm;
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

  const advance = (s: number): void => {
    const steps = Math.round(s * STEPS_PER_SECOND);
    for (let i = 0; i < steps; i++) {
      step();
      for (let f = 0; f < FRAMES_PER_STEP; f++) draw((f + 1) / (FRAMES_PER_STEP + 1), STEP_SECONDS / FRAMES_PER_STEP);
    }
  };

  const focus = (lane: number, x: number, half = 1.6): void => {
    renderer.rig.frameSubject({ x: [x - half, x + half], y: [0, 2.6], z: [lane - 0.4, lane + 1.4] }, { side: 0.05, top: 0.06, bottom: 0.08 });
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
    if (ui) render(null, ui);
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
