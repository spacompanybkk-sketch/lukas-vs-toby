import { Object3D, Vector3 } from 'three';
import { installDebug, markReady } from '../app/debug';
import { GameLoop } from '../game/GameLoop';
import { Hazards } from '../render/battle/Hazards';
import { HeroFx } from '../render/battle/HeroFx';
import { SpellFx, spellArea } from '../render/battle/SpellFx';
import { StatusMarks } from '../render/battle/StatusMarks';
import { worldToClient } from '../render/coords';
import { Effects } from '../render/fx/Effects';
import { Particles } from '../render/fx/Particles';
import {
  BURNING_TRAIL,
  PROJECTILE_TRAIL,
  PROJECTILE_TUMBLE,
  lobHeight,
  makeBolt,
  makeBone,
  makeFogBlock,
  makeGravestone,
  makeMegaMower,
  makeMeteor,
  makeProjectile,
  makeRock,
  makeVine,
} from '../render/models/props';
import { getModelDef } from '../render/models/registry';
import { PALETTE } from '../render/palette';
import { Renderer, type Quality } from '../render/Renderer';
import type { ProjectileKind, SpellKey, StatusKind } from '../render/types';
import { disposeModels } from '../render/voxel/build';
import { ModelInstance } from '../render/voxel/rig';
import { seededRandom } from '../render/world/boxes';
import { Lawn } from '../render/world/Lawn';
import { Sky } from '../render/world/Sky';

// Every phase 2 visual on the lawn, under the game's own camera, for judging by eye and for
// the screenshot tool. Nothing here is wired to the simulation: each page stages its units
// and fires its effects on a timeline that repeats every few seconds.
//
//   ?scene=fx-gallery                    cycles through the pages (keys 1–6 or the buttons pick one)
//   &show=projectiles|statuses|spells-plants|spells-zombies|heroes|props
//   &t=<seconds>                         frozen at that time of the page's timeline
//   &labels=0                            no name tags
//   &focus=<x0,x1,z0,z1>                 closes in on that part of the lawn (tiles)
//   &quality=low|medium|high

const PAGES = ['projectiles', 'statuses', 'spells-plants', 'spells-zombies', 'heroes', 'props'] as const;
type PageName = (typeof PAGES)[number];

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
const WARM_UP_FRAMES = 6;
const STEP = 1 / 60;
/** Each page's timeline repeats this often; the auto-cycle moves on after two rounds. */
const CYCLE: Record<PageName, number> = {
  projectiles: 2.4,
  statuses: 4,
  'spells-plants': 6,
  'spells-zombies': 6,
  heroes: 2.6,
  props: 4,
};
/** How big shots are drawn on the lawn (the battle view draws them a little over life size). */
const SHOT_SCALE = 1.15;

const hex = (c: string): number => parseInt(c.slice(1), 16);

interface Kit {
  root: Object3D;
  effects: Effects;
  particles: Particles;
  marks: StatusMarks;
  hazards: Hazards;
  hero: HeroFx;
  spells: SpellFx;
  label(text: string, at: Vector3): void;
}

interface Page {
  /** Moves the page to `time` seconds into its cycle; `wrapped` on the first frame of each cycle. */
  step(dt: number, time: number, wrapped: boolean): void;
}

/** A unit model standing on a tile, idling. */
function unit(kit: Kit, key: string, lane: number, col: number, level = 1): ModelInstance {
  const model = new ModelInstance(getModelDef(key), level);
  model.root.position.set(col + 0.5, 0, lane + 0.5);
  model.play('idle');
  model.root.userData.model = model;
  kit.root.add(model.root);
  return model;
}

