import { Object3D, Vector3 } from 'three';
import { installDebug, markReady } from '../app/debug';
import { GameLoop } from '../game/GameLoop';
import { PLANT_BASE_X, ZOMBIE_BASE_X } from '../render/coords';
import { Effects } from '../render/fx/Effects';
import { Particles } from '../render/fx/Particles';
import { getModelDef } from '../render/models/registry';
import { BaseView } from '../render/models/bases';
import { makeProjectile, makeToken, spinToken } from '../render/models/props';
import { PALETTE } from '../render/palette';
import { Renderer, type Quality } from '../render/Renderer';
import { disposeModels } from '../render/voxel/build';
import { ModelInstance } from '../render/voxel/rig';
import { seededRandom } from '../render/world/boxes';
import { Lawn } from '../render/world/Lawn';
import { Sky } from '../render/world/Sky';

// The bases and the effects library on the lawn, for judging them by eye and for the
// screenshot tool.
//
//   ?scene=fx                     three copies of each base side by side on the lawn, at
//                                 health 1, 0.6 and 0.3, with every effect firing in the gap
//   &healths=<a,b,c>              the healths of the three copies (default 1,0.6,0.3)
//   &layout=game                  one base at each end, as in a match, instead
//   &plants=<f>&zombies=<f>       their health in that layout (default 1); &health=<f> sets both
//   &effects=0                    no effects
//   &collapse=plants|zombies|both those bases fall, starting at time 0
//   &strike=<lane>                the plants' base swats at that lane at time 0
//   &focus=plants|zombies         the camera closes in on that end
//   &t=<seconds>                  frozen at that time of the timeline (it runs from 0 to t
//                                 first, so t = 0.15 catches the explosion's flash and ring)
//   &quality=low|medium|high

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
const WARM_UP_FRAMES = 6;
/** The timeline repeats this often when time is not frozen. */
const CYCLE_SECONDS = 3;
const STEP = 1 / 60;

