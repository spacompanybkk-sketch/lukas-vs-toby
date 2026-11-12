import { installDebug, markReady } from '../app/debug';
import { BALANCE } from '../data/balance';
import { GameLoop, STEPS_PER_SECOND } from '../game/GameLoop';
import { BattleView } from '../render/battle/BattleView';
import { Effects } from '../render/fx/Effects';
import { Particles } from '../render/fx/Particles';
import { LAWN_COLS, LAWN_LANES } from '../render/coords';
import { Renderer, type Quality } from '../render/Renderer';
import { disposeModels } from '../render/voxel/build';
import { seededRandom } from '../render/world/boxes';
import { Lawn } from '../render/world/Lawn';
import { Sky } from '../render/world/Sky';
import { Match, defaultConfig, spawnUnit } from '../sim/match';
import { MAX_LEVEL, PLANT_COLS } from '../sim/types';
import type { Faction, SimEvent, UnitKey } from '../sim/types';
import { mixMatch, stepMix } from './stressMix';

// A crowded battle for the performance tool and for judging the worst case by eye: the real
// lawn, bases and battle view, with a real `Match` kept full of units.
//
//   ?scene=stress&units=<n>    n units alive at any time, half per side (default 60)
//   &quality=low|medium|high
//   &mix                       the mixed roster instead (see stressMix.ts): all 21 kinds, every
//                              shot kind, puddles, statuses on a third, two rocks, and a spell
//                              and a hero power always firing
//
// No bots and no player: plants and zombies of mixed types and levels are placed by the scene
// itself and fight where they stand (zombies walk in, plants shoot and bite back). A unit that
// falls is replaced at once, so the walking, attacking, projectiles and effects never run out.
// Both bases are kept whole, so the match never ends. `window.__lvt.stress` holds
// `{ match, view, count }` (units alive now).

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
const DEFAULT_UNITS = 60;
const MAX_UNITS = 600;
const WARM_UP_FRAMES = 6;
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

  const asNumber = Number(params.get('units'));
  const total = Number.isFinite(asNumber) && params.has('units') ? Math.min(MAX_UNITS, Math.max(2, Math.trunc(asNumber))) : DEFAULT_UNITS;
  const perSide = Math.floor(total / 2);
  const random = seededRandom(7);
  const mix = params.has('mix') ? mixMatch(total) : null;
  const match = mix ? mix.match : new Match(defaultConfig(7));
  const state = match.state;
  // The mix can show every model (the default); the phase-1 crowd builds only its own.
  const view = new BattleView(renderer.scene, renderer.camera, lawn, fx, 'plants', mix ? {} : {
    units: [...state.config.cards.plants, ...state.config.cards.zombies],
  });
  // The mix's hero and spell shows move the camera as in a battle (hit-stop is left out).
  if (mix) view.onFeel = (f) => {
    if (f.shake) renderer.rig.shake(f.shake, 0.35);
    if (f.punch) renderer.rig.punch(f.punch, f.punchSeconds ?? 0.25, f.focusZ);
  };
  // The units the first level has (the balance table has numbers for no others), the shooters twice
  // over so that there are always projectiles in the air.
  const plantMix: UnitKey[] = [...state.config.cards.plants, 'peashooter'];
  const zombieMix: UnitKey[] = [...state.config.cards.zombies];

  let spawned = 0;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  /** One new unit of `faction`: plants on the lawn (two to a tile at most), zombies out on the right. */
  const spawn = (faction: Faction, events: SimEvent[]): void => {
    const lane = Math.floor(random() * LAWN_LANES);
    const x = faction === 'plants'
      ? Math.floor(random() * PLANT_COLS) + 0.3 + 0.4 * (spawned % 2)
      : 3 + random() * (LAWN_COLS - 3);
    const unit = spawnUnit(state, BALANCE, pick(faction === 'plants' ? plantMix : zombieMix), lane, x, events);
    unit.level = 1 + Math.floor(random() * MAX_LEVEL);
    spawned += 1;
  };
  /** Tops each side up to its share of units. */
  const fill = (events: SimEvent[]): void => {
    for (const faction of ['plants', 'zombies'] as const) {
      let alive = 0;
      for (const u of state.units) if (u.faction === faction) alive += 1;
      for (; alive < perSide; alive++) spawn(faction, events);
    }
  };
  const first: SimEvent[] = [];
  if (!mix) fill(first);
  view.applyEvents(first, state);

  const mixEvents: SimEvent[] = [];
  const step = (): void => {
    if (mix) {
      mixEvents.length = 0;
      stepMix(mix, mixEvents);
      view.applyEvents(mixEvents, state);
      return;
    }
    state.baseHp.plants = state.baseMaxHp.plants;
    state.baseHp.zombies = state.baseMaxHp.zombies;
    state.winner = null;
    const events = [...match.step([])];
    fill(events);
    view.applyEvents(events, state);
  };

  let time = 0;
  let frames = 0;
  const loop = new GameLoop({
    step,
    frame(alpha, realDt, gameDt) {
      time += gameDt;
      view.frame(state, alpha, gameDt, time);
      fx.update(gameDt, renderer.camera);
      lawn.update(time);
      sky.update(time);
      renderer.render(realDt);
      if (++frames === WARM_UP_FRAMES) markReady();
    },
  });
  const onResize = (): void => renderer.resize();
  window.addEventListener('resize', onResize);

  const lvt = installDebug();
  lvt.renderer = renderer;
  lvt.lawn = lawn;
  const debug = {
    match, view, mix: mix !== null, stepsPerSecond: STEPS_PER_SECOND,
    get count() { return state.units.length; },
    /** What is on the lawn now, for the perf tool's report. */
    contents() {
      const kinds = new Set<string>();
      let statused = 0;
      for (const u of state.units) {
        kinds.add(u.key);
        if (u.stun || u.blind || u.tied || u.poison || u.burn || u.haste) statused += 1;
      }
      return {
        units: state.units.length, kinds: kinds.size, projectiles: state.projectiles.length,
        projectileKinds: new Set(state.projectiles.map((p) => p.kind)).size,
        lobbed: state.projectiles.filter((p) => p.flight === 'lobbed').length,
        burning: state.projectiles.filter((p) => p.burning).length,
        puddles: state.hazards.length, statused, rocks: state.units.filter((u) => u.key === 'rock').length,
      };
    },
  };
  lvt.stress = debug;
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
    if (lvt.stress === debug) delete lvt.stress;
  };
}