function projectilesPage(kit: Kit): Page {
  // Who fires what, from where to where, and whether it is lobbed.
  const flights: { kind: ProjectileKind; lane: number; from: number; to: number; lob: boolean; offset: number; burning?: boolean }[] = [
    { kind: 'pea', lane: 0, from: 1, to: 9.5, lob: false, offset: 0 },
    { kind: 'kernel', lane: 1, from: 1, to: 7.5, lob: true, offset: 0 },
    { kind: 'butter', lane: 1, from: 1, to: 7.5, lob: true, offset: 0.5 },
    { kind: 'mango', lane: 2, from: 1, to: 6.5, lob: true, offset: 0.2 },
    { kind: 'sand', lane: 2, from: 8.6, to: 3, lob: false, offset: 0.6 },
    { kind: 'arrow', lane: 3, from: 8.6, to: 1, lob: false, offset: 0.1 },
    { kind: 'bullet', lane: 3, from: 8.6, to: 1, lob: false, offset: 0.55 },
    { kind: 'brain', lane: 0, from: 8.6, to: 4, lob: false, offset: 0.45 },
    { kind: 'trident', lane: 4, from: 8.6, to: 1, lob: false, offset: 0.3 },
    { kind: 'rot', lane: 4, from: 8.6, to: 2.5, lob: true, offset: 0.75 },
  ];
  unit(kit, 'peashooter', 0, 0);
  unit(kit, 'torchwood', 0, 3);
  unit(kit, 'kernelPult', 1, 0);
  unit(kit, 'mangoPult', 2, 0);
  unit(kit, 'brainEater', 0, 8);
  unit(kit, 'desertZombie', 2, 8);
  unit(kit, 'skeletonArcher', 3, 8);
  unit(kit, 'tridentZombie', 4, 8);
  const shots = flights.map((f) => {
    const plain = makeProjectile(f.kind);
    const fire = f.kind === 'pea' ? makeProjectile('pea', true) : null;
    plain.scale.setScalar(SHOT_SCALE);
    fire?.scale.setScalar(SHOT_SCALE);
    kit.root.add(plain);
    if (fire) kit.root.add(fire);
    return { ...f, plain, fire };
  });
  return {
    step(_dt, time) {
      for (const s of shots) {
        const u = (time / CYCLE.projectiles + s.offset) % 1;
        const x = s.from + (s.to - s.from) * u;
        const y = 0.55 + (s.lob ? lobHeight(Math.abs(s.to - s.from), u) : 0);
        // A pea that has crossed the Torchwood is burning.
        const burning = s.fire !== null && x > 3.5;
        const shown = burning && s.fire ? s.fire : s.plain;
        s.plain.visible = shown === s.plain;
        if (s.fire) s.fire.visible = burning;
        shown.position.set(x, y, s.lane + 0.5);
        const spin = PROJECTILE_TUMBLE[s.kind] * Math.PI * 2 * time;
        shown.rotation.set(spin, spin * 0.7, 0);
        shown.updateMatrixWorld(true);
        kit.effects.trail(shown, burning ? BURNING_TRAIL : PROJECTILE_TRAIL[s.kind]);
      }
    },
  };
}