const hex = (c: string): number => parseInt(c.slice(1), 16);

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

  // Floating numbers are drawn with the display font, so it has to be in first.
  await document.fonts?.load("22px 'Lilita One'").catch(() => undefined);

  const game = params.get('layout') === 'game';
  const bases: BaseView[] = [];
  const add = (side: 'plants' | 'zombies', health: number, shift = 0): BaseView => {
    const base = new BaseView(side);
    base.group.position.x += shift;
    base.setHealth(health);
    renderer.scene.add(base.group);
    bases.push(base);
    return base;
  };
  let plantBase: BaseView;
  let zombieBase: BaseView;
  if (game) {
    const both = number(params, 'health', 1);
    plantBase = add('plants', number(params, 'plants', both));
    zombieBase = add('zombies', number(params, 'zombies', both));
  } else {
    const healths = (params.get('healths') ?? '1,0.6,0.3').split(',').map(Number).filter(Number.isFinite).slice(0, 3);
    plantBase = add('plants', healths[0] ?? 1);
    zombieBase = add('zombies', healths[0] ?? 1);
    healths.slice(1).forEach((health, i) => {
      add('plants', health, 2.3 * (i + 1));
      add('zombies', health, -2.3 * (i + 1));
    });
  }

  const focus = params.get('focus');
  if (focus === 'plants' || focus === 'zombies') {
    const [x0, x1] = focus === 'plants' ? PLANT_BASE_X : ZOMBIE_BASE_X;
    renderer.rig.frameSubject({ x: [x0 - 0.6, x1 + 0.6], y: [0, 2.4], z: [-0.3, 5.3] }, { side: 0.04, top: 0.05, bottom: 0.08 });
  }

  const particles = new Particles();
  const effects = new Effects(particles, seededRandom(2026));
  renderer.scene.add(particles.object, effects.group);
  const withEffects = params.get('effects') !== '0';

  // Where effects go: spread over the lawn in a match layout, squeezed into the gap between
  // the copies otherwise.
  const spot = (x: number, y: number, z: number): Vector3 => (game ? new Vector3(x, y, z) : new Vector3(5 + (x - 5) * 0.1, y, z));

  // Things that move through the timeline.
  const pea = makeProjectile('pea');
  const brain = makeProjectile('brain');
  const sun = makeToken('sun');
  const brainToken = makeToken('brain');
  const props = new Object3D();
  props.add(pea, brain, sun, brainToken);
  sun.position.copy(spot(2.5, 0.75, 4.5));
  brainToken.position.copy(spot(7.5, 0.75, 4.5));
  let champion: ModelInstance | null = null;
  if (withEffects) {
    renderer.scene.add(props);
    champion = new ModelInstance(getModelDef('peashooter'), 5);
    champion.root.position.copy(spot(3.5, 0, 0.5));
    champion.play('idle');
    renderer.scene.add(champion.root);
  }

  const collapse = params.get('collapse');
  const strikeLane = params.has('strike') ? number(params, 'strike', 2) : null;

  // The timeline: what fires when, in seconds from the start of a cycle.
  const events: [number, () => void][] = [];
  if (withEffects) {
    events.push(
      [0, () => effects.explosion(spot(5, 0, 2.5), game ? 1.2 : 0.9)],
      [0, () => effects.spark(spot(6.2, 0.45, 1.5))],
      [0, () => effects.blockFlash(spot(7, 0.5, 0.5))],
      [0, () => effects.burst(spot(3, 0.35, 3.5), [hex(PALETTE.leaf), hex(PALETTE.leafDark), hex(PALETTE.leafLight)], 14, 2.2)],
      [0, () => effects.debris(spot(6.8, 0.3, 3.5), [hex(PALETTE.skin), hex(PALETTE.clothPurple), hex(PALETTE.clothDark), hex(PALETTE.bone)], 3)],
      [0, () => effects.dirt(spot(2, 0, 2.5))],
      [0, () => effects.puff(spot(8.2, 0.2, 2.5))],
      [0, () => effects.ring(spot(3.5, 0, 0.5), hex(PALETTE.levelGold), 0.8)],
      [0, () => effects.sparkles(spot(3.5, 0.1, 0.5), hex(PALETTE.levelGold))],
      [0, () => effects.floatText(spot(2.5, 1.1, 4.5), '+25', PALETTE.sun)],
      [0, () => effects.floatText(spot(6.8, 1.1, 3.5), '-40', PALETTE.speedRed)],
      [0, () => plantBase.strike(1)],
      [0, () => zombieBase.hit(3)],
      [0.5, () => effects.spark(spot(8.8, 0.4, 1.5))],
      [0.9, () => effects.floatText(spot(7.5, 1.1, 4.5), '+10', PALETTE.brains)],
      [1.2, () => effects.explosion(spot(4, 0, 3.5), 0.7)],
      [1.5, () => plantBase.strike(3)],
    );
  }
  if (strikeLane !== null) events.push([0, () => plantBase.strike(strikeLane)]);
  if (collapse === 'plants' || collapse === 'both') events.push([0, () => void plantBase.collapse()]);
  if (collapse === 'zombies' || collapse === 'both') events.push([0, () => void zombieBase.collapse()]);

  let time = 0;
  let cycle = 0;
  let smokeIn = 0;
  const step = (dt: number): void => {
    const before = cycle;
    cycle += dt;
    for (const [at, fire] of events) {
      if (at >= before && at < cycle) fire();
      // Effects repeat; a collapse or a swat asked for in the URL happens once.
    }
    if (cycle >= CYCLE_SECONDS && withEffects) cycle -= CYCLE_SECONDS;
    time += dt;

    // A pea flying right down lane 1, a brain flying left down lane 3, each with a trail.
    const flight = (cycle % 2) / 2;
    pea.position.copy(spot(1 + 8 * flight, 0.5, 1.5));
    brain.position.copy(spot(9 - 8 * flight, 0.5, 3.5));
    brain.rotation.set(time * 4, time * 3, 0);
    props.updateMatrixWorld(true);
    if (withEffects) {
      effects.trail(pea, hex(PALETTE.pea));
      effects.trail(brain, hex(PALETTE.brainPink));
    }
    spinToken(sun, time);
    spinToken(brainToken, time + 1);
    if (champion) {
      champion.update(dt);
      champion.root.updateMatrixWorld(true);
      if (withEffects) effects.aura(champion.root, hex(PALETTE.levelGold));
    }

    // Smoke from every hurt base, a few puffs a second at each point.
    smokeIn -= dt;
    if (smokeIn <= 0) {
      smokeIn += 0.14;
      for (const base of bases) for (const p of base.smokeAnchors()) effects.smoke(p);
    }
    for (const base of bases) base.update(dt, time);
    // The effects move their particle pool too.
    effects.update(dt, renderer.camera);
  };

  const frozenAt = params.has('t') ? Math.max(0, number(params, 't', 0)) : null;
  if (frozenAt !== null) {
    // Play the timeline up to the asked time in small steps, then hold it there.
    let left = frozenAt;
    while (left > 1e-9) {
      const dt = Math.min(STEP, left);
      step(dt);
      left -= dt;
    }
  }

  const lvt = installDebug();
  lvt.renderer = renderer;
  lvt.lawn = lawn;
  const debug = { bases, particles, effects };
  lvt.fx = debug;

  let frames = 0;
  const loop = new GameLoop({
    step() {},
    frame(_alpha, realDt, gameDt) {
      if (frozenAt === null) step(gameDt);
      lawn.update(time);
      sky.update(time);
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
    for (const base of bases) {
      renderer.scene.remove(base.group);
      base.dispose();
    }
    renderer.scene.remove(particles.object, effects.group, props, sky.group, lawn.group);
    if (champion) {
      renderer.scene.remove(champion.root);
      champion.dispose();
    }
    particles.dispose();
    effects.dispose();
    disposeModels();
    lawn.dispose();
    sky.dispose();
    renderer.dispose();
    if (lvt.renderer === renderer) delete lvt.renderer;
    if (lvt.lawn === lawn) delete lvt.lawn;
    if (lvt.fx === debug) delete lvt.fx;
  };
}