function statusesPage(kit: Kit): Page {
  const cast: [string, number, number, StatusKind, number?][] = [
    ['peashooter', 0, 2, 'blind'],
    ['sunflower', 1, 2, 'tied'],
    ['walnutBomb', 2, 2, 'poison'],
    ['kernelPult', 3, 2, 'stun'],
    ['peashooter', 4, 2, 'burn', 5],
    ['brainEater', 0, 6, 'stun'],
    ['veryFastWalker', 1, 6, 'haste'],
    ['skeletonWarrior', 2, 6, 'burn'],
    ['desertZombie', 3, 6, 'tied'],
    ['cowboyZombie', 4, 6, 'blind', 5],
  ];
  const units = cast.map(([key, lane, col, status, level], id) => {
    const model = unit(kit, key, lane, col, level ?? 1);
    model.root.updateMatrixWorld(true);
    kit.marks.set(id, model.root, status, true);
    kit.label(status, new Vector3(col + 0.5, 0, lane + 0.95));
    return model;
  });
  void units;
  unit(kit, 'necromancer', 1, 8);
  const hurt = unit(kit, 'hotTopic', 2, 8);
  void hurt;
  return {
    step(_dt, time, wrapped) {
      if (wrapped) {
        kit.hazards.add(1, 2, 2.5, 0.75, 3.6);
        kit.hazards.add(2, 3, 4.5, 0.75, 3.6);
        // The three things that lie on the lawn, side by side, so they can be told apart:
        // the poison puddle (lane 3), the Vines' leafy mat (lanes 0–1) and a scorch (lanes 0–1, right).
        kit.spells.clear();
        kit.spells.cast('vines', 0, 3, 2);
        kit.spells.cast('thunderbolt', 0, 7, 2);
      }
      // The blind Peashooter's shots miss; the Necromancer heals the Hot Topic.
      const beat = Math.floor(time / 0.8);
      const before = Math.floor((time - STEP) / 0.8);
      if (beat !== before) {
        kit.effects.miss(new Vector3(2.5, 1.05, 0.5));
        if (beat % 2 === 0) kit.effects.healPlus(new Vector3(8.5, 0.7, 2.5));
        else kit.effects.floatText(new Vector3(6.5, 1.2, 4.5), '-25', PALETTE.speedRed);
      }
    },
  };
}

/** Casts each of `spells` at its tile on the first frame of every cycle. */
function spellsPage(kit: Kit, spells: [SpellKey, number, number, 0 | 2 | 3][], aim: [SpellKey, number, number, 0 | 2 | 3]): Page {
  return {
    step(_dt, time, wrapped) {
      if (wrapped) {
        kit.spells.clear();
        for (const [spell, lane, col, size] of spells) kit.spells.cast(spell, lane, col, size);
        const [spell, lane, col, size] = aim;
        kit.spells.showArea(spellArea(spell, lane, col, size), spell === 'meteor' || spell === 'fog' || spell === 'frenzy' ? 'zombies' : 'plants');
      }
      // The rock is chewed down and crumbles near the end of the cycle.
      const rock = spells.find(([s]) => s === 'rockWall');
      if (rock) {
        const [, lane, col] = rock;
        if (time > 2.5) kit.spells.setRock(lane, col, 0.5);
        if (time > 4) kit.spells.setRock(lane, col, 0.2);
        if (time > 5.4) kit.spells.crumbleRock(lane, col);
      }
    },
  };
}

function plantSpellsPage(kit: Kit): Page {
  // Zombies to strike and tie, plants to heal.
  for (const [key, lane, col] of [
    ['brainEater', 0, 5],
    ['skeletonWarrior', 1, 6],
    ['desertZombie', 2, 6],
    ['hotTopic', 3, 7],
    ['tridentZombie', 3, 6],
  ] as const) {
    unit(kit, key, lane, col);
  }
  for (const [key, lane, col] of [
    ['peashooter', 2, 1],
    ['sunflower', 3, 2],
    ['walnutBomb', 4, 1],
    ['avocadoBunker', 3, 1],
  ] as const) {
    unit(kit, key, lane, col);
  }
  kit.label('thunder', new Vector3(6, 0, 0.1));
  kit.label('vines', new Vector3(7, 0, 4.1));
  kit.label('rain', new Vector3(2.5, 0, 5.1));
  kit.label('rock', new Vector3(3.5, 0, 1.95));
  kit.label('aim', new Vector3(9, 0, 5.1));
  return spellsPage(
    kit,
    [
      ['thunderbolt', 0, 5, 2],
      ['vines', 2, 6, 2],
      ['healingRain', 3, 2, 3],
      ['rockWall', 1, 3, 0],
      ['sunShower', 0, 0, 0],
    ],
    ['thunderbolt', 3, 8, 2],
  );
}

function zombieSpellsPage(kit: Kit): Page {
  for (const [key, lane, col] of [
    ['peashooter', 0, 3],
    ['sunflower', 1, 4],
    ['walnutBomb', 2, 2],
    ['kernelPult', 3, 3],
    ['peashooter', 2, 3],
  ] as const) {
    unit(kit, key, lane, col);
  }
  const frenzied = [
    ['brainEater', 2, 7],
    ['veryFastWalker', 3, 6],
    ['hotTopic', 4, 8],
  ] as const;
  frenzied.forEach(([key, lane, col], i) => {
    const model = unit(kit, key, lane, col);
    model.root.updateMatrixWorld(true);
    kit.marks.set(100 + i, model.root, 'haste', true);
  });
  kit.label('meteor', new Vector3(4, 0, 0.1));
  kit.label('fog', new Vector3(3, 0, 4.1));
  kit.label('frenzy', new Vector3(7.5, 0, 5.1));
  kit.label('graves', new Vector3(8.5, 0, 2.1));
  kit.label('aim', new Vector3(1, 0, 5.1));
  return spellsPage(
    kit,
    [
      ['meteor', 0, 4, 2],
      ['fog', 2, 3, 2],
      ['frenzy', 3, 7, 3],
      ['graveRise', 1, 8, 0],
      ['brainFeast', 0, 0, 0],
    ],
    ['meteor', 3, 1, 2],
  );
}

function heroesPage(kit: Kit): Page {
  const zombies = [2, 4.4, 6.2, 8].map((col, i) => unit(kit, i % 2 ? 'veryFastWalker' : 'brainEater', 1, col));
  const plants = [0.8, 2.5, 4.2, 6].map((col, i) => unit(kit, i % 2 ? 'sunflower' : 'peashooter', 3, col));
  const flashes = new Map<ModelInstance, number>();
  const strike = (row: ModelInstance[], x: number, reach: number): boolean => {
    let any = false;
    for (const model of row) {
      const ux = model.root.position.x;
      if (Math.abs(ux - x) <= reach && !flashes.has(model)) {
        flashes.set(model, 0);
        kit.effects.floatText(new Vector3(ux, 1.25, model.root.position.z), '-400', PALETTE.speedRed);
        any = true;
      }
    }
    return any;
  };
  kit.label('mega mower', new Vector3(0.5, 0, 1.95));
  kit.label('bone storm', new Vector3(9.5, 0, 3.95));
  return {
    step(dt, _time, wrapped) {
      if (wrapped) {
        flashes.clear();
        for (const m of [...zombies, ...plants]) m.setFlash(0);
        void kit.hero.play('plants', 1, (x) => strike(zombies, x - 0.25, 0.25));
        void kit.hero.play('zombies', 3, (x) => strike(plants, x, 0.3));
      }
      for (const [model, age] of flashes) {
        const next = age + dt;
        flashes.set(model, next);
        model.setFlash(next < 0.06 ? 1 : Math.max(0, 1 - (next - 0.06) / 0.2));
      }
    },
  };
}

function propsPage(kit: Kit): Page {
  const place = (o: Object3D, x: number, y: number, z: number, name: string): Object3D => {
    o.position.set(x, y, z);
    kit.root.add(o);
    kit.label(name, new Vector3(x, 0, z + 0.55));
    return o;
  };
  const mower = place(makeMegaMower(), 1.4, 0, 1.5, 'mega mower');
  ([0, 1, 2] as const).forEach((s) => place(makeRock(s), 1 + s * 1.1, 0, 3.5, `rock ${s}`));
  const meteor = place(makeMeteor(), 4.5, 0.6, 1.5, 'meteor');
  place(makeBone(), 5, 0.1, 3.5, 'bone').rotation.y = 0.5;
  place(makeBolt('plants'), 6.2, 0, 1.5, 'bolt');
  place(makeBolt('zombies'), 7.2, 0, 1.5, 'storm bolt');
  for (let i = 0; i < 4; i++) {
    const vine = makeVine();
    vine.position.set(6 + (i % 2) * 0.3, 0, 3.3 + Math.floor(i / 2) * 0.3);
    vine.scale.set(1.3, 1.5, 1.3);
    kit.root.add(vine);
  }
  kit.label('vines', new Vector3(6.15, 0, 4.05));
  const fog = place(makeFogBlock(), 8.3, 0.4, 1.5, 'fog');
  const fog2 = makeFogBlock();
  fog2.position.set(8.7, 0.75, 1.3);
  kit.root.add(fog2);
  place(makeGravestone(), 7.5, 0, 3.5, 'grave');
  // Every shot, twice life size, along the front lane.
  const kinds: ProjectileKind[] = ['pea', 'brain', 'kernel', 'butter', 'mango', 'sand', 'arrow', 'bullet', 'trident', 'rot'];
  const shots = kinds.map((kind, i) => {
    const o = makeProjectile(kind);
    o.scale.setScalar(2);
    return place(o, 0.6 + i * 0.95, 0.4, 4.5, kind);
  });
  const fire = makeProjectile('pea', true);
  fire.scale.setScalar(2);
  place(fire, 9.6, 0.4, 3.5, 'burning');
  void fog;
  return {
    step(_dt, time) {
      meteor.rotation.set(time * 0.7, time, 0);
      for (const wheel of mower.children) if (wheel.name === 'mower-wheel') wheel.rotation.z = -time * 3;
      for (const s of shots) s.rotation.y = time * 0.8;
    },
  };
}

const BUILD: Record<PageName, (kit: Kit) => Page> = {
  projectiles: projectilesPage,
  statuses: statusesPage,
  'spells-plants': plantSpellsPage,
  'spells-zombies': zombieSpellsPage,
  heroes: heroesPage,
  props: propsPage,
};

export async function mount(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<() => void> {
  const asked = params.get('quality') as Quality | null;
  const renderer = new Renderer(canvas, asked && QUALITIES.includes(asked) ? asked : 'high');
  const lawn = new Lawn();
  const sky = new Sky();
  renderer.scene.add(sky.group, lawn.group);
  await document.fonts?.load("22px 'Lilita One'").catch(() => undefined);

  // `focus=x0,x1,z0,z1` closes the camera in on that part of the lawn.
  const focus = (params.get('focus') ?? '').split(',').map(Number);
  if (focus.length === 4 && focus.every(Number.isFinite)) {
    const [x0, x1, z0, z1] = focus as [number, number, number, number];
    renderer.rig.frameSubject({ x: [x0, x1], y: [0, 1.4], z: [z0, z1] }, { side: 0.04, top: 0.05, bottom: 0.05 });
  }

  const particles = new Particles();
  const effects = new Effects(particles, seededRandom(2026));
  const marks = new StatusMarks();
  const hazards = new Hazards();
  const hero = new HeroFx(effects, { onFeel: (f) => f.shake && renderer.rig.shake(f.shake, 0.3) });
  const spells = new SpellFx(effects, particles, { onFeel: (f) => f.shake && renderer.rig.shake(f.shake, 0.35) });
  const root = new Object3D();
  renderer.scene.add(particles.object, effects.group, marks.group, hazards.group, hero.group, spells.group, root);

  // Name tags, as HTML over the canvas, under each item.
  const ui = document.getElementById('ui') as HTMLElement;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 12px system-ui,sans-serif;';
  ui.appendChild(overlay);
  const showLabels = params.get('labels') !== '0';
  const labels: { el: HTMLElement; at: Vector3 }[] = [];
  const label = (text: string, at: Vector3): void => {
    if (!showLabels) return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:absolute;transform:translate(-50%,0);padding:1px 5px;border-radius:4px;background:rgba(20,14,8,.7);color:#fff;white-space:nowrap;';
    overlay.appendChild(el);
    labels.push({ el, at });
  };
  const placeLabels = (): void => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    for (const { el, at } of labels) {
      const p = worldToClient(at, renderer.camera, viewport);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    }
  };

  // Page buttons along the top.
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:8px;left:8px;display:flex;gap:6px;pointer-events:auto;font:600 12px system-ui,sans-serif;';
  ui.appendChild(bar);

  const kit: Kit = { root, effects, particles, marks, hazards, hero, spells, label };
  const asked2 = params.get('show') as PageName | null;
  const fixed = asked2 && PAGES.includes(asked2) ? asked2 : null;
  let pageName: PageName = fixed ?? 'projectiles';
  let page: Page;
  let time = 0;
  let rounds = 0;

  const clearPage = (): void => {
    hero.clear();
    spells.clear();
    marks.clear();
    hazards.clear();
    effects.clear();
    particles.clear();
    for (const o of [...root.children]) {
      root.remove(o);
      // Unit models are freed here; the props' shared shapes belong to props.ts.
      (o.userData.model as ModelInstance | undefined)?.dispose();
    }
    for (const { el } of labels) el.remove();
    labels.length = 0;
  };
  const open = (name: PageName): void => {
    clearPage();
    pageName = name;
    page = BUILD[name](kit);
    time = 0;
    rounds = 0;
    page.step(0, 0, true);
    for (const b of bar.children) (b as HTMLElement).style.background = (b as HTMLElement).dataset.page === name ? '#FFD54A' : '#fff';
  };
  PAGES.forEach((name, i) => {
    const button = document.createElement('button');
    button.textContent = `${i + 1} ${name}`;
    button.dataset.page = name;
    button.style.cssText = 'padding:4px 8px;border:2px solid #2A1B0E;border-radius:6px;cursor:pointer;color:#2A1B0E;font:inherit;';
    button.onclick = () => open(name);
    bar.appendChild(button);
  });
  const onKey = (event: KeyboardEvent): void => {
    const n = Number(event.key);
    if (n >= 1 && n <= PAGES.length) open(PAGES[n - 1] as PageName);
  };
  window.addEventListener('keydown', onKey);
  open(pageName);

  const step = (dt: number): void => {
    time += dt;
    let wrapped = false;
    if (time >= CYCLE[pageName]) {
      time -= CYCLE[pageName];
      wrapped = true;
      if (++rounds >= 2 && !fixed) {
        open(PAGES[(PAGES.indexOf(pageName) + 1) % PAGES.length] as PageName);
        return;
      }
    }
    page.step(dt, time, wrapped);
    for (const o of root.children) (o.userData.model as ModelInstance | undefined)?.update(dt);
    marks.update(dt);
    hazards.update(dt);
    hero.update(dt);
    spells.update(dt);
    effects.update(dt, renderer.camera);
  };

  const frozenAt = params.has('t') ? Math.max(0, Number(params.get('t')) || 0) : null;
  if (frozenAt !== null) {
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
  const debug = { open, marks, hazards, hero, spells, effects, particles };
  lvt.fxGallery = debug;

  let frames = 0;
  let clock = 0;
  const loop = new GameLoop({
    step() {},
    frame(_alpha, realDt, gameDt) {
      if (frozenAt === null) step(gameDt);
      clock += frozenAt === null ? gameDt : 0;
      lawn.update(clock);
      sky.update(clock);
      renderer.render(frozenAt === null ? realDt : 0);
      placeLabels();
      if (++frames === WARM_UP_FRAMES) markReady();
    },
  });
  const onResize = (): void => renderer.resize();
  window.addEventListener('resize', onResize);
  loop.start();

  return () => {
    loop.stop();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey);
    clearPage();
    overlay.remove();
    bar.remove();
    renderer.scene.remove(particles.object, effects.group, marks.group, hazards.group, hero.group, spells.group, root, sky.group, lawn.group);
    hero.dispose();
    spells.dispose();
    marks.dispose();
    hazards.dispose();
    particles.dispose();
    effects.dispose();
    disposeModels();
    lawn.dispose();
    sky.dispose();
    renderer.dispose();
    if (lvt.renderer === renderer) delete lvt.renderer;
    if (lvt.lawn === lawn) delete lvt.lawn;
    if (lvt.fxGallery === debug) delete lvt.fxGallery;
  };
}
